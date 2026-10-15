#!/usr/bin/env node
// A real DSH process. Protocol-only mode uses no model API; --live uses your provider account.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DshAdapter } from '../ai/harness/dsh.mjs';
import { Store } from '../ai/store.mjs';
import { startBridge } from '../ai/server.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const live = process.argv.includes('--live');
const vision = process.argv.includes('--vision');
if (vision && !live) throw new Error('--vision requires --live');
const bailian = process.argv.includes('--bailian');
const qianwen = process.argv.includes('--qianwen');
if (bailian && qianwen) throw new Error('Choose one provider: --bailian or --qianwen');
const keyName = bailian || qianwen ? 'DASHSCOPE_API_KEY' : 'SILICONFLOW_API_KEY';
const storedKey = process.argv.includes('--stored-key');
if (live && !storedKey && !process.env[keyName]) {
  console.error(`Set ${keyName} locally first. No API request was made. Do not paste keys into chat or commit them.`);
  process.exit(1);
}
const directory = await mkdtemp(join(tmpdir(), 'lolpingai-dsh-'));
const bridge = await startBridge({ status: () => ({}), context: { message: 'Connection-only text trial. No desktop task is active.' } }, new Store(directory));
const adapter = new DshAdapter({ command: process.execPath, args: [process.env.LOLPINGAI_DSH ?? join(homedir(), '.local/share/lolpingyourai-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')], cwd: directory, skillPath: join(root, 'skills/lolping-your-ai/SKILL.md'), patch: resolve(root, qianwen ? 'examples/dsh-qianwen.patch.yml' : bailian ? 'examples/dsh-bailian.patch.yml' : 'examples/dsh-siliconflow.patch.yml'), env: storedKey ? {} : { DSH_HOME: join(directory, 'home') }, mcp: { command: process.execPath, args: [join(root, 'ai/mcp.mjs')], env: { LOLPINGAI_ENDPOINT: bridge.endpoint, LOLPINGAI_TOKEN: bridge.token } } });
adapter.on('failure', e => console.error(e.message));
let response = '';
adapter.on('event', e => { if (e.method === 'dsh/message') { const text = e.params.message.content.map(c => c.text).join(''); response += text; process.stdout.write(text); } });
async function trial(id, prompt, image) {
  response = '';
  let timer, completed;
  const done = new Promise((resolve, reject) => {
    completed = p => p.turn.status === 'completed' ? resolve() : reject(new Error(`Trial ${p.turn.status}`));
    adapter.once('completed', completed);
    timer = setTimeout(() => { void adapter.cancel(id).catch(() => {}); reject(new Error('API trial timed out')); }, 90000);
  });
  try { await Promise.all([adapter.send(id, prompt, image, { reasoningEffort: 0 }), done]); return response; }
  finally { clearTimeout(timer); adapter.off('completed', completed); console.log(); }
}
try {
  console.log(JSON.stringify(await adapter.capabilities()));
  const catalog = await adapter.listModels();
  console.log(`ACP model catalog: ${catalog.models.length} choices; default ${catalog.defaultModel}`);
  const id = await adapter.create();
  await adapter.rpc('session/close', { sessionId: id }); adapter.loaded.delete(id); await adapter.resume(id);
  console.log('ACP initialize / create / MCP mount / close / resume: passed');
  if (live) {
    assert.match(await trial(id, 'Connection-only text trial. There is no desktop task. Reply with: DSH text trial OK. Do not use any tools.'), /DSH text trial OK/);
    console.log('Live text API response: passed');
    if (vision) {
      const sharp = (await import('sharp')).default;
      const image = join(directory, 'vision.png');
      await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="white"/><text x="40" y="80" font-family="Arial" font-size="48" fill="black">ORBIT42</text><circle cx="120" cy="200" r="45" fill="red"/><circle cx="300" cy="200" r="45" fill="blue"/></svg>')).png().toFile(image);
      const answer = await trial(id, 'Read the attached synthetic image. Reply in English with two fields: Text (exact visible letters and digits), and Shapes (colors and shapes from left to right). Do not use tools.', image);
      assert.match(answer, /ORBIT42/); assert.match(answer, /red.*blue/is); assert.match(answer, /circle/i);
      console.log('Live synthetic image: exact text and ordered colored circles passed');
    }
  } else console.log(`No model API call made. Use --live with ${keyName} or --stored-key for the text trial; provider usage applies.`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await adapter.close(); bridge.close(); await rm(directory, { recursive: true, force: true }); }
