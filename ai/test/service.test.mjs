import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Teammate } from '../service.mjs';
import { validateSvg } from '../icons.mjs';

class Adapter extends EventEmitter {
  active = new Map(); next = 0; sent = []; cancelled = [];
  async create() { return `session-${++this.next}`; }
  async resume(id) { return id; }
  async send(id, prompt) { this.active.set(id, `turn-${this.sent.length}`); this.sent.push({ id, prompt }); }
  async steer(id, prompt) { this.sent.push({ id, prompt, steer: true }); }
  async cancel(id) { this.cancelled.push(id); this.active.delete(id); this.emit('completed', { threadId: id, turn: { status: 'interrupted' } }); }
  finish(id = [...this.active.keys()][0]) { this.active.delete(id); this.emit('completed', { threadId: id, turn: { status: 'completed' } }); }
  close() {}
}
async function fixture() {
  let now = 100; const data = {}, adapter = new Adapter();
  const store = { read: async (k, d) => structuredClone(data[k] ?? d), write: async (k, v) => { data[k] = structuredClone(v); } };
  const desktop = { available: async () => true, capture: async () => ({ target: { id: 'window', pid: 2, bounds: { x: 10, y: 20, width: 100, height: 100 }, relative: { x: .5, y: .5 } }, region: {}, imagePath: '/test.png' }), reply: async () => {}, action: async () => ({ ok: true }) };
  const service = new Teammate({ store, adapters: { codex: adapter, claude: new Adapter() }, desktop, now: () => now }); await service.init();
  return { service, adapter, data, time: n => { now = n; } };
}
test('successive pings resume the native session even after long inactivity', async () => {
  const { service, adapter, time } = await fixture();
  const first = await service.dispatch({ signal: 'assist', point: { x: 60, y: 70 } });
  await service.handoff({ contextId: first.contextId, summary: 'Fix the button; inspected the layout.', goal: 'Fix button' });
  adapter.finish(); await service.dispatch({ signal: 'missing', point: { x: 60, y: 70 } }); assert.equal(adapter.next, 1);
  adapter.finish(); time(7201000); await service.dispatch({ signal: 'assist', point: { x: 60, y: 70 } });
  assert.equal(adapter.next, 1); assert.match(adapter.sent.at(-1).prompt, /Fix the button/);
});
test('remote/agent replies never dispatch; duplicate input runs once', async () => {
  const { service, adapter } = await fixture();
  await service.dispatch({ source: 'agent', signal: 'allin' }); await service.dispatch({ source: 'remote', signal: 'allin' });
  assert.equal(adapter.next, 0);
  await service.dispatch({ id: 'same', signal: 'missing' }); await service.dispatch({ id: 'same', signal: 'missing' }); assert.equal(adapter.sent.length, 1);
});
test('read-only context rejects actions, stale contexts remain invalid', async () => {
  const { service, adapter } = await fixture(); const first = await service.dispatch({ signal: 'assist' });
  await service.action({ contextId: first.contextId, action: 'click' });
  adapter.finish(); const next = await service.dispatch({ signal: 'generic' });
  await assert.rejects(service.action({ contextId: first.contextId, action: 'click' }), /Stale/);
  await assert.rejects(service.action({ contextId: next.contextId, action: 'click' }), /not authorized/);
});
test('retreat revokes actions and waits for adapter cancellation', async () => {
  const { service, adapter } = await fixture(); const turn = await service.dispatch({ signal: 'allin' });
  await service.dispatch({ signal: 'retreat' }); assert.deepEqual(adapter.cancelled, [turn.session]);
  await assert.rejects(service.action({ contextId: turn.contextId, action: 'click' }));
});
test('unowned session binding needs explicit handoff and never resumes another chat', async () => {
  const { service } = await fixture(); await assert.rejects(service.bind({ harness: 'codex', id: 'someone-else' }), /not verified/);
  const binding = await service.bind({ harness: 'codex', id: 'someone-else', summary: 'Fix button' }); assert.equal(binding.binding, 'handoff'); assert.notEqual(binding.id, 'someone-else');
});
test('SVG icon candidates reject external resources and executable content', () => {
  assert.match(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="3"/></svg>'), /circle/);
  for (const svg of ['<svg><script>bad()</script></svg>', '<svg><image href="file:///secret"/></svg>', '<svg><rect fill="url(https://example.com)"/></svg>', '<svg onload="bad()"></svg>']) assert.throws(() => validateSvg(svg));
});

test('a queued session creation cannot revive desktop actions after retreat', async () => {
  const { service, adapter } = await fixture();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  adapter.create = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const pending = service.dispatch({ signal: 'assist' });
  await started;
  const retreat = service.dispatch({ signal: 'retreat' });
  release('late-session');
  await assert.rejects(pending, /superseded/); await retreat;
  assert.equal(service.gate.allowed, false); assert.equal(adapter.sent.length, 0);
});

test('event receipts survive service restart', async () => {
  const { service, adapter } = await fixture(); await service.dispatch({ id: 'persistent-event', signal: 'missing' });
  const restarted = new Teammate({ store: service.store, adapters: { codex: adapter }, desktop: service.desktop }); await restarted.init();
  assert.deepEqual(await restarted.dispatch({ id: 'persistent-event', signal: 'assist' }), { duplicate: true });
  assert.equal(adapter.sent.length, 1);
});

test('timer follow-up does not extend user activity or authorize edits', async () => {
  const { service, adapter, time } = await fixture(); await service.dispatch({ signal: 'assist' });
  const stamp = service.sessions.codex.lastHumanPing; adapter.finish(); time(4000);
  await service.dispatch({ source: 'timer', signal: 'missing', target: service.context.target });
  assert.equal(service.sessions.codex.lastHumanPing, stamp); assert.equal(service.gate.allowed, false); assert.equal(adapter.next, 1);
});

test('switching harness keeps separate sessions and queues behind former desktop work', async () => {
  const { service, adapter } = await fixture(); const first = await service.dispatch({ signal: 'assist' });
  await service.configure({ harness: 'claude' }); assert.equal((await service.dispatch({ signal: 'missing' })).queued, true); adapter.finish(); await new Promise(r => setImmediate(r)); await service.queue;
  assert.ok(service.sessions.codex); assert.ok(service.sessions.claude); assert.equal(adapter.active.size, 0); assert.deepEqual(adapter.cancelled, []);
});

test('teammate history keeps text but drops screenshot payloads', async () => {
  const { service, adapter } = await fixture(), image = 'iVBORw0KGgo' + 'A'.repeat(300000);
  await service.configure({ diagnosticsEnabled: true });
  adapter.emit('event', { method: 'claude/message', params: { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { data: image } }, { type: 'text', text: 'Mapped region.' }] }] } } });
  adapter.emit('event', { method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'Done. ' } }); adapter.emit('event', { method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'Note restored.' } });
  const [tool, reply] = service.status().history.map(h => h.event.params);
  assert.match(tool.message.content[0].content[0].source.data, /^\[300011 characters of binary data omitted\]$/); assert.equal(tool.message.content[0].content[1].text, 'Mapped region.');
  assert.equal(reply.delta, 'Done. Note restored.'); assert.ok(JSON.stringify(service.status().history).length < 2000);
});

