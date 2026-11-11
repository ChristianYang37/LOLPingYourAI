// Optional live App Server regression. Run with Node 22+ and Codex on PATH
// (or CODEX_CLI_PATH). The provider is a loopback fixture and the desktop is synthetic.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTick } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { CodexAdapter } from '../ai/harness/codex.mjs';
import { startBridge } from '../ai/server.mjs';
import { Teammate } from '../ai/service.mjs';
import { Store } from '../ai/store.mjs';

const tool = 'lolping_desktop_action', contextId = 'disposable-board';
const receipt = 'completed synthetic action';
const home = await mkdtemp(join(tmpdir(), 'lolping-scoped-action-'));
const failure = Promise.withResolvers(), entered = Promise.withResolvers(), release = Promise.withResolvers();
let requests = 0;

// Two Responses API exchanges in one real Codex turn. The second verifies the
// client's first tool result made it back to the provider before asking for more input.
const provider = createServer(async (req, res) => {
  if (req.url !== '/v1/responses') { res.writeHead(404).end(); return; }
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body), n = ++requests;
    assert.ok(payload.tools.some(t => t.name === tool), 'Scoped action missing from provider request');
    assert.ok(n <= 2, 'Unexpected provider request after interrupt');
    if (n === 2) {
      const output = payload.input.find(i => i.type === 'function_call_output' && i.call_id === 'call_1');
      assert.ok(JSON.stringify(output?.output ?? '').includes(receipt), 'Scoped action result missing');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let seq = 0;
    const event = (type, fields) => res.write('data: ' + JSON.stringify({ type, sequence_number: seq++, ...fields }) + '\n\n');
    const response = { id: 'resp_' + n, object: 'response', model: 'fixture', created_at: 1, output: [] };
    const item = { type: 'function_call', id: 'fc_' + n, call_id: 'call_' + n, name: tool,
      arguments: JSON.stringify({ contextId, action: 'type', text: n === 1 ? 'round-trip' : 'in-flight' }) };
    event('response.created', { response: { ...response, status: 'in_progress' } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } });
    event('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
    event('response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments });
    event('response.output_item.done', { output_index: 0, item: { ...item, status: 'completed' } });
    event('response.completed', { response: { ...response, status: 'completed',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    res.end();
  } catch (error) { res.end(); failure.reject(error); }
});

const adapter = new CodexAdapter({ command: process.env.CODEX_CLI_PATH || 'codex', cwd: home,
  skillPath: join(home, 'SKILL.md'), mcp: { command: process.execPath,
    args: [fileURLToPath(new URL('../ai/mcp.mjs', import.meta.url))], env: { CODEX_HOME: home } } });
const store = new Store(join(home, 'app-data'));
const executed = [];
const desktop = {
  capture: async target => ({ target }),
  async action(args, _context, signal) {
    executed.push(args.text);
    if (args.text === 'round-trip') return { receipt };
    assert.equal(args.text, 'in-flight', 'Queued action reached the desktop');
    entered.resolve(signal);
    await release.promise; // Model an OS operation that takes time to unwind after abort.
    signal.throwIfAborted();
  },
};
const service = new Teammate({ store, desktop, adapters: { codex: adapter } });
adapter.desktopAction = (threadId, args) => {
  assert.equal(threadId, service.sessions.codex.id);
  return service.action(args);
};

async function run() {
  await service.dispatch({ id: contextId, signal: 'assist', target: { id: 'board' } });
  const signal = await entered.promise;
  const session = service.sessions.codex.id, turnId = adapter.active.get(session);
  assert.ok(turnId, 'Expected the real Codex turn to be active');
  assert.equal(signal.aborted, false);
  // Queue a second operation against the same live context while native input is held.
  const queued = assert.rejects(service.action({ contextId, action: 'type', text: 'queued' }), /cancelled/);
  const turnEnd = once(adapter, 'completed');
  const stopped = service.dispatch({ signal: 'retreat' });
  assert.equal(signal.aborted, true, 'Retreat must revoke native input synchronously');
  let acknowledged = false;
  const stoppedResult = stopped.then(result => { acknowledged = true; return result; });
  const [event] = await Promise.race([turnEnd, stoppedResult.then(() => { throw new Error('Stop returned before the held action drained'); })]);
  assert.equal(event.threadId, session);
  assert.equal(event.turn.id, turnId);
  assert.equal(event.turn.status, 'interrupted');
  const late = assert.rejects(service.action({ contextId, action: 'type', text: 'late' }), /cancelled/);
  await nextTick(); // Let Stop process the confirmation while the desktop still holds the gate.
  assert.equal(service.status().task.phase, 'stopping');
  assert.equal(acknowledged, false);
  release.resolve();
  await Promise.all([queued, late]);
  assert.deepEqual(await stoppedResult, { stopped: true });
  assert.equal(service.status().task.phase, 'stopped');
  assert.deepEqual(executed, ['round-trip', 'in-flight']);
  assert.equal(requests, 2);
}

let bridge;
const timeout = setTimeout(() => failure.reject(new Error('Scoped desktop regression timed out')), 45_000);
try {
  await new Promise((resolve, reject) => provider.once('error', reject).listen(0, '127.0.0.1', resolve));
  await writeFile(join(home, 'config.toml'), [
    'model = "fixture"', 'model_provider = "fixture"', '[model_providers.fixture]', 'name = "Local fixture"',
    'base_url = "http://127.0.0.1:' + provider.address().port + '/v1"', 'wire_api = "responses"',
    'supports_websockets = false', 'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0',
  ].join('\n'));
  await writeFile(adapter.skillPath, '---\nname: lolping-your-ai\ndescription: Scoped action test fixture\n---\nUse the disposable fixture.\n');
  await service.init();
  bridge = await startBridge(service, store);
  Object.assign(adapter.mcp.env, { LOLPINGAI_ENDPOINT: bridge.endpoint, LOLPINGAI_TOKEN: bridge.token });
  adapter.on('failure', failure.reject);
  await Promise.race([run(), failure.promise]);
  console.log('PASS: real Codex tool round-trip, confirmed turn interrupt, queued input rejected, Stop waits for synthetic input to drain.');
} finally {
  clearTimeout(timeout);
  adapter.off('failure', failure.reject);
  release.resolve();
  const exit = adapter.child ? once(adapter.child, 'exit') : Promise.resolve();
  service.close(); bridge?.close(); provider.closeAllConnections(); provider.close();
  await exit; await service.conversation?.flush(); await store.tail;
  await rm(home, { recursive: true, force: true });
}
