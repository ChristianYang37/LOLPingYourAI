// Prints a timestamped /status snapshot without the event history (config, effective model/effort, sessions, wards).
import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; import { homedir } from 'node:os';
const b = JSON.parse(await readFile(join(homedir(), 'Library/Application Support/LOLPingYourAI/bridge.json'), 'utf8'));
const s = await (await fetch(`${b.endpoint}/status`, { method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' }, body: '{}' })).json();
const { history, signals, ...rest } = s;
console.log(new Date().toLocaleTimeString('en-GB'), JSON.stringify({ ...rest, historyLength: history?.length }, null, 1));
