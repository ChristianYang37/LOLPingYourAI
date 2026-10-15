// Saves the full /status (including in-memory event history) as JSON for building timelines. Private: raw/ only.
import { readFile, writeFile } from 'node:fs/promises'; import { join } from 'node:path'; import { homedir } from 'node:os';
const b = JSON.parse(await readFile(join(homedir(), 'Library/Application Support/LOLPingYourAI/bridge.json'), 'utf8'));
const s = await (await fetch(`${b.endpoint}/status`, { method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' }, body: '{}' })).json();
await writeFile(process.argv[2], JSON.stringify(s)); console.log('history', s.history.length, 'first', new Date(s.history[0]?.time).toLocaleTimeString('en-GB'));