test('diagnostics default off, disabling clears protocol events but retains chat', async () => {
  const { service, adapter } = await fixture();
  assert.equal(service.config.diagnosticsEnabled, false);
  await service.message({ text: 'Keep this conversation' });
  const delta = { method: 'item/agentMessage/delta', params: { delta: 'Hello', itemId: 'one' } };
  adapter.emit('event', delta);
  assert.deepEqual(service.history, []);
  assert.equal(service.task.text, 'Hello');
  await service.configure({ diagnosticsEnabled: true });
  adapter.emit('event', delta);
  assert.equal(service.history.length, 1);
  await service.configure({ diagnosticsEnabled: false });
  assert.deepEqual(service.history, []);
  assert.ok(service.conversation.page().entries.some(row => row.text === 'HelloHello'));
  await assert.rejects(service.configure({ diagnosticsEnabled: 'true' }), /boolean/);
  service.close();
});

test('normal pings queue without cancelling; moved targets are captured fresh when admitted', async () => {
  const { service, adapter } = await fixture(); const first = await service.dispatch({ signal: 'assist' });
  let captures = 0; service.desktop.locate = async () => ({ id: 'second', relative: { x: .5, y: .5 } });
  const old = service.desktop.capture; service.desktop.capture = async (target, size, tracked) => { captures++; assert.equal(target.id, 'second'); assert.equal(tracked, true); return old(); };
  assert.equal((await service.dispatch({ signal: 'missing', point: { x: 12, y: 34 } })).queued, true);
  assert.equal(captures, 0); assert.equal(service.context.id, first.contextId); assert.equal(service.gate.allowed, true); assert.deepEqual(adapter.cancelled, []);
  adapter.finish(); await new Promise(r => setImmediate(r)); await service.queue;
  assert.equal(captures, 1); assert.equal(adapter.sent.length, 2); assert.equal(service.gate.allowed, true);
});

