import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge, drive } from '../core.mjs';
import { Teammate } from '../../../ai/service.mjs';
import { startBridge } from '../../../ai/server.mjs';

// Real HTTP bridge + real service, synthetic adapter and desktop. No account/UI access.
for (const harness of ['codex', 'claude', 'dsh']) test(`${harness}: runner integrates with the shipped bridge and service`, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'acceptance-bridge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const saved = {};
  const store = { read: async (key, fallback) => saved[key] ?? fallback, write: async (key, data) => { saved[key] = structuredClone(data); await writeFile(join(dir, `${key}.json`), JSON.stringify(data)); } };
  let text = 'Ready for a ping.', timer;
  class Adapter extends EventEmitter {
    active = new Map();
    async create() { return 'fixture-session'; }
    async resume() {}
    async send(id) {
      this.active.set(id, {});
      timer = setTimeout(() => { text = 'Ping received'; this.active.delete(id); this.emit('completed', { threadId: id, turn: { status: 'completed' } }); }, 10);
    }
    async cancel(id) { clearTimeout(timer); this.active.delete(id); this.emit('completed', { threadId: id, turn: { status: 'interrupted' } }); }
    close() { clearTimeout(timer); }
  }
  const target = { id: '42', pid: process.pid, bounds: { x: -100, y: 30, width: 680, height: 520 }, relative: { x: .5, y: .5 } };
  const desktop = { available: async () => true, reply: async () => {}, capture: async (input, _size, tracked) => {
    assert.equal(tracked, true); assert.equal(input.id, target.id); return { target, region: {}, imagePath: '/unused-fixture-image' };
  } };
  const service = new Teammate({ store, desktop, adapters: { [harness]: new Adapter() } });
  await service.init(); await service.configure({ harness });
  const server = await startBridge(service, store);
  t.after(() => { server.close(); service.close(); });
  const board = () => ({ instance: 'fixture', pid: process.pid, windowId: '42', bounds: target.bounds, value: text });
  await drive(new Bridge(dir), { harness, steps: [{ signal: 'assist', expectText: 'Ping received', timeoutMs: 2000 }] }, { allowActions: true, loadBoard: async () => board(), waitOptions: { intervalMs: 5 } });
  assert.equal(service.status().task.phase, 'done');
  assert.equal(service.status().context.harness, harness);
});
