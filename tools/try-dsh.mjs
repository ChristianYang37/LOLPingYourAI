#!/usr/bin/env node
// A real DSH process. Protocol-only mode uses no model API; --live requires your own free-provider key.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DshAdapter } from '../ai/harness/dsh.mjs';
import { Store } from '../ai/store.mjs';
import { startBridge } from '../ai/server.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const live = process.argv.includes('--live');
const bailian = process.argv.includes('--bailian');
const keyName = bailian ? 'DASHSCOPE_API_KEY' : 'SILICONFLOW_API_KEY';
if (live && !process.env[keyName]) {
  console.error(`Set ${keyName} locally first. No API request was made. Do not paste keys into chat or commit them.`);
  process.exit(1);
}
const directory = await mkdtemp(join(tmpdir(), 'lolpingai-dsh-'));
const bridge = await startBridge({ status: () => ({}), context: { message: 'Connection-only text trial. No desktop task is active.' } }, new Store(directory));
const adapter = new DshAdapter({ command: process.execPath, args: [process.env.LOLPINGAI_DSH ?? join(homedir(), '.local/share/lolpingyourai-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')], cwd: directory, skillPath: join(root, 'skills/lolping-your-ai/SKILL.md'), patch: resolve(root, bailian ? 'examples/dsh-bailian.patch.yml' : 'examples/dsh-siliconflow.patch.yml'), env: { DSH_HOME: join(directory, 'home') }, mcp: { command: process.execPath, args: [join(root, 'ai/mcp.mjs')], env: { LOLPINGAI_ENDPOINT: bridge.endpoint, LOLPINGAI_TOKEN: bridge.token } } });
adapter.on('failure', e => console.error(e.message));
adapter.on('event', e => { if (e.method === 'dsh/message') console.log(e.params.message.content.map(c => c.text).join('')); });
try {
  console.log(JSON.stringify(await adapter.capabilities()));
  const id = await adapter.create();
  await adapter.rpc('session/close', { sessionId: id }); adapter.loaded.delete(id); await adapter.resume(id);
  console.log('ACP initialize / create / MCP mount / close / resume: passed');
  if (live) {
    let timer;
    const done = new Promise((resolve, reject) => { adapter.once('completed', p => p.turn.status === 'completed' ? resolve() : reject(new Error(`Trial ${p.turn.status}`))); timer = setTimeout(() => { void adapter.cancel(id); reject(new Error('Text trial timed out')); }, 90000); });
    try { await adapter.send(id, 'Connection-only text trial. There is no desktop task. Reply with: DSH text trial OK. Do not use any tools.', undefined, { reasoningEffort: 0 }); await done; console.log('Live text API response: passed. Vision and desktop control were not tested.'); }
    finally { clearTimeout(timer); }
  } else console.log(`No model API call made. Use --live with ${keyName} for the text trial; verify provider free quota first.`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await adapter.close(); bridge.close(); await rm(directory, { recursive: true, force: true }); }
