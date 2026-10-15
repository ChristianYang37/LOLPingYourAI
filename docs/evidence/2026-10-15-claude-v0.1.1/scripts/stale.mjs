// Calls desktop_action with contexts that earlier pings superseded; each must be refused as stale.
// Usage: node stale.mjs label=contextId [label=contextId ...]
import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; import { homedir } from 'node:os';
const b = JSON.parse(await readFile(join(homedir(), 'Library/Application Support/LOLPingYourAI/bridge.json'), 'utf8'));
for (const [label, contextId] of process.argv.slice(2).map(a => a.split('='))) {
  const r = await fetch(`${b.endpoint}/desktop_action`, { method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contextId, action: 'key', key: 'shift' }) });
  console.log(new Date().toLocaleTimeString('en-GB'), label, r.status, JSON.stringify(await r.json()));
}
