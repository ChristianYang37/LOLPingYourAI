// Logs every ping context, pending ping and turn event from /status (and the board note) until the deadline.
// Used while the tester makes hand pings with the real wheels.  Usage: node handwatch.mjs <deadline>
import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; import { homedir, tmpdir } from 'node:os';
const dir = join(homedir(), 'Library/Application Support/LOLPingYourAI'), deadline = Date.parse(process.argv[2]);
const t = ms => new Date(ms).toLocaleTimeString('en-GB'), flat = x => String(x).replace(/\s+/g, ' ');
const status = async () => { try { const b = JSON.parse(await readFile(join(dir, 'bridge.json'), 'utf8')); return await (await fetch(`${b.endpoint}/status`, { method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) })).json(); } catch { return null; } };
const board = async () => { try { return JSON.parse(await readFile(join(tmpdir(), 'lolping-test-board.json'), 'utf8')).value; } catch { return '?'; } };
const start = Date.now(), seen = new Set(); let last = {};
for (;;) {
  const s = await status();
  if (s) {
    const ctx = s.context ? `${s.context.id.slice(0, 8)} ${s.context.source} ${s.context.signal} ${s.context.mode} ${s.context.target?.app}` : 'none';
    if (ctx !== last.ctx) console.log(t(Date.now()), 'context', ctx, 'board=' + JSON.stringify(await board()));
    if (s.busy !== last.busy) console.log(t(Date.now()), 'busy', s.busy);
    const pend = JSON.stringify(s.pending); if (pend !== last.pend && s.pending.length) console.log(t(Date.now()), 'pending', pend.slice(0, 300));
    last = { ctx, busy: s.busy, pend };
    for (const { time, event } of s.history) {
      const key = time + ':' + JSON.stringify(event).length; if (time < start || seen.has(key)) continue; seen.add(key);
      const m = event.params ?? {};
      if (m.type === 'system' && m.subtype === 'init') console.log(t(time), '  INIT', m.model, 'tools=' + m.tools?.length);
      if (m.type === 'result') console.log(t(time), '  RESULT', m.subtype);
      if (m.type === 'assistant') for (const c of m.message?.content ?? []) {
        if (c.type === 'text') console.log(t(time), '  SAY', flat(c.text).slice(0, 300));
        if (c.type === 'tool_use') { const i = { ...c.input }; delete i.contextId; console.log(t(time), '  TOOL', c.name.replace('mcp__lolpingyourai__', ''), flat(JSON.stringify(i)).slice(0, 200)); }
      }
    }
  }
  if (Date.now() > deadline) break;
  await new Promise(r => setTimeout(r, 700));
}
