// Optional interactive macOS regression. Vendor input targets only the board built by this script.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { CodexAdapter } from '../../ai/harness/codex.mjs';
import { Teammate } from '../../ai/service.mjs';
import { Store } from '../../ai/store.mjs';

if (process.platform !== 'darwin' || !process.stdin.isTTY) throw Error('Run interactively on macOS to approve the disposable Computer Use test board.');
const dir = await mkdtemp(join(tmpdir(), 'lolping-cua-'));
const title = 'LOLPing Cancellation Board ' + basename(dir);
const bundle = 'dev.lolpingyourai.test.vendorinput.' + basename(dir);
const path = join(dir, title + '.app');
const executable = join(path, 'Contents/MacOS/Board');
const manifest = join(dir, 'state.json');
const text = 'abcdefghijklmnopqrstuvwxyz0123456789';
const input = createInterface({ input: process.stdin, output: process.stdout });
const abort = new AbortController();
const codex = new CodexAdapter({
  command: process.env.CODEX_CLI_PATH || 'codex', cwd: dir,
  mcp: { command: process.execPath, args: ['-e', 'process.exit(0)'], env: {} },
});
let board, boardExit, service, threadId, selected = false, grant;

async function waitFor(check, label, ms = 10000) {
  const deadline = Date.now() + ms;
  do {
    abort.signal.throwIfAborted();
    const result = await check();
    if (result) return result;
    await delay(5);
  } while (Date.now() < deadline);
  throw Error('Timed out waiting for ' + label);
}
async function readBoard() {
  const state = JSON.parse(await readFile(manifest, 'utf8'));
  assert.equal(state.bundle, bundle);
  assert.equal(state.title, title);
  assert.equal(state.pid, board.pid);
  assert.equal(state.windows, 1);
  return state;
}
async function vendor(args) {
  const result = await codex.rpc('mcpServer/tool/call', { threadId, server: 'cua_repl', tool: 'js', arguments: args });
  if (result.isError) throw Error(result.content.find(item => item.type === 'text')?.text.split('\n')[0] || 'Computer Use failed');
  return result.content;
}
async function allowBoard() {
  await readBoard();
  const answer = await input.question(
    'Allow Computer Use to use "' + title + '" for this test? [y/N] ',
    { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]) },
  );
  return ['y', 'yes'].includes(answer.trim().toLowerCase());
}
codex.on('approval', async ({ id, method, params }) => {
  if (method !== 'mcpServer/elicitation/request') { abort.abort(Error('Unexpected approval request: ' + method)); codex.close(); return; }
  const matches = params.serverName === 'cua_repl' && params.mode === 'form' &&
    params.message === 'Allow Computer Use to use "' + title + '"?' &&
    params.requestedSchema?.type === 'object' && Object.keys(params.requestedSchema.properties ?? {}).length === 0;
  // The vendor can repeat the identical app-level prompt for selection and input.
  // An explicit answer applies only to this generated board in this process.
  if (matches) grant ??= allowBoard().catch(() => false);
  const allowed = matches && await grant;
  codex.respond(id, { action: allowed ? 'accept' : 'decline', content: allowed ? {} : null });
});
const end = () => { abort.abort(Error('Desktop regression interrupted')); codex.close(); };
process.once('SIGINT', end);
process.once('SIGTERM', end);
const deadline = setTimeout(end, 120000);

// Model turns are local fixtures. Actual keyboard actions use the vendor server below.
class FixtureHarness extends EventEmitter {
  active = new Map();
  async create() { return 'fixture'; }
  async send(id) { this.active.set(id, 'turn'); }
  async cancel(id) { this.active.delete(id); this.emit('completed', { threadId: id, turn: { status: 'interrupted' } }); }
  close() {}
}