test('ward and clear ward neither cancel the active turn nor replace its context', async () => {
  const { service, adapter } = await fixture(); const first = await service.dispatch({ signal: 'assist' });
  await service.dispatch({ signal: 'vision' }); await service.dispatch({ signal: 'cleared' });
  assert.equal(service.context.id, first.contextId); assert.equal(service.gate.allowed, true); assert.deepEqual(adapter.cancelled, []);
  assert.equal(service.wards.items[0].status, 'cancelled');
});

test('warning cancels immediately, discards queued pings and begins a fresh correction', async () => {
  const { service, adapter } = await fixture(); await service.dispatch({ signal: 'assist' });
  await service.dispatch({ signal: 'missing' }); assert.equal(service.pendingPings.length, 1);
  await service.dispatch({ signal: 'danger' });
  assert.equal(adapter.cancelled.length, 1); assert.equal(service.pendingPings.length, 0); assert.equal(service.context.signal, 'danger'); assert.equal(service.gate.allowed, true);
});

test('card output is scoped to current task and clarification stays waiting after turn completion', async () => {
  const { service, adapter } = await fixture(); const first = await service.dispatch({ signal: 'assist' });
  adapter.emit('event', { method: 'item/agentMessage/delta', params: { threadId: first.session, delta: 'Which paragraph?' } });
  await service.reply({ contextId: first.contextId, signal: 'missing' }); adapter.finish();
  assert.equal(service.task.phase, 'waiting'); assert.equal(service.task.text, 'Which paragraph?');
  await service.followup({ contextId: first.contextId, text: 'The first one.' }); assert.equal(service.task.text, ''); assert.equal(service.task.phase, 'understanding');
  assert.match(adapter.sent.at(-1).prompt, /The first one/);
});

test('retreat waits for a late turn start, then cancels it before reporting stopped', async () => {
  const { service, adapter } = await fixture(); let entered, release;
  const started = new Promise(r => { entered = r; }); const send = adapter.send.bind(adapter);
  adapter.send = async (...args) => { entered(); await new Promise(r => { release = r; }); await send(...args); };
  const ping = service.dispatch({ signal: 'assist' }); await started;
  let stopped = false; const stop = service.stop().then(() => { stopped = true; });
  await new Promise(r => setImmediate(r)); assert.equal(stopped, false); assert.equal(service.task.phase, 'stopping');
  release(); await assert.rejects(ping, /superseded/); await stop;
  assert.equal(adapter.active.size, 0); assert.equal(service.task.phase, 'stopped'); assert.equal(service.gate.allowed, false);
});

test('queued pings retain arrival order when later window lookup finishes first', async () => {
  const { service, adapter } = await fixture(); await service.dispatch({ signal: 'assist' });
  let release, entered; const started = new Promise(r => { entered = r; });
  service.desktop.locate = async point => { if (point.x === 1) { entered(); await new Promise(r => { release = r; }); } return { id: `window-${point.x}` }; };
  const first = service.dispatch({ signal: 'missing', point: { x: 1, y: 1 } }); await started;
  await service.dispatch({ signal: 'missing', point: { x: 2, y: 1 } });
  adapter.finish(); await new Promise(r => setImmediate(r)); assert.equal(adapter.sent.length, 1);
  const targets = []; const capture = service.desktop.capture; service.desktop.capture = async target => { targets.push(target.id); return capture(); };
  release(); await first; await service.queue; assert.deepEqual(targets, ['window-1']);
  adapter.finish(); await new Promise(r => setImmediate(r)); await service.queue; assert.deepEqual(targets, ['window-1', 'window-2']);
});

