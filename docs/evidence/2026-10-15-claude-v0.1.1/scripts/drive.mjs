// Drives the running LOLPingYourAI app through its local bridge (the same path `ai/cli.mjs` uses) and follows the
// teammate turn from /status history. The Test Board writes its textarea value to $TMPDIR/lolping-test-board.json,
// which is read independently of anything the teammate reports.
// Usage: node drive.mjs '<json plan>'   plan: [{ "signal", "message"?, "point"?, "after"?: "done"|"allin"|"action"|"reply", "timeout"? }, ...]
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const bridge = JSON.parse(await readFile(join(homedir(), 'Library/Application Support/LOLPingYourAI/bridge.json'), 'utf8'));
const call = async (method, body = {}) => {
  const r = await fetch(`${bridge.endpoint}/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
};
const board = async () => { try { return JSON.parse(await readFile(join(tmpdir(), 'lolping-test-board.json'), 'utf8')).value; } catch { return '(unreadable)'; } };
const t0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = (v, n = 200) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}…` : s; };

let seen = (await call('status')).history.at(-1)?.time ?? 0;
const marks = { allin: 0, action: 0, reply: 0, result: 0 };
function follow(history) {
  for (const { time, event } of history) {
    if (time <= seen) continue; seen = time;
    const m = event.params ?? {};
    if (event.method !== 'claude/message') { log(`   · ${event.method}`); continue; }
    if (m.type === 'system' && m.subtype === 'init') log(`   SDK init: claude_code ${m.claude_code_version} model=${m.model} tools=${m.tools?.length} mcp=${(m.mcp_servers ?? []).map(s => `${s.name}:${s.status}`).join(',')}`);
    else if (m.type === 'assistant') for (const b of m.message?.content ?? []) {
      if (b.type === 'text' && b.text.trim()) log(`   🗨 ${short(b.text.replace(/\s+/g, ' '), 700)}`);
      if (b.type === 'tool_use') {
        const name = b.name.replace('mcp__lolpingyourai__', ''), input = { ...b.input }; delete input.contextId;
        log(`   🔧 ${name} ${short(input, 180)}`);
        if (name === 'reply_ping') { marks.reply++; if (input.signal === 'allin') marks.allin++; }
        if (name === 'desktop_action') marks.action++;
      }
    } else if (m.type === 'user') for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
      if (b.type === 'tool_result' && b.is_error) log(`   ⛔ ${short(Array.isArray(b.content) ? b.content.map(c => c.text ?? `[${c.type}]`).join(' ') : b.content, 300)}`);
    } else if (m.type === 'result') { marks.result++; log(`   RESULT ${m.subtype} is_error=${m.is_error} turns=${m.num_turns} ${(m.duration_ms / 1000).toFixed(1)}s`); }
  }
}
async function wait(after, timeout = 300000) {
  const start = { ...marks }, end = Date.now() + timeout; let wasBusy = false;
  while (Date.now() < end) {
    const s = await call('status'); follow(s.history); wasBusy ||= s.busy;
    if (after === 'done' && wasBusy && !s.busy) return true;
    if (after === 'done' && !wasBusy && marks.result > start.result) return true;
    if (after === 'allin' && marks.allin > start.allin) return true;
    if (after === 'action' && marks.action > start.action) return true;
    if (after === 'reply' && marks.reply > start.reply) return true;
    if (after === 'none') return true;
    await sleep(400);
  }
  log(`TIMEOUT waiting for ${after}`); return false;
}
// Safety: confirm (with the app's own helper) that the Test Board process owns the window under the ping point, so a
// ping can never capture or act on one of the user's own windows. Window titles are not readable from this shell, so
// the check is by owning PID of the board's Electron process.
const helper = process.env.APP_HELPER ?? '/Applications/LOLPingYourAI.app/Contents/Resources/desktop-helper';
const pid = pattern => Number(execFileSync('/usr/bin/pgrep', ['-f', pattern], { encoding: 'utf8' }).split('\n')[0]);
const appPid = pid('/Applications/LOLPingYourAI.app/Contents/MacOS/LOLPingYourAI'), boardPid = pid('MacOS/Electron tools/test-board.cjs');
function boardUnder(point) {
  const w = JSON.parse(execFileSync(helper, ['target'], { input: JSON.stringify({ ...point, excludePid: appPid }), encoding: 'utf8' }));
  return w.pid === boardPid ? w : (log(`  ✗ refusing to ping: the window under ${JSON.stringify(point)} is ${w.app} pid ${w.pid}, not the Test Board (${boardPid})`), null);
}
const plan = JSON.parse(process.argv[2]);
for (const step of plan) {
  // A watch step sends nothing: it follows a ping made some other way (the real Option+drag wheel) until its turn ends.
  if (step.watch) { log(`▶ watching for a ping  board=${JSON.stringify(await board())}`); await wait(step.after ?? 'done', step.timeout); log(`  board=${JSON.stringify(await board())}`); continue; }
  if (step.front !== false && !boardUnder(step.point ?? { x: 230, y: 300 })) process.exit(2);
  log(`▶ ping ${step.signal}${step.message ? ` “${step.message}”` : ''}  board=${JSON.stringify(await board())}`);
  const sent = Date.now();
  try { log(`  → ${short(await call('ping', { signal: step.signal, point: step.point ?? { x: 230, y: 300 }, ...(step.message ? { message: step.message } : {}) }), 160)} (${Date.now() - sent} ms)`); }
  catch (e) { log(`  ✗ ${e.message}`); }
  await wait(step.after ?? 'done', step.timeout);
  log(`  board=${JSON.stringify(await board())}`);
}
const s = await call('status');
log(`■ busy=${s.busy} session=${s.sessions.claude?.id} wards=${JSON.stringify(s.wards.map(w => w.status))}`);