try {
  await mkdir(dirname(executable), { recursive: true });
  execFileSync('swiftc', [fileURLToPath(new URL('./NativeCuaBoard.swift', import.meta.url)), '-O', '-framework', 'AppKit', '-o', executable]);
  await writeFile(join(path, 'Contents/Info.plist'), `<plist version="1.0"><dict>
    <key>CFBundleName</key><string>${title}</string><key>CFBundleDisplayName</key><string>${title}</string>
    <key>CFBundleExecutable</key><string>Board</string>
    <key>CFBundleIdentifier</key><string>${bundle}</string><key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleVersion</key><string>1</string></dict></plist>`);
  execFileSync('codesign', ['--force', '--sign', '-', path], { stdio: 'pipe' });
  board = spawn(executable, [manifest, title], { stdio: 'ignore' });
  boardExit = once(board, 'exit').catch(() => {});
  const initial = await waitFor(async () => {
    try { return await readBoard(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }, 'the disposable board');
  assert.ok(initial.window > 0);
  assert.equal(initial.text, '');
  await codex.connect();
  ({ thread: { id: threadId } } = await codex.rpc('thread/start', { cwd: dir, ephemeral: true, approvalPolicy: 'on-request', sandbox: 'read-only' }));
  const status = await codex.rpc('mcpServerStatus/list', { threadId, serverName: 'cua_repl', detail: 'toolsAndAuthOnly' });
  assert.ok(status.data.some(s => s.name === 'cua_repl' && s.runtimeStatus === 'connected' && s.tools.js), 'Enable Computer Use in the ChatGPT desktop app.');
  const result = await vendor({ code: 'let board = await cua.getApp(' + JSON.stringify(path) + ')', title: 'Selecting the disposable test board' });
  selected = true;
  assert.ok(result.some(item => item.type === 'text' && item.text.includes(title)), 'Vendor did not identify the fixture');

  let sent = 0, returned = 0, startedActions = 0;
  const target = { id: String(initial.window), pid: initial.pid };
  const desktop = {
    capture: async () => ({ target }),
    async action(args, context, signal) {
      startedActions++;
      assert.deepEqual(context.target, target);
      assert.equal(args.action, 'type');
      assert.equal(args.text, text);
      for (const char of text) {
        signal.throwIfAborted();
        const state = await readBoard();
        assert.equal(state.window, initial.window);
        assert.equal(state.text, text.slice(0, sent));
        signal.throwIfAborted();
        sent++;
        await vendor({ code: 'await board.typeText(' + JSON.stringify(char) + ')', title: 'Typing one test character' });
        returned++;
        // A native RPC can return before the app consumes the event.
        await waitFor(async () => (await readBoard()).text === text.slice(0, returned), 'the board to consume input');
      }
    },
  };
  service = new Teammate({ store: new Store(join(dir, 'service')), desktop, adapters: { codex: new FixtureHarness() } });
  await service.init();
  const { contextId } = await service.dispatch({ signal: 'assist', target });
  const args = { contextId, action: 'type', text };
  const outcome = promise => promise.then(() => null, error => error);
  const typing = outcome(service.action(args));
  const queued = outcome(service.action({ ...args, text: 'queued' }));
  let stop;
  const observed = await Promise.race([
    waitFor(async () => {
      const { text: prefix } = await readBoard();
      if (prefix && sent > returned && sent < text.length) {
        stop = service.dispatch({ signal: 'retreat' });
        return prefix.length;
      }
    }, 'visible text during an outstanding native call', 50000),
    typing.then(error => { throw error ?? Error('Test input finished before Retreat'); }),
  ]);
  const late = outcome(service.action({ ...args, text: 'late' }));
  assert.deepEqual(await stop, { stopped: true });
  assert.equal(service.status().task.phase, 'stopped');
  assert.equal((await typing).name, 'AbortError');
  for (const error of await Promise.all([queued, late])) assert.match(error?.message ?? '', /cancelled/);
  assert.equal(startedActions, 1);
  assert.equal(sent, returned);
  const final = await readBoard();
  assert.ok(final.text.length >= observed && final.text.length < text.length);
  assert.equal(final.text, text.slice(0, sent));
  await delay(1500);
  assert.deepEqual(await readBoard(), final, 'Input changed after Stop');
  console.log(`PASS: characters observed at Retreat: ${observed}; native calls drained: ${returned}; queued and late input rejected. Board stable for 1.5 s.`);
} finally {
  if (selected && !abort.signal.aborted) {
    try { await vendor({ completion_summary: 'Checked native input cancellation' }); } catch {}
  }
  clearTimeout(deadline);
  abort.abort();
  input.close(); service?.close(); codex.close();
  if (board && board.exitCode === null && board.signalCode === null) {
    board.kill('SIGTERM');
    const force = setTimeout(() => board.kill('SIGKILL'), 2000);
    await boardExit;
    clearTimeout(force);
  }
  await service?.store.tail;
  await rm(dir, { recursive: true, force: true });
}
