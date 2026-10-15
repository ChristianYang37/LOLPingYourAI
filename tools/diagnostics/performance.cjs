// Credential-free production-code benchmarks. No screen capture or model calls.
// Run with Electron to exercise the actual NativeImage bitmap/PNG implementation.
const { app, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');
const sharp = require('sharp');
const load = name => import(pathToFileURL(resolve(name)).href);
const samples = 12;
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], samples: sorted.length };
};
async function timed(fn) { const start = performance.now(); await fn(); return performance.now() - start; }
// Frozen pre-optimization reference, only in the benchmark (not the app).
async function legacy(image, extract, valid, padding, size) {
  const cropped = await sharp(image.toPNG()).extract(extract).resize(valid.width, valid.height).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: '#151922' } })
    .composite([{ input: cropped, left: padding.left, top: padding.top }]).png().toBuffer();
}
const report = { schema: 1, platform: process.platform, electron: process.versions.electron, node: process.versions.node, results: {}, failures: [] };
function gate(condition, message) { if (!condition) report.failures.push(message); }
const watchdog = setTimeout(() => { console.error('Performance test timed out'); app.exit(1); }, 120000);
app.whenReady().then(async () => {
  const { focusImage, bitmapLayout } = await load('ai/capture-image.mjs');
  const layout = bitmapLayout(nativeImage); assert.ok(layout, 'Known bitmap layout on supported CI hosts');
  const { ConversationLog } = await load('ai/conversation.mjs');
  const { Teammate } = await load('ai/service.mjs');
  const { EventEmitter } = require('node:events');
  const pixels = Buffer.alloc(3840 * 2160 * 4); let seed = 42;
  for (let i = 0; i < pixels.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed & 255; pixels[i + 1] = seed >>> 8 & 255; pixels[i + 2] = seed >>> 16 & 255; pixels[i + 3] = 255;
  }
  const image = nativeImage.createFromBitmap(pixels, { width: 3840, height: 2160 });
  const cases = [
    { extract: { left: 1000, top: 500, width: 1024, height: 1024 }, valid: { width: 512, height: 512 }, padding: { left: 0, top: 0 }, size: 512 },
    { extract: { left: 0, top: 0, width: 400, height: 600 }, valid: { width: 200, height: 300 }, padding: { left: 100, top: 30 }, size: 512 },
    { extract: { left: 300, top: 250, width: 768, height: 768 }, valid: { width: 512, height: 512 }, padding: { left: 0, top: 0 }, size: 512 },
  ];
  for (const { extract, valid, padding, size } of cases) {
    const expected = await sharp(await legacy(image, extract, valid, padding, size)).raw().toBuffer();
    const actual = await sharp(await focusImage(image, extract, valid, padding, size, layout)).raw().toBuffer();
    assert.deepEqual(actual, expected, 'Crop, scaling and padding must remain pixel-identical');
  }
  // Native bitmap alpha may be premultiplied. Preserve the PNG fallback exactly.
  const translucent = nativeImage.createFromBuffer(await sharp({ create: { width: 128, height: 96, channels: 4, background: { r: 220, g: 90, b: 30, alpha: .5 } } }).png().toBuffer());
  const alphaArgs = [{ left: 0, top: 0, width: 128, height: 96 }, { width: 64, height: 48 }, { left: 30, top: 20 }, 128];
  const expectedAlpha = await sharp(await legacy(translucent, ...alphaArgs)).raw().toBuffer();
  assert.deepEqual(await sharp(await focusImage(translucent, ...alphaArgs, layout)).raw().toBuffer(), expectedAlpha);
  assert.deepEqual(await sharp(await focusImage(translucent, ...alphaArgs, null)).raw().toBuffer(), expectedAlpha);
  const opaqueOnly = { getSize: () => image.getSize(), toBitmap: () => image.toBitmap(), toPNG: () => { throw new Error('Opaque fast path encoded the whole window'); } };
  await focusImage(opaqueOnly, cases[0].extract, cases[0].valid, cases[0].padding, 512, layout);
  const { extract, valid, padding, size } = cases[0];
  const current = () => focusImage(image, extract, valid, padding, size, layout);
  const previous = () => legacy(image, extract, valid, padding, size);
  await current(); await previous();
  const crop = [], baseline = [];
  for (let i = 0; i < samples; i++) {
    // Interleave order to reduce thermal/cache ordering bias.
    if (i % 2) { baseline.push(await timed(previous)); crop.push(await timed(current)); }
    else { crop.push(await timed(current)); baseline.push(await timed(previous)); }
  }
  report.results.captureProcessing = { current: summary(crop), reference: summary(baseline), scope: '4K synthetic NativeImage to 512px PNG; excludes OS capture' };
  const ratio = summary(crop).medianMs / summary(baseline).medianMs;
  report.results.captureProcessing.medianRatio = ratio;
  gate(ratio < .8, 'Focus processing must take <80% of full-window reference median');
  gate(summary(crop).p95Ms < 1500, 'Focus processing p95 exceeded 1500ms');

  const rows = Array.from({ length: 50000 }, (_, i) => ({ id: `row-${i}`, text: 'Historical chat record', role: 'user' }));
  const store = { read: async (key, fallback) => key === 'ai-conversation' ? structuredClone(rows) : structuredClone(fallback), write: async () => {} };
  const log = new ConversationLog(store); await log.init();
  const updates = [], scans = [];
  for (let i = 0; i < samples; i++) {
    updates.push(await timed(() => { for (let j = 0; j < 1000; j++) log.update('row-49999', { text: String(j) }); }));
    scans.push(await timed(() => { for (let j = 0; j < 1000; j++) Object.assign(rows.find(r => r.id === 'row-49999'), { text: String(j) }); }));
  }
  assert.equal(log.page().entries.at(-1).text, '999'); await log.flush();
  report.results.historyUpdates = { current: summary(updates), reference: summary(scans), scope: '1000 updates with 50000 retained rows; excludes disk' };
  gate(summary(updates).medianMs < summary(scans).medianMs * .5, 'History update median regressed beyond 50% of linear-scan reference');
  gate(summary(updates).p95Ms < 250, '1000 history updates exceeded 250ms p95');

  class Adapter extends EventEmitter {
    active = new Map(); async create() { return 'perf'; } async resume(id) { return id; }
    async send(id) { this.active.set(id, 'turn'); } close() {}
  }
  const adapter = new Adapter(), service = new Teammate({ store, desktop: {}, adapters: { codex: adapter } }); await service.init();
  assert.equal(service.config.diagnosticsEnabled, false);
  await service.message({ text: 'Performance fixture' });
  const bursts = [];
  for (let i = 0; i < samples; i++) bursts.push(await timed(() => {
    for (let j = 0; j < 1000; j++) adapter.emit('event', { method: 'item/agentMessage/delta', params: { threadId: 'perf', itemId: 'reply', delta: 'x' } });
  }));
  assert.equal(service.task.text.length, samples * 1000);
  assert.equal(service.conversation.page().entries.at(-1).text, service.task.text);
  assert.deepEqual(service.history, []);
  report.results.streamBurst = { ...summary(bursts), scope: '1000 real service text events, 50000 history rows, mock harness, no disk/IPC/network' };
  gate(summary(bursts).p95Ms < 500, '1000 stream events exceeded 500ms p95');
  service.close(); await service.conversation.flush();
}).catch(error => { report.failures.push(error.stack); }).finally(() => {
  clearTimeout(watchdog);
  const output = resolve('performance-results', `${process.platform}.json`);
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); app.exit(report.failures.length ? 1 : 0);
});
