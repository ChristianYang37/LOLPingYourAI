// Watches the pending ward through its due time: logs busy changes, each new ping context and the visit's tool calls,
// then exits once the ward has left "pending" and the teammate is idle (or at the deadline).
import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; import { homedir } from 'node:os';
const dir = join(homedir(), 'Library/Application Support/LOLPingYourAI');
const b = JSON.parse(await readFile(join(dir, 'bridge.json'), 'utf8'));
const status = async () => (await fetch(`${b.endpoint}/status`, { method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' }, body: '{}' })).json();
const t = ms => new Date(ms).toLocaleTimeString('en-GB'), log = (...a) => console.log(t(Date.now()), ...a);
const deadline = Date.parse(process.argv[2]), flat = x => String(x).replace(/\s+/g, ' ');
let last = { busy: null, context: null, ward: null }, seenTimes = new Set(), timerContexts = new Set();
const start = Date.now();
for (;;) {
  const s = await status();
  const ward = s.wards.map(w => `${w.id.slice(0, 8)}:${w.status}`).join(',') || 'none';
  if (ward !== last.ward) log('wards', ward, JSON.stringify(s.wards.map(({ target, ...w }) => ({ ...w, dueAt: t(w.dueAt) }))));
  if (s.busy !== last.busy) log('busy', s.busy);
  if (s.context?.id !== last.context) { log('context', s.context?.id, s.context?.source, s.context?.signal, s.context?.mode, s.context?.target?.title); if (s.context?.source === 'timer') timerContexts.add(s.context.id); }
  for (const { time, event } of s.history) {
    if (time < start || seenTimes.has(time + JSON.stringify(event).length)) continue; seenTimes.add(time + JSON.stringify(event).length);
    const m = event.params ?? {};
    if (m.type === 'system' && m.subtype === 'init') console.log(t(time), '  INIT', m.model);
    if (m.type === 'result') console.log(t(time), '  RESULT', m.subtype, 'error=' + m.is_error);
    if (m.type === 'assistant') for (const c of m.message?.content ?? []) {
      if (c.type === 'text') console.log(t(time), '  SAY', flat(c.text).slice(0, 600));
      if (c.type === 'tool_use') { const i = { ...c.input }; delete i.contextId; console.log(t(time), '  TOOL', c.name.replace('mcp__lolpingyourai__', ''), flat(JSON.stringify(i)).slice(0, 300)); }
    }
  }
  last = { busy: s.busy, context: s.context?.id, ward };
  if (!s.wards.some(w => w.status === 'pending' || w.status === 'running') && !s.busy && Date.now() > (s.wards[0]?.dueAt ?? 0)) { log('done; timer contexts:', timerContexts.size); break; }
  if (Date.now() > deadline) { log('deadline reached'); break; }
  await new Promise(r => setTimeout(r, 3000));
}
console.log('--- wards.json'); console.log(await readFile(join(dir, 'wards.json'), 'utf8'));
