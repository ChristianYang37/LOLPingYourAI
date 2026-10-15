import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { Bridge, BridgeError, BridgeUnavailable, dataDirectory, validateBoard, boardTarget, eventSummary, statusSummary, poll, drive, watchWard, checkStale } from '../core.mjs';

async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'lolping-acceptance-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const fixture = () => ({ kind: 'lolping-test-board', instance: 'fixture', pid: process.pid, windowId: '42', bounds: { x: -900, y: 50, width: 680, height: 520 }, value: 'Ready for a ping.', time: Date.now() });
function fakeClock() { let now = 0; return { now: () => now, sleep: async ms => { now += ms; }, intervalMs: 1 }; }
function mockApp(harness, overrides = {}) {
  const board = fixture(), calls = [];
  const state = { config: { harness }, signals: { missing: { mode: 'observe' }, assist: { mode: 'execute' }, danger: { mode: 'interrupt' }, retreat: { mode: 'stop' } }, busy: false };
  return { board, state, calls, async call(method, args) {
    calls.push({ method, args });
    if (method === 'status') return { ...state, ...overrides };
    if (method === 'ping') {
      state.context = { id: args.id, target: boardTarget(board) }; state.task = { phase: 'done' };
      return { delivered: true, contextId: args.id };
    }
    throw new Error('Unexpected call');
  } };
}

