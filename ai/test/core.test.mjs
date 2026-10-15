import test from 'node:test';
import assert from 'node:assert/strict';
import { squareRegion, anchoredPoint, windowAnchor } from '../geometry.mjs';
import { validateConfig } from '../config.mjs';
import { ActionGate } from '../gate.mjs';
import { Wards } from '../wards.mjs';

test('square crops retain padding and negative monitor coordinates at 2x DPI', () => {
  const r = squareRegion({ x: -1000, y: 10 }, 512, { x: -1024, y: 0, width: 1024, height: 768, scaleFactor: 2 });
  assert.deepEqual(r.valid, { x: -1024, y: 0, width: 280, height: 266 });
  assert.deepEqual(r.padding, { left: 232, top: 246 });
  assert.equal(r.width, 512); assert.equal(r.scaleFactor, 2);
});

test('window anchors track moved and resized windows', () => {
  const target = windowAnchor({ id: '1', bounds: { x: 0, y: 0, width: 100, height: 100 } }, { x: 25, y: 75 });
  assert.deepEqual(anchoredPoint(target, { x: 300, y: 100, width: 200, height: 400 }), { x: 350, y: 400 });
});

test('danger revokes already queued actions even after enabling a new turn', async () => {
  const gate = new ActionGate(); gate.enable(); let calls = 0;
  const stale = gate.run(() => calls++);
  gate.pause(); gate.enable();
  await assert.rejects(stale, /cancelled/);
  await gate.run(() => calls++); assert.equal(calls, 1);
});

test('read-only ping cannot operate desktop', async () => {
  await assert.rejects(new ActionGate().run(() => {}), /not authorized/);
});

test('config rejects invalid durations and mappings', () => {
  assert.equal(validateConfig().wardHours, 0.5);
  assert.throws(() => validateConfig({ sessionHours: NaN }));
  assert.throws(() => validateConfig({ mappings: { missing: { mode: 'shell', prompt: 'bad' } } }));
});

test('ward persists, waits for unlock, runs once after restart, and can be cleared', async () => {
  const data = {}; const store = { read: async (k, d) => structuredClone(data[k] ?? d), write: async (k, v) => { data[k] = structuredClone(v); } };
  let now = 0, unlocked = false, visits = 0;
  const args = { now: () => now, available: async () => unlocked, visit: async () => { visits++; } };
  const first = new Wards(store, args); await first.init();
  await first.add({ id: 'window' }, 0.5, 'codex');
  const next = new Wards(store, args); await next.init(); now = 1800001;
  await next.tick(); assert.equal(visits, 0);
  unlocked = true; await next.tick(); await next.tick(); assert.equal(visits, 1);
  await next.add({ id: 'window' }, 0.5, 'codex'); await next.cancel('window'); now += 1800001;
  await next.tick(); assert.equal(visits, 1);
});

test('overlapping resume and interval ticks share one scheduler execution', async () => {
  let release, entered, visits = 0, availabilityCalls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const store = { read: async (_, fallback) => fallback, write: async () => {} };
  const wards = new Wards(store, { now: () => 10, available: async () => { availabilityCalls++; entered(); await new Promise(r => { release = r; }); return true; }, visit: async () => { visits++; } });
  await wards.init(); wards.items.push({ id: 'a', status: 'pending', dueAt: 0 });
  const first = wards.tick(); await started; await wards.tick(); release(); await first;
  assert.equal(availabilityCalls, 1); assert.equal(visits, 1);
});

test('visit-now remains pending while locked; cancel by id leaves other wards intact', async () => {
  let now = 0, available = false, visited = [];
  const store = { read: async (_, d) => d, write: async () => {} };
  const w = new Wards(store, { now: () => now, available: async () => available, visit: async item => visited.push(item.id) }); await w.init();
  const a = await w.add({ id: 'window' }, .5, 'codex'), b = await w.add({ id: 'window' }, .5, 'codex');
  await w.update(a.id, 'cancel'); await w.update(b.id, 'now'); await w.tick(); assert.deepEqual(visited, []);
  available = true; await w.tick(); assert.deepEqual(visited, [b.id]); assert.equal(a.status, 'cancelled');
});
