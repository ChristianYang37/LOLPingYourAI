import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseEffort } from '../harness/effort.mjs';
import { validateConfig } from '../config.mjs';
import { CodexAdapter } from '../harness/codex.mjs';
test('ordinal effort defaults to zero, orders supported levels and clamps', () => {
  assert.equal(validateConfig().reasoningEffort, 0);
  assert.equal(chooseEffort(0, ['high', 'minimal', 'medium']), 'minimal');
  assert.equal(chooseEffort(1, ['high', 'minimal', 'medium']), 'medium');
  assert.equal(chooseEffort(8, ['low', 'high']), 'high');
  assert.equal(chooseEffort(3, []), undefined);
  assert.throws(() => validateConfig({ reasoningEffort: -1 }));
});
test('Codex sends the resolved effort on every turn without altering user model config', async () => {
  const a = new CodexAdapter({ mcp: {}, skillPath: '/skill' }), calls = [];
  a.connect = async () => {}; a.models.set('s', 'chosen'); a.rpc = async (method, params) => { calls.push({ method, params }); return method === 'model/list' ? { data: [{ model: 'chosen', supportedReasoningEfforts: [{ reasoningEffort: 'minimal' }, { reasoningEffort: 'high' }] }] } : { turn: { id: 't' } }; };
  await a.send('s', 'Hi'); assert.equal(calls.at(-1).params.effort, 'minimal');
  await a.send('s', 'Hi', undefined, { reasoningEffort: 1 }); assert.equal(calls.at(-1).params.effort, 'high');
  await a.send('s', 'Hi', undefined, { reasoningEffort: 8 }); assert.equal(calls.at(-1).params.effort, 'high');
});

 test('Codex exposes model choices and explicitly sends standard routing unless fast is selected', async () => {
  const a = new CodexAdapter({ mcp: {}, skillPath: '/skill' }), calls = [];
  a.connect = async () => {};
  a.rpc = async (method, params) => { calls.push({ method, params }); return method === 'model/list' ? { data: [
    { model: 'model-a', displayName: 'Model A', isDefault: true, serviceTiers: [{ id: 'priority', name: 'Fast' }], supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
    { model: 'model-b', displayName: 'Model B', serviceTiers: [], supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
  ] } : { turn: { id: 't' } }; };
  const catalog = await a.listModels(); assert.equal(catalog.defaultModel, 'model-a'); assert.equal(catalog.models[0].fastMode, true); assert.equal(catalog.models[1].fastMode, false);
  await a.send('s', 'Hi'); assert.equal(calls.at(-1).params.serviceTier, 'default'); assert.equal(calls.at(-1).params.model, 'model-a');
  await a.send('s', 'Hi', undefined, { model: 'model-a', fastMode: true }); assert.equal(calls.at(-1).params.serviceTier, 'priority');
  await a.send('s', 'Hi', undefined, { model: 'model-b', fastMode: false }); assert.equal(calls.at(-1).params.model, 'model-b'); assert.equal(calls.at(-1).params.effort, 'medium'); assert.equal(calls.at(-1).params.serviceTier, 'default');
  await a.send('s', 'Hi', undefined, { model: 'custom-provider-model', fastMode: false }); assert.equal(calls.at(-1).params.model, 'custom-provider-model'); assert.equal(calls.at(-1).params.effort, undefined);
  await assert.rejects(a.send('s', 'Hi', undefined, { model: 'model-b', fastMode: true }), /does not advertise fast/);
 });
 test('model choices are separate per harness and fast mode requires an explicit boolean', () => {
  assert.deepEqual(validateConfig().modelSelections, {});
  const selections = { codex: { model: 'a', fastMode: false }, dsh: { model: '["provider","b"]', fastMode: false } };
  assert.deepEqual(validateConfig({ modelSelections: selections }).modelSelections, selections);
  assert.throws(() => validateConfig({ modelSelections: { codex: { model: 'a', fastMode: 'true' } } }));
 });

test('Codex configured custom model wins over bundled default and catalog is reused between turns', async () => {
  const a = new CodexAdapter({ mcp: {}, skillPath: '/skill' }), calls = [];
  a.connect = async () => {};
  a.rpc = async (method, params) => { calls.push({ method, params });
    if (method === 'model/list') return { data: [{ model: 'bundled', isDefault: true }] };
    if (method === 'config/read') return { config: { model: 'gateway-model', model_provider: 'gateway' } };
    return { turn: { id: 't' } };
  };
  assert.equal((await a.listModels()).defaultModel, 'gateway-model');
  await a.send('s', 'One'); await a.send('s', 'Two');
  assert.equal(calls.filter(c => c.method === 'model/list').length, 1);
  assert.equal(calls.at(-1).params.model, 'gateway-model');
  assert.equal(calls.at(-1).params.effort, undefined);
  await a.resume('s'); assert.equal(calls.at(-1).params.modelProvider, 'gateway');
});
