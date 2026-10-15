// Watches the app during the second round of hand checks: emote candidates, imported emotes, signal mappings,
// new teammate sessions, ping contexts, wards and app restarts.
// Usage: node round2.mjs ward-placed <deadline>        exits when a new ward appears
//        node round2.mjs ward-done <deadline> <wardId>  exits when that ward has finished and the teammate is idle
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path'; import { homedir } from 'node:os';
const [until, deadlineArg, wardId] = process.argv.slice(2), deadline = Date.parse(deadlineArg);
const dir = join(homedir(), 'Library/Application Support/LOLPingYourAI');
const projects = join(homedir(), '.claude/projects', join(homedir(), 'Library/Application Support/LOLPingYourAI').replace(/[^A-Za-z0-9]/g, '-'));
const t = ms => new Date(ms).toLocaleTimeString('en-GB'), log = (...a) => console.log(t(Date.now()), ...a), flat = x => String(x).replace(/\s+/g, ' ');
const json = async (path, fallback) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } };
const list = async path => { try { return await readdir(path); } catch { return null; } };
const appPid = () => { try { return execFileSync('/usr/bin/pgrep', ['-f', 'LOLPingYourAI.app/Contents/MacOS/LOLPingYourAI'], { encoding: 'utf8' }).split('\n')[0]; } catch { return 'none'; } };
async function status() {
  const b = await json(join(dir, 'bridge.json'), null); if (!b) return null;
  try { return await (await fetch(`${b.endpoint}/status`, { method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) })).json(); } catch { return null; }
}
async function firstPrompt(file) {
  try {
    for (const line of (await readFile(join(projects, file), 'utf8')).split('\n')) {
      const e = JSON.parse(line || 'null'); const c = e?.type === 'user' ? e.message?.content : null;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find(x => x.type === 'text')?.text : null;
      if (text) return flat(text).slice(0, 200);
    }
  } catch {}
  return null;
}
const initialWards = new Set((await json(join(dir, 'wards.json'), [])).map(w => w.id));
const known = new Set(await list(projects) ?? []), described = new Set();
let last = {}, seen = new Set(), terminalSince = null;
const changed = (key, value, print) => { const s = JSON.stringify(value); if (last[key] !== s) { last[key] = s; print(); } };
log('watching', until, wardId ?? '', 'until', t(deadline));
for (;;) {
  const pid = appPid(); changed('pid', pid, () => log('app pid', pid));
  const names = (await list(join(dir, 'icon-candidates')) ?? []).filter(f => f.endsWith('.json'));
  const candidates = await Promise.all(names.map(f => json(join(dir, 'icon-candidates', f), {})));
  changed('candidates', candidates, () => log('icon candidates', JSON.stringify(candidates)));
  const settings = await json(join(dir, 'settings.json'), {});
  changed('customEmotes', settings.customEmotes, () => log('customEmotes', JSON.stringify(settings.customEmotes)));
  changed('emoteWheel', settings.emoteWheel, () => log('emoteWheel', JSON.stringify(settings.emoteWheel)));
  const emotes = await list(join(dir, 'emotes')); changed('emotes', emotes, () => log('emotes dir', JSON.stringify(emotes)));
  const config = await json(join(dir, 'ai-config.json'), {}); changed('config', config, () => log('ai-config', JSON.stringify(config)));
  for (const f of await list(projects) ?? []) {
    if (!f.endsWith('.jsonl') || known.has(f) || described.has(f)) continue;
    const p = await firstPrompt(f); if (p) { described.add(f); log('new teammate session', f.slice(0, 8), '—', p); }
  }
  const s = await status();
  if (!s) changed('bridge', 'down', () => log('bridge unreachable'));
  else {
    changed('bridge', 'up', () => log('bridge up'));
    changed('busy', s.busy, () => log('busy', s.busy));
    changed('context', s.context?.id, () => log('context', s.context?.id?.slice(0, 8), s.context?.source, s.context?.signal, s.context?.mode, s.context?.target?.app, s.context?.target?.pid));
    changed('wards', s.wards.map(({ target, ...w }) => w), () => log('wards', JSON.stringify(s.wards.map(({ target, ...w }) => ({ ...w, id: w.id.slice(0, 8), dueAt: t(w.dueAt), target: `${target?.app}:${target?.pid}` })))));
    for (const { time, event } of s.history) {
      const key = `${time}:${JSON.stringify(event).length}`; if (seen.has(key)) continue; seen.add(key);
      if (!last.historyPrimed) continue;
      const m = event.params ?? {}, sid = String(m.session_id ?? '').slice(0, 8);
      if (m.type === 'system' && m.subtype === 'init') console.log(t(time), '  INIT', sid, m.model, 'tools=' + m.tools?.length);
      if (m.type === 'result') console.log(t(time), '  RESULT', sid, m.subtype, 'error=' + m.is_error);
      if (m.type === 'assistant') for (const c of m.message?.content ?? []) {
        if (c.type === 'text') console.log(t(time), '  SAY', sid, flat(c.text).slice(0, 500));
        if (c.type === 'tool_use') { const i = { ...c.input }; delete i.contextId; for (const k of ['svg', 'pngBase64']) if (i[k]) i[k] = `[${String(i[k]).length} chars]`; console.log(t(time), '  TOOL', sid, c.name.replace('mcp__lolpingyourai__', ''), flat(JSON.stringify(i)).slice(0, 300)); }
      }
    }
    last.historyPrimed = true;
    const fresh = s.wards.find(w => !initialWards.has(w.id));
    if (until === 'ward-placed' && fresh) { log('WARD PLACED', fresh.id, 'due', t(fresh.dueAt), 'target', `${fresh.target?.app}:${fresh.target?.pid}:${fresh.target?.id}`); break; }
    if (until === 'ward-done') {
      const w = s.wards.find(w => w.id === wardId);
      const done = w && !['pending', 'visiting'].includes(w.status) && !s.busy;
      terminalSince = done ? terminalSince ?? Date.now() : null;
      if (terminalSince && Date.now() - terminalSince > 15000) { log('WARD FINISHED', w.status, w.error ?? ''); break; }
    }
  }
  if (Date.now() > deadline) { log('deadline reached'); break; }
  await new Promise(r => setTimeout(r, 3000));
}
console.log('--- wards.json'); console.log(JSON.stringify((await json(join(dir, 'wards.json'), [])).map(({ target, ...w }) => ({ ...w, dueAt: t(w.dueAt), target: `${target?.app}:${target?.pid}` })), null, 1));
