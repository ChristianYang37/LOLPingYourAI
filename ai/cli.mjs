#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const usage = `Usage: lolpingai <command> [json | --file payload.json]

  models   Reload native models: '{"harness":"codex","refresh":true}'
  doctor   Desktop permissions and harness availability
  status   Configuration, sessions, wards and recent teammate events
  ping     Send a ping:        '{"signal":"missing","point":{"x":640,"y":400}}'
  config   Change settings:    '{"regionSize":512,"wardHours":0.5}'
  bind     Hand off a task:    '{"harness":"codex","summary":"Goal, progress, next step"}'
  stop     Interrupt the teammate and return control

Talks only to the LOLPingYourAI app running on this machine.`;
const commands = ['doctor', 'status', 'stop', 'bind', 'ping', 'config', 'models'];
const [command = 'status', ...args] = process.argv.slice(2);
const directory = process.env.LOLPINGAI_DATA_DIR ?? (process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/LOLPingYourAI') : join(process.env.APPDATA ?? homedir(), 'LOLPingYourAI'));
try {
  if (['help', '--help', '-h'].includes(command)) { console.log(usage); process.exit(0); }
  if (!commands.includes(command)) throw Object.assign(new Error(`Unknown command "${command}"`), { usage: true });
  let body;
  try { body = args[0] === '--file' ? JSON.parse(await readFile(args[1], 'utf8')) : args[0] ? JSON.parse(args[0]) : {}; }
  catch (error) { throw new Error(`Invalid JSON payload (${error.message})`); }
  let bridge;
  try { bridge = JSON.parse(await readFile(join(directory, 'bridge.json'), 'utf8')); }
  catch { throw Object.assign(new Error('The app is not running'), { offline: true }); }
  const { endpoint, token } = bridge;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('Invalid bridge endpoint');
  const response = await fetch(`${endpoint}/${command}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) })
    .catch(() => { throw Object.assign(new Error('The app is not reachable'), { offline: true }); });
  const result = await response.json(); if (!response.ok) throw new Error(result.error);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`LOLPingYourAI: ${error.message}.${error.offline ? ' Start the desktop app first.' : ''}${error.usage ? `\n\n${usage}` : ''}`);
  process.exitCode = 1;
}