test('ACP permissions select only an offered one-time option and retain unsupported requests', async () => {
  const { service, adapter } = await fixture(); const answers = [];
  adapter.respond = (id, result) => answers.push({ id, result });
  adapter.emit('approval', { id: 7, method: 'session/request_permission', params: { options: [{ kind: 'allow_always', optionId: 'forever' }] } });
  await assert.rejects(service.approve({ harness: 'codex', id: 7, allow: true }), /no one-time approval/);
  assert.equal(answers.length, 0); assert.equal(service.approvals.length, 1);
  await service.approve({ harness: 'codex', id: 7, allow: false });
  assert.deepEqual(answers[0].result, { outcome: { outcome: 'cancelled' } });
  adapter.emit('approval', { id: 8, method: 'session/request_permission', params: { options: [{ kind: 'allow_once', optionId: 'once' }] } });
  await service.approve({ harness: 'codex', id: 8, allow: true });
  assert.deepEqual(answers[1].result, { outcome: { outcome: 'selected', optionId: 'once' } });
  assert.equal(service.approvals.length, 0);
});

test('direct text starts without desktop access, streams a reply, and continues the same session', async () => {
  const { service, adapter } = await fixture();
  service.desktop.capture = service.desktop.reply = service.desktop.action = async () => { throw new Error('Desktop must not be touched'); };
  const first = await service.message({ text: 'Hello from chat' });
  assert.equal(service.context.mode, 'chat'); assert.equal(service.context.target, undefined);
  assert.equal(service.gate.allowed, false);
  await assert.rejects(service.screenshot(first.contextId), /Ping a window/);
  await assert.rejects(service.action({ contextId: first.contextId, action: 'click' }), /Ping a window/);
  adapter.emit('event', { method: 'item/agentMessage/delta', params: { threadId: first.session, delta: 'Hello back' } });
  assert.equal(service.task.text, 'Hello back');
  adapter.finish(); await new Promise(r => setImmediate(r));
  assert.equal(service.task.phase, 'done');
  await service.message({ contextId: first.contextId, text: 'Continue' });
  assert.equal(adapter.next, 1); assert.equal(adapter.sent.length, 2);
});

test('text can precede a desktop ping; only the ping captures and enables actions', async () => {
  const { service, adapter } = await fixture(); let captures = 0;
  const capture = service.desktop.capture; service.desktop.capture = async (...args) => { captures++; return capture(...args); };
  await service.message({ text: 'Help me with this project' }); assert.equal(captures, 0);
  adapter.finish(); await service.dispatch({ signal: 'assist', point: { x: 1, y: 2 } });
  assert.equal(captures, 1); assert.equal(adapter.next, 1); assert.equal(service.gate.allowed, true);
});

test('text queues behind another harness without locating a window, and retreat clears it', async () => {
  const { service } = await fixture();
  const first = await service.message({ text: 'Start' });
  await service.configure({ harness: 'claude' });
  service.desktop.locate = service.desktop.capture = async () => { throw new Error('No window'); };
  assert.equal((await service.message({ contextId: first.contextId, text: 'Use Claude' })).queued, true);
  assert.equal(service.pendingPings.length, 1);
  await service.stop(); assert.equal(service.pendingPings.length, 0); assert.equal(service.adapters.claude.sent.length, 0);
});

test('direct text retains its session and validates empty/stale submissions', async () => {
  const { service, adapter, time } = await fixture();
  await assert.rejects(service.message({ text: '  ' }), /characters/);
  const first = await service.message({ text: 'Start' }); adapter.finish();
  time(7201000); await service.message({ contextId: first.contextId, text: 'After a long idle' });
  assert.equal(adapter.next, 1);
  await assert.rejects(service.message({ contextId: first.contextId, text: 'Old context' }), /Stale/);
});

