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
  a.models.set('s', 'chosen'); a.rpc = async (method, params) => { calls.push({ method, params }); return method === 'model/list' ? { data: [{ model: 'chosen', supportedReasoningEfforts: [{ reasoningEffort: 'minimal' }, { reasoningEffort: 'high' }] }] } : { turn: { id: 't' } }; };
  await a.send('s', 'Hi'); assert.equal(calls.at(-1).params.effort, 'minimal');
  await a.send('s', 'Hi', undefined, { reasoningEffort: 1 }); assert.equal(calls.at(-1).params.effort, 'high');
  await a.send('s', 'Hi', undefined, { reasoningEffort: 8 }); assert.equal(calls.at(-1).params.effort, 'high');
});
