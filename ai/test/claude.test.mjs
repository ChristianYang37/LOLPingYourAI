import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAdapter, contextTools, toolPolicy } from '../harness/claude.mjs';

const skillPath = fileURLToPath(new URL('../../skills/lolping-your-ai/SKILL.md', import.meta.url));
const cwd = join(homedir(), 'Library/Application Support/LOLPingYourAI');

// Stands in for the Agent SDK: reads one streamed user message per turn and answers it with a result.
// `exiting` keeps the stream open after the input ends, as Claude Code does while it shuts down.
function fakeSdk({ missingSessions = new Set(), exiting } = {}) {
  const calls = [];
  const query = ({ prompt, options }) => {
    const call = { options, prompts: [], interrupted: false }; calls.push(call);
    const input = prompt[Symbol.asyncIterator](), session = options.sessionId ?? options.resume;
    let stop; const interrupted = new Promise(resolve => { stop = resolve; });
    async function* run() {
      if (options.resume && missingSessions.has(options.resume)) { options.stderr?.(`No conversation found with session ID: ${options.resume}\n`); throw new Error('Claude Code process exited with code 1'); }
      for (;;) {
        const next = await input.next(); if (next.done) { await exiting?.(); return; }
        call.prompts.push(next.value.message.content);
        yield { type: 'system', subtype: 'init', session_id: session };
        if (await Promise.race([interrupted, new Promise(resolve => setTimeout(() => resolve(false), 20))])) { yield { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: session }; return; }
        yield { type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] } };
        yield { type: 'result', subtype: 'success', is_error: false, session_id: session };
      }
    }
    return Object.assign(run(), { interrupt: async () => { call.interrupted = true; stop(true); }, close() {} });
  };
  return { calls, query };
}
const completion = adapter => new Promise(resolve => adapter.once('completed', resolve));

test('a reaction during a Claude turn is delivered after it, in the same session, without interrupting', async () => {
  const sdk = fakeSdk(), a = new ClaudeAdapter({ cwd, mcp: {}, skillPath, sdk }), done = completion(a);
  const id = await a.create(); await a.send(id, 'Assist: finish the note');
  await a.steer(id, 'The user approves your current direction.');
  const { turn } = await done;
  assert.equal(turn.status, 'completed'); assert.equal(sdk.calls.length, 1); assert.equal(sdk.calls[0].interrupted, false);
  assert.deepEqual(sdk.calls[0].prompts.map(p => p[0].text), ['Assist: finish the note', 'The user approves your current direction.']);
  assert.equal(sdk.calls[0].options.sessionId, id); assert.equal(a.active.size, 0);
  await a.send(id, 'Next ping'); await completion(a); assert.equal(sdk.calls[1].options.resume, id);
});

test('a reaction that arrives while a finished Claude turn shuts down starts the next turn instead of being lost', async () => {
  let ended; const inputEnded = new Promise(resolve => { ended = resolve; });
  const sdk = fakeSdk({ exiting: () => { ended(); return new Promise(resolve => setTimeout(resolve, 20)); } }), a = new ClaudeAdapter({ cwd, mcp: {}, skillPath, sdk });
  const id = await a.create(); await a.send(id, 'Question');
  await inputEnded; assert.equal(a.active.has(id), true);
  await a.steer(id, 'Nice'); await completion(a);
  assert.deepEqual(sdk.calls.map(call => call.prompts.map(p => p[0].text)), [['Question'], ['Nice']]);
  assert.equal(sdk.calls[1].options.resume, id);
});

test('Claude retreat interrupts, drops queued reactions and confirms the turn as interrupted', async () => {
  const sdk = fakeSdk(), a = new ClaudeAdapter({ cwd, mcp: {}, skillPath, sdk }), done = completion(a);
  const id = await a.create(); await a.send(id, 'Work'); await a.steer(id, 'Nice'); await a.cancel(id);
  assert.equal((await done).turn.status, 'interrupted'); assert.equal(sdk.calls[0].interrupted, true); assert.equal(sdk.calls[0].prompts.length, 1);
});

