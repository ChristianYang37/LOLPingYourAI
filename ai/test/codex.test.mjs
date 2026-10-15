import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CodexAdapter } from '../harness/codex.mjs';

test('newly created or already loaded Codex thread is not resumed again', async () => {
  const a = new CodexAdapter({ cwd: '/tmp', mcp: {}, skillPath: '/skill' });
  const calls = []; a.connect = async () => {};
  a.rpc = async (method, params) => { calls.push({ method, params }); return { thread: { id: 'fresh' } }; };
  const id = await a.create(); await a.resume(id); await a.resume('persisted'); await a.resume('persisted');
  assert.deepEqual(calls.map(c => c.method), ['thread/start', 'model/list', 'config/read', 'thread/resume']);
});

test('Codex interrupt stays pending until completion is confirmed', async () => {
  const a = new CodexAdapter({ mcp: {} }); a.active.set('s', 't'); a.rpc = async () => ({});
  let finished = false; const cancel = a.cancel('s').then(() => { finished = true; });
  await new Promise(r => setImmediate(r)); assert.equal(finished, false);
  a.emit('completed', { threadId: 's', turn: { id: 't', status: 'interrupted' } }); await cancel; assert.equal(finished, true);
});

const fakeServer = () => new CodexAdapter({ command: process.execPath, cwd: fileURLToPath(new URL('./fixtures/', import.meta.url)), mcp: { command: 'unused', args: [], env: {} }, skillPath: '/skill' });

test('concurrent Codex callers share one initialization before sending requests', async () => {
  const a = fakeServer();
  try { const [, thread] = await Promise.all([a.connect(), a.create()]); assert.equal(thread, 'thread-1'); }
  finally { a.close(); }
});

test('Codex app-server exit fails active turns instead of leaving waiters hanging', async () => {
  const a = fakeServer(); const failures = []; a.on('failure', error => failures.push(error.message));
  const completed = new Promise(resolve => a.on('completed', resolve));
  const thread = await a.create(); await a.send(thread, 'crash now');
  const done = await completed;
  assert.deepEqual([done.threadId, done.turn.status], ['thread-1', 'failed']); assert.equal(a.active.size, 0); assert.match(failures.at(-1), /exited/);
  await assert.doesNotReject(a.cancel(thread)); // Nothing left to interrupt.
  assert.equal(await a.create(), 'thread-1'); // Reconnects with a fresh app-server.
  a.close();
});


test('explicit refresh reloads changed native configuration without replacing thread identity', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'lolping-codex-refresh-')), file = join(dir, 'model');
  const a = fakeServer(); a.mcp.env.FIXTURE_MODEL_FILE = file; const failures = [];
  a.on('failure', e => failures.push(e.message));
  try {
    await writeFile(file, 'custom-before');
    assert.equal((await a.listModels()).defaultModel, 'custom-before');
    const id = await a.create();
    await writeFile(file, 'custom-after');
    assert.equal((await a.listModels()).defaultModel, 'custom-before');
    assert.equal((await a.listModels({ refresh: true })).defaultModel, 'custom-after');
    await a.resume(id); assert.equal(a.models.get(id), 'custom-after');
    assert.deepEqual(failures, []);
  } finally { a.close(); await rm(dir, { recursive: true, force: true }); }
});
