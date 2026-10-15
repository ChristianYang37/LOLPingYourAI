// Launch the actual app, inspect its real renderer, persist config, quit and restart.
// Inspector is loopback-only and exists only for this disposable test process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { WebSocket } from 'ws';

const executable = resolve(process.argv[2] || 'release/win-unpacked/LOLPingYourAI.exe');
await mkdir('.local', { recursive: true });
const directory = await mkdtemp(resolve('.local/windows app profile '));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function launch(expected, change) {
  const env = { ...process.env, LOLPINGAI_DATA_DIR: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['--inspect=127.0.0.1:0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', inspector, exited = false, socket;
  const exit = new Promise(r => child.on('exit', code => { exited = true; r(code); }));
  child.stderr.on('data', data => { stderr += data; inspector ??= stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0]; });
  child.stdout.resume();
  const watchdog = setTimeout(() => child.kill(), process.argv.includes('--live-codex') ? 660000 : 60000);
  const wait = async fn => { for (let i = 0; i < 200; i++) { if (exited) throw new Error(`App exited: ${stderr.slice(-2000)}`); const value = await fn(); if (value) return value; await sleep(100); } throw new Error('Packaged app readiness timed out'); };
  try {
    await wait(() => inspector);
    socket = new WebSocket(inspector); await new Promise((r,j) => { socket.once('open', r); socket.once('error', j); });
    let id = 0; const pending = new Map();
    socket.on('message', raw => { const m = JSON.parse(raw); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    const evaluate = async expression => {
      const current = ++id; const answer = new Promise(r => pending.set(current, r));
      socket.send(JSON.stringify({ id: current, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      const response = await Promise.race([answer, exit.then(() => { throw new Error('App exited during inspection'); })]);
      assert.ok(!response.error && !response.result.exceptionDetails, JSON.stringify(response));
      return response.result.result.value;
    };
    const bridge = await wait(async () => { try { const b = JSON.parse(await readFile(join(directory, 'bridge.json'), 'utf8')); return b.pid === child.pid && b; } catch { return false; } });
    const call = async (method, body = {}) => {
      const response = await fetch(`${bridge.endpoint}/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200); return response.json();
    };
    assert.equal((await call('status')).config.regionSize, expected);
    assert.match(await readFile(join(directory, '.agents/skills/lolping-your-ai/SKILL.md'), 'utf8'), /lolping-your-ai/);
    const electron = "process.mainModule.require('electron')";
    const renderer = await wait(async () => {
      const values = await evaluate(`Promise.all(${electron}.BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/settings/')).map(w=>w.webContents.executeJavaScript('document.body.innerText'))) `);
      return values?.find(text => text.length > 100);
    });
    assert.ok(renderer.length > 100, 'Actual settings/chat renderer loaded');
    if (change) await call('config', { regionSize: change });
    if (change && process.argv.includes('--live-codex')) await (await import('./live-codex.mjs')).liveCodex(directory);
    // Graceful app quit runs bridge, harness and hook cleanup.
    socket.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: `setImmediate(()=>${electron}.app.quit()); true` } }));
    socket.close();
    assert.equal(await exit, 0, 'App quits cleanly');
  } finally {
    if (!exited && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: 999999, method: 'Runtime.evaluate', params: { expression: "setImmediate(()=>process.mainModule.require('electron').app.quit()); true" } }));
      socket.close(); await Promise.race([exit, sleep(5000)]);
    }
    clearTimeout(watchdog); socket?.terminate(); if (!exited) child.kill();
  }
}
await launch(512, 640); await launch(640);
console.log('Actual packaged app: renderer, isolated profile, skill installation, config persistence and graceful restart passed');