test('a Claude session that was never saved starts fresh instead of failing every later ping', async () => {
  const sdk = fakeSdk({ missingSessions: new Set(['lost']) }), a = new ClaudeAdapter({ cwd, mcp: {}, skillPath, sdk }), failures = [];
  a.on('failure', error => failures.push(error)); const done = completion(a);
  await a.resume('lost'); await a.send('lost', 'Question');
  assert.equal((await done).turn.status, 'completed'); assert.deepEqual(failures, []);
  assert.equal(sdk.calls[0].options.resume, 'lost'); assert.equal(sdk.calls[1].options.sessionId, 'lost');
});

test('Claude exposes only read-only context tools; hooks refuse everything else before settings allow-rules apply', async () => {
  const sdk = fakeSdk(), a = new ClaudeAdapter({ cwd, mcp: {}, skillPath, sdk });
  await a.send(await a.create(), 'Question'); await completion(a);
  const { options } = sdk.calls[0];
  assert.deepEqual(options.tools, contextTools);
  assert.deepEqual(Object.keys(options.mcpServers), ['lolpingyourai']); assert.equal(options.strictMcpConfig, true);
  const hook = options.hooks.PreToolUse[0].hooks[0];
  assert.equal((await hook({ tool_name: 'Bash', tool_input: { command: 'ls' } })).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(await hook({ tool_name: 'mcp__lolpingyourai__reply_ping', tool_input: {} }), {});
  assert.equal((await options.canUseTool('Read', { file_path: '/tmp/notes.md' })).behavior, 'allow');
  assert.equal((await options.canUseTool('mcp__other__send_email', {})).behavior, 'deny');
});

test('context tool policy keeps credentials and whole-home sweeps out of reach', () => {
  const home = '/Users/me', at = '/Users/me/Library/Application Support/LOLPingYourAI';
  const allowed = (name, input) => toolPolicy(name, input, at, home) === null;
  assert.ok(allowed('Read', { file_path: '/Users/me/code/app/README.md' }));
  assert.ok(allowed('Grep', { pattern: 'ping', path: '/Users/me/.claude/projects' }));
  assert.ok(allowed('Glob', { pattern: '**/*.md', path: '/Users/me/code/app' }));
  assert.ok(allowed('mcp__lolpingyourai__desktop_action', {}));
  for (const [name, input] of [['Read', { file_path: '/Users/me/.ssh/id_ed25519' }], ['Read', { file_path: '/Users/me/code/app/.env.local' }], ['Read', { file_path: 'bridge.json' }],
    ['Read', { file_path: '/Users/me/.aws/credentials' }], ['Grep', { pattern: 'token', path: '/Users/me' }], ['Glob', { pattern: '**/*', path: '/' }],
    ['Grep', { pattern: 'KEY', path: '/Users/me/code/app', glob: '**/.env' }], ['Write', { file_path: '/tmp/x' }], ['Bash', { command: 'ls' }]]) assert.equal(allowed(name, input), false, `${name} ${JSON.stringify(input)}`);
});

test('retreat cancels a late reaction waiting for Claude process shutdown', async () => {
  let ended, release;
  const reached = new Promise(resolve => { ended = resolve; });
  const sdk = fakeSdk({ exiting: () => { if (sdk.calls.length !== 1) return; ended(); return new Promise(resolve => { release = resolve; }); } });
  const a = new ClaudeAdapter({ cwd, mcp: {}, skillPath, sdk });
  const id = await a.create(); await a.send(id, 'Work'); await reached;
  const reaction = a.steer(id, 'Late reaction');
  const refused = assert.rejects(reaction, /cancelled/i);
  const stopped = a.cancel(id); release(); await stopped; await refused;
  assert.equal(sdk.calls.length, 1, 'Retreat must not start a second turn');
});
