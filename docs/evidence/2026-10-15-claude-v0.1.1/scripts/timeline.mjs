// Builds a redacted per-session tool timeline from a Claude Code session transcript (.jsonl).
// Usage: node timeline.mjs <transcript.jsonl> <label> [redact-json]
//   redact-json: {"sessions":{"<id>":"S1",...},"turns":{"<eventId>":"reason",...},"text":[["find","replace"],...]}
// A redacted turn keeps its PING line (time, signal, source, target app) and drops everything else until the next prompt.
import { readFileSync } from 'node:fs'; import { homedir } from 'node:os';
const [file, label, redactFile] = process.argv.slice(2);
const red = redactFile ? JSON.parse(readFileSync(redactFile, 'utf8')) : {};
const t = s => new Date(s).toLocaleTimeString('en-GB'), clip = (s, n) => s.length > n ? `${s.slice(0, n)}…` : s, flat = s => String(s).replace(/\s+/g, ' ');
const scrub = s => {
  let out = String(s).split(homedir()).join('~');
  for (const [id, l] of Object.entries(red.sessions ?? {})) out = out.split(id).join(l);
  for (const [a, b] of red.text ?? []) out = out.split(a).join(b);
  return out;
};
const out = []; let skipping = false;
for (const e of readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse)) {
  const c = e.message?.content, parts = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
  const ts = t(e.timestamp);
  if (e.type === 'user') for (const p of parts) {
    if (p.type === 'text') {
      if (/^(Continue from where you left off\.|\[Request interrupted)/.test(p.text)) { if (!skipping) out.push(`${ts} SDK ${flat(p.text)}`); continue; }
      const ev = p.text.match(/^LOLPingYourAI event ([0-9a-f-]{36})/)?.[1];
      let ctx = {}; try { ctx = JSON.parse(p.text.match(/\nContext: (\{.*\})\n/)?.[1] ?? '{}'); } catch {}
      const handoff = p.text.match(/\nHandoff: (.*)\n/)?.[1];
      const head = ev ? `PING event=${ev.slice(0, 8)} signal=${ctx.signal ?? '?'} source=${ctx.source ?? '?'} target=${ctx.target?.app ?? '?'}` : 'PROMPT';
      skipping = Boolean(ev && red.turns?.[ev]);
      if (skipping) { out.push(`${ts} ${head} [turn redacted: ${red.turns[ev]}]`); continue; }
      const first = ev ? p.text.split('\n')[0].replace(/^LOLPingYourAI event \S+ /, '') : p.text;
      const extra = p.text.split('\n').filter(l => /^(This is the|User message|Message:)/.test(l)).join(' ');
      out.push(`${ts} ${head}${ctx.target?.title ? `:${ctx.target.title}` : ''} | ${clip(flat(first), 200)}${extra ? ` | ${clip(flat(extra), 200)}` : ''}${handoff ? ` | handoff="${clip(flat(handoff), 160)}"` : ''}`);
    } else if (p.type === 'image' && !skipping) out.push(`${ts} PROMPT [image attached: ${p.source?.media_type}]`);
    else if (p.type === 'tool_result' && !skipping) {
      const body = Array.isArray(p.content) ? p.content.map(x => x.type === 'text' ? x.text : `[${x.type}]`).join(' ') : p.content;
      out.push(`${ts} RESULT error=${Boolean(p.is_error)} ${clip(flat(body), 220)}`);
    }
  }
  if (e.type === 'assistant' && !skipping) for (const p of parts) {
    if (p.type === 'text' && p.text.trim()) out.push(`${ts} SAY ${clip(flat(p.text), 600)}`);
    if (p.type === 'tool_use') { const i = { ...p.input }; delete i.contextId; if (typeof i.svg === 'string') i.svg = `[${i.svg.length} chars]`; out.push(`${ts} TOOL ${p.name.replace('mcp__lolpingyourai__', '')} ${clip(flat(JSON.stringify(i)), 260)}`); }
  }
}
console.log(`# ${label}: tool timeline from the Claude Code session transcript (times local, UTC+8)`);
console.log(scrub(out.join('\n')));
