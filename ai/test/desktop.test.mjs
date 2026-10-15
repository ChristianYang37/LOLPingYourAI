import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Desktop } from '../desktop.mjs';

test('tracked captures select window identity and pad a 2x negative-coordinate square', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lolping-capture-'));
  const bounds = { x: -950, y: 50, width: 300, height: 200 }, target = { id: '44', pid: 3, bounds, relative: { x: .5, y: .5 } };
  const png = await sharp({ create: { width: 600, height: 400, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const display = { id: 5, bounds: { x: -1024, y: 0, width: 1024, height: 768 }, scaleFactor: 2 };
  const desktop = new Desktop({ dataDir: dir, overlays: { captureWithoutOverlays: fn => fn() }, electron: { screen: {
    getDisplayNearestPoint: () => display,
    screenToDipRect: (_window, rect) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / 2])),
    dipToScreenPoint: point => ({ x: point.x * 2, y: point.y * 2 }),
  }, desktopCapturer: { getSources: async options => { assert.deepEqual(options.types, ['window']); return [{ id: 'window:44:0', thumbnail: { isEmpty: () => false, getSize: () => ({ width: 600, height: 400 }), toPNG: () => png } }]; } } } });
  // Win32 reports physical pixels; the public capture contract uses logical pixels.
  const nativeTarget = process.platform === 'win32'
    ? { ...target, bounds: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, value * 2])) }
    : target;
  desktop.native = async op => op === 'doctor' ? { locked: false, screenRecording: true } : nativeTarget;
  try {
    const capture = await desktop.capture(target, 512, true);
    assert.equal(capture.region.captureKind, 'window'); assert.equal(capture.region.scaleFactor, 2);
    assert.deepEqual(capture.region.valid, bounds);
    const { data, info } = await sharp(capture.imagePath).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 512); assert.equal(info.height, 512);
    assert.deepEqual([...data.subarray((256 * 512 + 256) * 4, (256 * 512 + 256) * 4 + 3)], [255, 0, 0]);
    assert.deepEqual([...data.subarray(0, 3)], [21, 25, 34]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a moved target refuses stale coordinate actions', async () => {
  const desktop = new Desktop({}); desktop.resolve = async () => ({ id: '1', pid: 2, bounds: { x: 20, y: 0, width: 100, height: 100 } });
  await assert.rejects(desktop.action({ action: 'click', x: 25, y: 25 }, { target: { bounds: { x: 0, y: 0, width: 100, height: 100 } } }), /Window moved/);
});

test('resolve preserves the process birth marker instead of silently rebinding a PID', async () => {
  const desktop = new Desktop({});
  desktop.native = async (op, args) => {
    assert.equal(op, 'resolve'); assert.deepEqual(args, { id: '12', pid: 34, processStartedAt: 123.5 });
    throw new Error('Target process restarted; select the window again');
  };
  await assert.rejects(desktop.resolve({ id: '12', pid: 34, processStartedAt: 123.5 }), /process restarted/);
});

test('coordinate actions carry the observed bounds for native revalidation', async () => {
  const target = { id: '12', pid: 34, processStartedAt: 123.5, bounds: { x: 10, y: 20, width: 300, height: 200 } };
  const desktop = new Desktop({ electron: { screen: { dipToScreenPoint: p => p, dipToScreenRect: (_, b) => b } } });
  desktop.resolve = async () => target;
  desktop.native = async (op, args) => {
    assert.equal(op, 'click'); assert.deepEqual(args.expectedBounds, target.bounds);
    assert.equal(args.processStartedAt, target.processStartedAt);
    // Simulate a move between JS resolve and native dispatch. The failure must reach the agent.
    throw new Error('Window moved. Take a fresh screenshot before acting.');
  };
  await assert.rejects(desktop.action({ action: 'click', x: 30, y: 50 }, { target }), /Window moved/);
});

test('window restore state is not inherited by a reused PID and window ID', async () => {
  let target = { id: '12', pid: 34, processStartedAt: 100, bounds: { x: 0, y: 0, width: 100, height: 100 } };
  const desktop = new Desktop({ electron: { screen: { getDisplayMatching: () => ({ workArea: target.bounds }), dipToScreenRect: (_, b) => b } } });
  desktop.resolve = async () => target; desktop.native = async () => ({ ok: true });
  await desktop.action({ action: 'maximize' }, { target });
  target = { ...target, processStartedAt: 200 };
  await assert.rejects(desktop.action({ action: 'restore' }, { target }), /No original window bounds saved/);
});
