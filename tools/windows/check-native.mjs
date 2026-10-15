// Real Win32 input against disposable fixtures only; fails on a noninteractive desktop.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { Desktop } from '../../ai/desktop.mjs';

if (process.platform !== 'win32') throw new Error('This regression requires Windows');
const build = resolve('native/desktop/build');
const compiled = spawnSync(join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  ['/nologo', '/r:System.Web.Extensions.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', `/out:${join(build, 'fixture.exe')}`, resolve('tools/windows/Fixture.cs')], { stdio: 'inherit' });
assert.equal(compiled.status, 0, 'Compile disposable fixture');
const fixture = spawn(join(build, 'fixture.exe'), [], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = []; let onInput;
const lines = createInterface({ input: fixture.stdout });
lines.on('line', line => { const event = JSON.parse(line); if (event.input !== undefined) onInput?.(event); else pending.shift()?.resolve(event.ready ?? event.reply ?? event); });
fixture.on('exit', code => { for (const p of pending.splice(0)) p.reject(new Error(`Fixture exited ${code}`)); });
const next = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
const command = async (op, index = 0) => { const answer = next(); fixture.stdin.write(JSON.stringify({ op, index }) + '\n'); return answer; };
// SendInput only queues events; a cross-thread Invoke can overtake their UI delivery.
// Poll independent state without ever repeating the input operation.
const values = async expected => {
  let state;
  for (let i = 0; i < 100; i++) { state = await command('read'); if (JSON.stringify(state.values) === JSON.stringify(expected)) return state; await new Promise(r => setTimeout(r, 20)); }
  assert.deepEqual(state.values, expected); return state;
};
const desktop = new Desktop({ helper: resolve(process.env.LOLPINGAI_DESKTOP_HELPER || 'native/desktop/build/desktop-helper.exe') });
let passed = 0;
const check = async (name, fn) => { await fn(); console.log(`PASS ${++passed}: ${name}`); };
const watchdog = setTimeout(() => { console.error('Windows fixture timed out'); fixture.kill(); process.exitCode = 1; }, 420000);
try {
  const initial = await next();
  let targets = [];
  for (let i = 0; i < 2; i++) { await command('focus', i); targets[i] = await desktop.native('target', { x: 180, y: 220 }); assert.equal(targets[i].id, initial.ids[i]); }
  const identity = i => targets[i];
  await check('same-process overlapping windows keep distinct lifetime tokens', async () => {
    assert.equal(targets[0].pid, targets[1].pid); assert.notEqual(targets[0].id, targets[1].id);
    assert.ok(targets[0].processStartedAt); assert.ok(targets[0].windowToken);
    for (let n = 0; n < 20; n++) {
      const i = n % 2; await command('focus', i);
      await desktop.native('type', { ...identity(i), text: i ? 'B' : 'A' });
      await values(['A'.repeat(Math.floor(n / 2) + 1), 'B'.repeat(Math.floor((n + 1) / 2))]);
    }
  });
  await check('Unicode input and Ctrl+A reach only the intended edit control', async () => {
    await command('focus'); await desktop.native('key', { ...identity(0), key: 'ctrl+a' });
    await desktop.native('type', { ...identity(0), text: 'Windows 中文 ✓ 😀\nSecond line.\r\nThird line.' });
    await values(['Windows 中文 ✓ 😀\r\nSecond line.\r\nThird line.', 'B'.repeat(10)]);
  });
  await check('reused PID/birth and window lifetime markers are rejected', async () => {
    await assert.rejects(desktop.native('resolve', { ...identity(0), processStartedAt: '0' }), /process restarted/);
    await assert.rejects(desktop.native('resolve', { ...identity(0), windowToken: '0' }), /closed or changed/);
  });
  await check('moved window refuses stale native coordinates', async () => {
    await command('move');
    await assert.rejects(desktop.native('click', { ...identity(0), expectedBounds: targets[0].bounds, x: 200, y: 220 }), /Window moved/);
    targets[0] = await desktop.native('resolve', identity(0));
  });
  await check('topmost obstruction refuses clicks', async () => {
    await command('cover'); await command('focus');
    await assert.rejects(desktop.native('click', { ...identity(0), expectedBounds: targets[0].bounds, x: 220, y: 240 }), /obscured/);
    await command('uncover');
  });
  await check('disabled modal owner refuses input', async () => {
    await command('disable'); await assert.rejects(desktop.native('type', { ...identity(0), text: 'LEAK' }), /disabled/); await command('enable');
  });
  await check('constrained resize rolls back and valid resize reads actual geometry', async () => {
    await command('focus'); const original = (await desktop.native('resolve', identity(0))).bounds;
    await assert.rejects(desktop.native('resize', { ...identity(0), bounds: { ...original, width: 10, height: 10 } }), /rollback verified/);
    assert.deepEqual((await desktop.native('resolve', identity(0))).bounds, original);
    const bounds = { ...original, width: 620, height: 400 };
    assert.deepEqual((await desktop.native('resize', { ...identity(0), bounds })).actual, bounds);
    await desktop.native('resize', { ...identity(0), bounds: original });
  });
  await check('focus theft interrupts long text without draining it into the other window', async () => {
    await command('clear'); await command('focus'); await command('steal');
    await assert.rejects(desktop.native('type', { ...identity(0), text: 'X'.repeat(10000) }), /foreground|focus/);
    const state = await command('read'); assert.ok(state.values[0].length < 10000); assert.equal(state.values[1], ''); assert.ok(state.held.every(v => !v));
  });
  await check('cooperative cancellation waits for exit and releases keys', async () => {
    await command('clear'); await command('focus'); const controller = new AbortController();
    onInput = event => { if (event.length >= 10) controller.abort(); };
    const start = Date.now();
    await assert.rejects(desktop.native('type', { ...identity(0), text: 'Y'.repeat(10000) }, controller.signal), /cancelled/);
    onInput = undefined; const state = await command('read');
    assert.ok(controller.signal.aborted); assert.ok(state.values[0].length >= 10 && state.values[0].length < 10000);
    assert.equal(state.values[1], ''); assert.ok(state.held.every(v => !v));
    console.log(`  cancelled after ${state.values[0].length} characters, total ${Date.now() - start}ms`);
  });
  await check('cancellation waits for a slow in-flight character handler', async () => {
    await command('clear'); await command('focus'); await command('delay');
    const controller = new AbortController(); let started, settled = false;
    const processing = new Promise(resolve => { started = resolve; });
    onInput = event => { if (event.delayStarted) { controller.abort(); started(); } };
    const action = desktop.native('type', { ...identity(0), text: 'ZZ' }, controller.signal);
    action.then(() => { settled = true; }, () => { settled = true; });
    const rejected = assert.rejects(action, /cancelled/);
    await processing; await new Promise(r => setTimeout(r, 1200));
    assert.equal(settled, false, 'Do not confirm cancellation while the target is processing a character');
    await rejected; onInput = undefined;
    await values(['Z', '']);
  });
  await check('accepted 10,000-character text completes without timeout or cross-window input', async () => {
    await command('clear'); await command('focus'); const text = 'Long text '.repeat(1000), start = Date.now();
    await desktop.native('type', { ...identity(0), text });
    const state = await values([text, '']); assert.ok(state.held.every(v => !v));
    console.log(`  all ${text.length} characters independently read back in ${Date.now() - start}ms`);
  });
  await check('closed/recreated same-title window invalidates old identity', async () => {
    await command('recreate'); await assert.rejects(desktop.native('resolve', identity(0)), /closed or changed/);
  });
  console.log(`${passed} Windows native regression groups passed`);
} finally { clearTimeout(watchdog); onInput = undefined; fixture.stdin.end(); lines.close(); fixture.kill(); }
