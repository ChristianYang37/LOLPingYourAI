import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
test('successive pings resume, expiry creates a new session with a concise handoff', async () => {
  const { service, adapter, time } = await fixture();
  const first = await service.dispatch({ signal: 'assist', point: { x: 60, y: 70 } });
  await service.handoff({ contextId: first.contextId, summary: 'Fix the button; inspected the layout.', goal: 'Fix button' });
  adapter.finish(); await service.dispatch({ signal: 'missing', point: { x: 60, y: 70 } }); assert.equal(adapter.next, 1);
  adapter.finish(); time(7201000); await service.dispatch({ signal: 'assist', point: { x: 60, y: 70 } });
  assert.equal(adapter.next, 2); assert.match(adapter.sent.at(-1).prompt, /Fix the button/);
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
  adapter.finish(); const next = await service.dispatch({ signal: 'missing' });
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
  adapter.emit('event', { method: 'claude/message', params: { type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { data: image } }, { type: 'text', text: 'Mapped region.' }] }] } } });
  adapter.emit('event', { method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'Done. ' } }); adapter.emit('event', { method: 'item/agentMessage/delta', params: { itemId: 'a', delta: 'Note restored.' } });
  const [tool, reply] = service.status().history.map(h => h.event.params);
  assert.match(tool.message.content[0].content[0].source.data, /^\[300011 characters of binary data omitted\]$/); assert.equal(tool.message.content[0].content[1].text, 'Mapped region.');
  assert.equal(reply.delta, 'Done. Note restored.'); assert.ok(JSON.stringify(service.status().history).length < 2000);
});

test('normal pings queue without cancelling; moved targets are captured fresh when admitted', async () => {
  const { service, adapter } = await fixture(); const first = await service.dispatch({ signal: 'assist' });
  let captures = 0; service.desktop.locate = async () => ({ id: 'second', relative: { x: .5, y: .5 } });
  const old = service.desktop.capture; service.desktop.capture = async (target, size, tracked) => { captures++; assert.equal(target.id, 'second'); assert.equal(tracked, true); return old(); };
  assert.equal((await service.dispatch({ signal: 'missing', point: { x: 12, y: 34 } })).queued, true);
  assert.equal(captures, 0); assert.equal(service.context.id, first.contextId); assert.equal(service.gate.allowed, true); assert.deepEqual(adapter.cancelled, []);
  adapter.finish(); await new Promise(r => setImmediate(r)); await service.queue;
  assert.equal(captures, 1); assert.equal(adapter.sent.length, 2); assert.equal(service.gate.allowed, false);
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

test('the first prompt and steering ask for Simplified Chinese replies', async () => {
  const { service, adapter } = await fixture();
  await service.dispatch({ signal: 'missing', point: { x: 60, y: 70 } });
  assert.match(adapter.sent.at(-1).prompt, /Write every user-facing reply, including reply_ping captions, in Simplified Chinese/);
  await service.dispatch({ signal: 'bait', point: { x: 60, y: 70 } });
  assert.equal(adapter.sent.at(-1).steer, true);
  assert.match(adapter.sent.at(-1).prompt, /Write your visible reply in Simplified Chinese/);
});

test('a finished reply is archived to the configured directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lolping-replies-'));
  process.env.LOLPINGAI_REPLY_DIR = root;
  try {
    const { service, adapter } = await fixture();
    const ping = await service.dispatch({ signal: 'missing', point: { x: 60, y: 70 } });
    adapter.emit('event', { method: 'item/completed', params: { threadId: ping.session, item: { type: 'agentMessage', text: '这是中文回复。' } } });
    let files = [];
    for (let i = 0; i < 200 && !files.length; i++) { await new Promise(resolve => setTimeout(resolve, 10)); files = await readdir(root); }
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9]{8}-[0-9]{6}-missing\.txt$/);
    const body = await readFile(join(root, files[0]), 'utf8');
    assert.match(body, /Signal: missing \(observe\)/);
    assert.match(body, /Target: window \(pid 2\)/);
    assert.match(body, /这是中文回复。/);
    adapter.emit('event', { method: 'item/completed', params: { threadId: ping.session, item: { type: 'agentMessage', text: '   ' } } });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await readdir(root)).length, 1);
  } finally {
    delete process.env.LOLPINGAI_REPLY_DIR;
    await rm(root, { recursive: true, force: true });
  }
});
