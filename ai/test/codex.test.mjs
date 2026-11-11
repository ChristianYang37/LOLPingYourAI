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

test('writer conflicts invalidate only the affected thread and keep its identity', async () => {
  const a = new CodexAdapter({ mcp: {} });
  a.connect = async () => {}; a.modelCatalog = async () => [];
  a.loaded.add('original'); a.loaded.add('other');
  a.rpc = async () => { throw new Error('thread original already has an active writer'); };
  await assert.rejects(a.resume('original', { force: true }), e => e.code === 'SESSION_WRITER_CONFLICT' && e.threadId === 'original');
  assert.equal(a.loaded.has('original'), false); assert.equal(a.loaded.has('other'), true);
  await assert.rejects(a.threadRpc('turn/start', 'original', {}), e => e.code === 'SESSION_WRITER_CONFLICT');
  a.rpc = async (method, params) => { assert.equal(method, 'thread/resume'); assert.equal(params.threadId, 'original'); return { model: 'test' }; };
  assert.equal(await a.resume('original', { force: true }), 'original');
  assert.equal(a.loaded.has('original'), true);
});

test('unrelated resume errors are not classified as writer conflicts', async () => {
  const a = new CodexAdapter({ mcp: {} }); a.rpc = async () => { throw new Error('authentication failed'); };
  await assert.rejects(a.threadRpc('thread/resume', 'original', {}), e => !e.code && e.message === 'authentication failed');
});

test('concurrent resumes share the native ownership request', async () => {
  const a = new CodexAdapter({ mcp: {} }); a.connect = async () => {}; a.modelCatalog = async () => [];
  let count = 0, release;
  a.rpc = async () => { count++; return new Promise(r => { release = r; }); };
  const first = a.resume('s'), second = a.resume('s');
  await new Promise(r => setImmediate(r)); assert.equal(count, 1);
  release({ model: 'test' }); assert.deepEqual(await Promise.all([first, second]), ['s', 's']);
});

test('scoped Codex tool requires the owning turn and propagates target rejections', async () => {
  const adapter = new CodexAdapter({ mcp: {} });
  adapter.active.set('owner', 'current');
  const params = { threadId: 'owner', turnId: 'current', namespace: null, tool: 'lolping_desktop_action', arguments: { contextId: 'old', action: 'click' } };
  assert.equal((await adapter.handleToolCall(params)).success, false);
  let actions = 0;
  adapter.desktopAction = (thread, args) => { actions++; assert.equal(thread, 'owner'); assert.equal(args.contextId, 'old'); throw new Error('Stale ping context'); };
  for (const invalid of [null, { ...params, namespace: 'other' }, { ...params, tool: 'other' }, { ...params, threadId: 'other' }, { ...params, turnId: 'old-turn' }, { ...params, arguments: {} }]) {
    assert.equal((await adapter.handleToolCall(invalid)).success, false);
  }
  assert.equal(actions, 0);
  const result = await adapter.handleToolCall(params);
  assert.equal(result.success, false);
  assert.match(result.contentItems[0].text, /Stale ping/);
  assert.equal(actions, 1);
});

test('Codex cancellation reports a timeout if the interrupt RPC never acknowledges', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const adapter = new CodexAdapter({ mcp: {} });
  adapter.active.set('thread', 'current');
  adapter.rpc = () => new Promise(() => {});
  const failure = assert.rejects(adapter.cancel('thread'), /has not confirmed cancellation/);
  adapter.emit('completed', { threadId: 'thread', turn: { id: 'current', status: 'interrupted' } });
  t.mock.timers.tick(15000);
  await failure;
  assert.equal(adapter.listenerCount('completed'), 0);
});

test('a late interruption for a previous turn cannot revoke its successor', async () => {
  const adapter = fakeServer();
  const completed = [];
  adapter.on('completed', event => completed.push(event.turn.id));
  try {
    const thread = await adapter.create();
    const barrier = new Promise(resolve => adapter.on('event', e => { if (e.method === 'test/barrier') resolve(); }));
    const turn = await adapter.send(thread, 'late completion');
    await barrier;
    assert.equal(adapter.active.get(thread), turn);
    assert.deepEqual(completed, []);
  } finally { adapter.close(); }
});

test('turn/start cannot mark an already interrupted turn active again', async () => {
  const adapter = new CodexAdapter({ mcp: {} });
  adapter.modelCatalog = async () => [{ model: 'fixture', isDefault: true }];
  adapter.threadRpc = async () => {
    adapter.emit('completed', { threadId: 'thread', turn: { id: 'fast', status: 'interrupted' } });
    return { turn: { id: 'fast' } };
  };
  assert.equal(await adapter.send('thread', 'fixture'), 'fast');
  assert.equal(adapter.active.size, 0);
  assert.equal(adapter.listenerCount('completed'), 0);
});