test('conversation persists user text, streamed replies, pings and agent reactions across restart', async () => {
  const { service, adapter, data } = await fixture();
  const chat = await service.message({ text: 'Remember this request' });
  adapter.emit('event', { method: 'item/agentMessage/delta', params: { threadId: chat.session, delta: 'A complete reply' } });
  adapter.finish();
  await service.dispatch({ id: 'visible-ping', signal: 'missing' });
  await service.reply({ contextId: 'visible-ping', signal: 'onmyway', caption: 'Here' });
  await service.dispatch({ signal: 'vision' });
  await service.dispatch({ signal: 'cleared' });
  await service.dispatch({ signal: 'retreat' });
  await service.conversation.flush();
  const records = data['ai-conversation'];
  assert.equal(records[0].text, 'Remember this request');
  assert.equal(records[1].text, 'A complete reply');
  assert.equal(records[1].phase, 'done');
  assert.ok(records.some(r => r.role === 'user' && r.signal === 'missing'));
  assert.ok(records.some(r => r.role === 'agent' && r.signal === 'onmyway' && r.text === 'Here'));
  for (const signal of ['vision', 'cleared', 'retreat']) assert.ok(records.some(r => r.role === 'user' && r.signal === signal));
  assert.ok(!JSON.stringify(records).includes('/test.png'));
  const restarted = new Teammate({ store: service.store, desktop: service.desktop, adapters: { codex: new Adapter() } });
  await restarted.init();
  assert.deepEqual(restarted.status().conversation.entries, records);
  await restarted.message({ text: 'After restart' });
  assert.equal(restarted.adapters.codex.next, 0);
  assert.equal(restarted.adapters.codex.sent[0].id, chat.session);
  service.close(); restarted.close();
});

test('legacy expired sessions are resumed, not silently replaced', async () => {
  const { service, adapter, time } = await fixture();
  const first = await service.message({ text: 'Start' }); adapter.finish();
  service.sessions.codex.expired = true; await service.saveSessions();
  await service.configure({ sessionHours: .01 });
  time(365 * 24 * 3600000);
  const restarted = new Teammate({ store: service.store, desktop: service.desktop, adapters: { codex: new Adapter() } });
  await restarted.init(); await restarted.message({ text: 'Continue' });
  assert.equal(restarted.adapters.codex.next, 0);
  assert.equal(restarted.adapters.codex.sent[0].id, first.session);
  assert.equal('sessionHours' in restarted.config, false);
  service.close(); restarted.close();
});

test('busy follow-up and duplicate receipts are logged once without dropping earlier reply text', async () => {
  const { service, adapter } = await fixture();
  const first = await service.message({ text: 'Start' });
  adapter.emit('event', { method: 'item/agentMessage/delta', params: { threadId: first.session, delta: 'Working' } });
  await service.message({ contextId: first.contextId, text: 'Also consider this' });
  await service.dispatch({ id: first.contextId, signal: 'missing' });
  const rows = service.status().conversation.entries;
  assert.equal(rows.filter(r => r.role === 'user').length, 2);
  assert.equal(rows.find(r => r.role === 'agent').text, 'Working');
  assert.equal(adapter.sent.at(-1).steer, true);
  service.close();
});

test('unconfirmed cancellation never reports stopped or reopens the action gate', async () => {
  const { service, adapter } = await fixture(); await service.dispatch({ signal: 'assist' });
  adapter.cancel = async () => { throw new Error('Harness has not confirmed cancellation'); };
  await assert.rejects(service.stop(), /not confirmed/);
  assert.equal(service.task.phase, 'stopping'); assert.equal(service.gate.allowed, false);
  await assert.rejects(service.action({ contextId: service.context.id, action: 'type', text: 'late' }), /cancelled/);
});

test('Finish setup and signal mappings survive service restart', async () => {
  const { service } = await fixture();
  const mappings = { missing: { label: 'Explain', mode: 'observe', prompt: 'Explain only visible text.' } };
  await service.configure({ setupComplete: true, mappings });
  const restarted = new Teammate({ store: service.store, adapters: { codex: new Adapter() }, desktop: service.desktop }); await restarted.init();
  assert.equal(restarted.config.setupComplete, true); assert.deepEqual(restarted.config.mappings, mappings);
});

