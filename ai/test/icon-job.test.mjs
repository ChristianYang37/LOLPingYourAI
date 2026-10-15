import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { IconJob } from '../icon-job.mjs';
import { startBridge } from '../server.mjs';
const call = async (bridge, op, args = {}) => {
  const response = await fetch(`${bridge.endpoint}/${op}`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify(args) });
  return { status: response.status, data: await response.json() };
};
test('normal teammates cannot list or submit icons; generation token only allows icon submission', async () => {
  const normal = await startBridge({}, { write: async () => {} });
  let submitted, adapter;
  const job = new IconJob({ icons: { reference: async () => '/reference.png', submit: async (...args) => { submitted = args; return { id: 'candidate' }; } }, mcp: { env: {} }, makeAdapter: () => {
    adapter = new EventEmitter(); Object.assign(adapter, { create: async () => 'icon-session', send: async () => {}, close: () => {}, cancel: async () => {} }); return adapter;
  } });
  try {
    assert.equal((await call(normal, 'tools')).data.some(t => t.name === 'submit_icon'), false);
    assert.equal((await call(normal, 'submit_icon', { name: 'unrequested' })).status, 400);
    await job.start({ prompt: 'smile', reference: 'image' }, {});
    const scoped = job.job.bridge;
    assert.deepEqual((await call(scoped, 'tools')).data.map(t => t.name), ['submit_icon']);
    for (const op of ['desktop_action', 'get_context', 'config', 'ping', 'stop']) assert.equal((await call(scoped, op)).status, 400);
    assert.equal((await call(scoped, 'submit_icon', { name: 'smile' })).status, 200);
    assert.deepEqual(submitted[2], { referenceProvided: true });
    await assert.rejects(job.start({ prompt: 'another' }, {}), /already/);
    adapter.emit('completed'); assert.equal(job.job, null);
    await assert.rejects(call(scoped, 'submit_icon'));
    assert.equal((await call(normal, 'submit_icon')).status, 400);
  } finally { normal.close(); job.close(); }
});
test('cancelling a generation while create is pending revokes it before send', async () => {
  let release, sent = false;
  const adapter = new EventEmitter(); Object.assign(adapter, { create: () => new Promise(r => { release = r; }), send: () => { sent = true; }, close: () => {} });
  const job = new IconJob({ icons: {}, mcp: { env: {} }, makeAdapter: () => adapter });
  const started = job.start({ prompt: 'smile' }, {});
  while (!release) await new Promise(r => setTimeout(r, 1));
  await job.cancel(); release('id');
  await assert.rejects(started, /cancelled/); assert.equal(sent, false);
});
