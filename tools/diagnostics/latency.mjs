// Isolated text-only probe: no screenshots or desktop actions; never prints credentials/prompts.
// node tools/diagnostics/latency.mjs [codex|claude|dsh] [--turns 2]
import { mkdtemp } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from '../../ai/store.mjs';
import { Teammate } from '../../ai/service.mjs';
import { startBridge } from '../../ai/server.mjs';
import { CodexAdapter } from '../../ai/harness/codex.mjs';
import { ClaudeAdapter } from '../../ai/harness/claude.mjs';
import { DshAdapter } from '../../ai/harness/dsh.mjs';
const harness = process.argv[2] ?? 'codex';
const turnsIndex = process.argv.indexOf('--turns'), turns = turnsIndex < 0 ? 0 : Number(process.argv[turnsIndex + 1]);
if (!['codex', 'claude', 'dsh'].includes(harness) || !Number.isInteger(turns) || turns < 0 || turns > 3) throw new Error('Choose a supported harness and 0–3 text turns');
const modelIndex = process.argv.indexOf('--model'), model = modelIndex < 0 ? '' : process.argv[modelIndex + 1];
const dir = await mkdtemp(join(tmpdir(), 'lolping-latency-')), store = new Store(dir);
const mcp = { command: process.execPath, args: [resolve('ai/mcp.mjs')], env: {} };
const skillPath = resolve('skills/lolping-your-ai/SKILL.md');
const adapter = harness === 'codex' ? new CodexAdapter({ command: process.env.LOLPINGAI_CODEX ?? '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', cwd: dir, mcp, skillPath }) : harness === 'claude' ? new ClaudeAdapter({ cwd: dir, mcp, skillPath }) : new DshAdapter({ command: process.execPath, args: [join(homedir(), '.local/share/lolpingyourai-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js')], cwd: dir, mcp, skillPath, patch: process.env.LOLPINGAI_DSH_PATCH ?? join(homedir(), 'Library/Application Support/LOLPingYourAI/dsh.patch.yml') });
const timings = [];
if (adapter.rpc) { const rpc = adapter.rpc.bind(adapter); adapter.rpc = async (method, ...args) => { const start = performance.now(); try { return await rpc(method, ...args); } finally { timings.push({ method, ms: Math.round(performance.now() - start) }); } }; }
const service = new Teammate({ store, adapters: { [harness]: adapter }, desktop: { available: async () => false } });
await service.init(); await service.configure({ harness, modelSelections: { [harness]: { model, fastMode: false } } });
const bridge = await startBridge(service, store); Object.assign(mcp.env, { LOLPINGAI_ENDPOINT: bridge.endpoint, LOLPINGAI_TOKEN: bridge.token });
const watchdog = setTimeout(() => { console.error('Probe timed out'); process.exit(1); }, 60000);
try {
 const t = performance.now(), catalog = await adapter.listModels();
 console.log(JSON.stringify({ harness, discoveryMs: Math.round(performance.now() - t), models: catalog.models.map(m => m.id), defaultModel: catalog.defaultModel }));
 if(harness === 'codex') { const {config} = await adapter.rpc('config/read', {includeLayers:false}); console.log(JSON.stringify({ configuredModel:config.model, provider:config.model_provider })); }
 for(let i=0;i<turns;i++) {
   const started=performance.now(), previousId=service.task?.id; let first;
   const listener=()=>{if(service.task?.id !== previousId && service.task?.text && first===undefined)first=performance.now()-started;}; service.on('change',listener);
   const done=new Promise((res,rej)=>{adapter.once('completed',res);adapter.once('failure',rej);});
   await service.message({text:'Latency diagnostic. Reply only OK. No desktop actions, screenshots, file changes, or pings.'});
   const submitted=performance.now()-started, result=await done;
   console.log(JSON.stringify({turn:i+1,submittedMs:Math.round(submitted),firstTextMs:Math.round(first??0),completedMs:Math.round(performance.now()-started),status:result.turn.status,stages:service.task.timings}));
   service.off('change',listener);
 }
 console.log(JSON.stringify({rpc:timings}));
} finally {clearTimeout(watchdog);bridge.close();service.close();await adapter.close();}
