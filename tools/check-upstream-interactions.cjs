// Actual Chromium decoding, local protocol, wheel geometry and custom audio completion.
// No harness, global input hook, personal configuration or installed app is used.
// Run after pnpm build: pnpm exec electron tools/check-upstream-interactions.cjs
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lolping-upstream-'));
buildSync({ stdin: { contents: "export * from './src/main/appProtocol'; export * from './src/main/emoteLibrary'; export * from './src/shared/settings';", resolveDir: process.cwd() }, bundle: true, platform: 'node', external: ['electron'], outfile: path.join(temp, 'main.cjs') });
const { registerAppScheme, serveAppScheme, EmoteLibrary, DEFAULT_SETTINGS, overlaySettings } = require(path.join(temp, 'main.cjs'));
const renderer = buildSync({ stdin: { contents: "export { SoundBank } from './src/renderer/overlay/soundBank'; export { prepareSound } from './src/renderer/settings/emoteImport';", resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'iife', globalName: 'migrationTest', write: false }).outputFiles[0].text;
const hash = 'a'.repeat(32), id = `c:${hash}`, url = `lolping://emotes/${hash}.sound`;
function wav(seconds) {
  const rate = 8000, n = Math.round(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  // Silent PCM exercises the real audio clock without making test noise.
  return b;
}
registerAppScheme();
const watchdog = setTimeout(() => { console.error('Interaction smoke test timed out'); finish(1); }, 30000);
function finish(code) { clearTimeout(watchdog); fs.rmSync(temp, { recursive: true, force: true }); app.exit(code); }
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 1100, webPreferences: { backgroundThrottling: false, preload: path.resolve('out/preload/overlay.js') } });
  const js = code => win.webContents.executeJavaScript(code);
  try {
    serveAppScheme({ rendererRoot: path.resolve('out/renderer'), emoteDirs: () => [temp], assetDirs: () => [path.resolve('out/renderer')] });
    const library = new EmoteLibrary(temp);
    await win.loadURL('lolping://app/overlay/index.html');
    await js(renderer + '; window.bank = new migrationTest.SoundBank();');
    const timings = [];
    for (const seconds of [.3, .6]) {
      assert.equal(await library.setSound(id, wav(seconds)), null);
      const result = await js(`(async () => {
        const r = await fetch('${url}'); const bytes = await r.arrayBuffer();
        const valid = await migrationTest.prepareSound(new File([bytes], 'test.wav'));
        bank.forget('lolping://emotes/'); const start = performance.now();
        await bank.playUrl('${url}', .1);
        return { ok: valid.ok, elapsed: performance.now() - start, cache: r.headers.get('Cache-Control') };
      })()`);
      assert(result.ok); assert.equal(result.cache, 'no-store');
      assert(result.elapsed >= seconds * 1000 - 30 && result.elapsed < 4000, JSON.stringify(result));
      timings.push(Math.round(result.elapsed));
    }
    await library.setSound(id, wav(5.5));
    assert.deepEqual(await js(`(async () => migrationTest.prepareSound(new File([await (await fetch('${url}')).arrayBuffer()], 'long.wav')))()`), { ok: false, error: 'long' });
    await library.setSound(id, null);
    assert.equal(await js(`fetch('${url}').then(r => r.status)`), 404);
    await js(`bank.forget('lolping://emotes/'); bank.playUrl('${url}', .1)`);
    for (const size of [300, 600, 900]) {
      win.webContents.send('overlay:settings', overlaySettings({ ...DEFAULT_SETTINGS, wheelSizePx: size, muted: true }));
      win.webContents.send('wheel:open', { x: 550, y: 550, wheel: 'ping' });
      await js("Promise.all(document.querySelector('#wheel').getAnimations().map(a => a.finished))");
      const rect = await js(`(() => { const r = document.querySelector('#wheel').getBoundingClientRect(); return { width: r.width, height: r.height, x: r.x, y: r.y }; })()`);
      assert.deepEqual(rect, { width: size, height: size, x: 550 - size / 2, y: 550 - size / 2 });
      win.webContents.send('wheel:cancel', {});
    }
    const flipped = await js(`new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img.naturalWidth > 0); img.onerror = () => resolve(false); img.src = 'lolping://assets/textures/enemy_missing_flipped.png'; })`);
    assert(flipped);
    console.log(JSON.stringify({ passed: true, customSoundElapsedMs: timings, rejectedLongSound: true, deletedSound404: true, wheelSizes: [300, 600, 900], flippedTexture: true }));
    finish(0);
  } catch (error) { console.error(error); finish(1); }
});