test('platform directories follow the shipped CLI and explicit overrides', () => {
  assert.equal(dataDirectory('darwin', {}, '/Users/test'), '/Users/test/Library/Application Support/LOLPingYourAI');
  assert.equal(dataDirectory('win32', { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }, 'unused'), 'C:\\Users\\test\\AppData\\Roaming\\LOLPingYourAI');
  assert.equal(dataDirectory('linux', { LOLPINGAI_DATA_DIR: '/custom' }), '/custom');
  assert.throws(() => dataDirectory('linux', {}, '/home/test'), /unsupported/);
});
test('manifest refuses stale, restarted and invalid targets without inventing coordinates', () => {
  const b = fixture(); assert.equal(validateBoard(b), b); assert.equal(boardTarget(b).bounds.x, -900);
  for (const patch of [{ time: Date.now() - 6000 }, { time: Date.now() + 5000 }, { pid: 0 }, { windowId: '0' }, { bounds: { ...b.bounds, width: -1 } }]) assert.throws(() => validateBoard({ ...b, ...patch }));
  assert.throws(() => validateBoard(b, Date.now(), 'other'), /restarted/);
});
test('bridge rejects remote descriptors and reloads credentials after a restart', async t => {
  const dir = await temporary(t); let calls = 0;
  const b = new Bridge(dir, { fetchImpl: async (_url, args) => { calls++; assert.equal(args.redirect, 'error'); return { ok: true, json: async () => ({ auth: args.headers.Authorization }) }; } });
  await writeFile(join(dir, 'bridge.json'), JSON.stringify({ endpoint: 'https://example.com', token: 'secret' }));
  await assert.rejects(b.call('status'), /Invalid/); assert.equal(calls, 0);
  for (const token of ['one', 'two']) {
    await writeFile(join(dir, 'bridge.json'), JSON.stringify({ endpoint: 'http://127.0.0.1:12345', token }));
    assert.equal((await b.call('get_context')).auth, `Bearer ${token}`);
  }
});
test('real loopback transport rejects HTTP errors and has a finite timeout', async t => {
  const dir = await temporary(t);
  const server = createServer((req, res) => { if (req.url === '/slow') return; res.writeHead(401); res.end('{"error":"Unauthorized"}'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await writeFile(join(dir, 'bridge.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}`, token: 'fixture' }));
  const b = new Bridge(dir, { timeoutMs: 3000 });
  await assert.rejects(b.call('status'), e => e instanceof BridgeError && e.status === 401);
  await assert.rejects(b.call('slow', {}, 100), e => e instanceof BridgeUnavailable && e.cause?.name === 'TimeoutError');
});
test('timeout never becomes a successful acceptance result', async () => {
  await assert.rejects(poll(async () => ({}), () => false, { ...fakeClock(), timeoutMs: 5 }), /timed out/);
});
for (const harness of ['codex', 'claude', 'dsh']) test(`${harness}: completion uses matching task state and actual board text`, async () => {
  const app = mockApp(harness);
  await drive(app, { harness, steps: [{ signal: 'missing', expectText: app.board.value }] }, { loadBoard: async () => app.board });
  assert.equal(app.calls.find(c => c.method === 'ping').args.target.id, '42');
  await assert.rejects(drive(app, { harness, steps: [{ signal: 'missing', expectText: 'wrong' }] }, { loadBoard: async () => app.board }), /expectText/);
});
test('driver refuses unexpected harnesses, invalid modes, busy turns and unapproved actions before sending', async () => {
  for (const [step, patch, harness, error] of [
    [{ signal: 'assist' }, {}, 'claude', /allow-actions/],
    [{ signal: 'question' }, {}, 'claude', /Unknown signal/],
    [{ signal: 'missing' }, { busy: true }, 'claude', /active/],
    [{ signal: 'missing' }, {}, 'codex', /Select/],
    [{ signal: 'missing', timeoutMs: -1 }, {}, 'claude', /timeout/],
  ]) {
    const app = mockApp('claude', patch);
    await assert.rejects(drive(app, { harness, steps: [step] }, { loadBoard: async () => app.board }), error);
    assert.equal(app.calls.some(c => c.method === 'ping'), false);
  }
});
test('driver distinguishes failure, superseded context, and waiting from completion', async () => {
  for (const [patch, error] of [[{ task: { phase: 'error' } }, /failed/], [{ context: { id: 'unrelated' } }, /superseded/], [{ task: { phase: 'waiting' } }, /timed out/]]) {
    const app = mockApp('claude', patch);
    await assert.rejects(drive(app, { harness: 'claude', steps: [{ signal: 'missing', timeoutMs: 5 }] }, { loadBoard: async () => app.board, waitOptions: fakeClock() }), error);
  }
});
test('driver can correct an owned active turn and confirm Retreat', async () => {
  const app = mockApp('claude'), call = app.call.bind(app);
  app.call = async (method, args) => {
    if (method === 'ping' && args.signal === 'retreat') { app.state.busy = false; app.state.task.phase = 'stopped'; return { stopped: true }; }
    const result = await call(method, args);
    if (method === 'ping') { app.state.busy = true; app.state.task.phase = 'working'; }
    return result;
  };
  await drive(app, { harness: 'claude', steps: [{ signal: 'assist', after: 'working' }, { signal: 'danger', after: 'working' }, { signal: 'retreat', after: 'stopped' }] }, { allowActions: true, loadBoard: async () => app.board });
  assert.equal(app.state.task.phase, 'stopped');
});
test('failed wait stops its own active test but never a superseding context', async () => {
  for (const superseded of [false, true]) {
    const app = mockApp('claude'), original = app.call.bind(app); let stopped = false;
    app.call = async (method, args) => {
      if (method === 'stop') { stopped = true; app.state.busy = false; app.state.task.phase = 'stopped'; return { ok: true }; }
      const r = await original(method, args);
      if (method === 'ping') { app.state.busy = true; app.state.task.phase = 'working'; if (superseded) app.state.context.id = 'other'; }
      return r;
    };
    await assert.rejects(drive(app, { harness: 'claude', steps: [{ signal: 'missing', timeoutMs: 5 }] }, { loadBoard: async () => app.board, waitOptions: fakeClock() }));
    assert.equal(stopped, !superseded);
  }
});
test('ward watcher survives a restart but rejects missing, cancelled, failed and uncertain visits', async () => {
  let samples = 0;
  await watchWard({ call: async () => { if (!samples++) throw new BridgeUnavailable('offline'); return { wards: [{ id: 'ward', status: 'completed' }], busy: false }; } }, 'ward', 'completed', { ...fakeClock(), timeoutMs: 10 });
  for (const status of ['cancelled', 'failed', 'uncertain']) await assert.rejects(watchWard({ call: async () => ({ wards: [{ id: 'ward', status }] }) }, 'ward', 'completed'), /Unexpected/);
  await assert.rejects(watchWard({ call: async () => ({ wards: [] }) }, 'ward', 'completed'), /disappeared/);
  await assert.rejects(watchWard({ call: async () => { throw new BridgeError('Unauthorized', 401); } }, 'ward', 'completed'), /Unauthorized/);
});
test('stale check requires the intended refusal, not just any error', async () => {
  const board = fixture();
  for (const [failure, pass] of [[new BridgeError('Stale ping context. Stop using the previous target.', 400), true], [new BridgeError('Unauthorized', 401), false], [new Error('offline'), false], [null, false]]) {
    const bridge = { call: async method => { if (method === 'status') return { context: { id: 'current', target: boardTarget(board) }, busy: false }; if (failure) throw failure; return { ok: true }; } };
    const run = checkStale(bridge, 'old', { loadBoard: async () => board });
    if (pass) assert.deepEqual(await run, { rejected: true }); else await assert.rejects(run);
  }
});
test('structural summaries support all adapters without leaking private payloads', () => {
  const secret = 'DO_NOT_LOG';
  const s = statusSummary({ config: { harness: 'claude', mappings: secret }, task: { phase: 'done', text: secret }, sessions: secret, context: { imagePath: secret, target: { title: secret, bounds: { x: 0 } } } });
  assert.ok(!JSON.stringify(s).includes(secret));
  for (const event of [
    { method: 'claude/message', params: { type: 'assistant', message: { content: [{ type: 'text', text: secret }, { type: 'tool_use', name: 'desktop_action', input: { text: secret } }] } } },
    { method: 'dsh/update', params: { update: { sessionUpdate: 'tool_call', status: 'pending', kind: 'execute', rawInput: secret } } },
    { method: 'item/started', params: { item: { type: 'commandExecution', command: secret } } },
  ]) assert.ok(!JSON.stringify(eventSummary({ event })).includes(secret));
});
test('CLI returns nonzero on malformed input, creates separate logs and drops transcript content', async t => {
  const dir = await temporary(t), input = join(dir, 'transcript.jsonl');
  await writeFile(input, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'PRIVATE_REPLY' }] } }));
  async function run(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../run.mjs', import.meta.url)), ...args], { cwd: dir });
      let stderr = ''; child.stderr.on('data', d => { stderr += d; }); child.stdout.resume(); child.on('error', reject); child.on('close', code => resolve({ code, stderr }));
    });
  }
  const output = join(dir, 'summary.jsonl');
  assert.equal((await run(['timeline', '--data-dir', dir, '--input', input, '--output', output])).code, 0);
  assert.ok(!(await readFile(output, 'utf8')).includes('PRIVATE_REPLY'));
  assert.equal((await run(['timeline', '--data-dir', dir, '--input', input, '--output', output])).code, 1); // never overwrite
  assert.equal((await run(['bogus'])).code, 1);
  assert.equal((await run(['drive', '--data-dir', dir, '--plan', join(dir, 'absent')])).code, 1);
});
test('watch keeps duplicate events at the same timestamp instead of dropping them', async t => {
  const dir = await temporary(t), output = join(dir, 'watch.jsonl');
  const event = { harness: 'claude', time: 123, event: { method: 'claude/message', params: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'reply_ping' }] } } } };
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ config: { harness: 'claude' }, busy: false, history: [event, event] })); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await writeFile(join(dir, 'bridge.json'), JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}`, token: 'fixture' }));
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../run.mjs', import.meta.url)), 'watch', '--seconds', '0.05', '--data-dir', dir, '--output', output], { stdio: 'ignore' });
    child.on('error', reject); child.on('close', resolve);
  });
  assert.equal(code, 0);
  assert.equal((await readFile(output, 'utf8')).trim().split('\n').map(l => JSON.parse(l)).filter(e => e.kind === 'event').length, 2);
});
test('Test Board publishes fresh native identity, values and bounds without enabling AX', async () => {
  const source = await readFile(new URL('../../test-board.cjs', import.meta.url), 'utf8');
  let win, heartbeat, written, callback;
  const ipcMain = new EventEmitter(), app = new EventEmitter();
  Object.assign(app, { setName() {}, getPath: () => tmpdir(), whenReady: () => ({ then: fn => { callback = fn; } }), quit() {} });
  class BrowserWindow extends EventEmitter {
    constructor() { super(); win = this; this.webContents = {}; this.bounds = { x: -100, y: 10, width: 680, height: 520 }; }
    isDestroyed() { return false; }
    getMediaSourceId() { return 'window:42:0'; }
    getBounds() { return this.bounds; }
    loadURL() {}
  }
  const require = createRequire(import.meta.url);
  vm.runInNewContext(source, { require: name => name === 'electron' ? { app, BrowserWindow, ipcMain } : name === 'node:fs' ? { writeFileSync: (_path, value) => { written = JSON.parse(value); }, renameSync() {} } : require(name), process: { pid: process.pid, env: {} }, setInterval: fn => { heartbeat = fn; return 1; }, clearInterval() {} });
  callback(); heartbeat(); assert.equal(written.windowId, '42'); assert.equal(written.pid, process.pid);
  validateBoard(written);
  ipcMain.emit('board:value', { sender: {} }, 'wrong sender'); assert.equal(written.value, 'Ready for a ping.');
  ipcMain.emit('board:value', { sender: win.webContents }, 'Ping received'); assert.equal(written.value, 'Ping received');
  win.bounds.x = 100; heartbeat(); assert.equal(written.bounds.x, 100);
  assert.ok(!source.includes('setAccessibilitySupportEnabled'));
});
