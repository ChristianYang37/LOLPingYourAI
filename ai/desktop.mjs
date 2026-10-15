import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { squareRegion, windowAnchor, anchoredPoint } from './geometry.mjs';

export class Desktop {
  constructor({ electron, helper, dataDir, overlays, pingIds }) { Object.assign(this, { electron, helper, dataDir, overlays, pingIds }); this.savedBounds = new Map(); this.captureTail = Promise.resolve(); }
  native(op, args = {}, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Desktop action cancelled'));
      const cooperative = process.platform === 'win32' && ['key', 'type', 'click', 'scroll'].includes(op);
      const cancelDir = cooperative ? mkdtempSync(join(tmpdir(), 'lolping-input-')) : undefined;
      const cancelFile = cancelDir && join(cancelDir, 'cancel');
      const child = spawn(this.helper, [op], { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
      let killTimer; const abort = () => {
        // The helper checks between complete key strokes and releases held keys
        // in finally. Never confirm cancellation before the process exits.
        if (cooperative) { writeFileSync(cancelFile, 'cancel'); return; }
        child.kill(); killTimer = setTimeout(() => child.kill('SIGKILL'), 3000); };
      signal?.addEventListener('abort', abort, { once: true });
      const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); if (cancelDir) rmSync(cancelDir, { recursive: true, force: true }); };
      // Give synchronous target controls time to consume accepted long text;
      // explicit cancellation is still checked between individual characters.
      const timeoutMs = cooperative && op === 'type' ? 30000 + Math.min(10000, args.text?.length ?? 0) * 30 : 30000;
      let output = '', error = ''; const timer = setTimeout(abort, timeoutMs);
      child.stdin.on('error', e => { error ||= e.message; });
      child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { error += d; });
      child.on('error', e => { cleanup(); reject(e); });
      child.on('close', code => { cleanup(); if (signal?.aborted) return reject(new Error('Desktop action cancelled')); try { const data = JSON.parse(output); data.error || code ? reject(new Error(data.error ?? error)) : resolve(data); } catch { reject(new Error(error || `Desktop helper exited (${code})`)); } });
      child.stdin.end(JSON.stringify({ ...args, ...(cancelFile ? { cancelFile } : {}), excludePid: process.pid }));
    });
  }
  async doctor() { return { ...await this.native('doctor'), helper: this.helper }; }
  async available() { try { const d = await this.doctor(); return !d.locked && d.screenRecording; } catch { return false; } }
  toNativePoint(p) { return process.platform === 'win32' ? this.electron.screen.dipToScreenPoint(p) : p; }
  normalizeWindow(w) {
    if (process.platform !== 'win32') return w;
    return { ...w, nativeBounds: w.bounds, bounds: this.electron.screen.screenToDipRect(null, w.bounds) };
  }
  async resolve(target) { return this.normalizeWindow(await this.native('resolve', { id: target.id, pid: target.pid, processStartedAt: target.processStartedAt, ...(target.windowToken ? { windowToken: target.windowToken } : {}) })); }
  async locate(point) { return windowAnchor(this.normalizeWindow(await this.native('target', this.toNativePoint(point))), point); }
  capture(pointOrTarget, size, tracked = false) {
    const job = this.captureTail.then(() => this.captureNow(pointOrTarget, size, tracked));
    this.captureTail = job.catch(() => {}); return job;
  }
  async captureNow(pointOrTarget, size, tracked) {
    if (!await this.available()) throw new Error('Screen recording permission is missing or desktop is locked');
    if (!pointOrTarget) throw new Error('No target has been selected');
    const { screen, desktopCapturer } = this.electron;
    let target, point;
    if (tracked) { const w = await this.resolve(pointOrTarget); target = { ...w, relative: pointOrTarget.relative }; point = anchoredPoint(target, w.bounds); }
    else { point = pointOrTarget; const w = this.normalizeWindow(await this.native('target', this.toNativePoint(point))); target = windowAnchor(w, point); }
    const display = screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) });
    const region = squareRegion(point, size, { ...display.bounds, scaleFactor: display.scaleFactor });
    const png = await this.overlays.captureWithoutOverlays(async () => {
      // Capture the identified window, including when our settings cover it. A
      // screen image can otherwise describe a different window than the metadata.
      const captureBounds = target.bounds;
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.round(captureBounds.width * display.scaleFactor), height: Math.round(captureBounds.height * display.scaleFactor) } });
      const fresh = await this.resolve(target);
      if (JSON.stringify(fresh.bounds) !== JSON.stringify(target.bounds)) throw new Error('Window moved during capture; take a fresh screenshot');
      const source = sources.find(s => s.id.split(':')[1] === String(target.id));
      {
        const x = Math.max(region.valid.x, target.bounds.x), y = Math.max(region.valid.y, target.bounds.y);
        const right = Math.min(region.valid.x + region.valid.width, target.bounds.x + target.bounds.width), bottom = Math.min(region.valid.y + region.valid.height, target.bounds.y + target.bounds.height);
        region.valid = { x: Math.round(x), y: Math.round(y), width: Math.round(right - x), height: Math.round(bottom - y) };
        region.padding = { left: Math.round(x - region.x), top: Math.round(y - region.y) };
        region.captureKind = 'window';
      }
      if (!source || source.thumbnail.isEmpty()) throw new Error('No screenshot for target window');
      const image = source.thumbnail, actual = image.getSize(), sx = actual.width / captureBounds.width, sy = actual.height / captureBounds.height;
      const extract = { left: Math.max(0, Math.round((region.valid.x - captureBounds.x) * sx)), top: Math.max(0, Math.round((region.valid.y - captureBounds.y) * sy)), width: Math.round(region.valid.width * sx), height: Math.round(region.valid.height * sy) };
      extract.width = Math.min(extract.width, actual.width - extract.left); extract.height = Math.min(extract.height, actual.height - extract.top);
      if (extract.width < 1 || extract.height < 1) throw new Error('Target region is outside the display');
      const cropped = await sharp(image.toPNG()).extract(extract).resize(region.valid.width, region.valid.height).png().toBuffer();
      return sharp({ create: { width: size, height: size, channels: 4, background: '#151922' } }).composite([{ input: cropped, left: region.padding.left, top: region.padding.top }]).png().toBuffer();
    });
    region.imageScale = 1; region.imageWidth = size; region.imageHeight = size;
    const dir = join(this.dataDir, 'captures'); await mkdir(dir, { recursive: true, mode: 0o700 });
    const imagePath = join(dir, `ping-${Date.now()}.png`); await writeFile(imagePath, png, { mode: 0o600 });
    // Keep a bounded local diagnostic history; never delete the just-captured image.
    const old = (await readdir(dir)).filter(f => /^ping-\d+\.png$/.test(f)).sort().slice(0, -100);
    await Promise.all(old.map(f => unlink(join(dir, f)).catch(() => {})));
    return { target, region, imagePath };
  }
  async reply({ signal, target, at, caption }) {
    const point = at === 'cursor' ? this.electron.screen.getCursorScreenPoint() : anchoredPoint(target, (await this.resolve(target)).bounds);
    const display = this.electron.screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) });
    this.overlays.spawnAgent({ id: this.pingIds[signal] ?? 'generic', displayId: display.id, x: point.x - display.bounds.x, y: point.y - display.bounds.y, tag: { name: caption || 'AI', color: 4 } });
  }
  async action(args, context, signal) {
    const native = (op, args) => this.native(op, args, signal);
    const target = await this.resolve(context.target), identity = { id: target.id, pid: target.pid, processStartedAt: target.processStartedAt, ...(target.windowToken ? { windowToken: target.windowToken } : {}) };
    if (['click', 'scroll'].includes(args.action)) {
      if (![args.x, args.y].every(Number.isFinite)) throw new Error('x and y must be finite global logical coordinates');
      if (JSON.stringify(target.bounds) !== JSON.stringify(context.target.bounds)) throw new Error('Window moved. Take a fresh screenshot before acting.');
      if (args.x < target.bounds.x || args.x >= target.bounds.x + target.bounds.width || args.y < target.bounds.y || args.y >= target.bounds.y + target.bounds.height) throw new Error('Point is outside the target window');
      return native(args.action, { ...identity, expectedBounds: process.platform === 'win32' ? target.nativeBounds ?? this.electron.screen.dipToScreenRect(null, target.bounds) : target.bounds, ...this.toNativePoint({ x: args.x, y: args.y }), button: args.button, delta: Math.max(-2000, Math.min(2000, Number(args.delta) || 0)) });
    }
    if (args.action === 'type') { if (typeof args.text !== 'string' || args.text.length > 10000) throw new Error('Invalid text'); return native('type', { ...identity, text: args.text }); }
    if (args.action === 'key') { if (typeof args.key !== 'string' || args.key.length > 50) throw new Error('Invalid key'); return native('key', { ...identity, key: args.key }); }
    if (['maximize', 'restore'].includes(args.action)) {
      let bounds;
      const key = `${target.pid}:${target.processStartedAt ?? ""}:${target.id}:${target.windowToken ?? ""}`;
      if (args.action === 'maximize') { bounds = this.electron.screen.getDisplayMatching(target.bounds).workArea; }
      else { bounds = this.savedBounds.get(key)?.bounds; if (!bounds) throw new Error('No original window bounds saved'); }
      const physical = args.action === 'restore' ? this.savedBounds.get(key)?.nativeBounds : undefined;
      const result = await native('resize', { ...identity, bounds: process.platform === 'win32' ? physical ?? this.electron.screen.dipToScreenRect(null, bounds) : bounds });
      if (args.action === 'maximize' && !this.savedBounds.has(key)) this.savedBounds.set(key, { bounds: target.bounds, nativeBounds: target.nativeBounds });
      if (args.action === 'restore') this.savedBounds.delete(key); return result;
    }
    throw new Error('Unknown desktop action');
  }
}