test('refresh never interrupts an active turn; pings queue during native config reload', async () => {
  const { service, adapter } = await fixture(); await service.message({ text: 'Start' });
  await assert.rejects(service.listModels({ refresh: true }), /Finish or stop/);
  adapter.finish();
  let release; adapter.listModels = () => new Promise(resolve => { release = resolve; });
  const pending = service.listModels({ refresh: true });
  assert.equal((await service.message({ text: 'Queued safely' })).queued, true);
  assert.equal(adapter.sent.length, 1); assert.equal(adapter.cancelled.length, 0);
  release({ models: [] }); await pending; await service.queue;
  assert.equal(adapter.sent.length, 2); service.close();
});

test('Claude partial text appears before completion, complete message does not duplicate it', async () => {
  const { service, time } = await fixture(); await service.configure({ harness: 'claude' });
  const adapter = service.adapters.claude, turn = await service.message({ text: 'Hello' });
  time(150); adapter.emit('event', { method: 'claude/textDelta', params: { threadId: turn.session, delta: 'Hello' } });
  assert.equal(service.task.text, 'Hello'); assert.equal(service.task.timings.firstTextMs, 50);
  adapter.emit('event', { method: 'claude/textComplete', params: { threadId: turn.session, streamedText: 'Hello', text: 'Hello there' } });
  adapter.emit('event', { method: 'claude/message', params: { threadId: turn.session, type: 'assistant', textHandled: true, message: {content:[{type:'text',text:'Hello there'}]} } });
  assert.equal(service.task.text, 'Hello there'); time(200); adapter.finish();
  assert.equal(service.task.timings.totalMs, 100); service.close();
});


test('question exploration allows navigation but not arbitrary typing, wards stay read-only', async () => {
  const { service, adapter } = await fixture();
  const turn = await service.dispatch({ signal: 'missing' });
  assert.equal(service.context.mode, 'explore');
  await service.action({ contextId: turn.contextId, action: 'scroll', x: 50, y: 50, delta: 100 });
  await service.action({ contextId: turn.contextId, action: 'click', purpose: 'Expand the relevant definition', x: 50, y: 50 });
  await assert.rejects(service.action({ contextId: turn.contextId, action: 'type', text: 'edit' }), /Exploration/);
  await assert.rejects(service.action({ contextId: turn.contextId, action: 'key', key: 'Cmd+S' }), /shortcut/);
  await assert.rejects(service.action({ contextId: turn.contextId, action: 'click' }), /purpose/);
  adapter.finish(); const ward = await service.dispatch({ source: 'timer', signal: 'missing' });
  assert.equal(service.context.mode, 'observe');
  await assert.rejects(service.action({ contextId: ward.contextId, action: 'scroll' }), /not authorized/);
  service.close();
});
test('nearby repeated question steers one task, keeps count and does not group different targets', async () => {
  const { service, adapter } = await fixture();
  let id = 'one'; service.desktop.locate = async () => ({ id, pid: 2 });
  const first = await service.dispatch({ signal: 'missing', point: { x: 60, y: 70 } });
  // Fixture capture returns a generic target; production capture keeps locate identity.
  service.expression.event.target = { id, pid: 2 };
  const second = await service.dispatch({ signal: 'missing', point: { x: 62, y: 71 } });
  assert.equal(second.grouped, true); assert.equal(service.context.expression.count, 2);
  assert.equal(adapter.sent.length, 2); assert.equal(adapter.sent[1].steer, true);
  assert.match(adapter.sent[1].prompt, /repeated this signal 2 times/);
  assert.equal(service.pendingPings.length, 0);
  id = 'another'; const third = await service.dispatch({ signal: 'missing', point: { x: 62, y: 71 } });
  assert.equal(third.queued, true); assert.equal(service.pendingPings.length, 1);
  await service.dispatch({ signal: 'retreat' }); assert.equal(service.pendingPings.length, 0);
  await assert.rejects(service.action({ contextId: first.contextId, action: 'scroll' }), /not authorized/); service.close();
});
test('emotions do not capture or authorize editing; a comeback question is not a request for input', async () => {
  const { service } = await fixture();
  service.desktop.locate = async () => ({ id: 'window', pid: 2 });
  service.desktop.capture = async () => { throw new Error('Unnecessary capture'); };
  const turn = await service.dispatch({ signal: 'bait', point: { x: 60, y: 70 } });
  await service.reply({ contextId: turn.contextId, signal: 'missing', caption: 'Your move?' });
  assert.notEqual(service.task.phase, 'waiting');
  await assert.rejects(service.action({ contextId: turn.contextId, action: 'type', text: 'oops' }), /not authorized/); service.close();
});
test('preview preserves original capture and separately follows agent screenshots', async () => {
  const { service } = await fixture(); let n = 0;
  const original = service.desktop.capture;
  service.desktop.capture = async (...args) => ({ ...await original(...args), imagePath: `/local/ping-${++n}.png` });
  const turn = await service.dispatch({ signal: 'missing' });
  await service.screenshot(turn.contextId, { x: 50, y: 60 });
  assert.equal(service.conversation.rows.find(row => row.id === turn.contextId).preview.file, 'ping-1.png');
  assert.equal(service.task.preview.file, 'ping-2.png');
  await assert.rejects(service.screenshot(turn.contextId, { x: -100, y: -100 }), /inside/); service.close();
});

