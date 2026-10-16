// Opt-in native ownership regression. Uses two real Codex servers and a local
// rejecting provider, not an authenticated model or the user's CODEX_HOME.
// CODEX_CLI_PATH=/path/to/codex node tools/check-codex-writer.mjs
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { CodexAdapter } from '../ai/harness/codex.mjs';
const home = await mkdtemp(join(tmpdir(), 'lolping-writer-native-'));
const provider = createServer((_req, res) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Local ownership fixture: no inference', type: 'invalid_request_error' } })); });
await new Promise(r => provider.listen(0, '127.0.0.1', r));
await writeFile(join(home, 'config.toml'), `model = "writer-fixture"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Local rejecting fixture"\nbase_url = "http://127.0.0.1:${provider.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`);
await writeFile(join(home, 'SKILL.md'), '---\nname: lolping-your-ai\ndescription: Ownership test fixture\n---\nDo not perform any actions.\n');
const make = () => new CodexAdapter({ command: process.env.CODEX_CLI_PATH || 'codex', cwd: home, skillPath: join(home, 'SKILL.md'), mcp: { command: process.execPath, args: ['-e', 'process.exit(0)'], env: { CODEX_HOME: home } } });
const a = make(), b = make();
a.on('failure', () => {}); b.on('failure', () => {});
const timer = setTimeout(() => { console.error('Native ownership regression timed out'); a.close(); b.close(); provider.close(); process.exitCode = 1; }, 60000);
try {
  const id = await a.create();
  const finished = once(a, 'completed');
  await a.send(id, 'WRITER_HISTORY_MUST_SURVIVE');
  await finished; // The local provider rejects; the persisted user turn is enough.
  const before = await a.rpc('thread/read', { threadId: id, includeTurns: true });
  assert.match(JSON.stringify(before.thread.turns), /WRITER_HISTORY_MUST_SURVIVE/);
  await assert.rejects(b.resume(id), e => e.code === 'SESSION_WRITER_CONFLICT' && e.threadId === id);
  await a.rpc('thread/archive', { threadId: id });
  await a.rpc('thread/unarchive', { threadId: id });
  assert.equal(await b.resume(id, { force: true }), id);
  const after = await b.rpc('thread/read', { threadId: id, includeTurns: true });
  assert.deepEqual(after.thread.turns, before.thread.turns);
  console.log('PASS: two native Codex writers conflict; release and reconnect preserve the same ID and complete turns. No external inference.');
} finally {
  clearTimeout(timer);
  const exits = [a, b].filter(x => x.child).map(x => once(x.child, 'exit'));
  a.close(); b.close(); provider.close();
  await Promise.all(exits); await rm(home, { recursive: true, force: true });
}
