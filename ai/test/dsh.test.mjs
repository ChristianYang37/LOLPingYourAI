import test from 'node:test';
import assert from 'node:assert/strict';
import { DshAdapter } from '../harness/dsh.mjs';
import { fileURLToPath } from 'node:url';
const skillPath = fileURLToPath(new URL('../../skills/lolping-your-ai/SKILL.md', import.meta.url));
function fixture() {
  const a = new DshAdapter({ cwd: '/tmp', skillPath, mcp: { command: process.execPath, args: [], env: { LOCAL: 'value' } } });
  a.connect = async () => {}; a.info = { agentCapabilities: { promptCapabilities: { image: false } } };
  const calls = []; let finish;
  a.rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'session/new' || method === 'session/resume') return { sessionId: 's', configOptions: [{ id: 'reasoning_effort', options: [{ value: 'off' }, { value: 'high' }] }] };
    if (method === 'session/prompt') return new Promise(r => { finish = r; });
    return {};
  };
  a.child = { stdin: { write: line => { const m = JSON.parse(line); calls.push(m); if (m.method === 'session/cancel') finish({ stopReason: 'cancelled' }); } } };
  return { a, calls, finish: () => finish({ stopReason: 'end_turn' }) };
}
test('ACP mounts MCP, chooses ordinal effort, sends skill and resumes owned sessions', async () => {
  const { a, calls, finish } = fixture(); const id = await a.create();
  assert.equal(calls[0].params.mcpServers[0].env[0].name, 'LOCAL');
  await a.send(id, 'Hi', undefined, { reasoningEffort: 1 });
  assert.equal(calls.find(c => c.method === 'session/set_config_option').params.value, 'high');
  assert.match(calls.at(-1).params.prompt[0].text, /get_context/);
  const done = a.active.get(id).finished; finish(); await done; assert.equal(a.active.size, 0);
  a.loaded.clear(); await a.resume(id); assert.equal(calls.at(-1).method, 'session/resume');
});
test('DSH cancellation discards reactions and waits for prompt settlement', async () => {
  const { a, calls } = fixture(); const id = await a.create(); let status;
  a.on('completed', p => { status = p.turn.status; });
  await a.send(id, 'Work'); await a.steer(id, 'Nice'); await a.cancel(id);
  assert.equal(status, 'interrupted'); assert.equal(a.active.size, 0); assert.equal(calls.filter(c => c.method === 'session/prompt').length, 1);
});
test('a text-only DSH model refuses screenshot work before submitting a prompt', async () => {
  const { a, calls } = fixture(); const id = await a.create();
  await assert.rejects(a.send(id, 'Look', '/tmp/image.png'), /does not support images/);
  assert.equal(calls.some(c => c.method === 'session/prompt'), false);
});

test('retreat during DSH session setup prevents a late prompt and rejects concurrent sends', async () => {
  const { a, calls } = fixture(); const id = await a.create();
  let release; a.resume = () => new Promise(resolve => { release = resolve; });
  const sending = a.send(id, 'Work');
  const refused = assert.rejects(sending, /cancelled before submission/);
  await assert.rejects(a.send(id, 'Duplicate'), /still active/);
  await a.cancel(id); release(); await refused;
  assert.equal(calls.some(c => c.method === 'session/prompt'), false);
  assert.equal(a.preparing.size, 0);
});

test('DSH defaults to thinking on, indexes native enabled levels and keeps off separate', async () => {
  const { a, calls, finish } = fixture(); const id = await a.create();
  a.loaded.set(id, [{ id: 'reasoning_effort', options: ['off', 'low', 'high', 'max'].map(value => ({ value })) }]);
  for (const [settings, expected] of [[{}, 'low'], [{ reasoningEffort: 1 }, 'high'], [{ reasoningEffort: 8 }, 'max'], [{ dshThinking: false }, 'off']]) {
    await a.send(id, 'Hi', undefined, settings);
    assert.equal(calls.filter(c => c.method === 'session/set_config_option').at(-1).params.value, expected);
    const done = a.active.get(id).finished; finish(); await done;
  }
});
test('DSH on/off provider keeps thinking on even at ordinal zero', async () => {
  const { a, calls, finish } = fixture(); const id = await a.create();
  await a.send(id, 'Hi'); assert.equal(a.effectiveEffort, 'high');
  assert.equal(calls.find(c => c.method === 'session/set_config_option').params.value, 'high');
  const done = a.active.get(id).finished; finish(); await done;
});

 test('DSH loads grouped model choices and refreshes effort options after a model change', async () => {
  const { a, calls, finish } = fixture(); const base = a.rpc;
  const configs = model => [{ id: 'model', currentValue: model, options: [{ name: 'Provider', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }] }, { id: 'reasoning_effort', options: (model === 'b' ? ['off', 'low', 'max'] : ['off', 'high']).map(value => ({ value })) }];
  a.rpc = async (method, params) => {
    if (method === 'session/new') { calls.push({ method, params }); return { sessionId: 's', configOptions: configs('a') }; }
    if (method === 'session/set_config_option' && params.configId === 'model') { calls.push({ method, params }); return { configOptions: configs(params.value) }; }
    return base(method, params);
  };
  const catalog = await a.listModels(); assert.equal(catalog.defaultModel, 'a'); assert.equal(catalog.models[1].name, 'Provider / B'); assert.equal(catalog.models[1].fastMode, false);
  const id = await a.create(); await a.send(id, 'Hi', undefined, { model: 'b', reasoningEffort: 0 });
  assert.equal(a.effectiveModel, 'b'); assert.equal(a.effectiveEffort, 'low');
  const done = a.active.get(id).finished; finish(); await done;
  await assert.rejects(a.send(id, 'Hi', undefined, { model: 'b', fastMode: true }), /does not expose a fast/);
 });