test('playful question during real work does not incorrectly wait for an answer', async () => {
  const { service } = await fixture(); const turn = await service.dispatch({ signal: 'assist' });
  await service.reply({ contextId: turn.contextId, signal: 'missing', meaning: 'reaction' });
  assert.notEqual(service.task.phase, 'waiting');
  await service.reply({ contextId: turn.contextId, signal: 'missing', meaning: 'clarification' });
  assert.equal(service.task.phase, 'waiting'); service.close();
});

test('an explicit observe-only setup ping cannot inherit exploration permissions', async () => {
  const { service } = await fixture();
  const turn = await service.dispatch({ signal: 'missing', observeOnly: true });
  assert.equal(service.context.mode, 'observe');
  await assert.rejects(service.action({ contextId: turn.contextId, action: 'scroll' }), /not authorized/); service.close();
});

test('standalone taunting does not append a duplicate completion comeback', async () => {
  const { service, adapter } = await fixture(); const replies = [];
  service.desktop.reply = async args => replies.push(args.signal);
  const turn = await service.dispatch({ signal: 'bait' });
  await service.reply({ contextId: turn.contextId, signal: 'bait', meaning: 'reaction' });
  await service.reply({ contextId: turn.contextId, signal: 'missing', meaning: 'reaction' });
  adapter.finish(); await new Promise(r => setImmediate(r));
  assert.deepEqual(replies, ['bait', 'missing']); service.close();
});

const writerConflict = id => Object.assign(new Error(`thread ${id} already has an active writer`), { code: 'SESSION_WRITER_CONFLICT', threadId: id });
async function conflicted() {
  const f = await fixture();
  await f.service.dispatch({ signal: 'chat', message: 'Original history' }); f.adapter.finish();
  await f.service.handoff({ contextId: f.service.context.id, summary: 'Detailed progress', goal: 'Original goal' });
  f.adapter.resume = async id => { throw writerConflict(id); };
  await assert.rejects(f.service.dispatch({ signal: 'assist' }), /active writer/); await f.service.queue;
  return f;
}
test('conflict persists with original identity, goal, summary and full local history across restart', async () => {
  const { service, adapter } = await conflicted();
  assert.equal(service.gate.allowed, false); assert.equal(service.task.errorCode, 'SESSION_WRITER_CONFLICT');
  const original = structuredClone(service.sessions.codex), rows = structuredClone(service.conversation.rows);
  const restarted = new Teammate({ store: service.store, adapters: { codex: adapter }, desktop: service.desktop }); await restarted.init();
  assert.deepEqual(restarted.sessions.codex, original); assert.deepEqual(restarted.conversation.rows, rows);
  await assert.rejects(restarted.dispatch({ signal: 'chat', message: 'not sent' }), /SESSION_WRITER_CONFLICT/);
  assert.equal(adapter.next, 1); assert.equal(adapter.sent.length, 1);
  assert.equal(original.summary, 'Detailed progress'); assert.equal(original.goal, 'Original goal');
});
test('recovery checks same thread, preserves history and never starts or replays a turn', async () => {
  const { service, adapter } = await conflicted(); const before = structuredClone(service.conversation.rows);
  await assert.rejects(service.recoverSession({ harness: 'codex', sessionId: 'wrong' }), /stale/);
  await assert.rejects(service.recoverSession({ harness: 'codex', sessionId: 'session-1' }), /active writer/);
  assert.ok(service.sessions.codex.writerConflict);
  adapter.resume = async (id, options) => { assert.equal(id, 'session-1'); assert.equal(options.force, true); return id; };
  assert.deepEqual(await service.recoverSession({ harness: 'codex', sessionId: 'session-1' }), { recovered: true, sessionId: 'session-1', replayed: false });
  assert.equal(service.sessions.codex.writerConflict, undefined); assert.equal(service.sessions.codex.summary, 'Detailed progress');
  assert.equal(service.sessions.codex.goal, 'Original goal'); assert.equal(adapter.next, 1); assert.equal(adapter.sent.length, 1);
  assert.equal(service.gate.allowed, false); assert.equal(service.conversation.rows.length, before.length);
  assert.deepEqual(service.conversation.rows, before);
  adapter.resume = async id => id;
  await service.dispatch({ signal: 'chat', message: 'User explicitly sends again' });
  assert.equal(adapter.sent.at(-1).id, 'session-1');
});
test('stop and repeated recovery requests cannot revive a stale recovery', async () => {
  const { service, adapter } = await conflicted(); let release;
  adapter.resume = () => new Promise(r => { release = r; });
  const recovering = service.recoverSession({ harness: 'codex', sessionId: 'session-1' });
  await assert.rejects(service.recoverSession({ harness: 'codex', sessionId: 'session-1' }), /current operation/);
  await service.stop(); release('session-1');
  await assert.rejects(recovering, /cancelled/);
  assert.ok(service.sessions.codex.writerConflict); assert.equal(service.gate.allowed, false);
  assert.equal(service.recoveringSession, null); assert.equal(adapter.sent.length, 1);
});
test('writer conflict at turn start stops queued desktop intentions without deleting their records', async () => {
  const { service, adapter } = await fixture();
  await service.dispatch({ signal: 'chat', message: 'original' }); adapter.finish();
  let rejectSend, entered;
  const started = new Promise(r => { entered = r; });
  adapter.send = () => { entered(); return new Promise((_, reject) => { rejectSend = reject; }); };
  const first = service.dispatch({ signal: 'assist' }); await started;
  const queued = await service.dispatch({ signal: 'missing' }); assert.equal(queued.queued, true);
  rejectSend(writerConflict('session-1')); await assert.rejects(first, /active writer/); await service.queue;
  assert.equal(service.pendingPings.length, 0);
  assert.match(service.conversation.rows.find(r => r.id === queued.id).error, /Not sent/);
  assert.equal(adapter.next, 1); assert.equal(service.gate.allowed, false);
});

test('failed persistence retains the recovery state and does not poison later retries', async () => {
  const { service, adapter } = await conflicted();
  const write = service.store.write; service.store.write = async () => { throw new Error('disk full'); };
  adapter.resume = async id => id;
  await assert.rejects(service.recoverSession({ harness: 'codex', sessionId: 'session-1' }), /disk full/);
  assert.ok(service.sessions.codex.writerConflict); assert.equal(service.busy(), false);
  service.store.write = write;
  assert.equal((await service.recoverSession({ harness: 'codex', sessionId: 'session-1' })).recovered, true);
  adapter.resume = async id => { throw writerConflict(id); };
  const save = service.saveSessions;
  service.saveSessions = async () => { if (service.sessions.codex.writerConflict) throw new Error('disk full'); return save.call(service); };
  await assert.rejects(service.dispatch({ signal: 'chat', message: 'retry' }), /active writer/);
  await service.queue;
  assert.equal(service.busy(), false); assert.ok(service.sessions.codex.writerConflict);
  service.saveSessions = save; adapter.resume = async id => id;
  assert.equal((await service.recoverSession({ harness: 'codex', sessionId: 'session-1' })).recovered, true);
});
