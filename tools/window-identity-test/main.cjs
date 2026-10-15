// Opt-in macOS integration test. Only creates/edits disposable fixture windows.
const { app, BrowserWindow, ipcMain, systemPreferences, screen } = require('electron');
const { spawn } = require('node:child_process');
const { writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync } = require('node:fs');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '../..');
const output = join(root, '.local/window-identity-test');
mkdirSync(output, { recursive: true });
const helper = join(root, 'native/desktop/build/desktop-helper');
const delay = ms => new Promise(r => setTimeout(r, ms));
let control, fixtures = [], running = false;
function native(op, args = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(helper, [op], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => p.kill(), 12000);
    p.stdout.on('data', x => stdout += x); p.stderr.on('data', x => stderr += x);
    p.on('error', reject);
    p.on('close', code => { clearTimeout(timeout); try { const value = JSON.parse(stdout); value.error || code ? reject(Error(value.error || stderr)) : resolve(value); } catch (e) { reject(e); } });
    p.stdin.end(JSON.stringify(args));
  });
}
async function fixture(label, bounds, options = {}) {
  const w = new BrowserWindow({ ...bounds, show: false, ...options, webPreferences: { contextIsolation: true } });
  fixtures.push(w);
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<title>Identity fixture</title><h2>Disposable window ${label}</h2><textarea autofocus style="width:90%;height:180px">${label}</textarea><script>document.querySelector('textarea').focus()</script>`));
  w.show(); await delay(250); return w;
}
const value = w => w.webContents.executeJavaScript("document.querySelector('textarea').value");
const assert = (condition, message) => { if (!condition) throw Error(message); };
async function rejected(op, args, pattern) { try { await native(op, args); } catch (e) { assert(pattern.test(e.message), e.message); return e.message; } throw Error(`${op} unexpectedly succeeded`); }
async function run() {
  if (running) return; running = true;
  const report = { at: new Date().toISOString(), platform: process.platform, tests: [] };
  const step = async (name, fn) => { try { const evidence = await fn(); report.tests.push({ name, passed: true, evidence }); } catch(e) { report.tests.push({ name, passed: false, error: e.message }); throw e; } finally { writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); } };
  try {
    report.doctor = await native('doctor');
    assert(report.doctor.accessibility, 'Enable Accessibility for Electron, then click Run tests. Installed LOLPingYourAI permissions are unchanged.');
    control.hide();
    await step('fresh Electron process: select, type and restore without pre-enabling AX', async () => {
      const manifest = join(output, `cold-${Date.now()}.json`);
      const child = spawn(process.execPath, [join(__dirname, 'cold-board.cjs'), manifest], { stdio: 'ignore' });
      try {
        const deadline = Date.now() + 10000;
        while (!existsSync(manifest) && Date.now() < deadline) await delay(100);
        assert(existsSync(manifest), 'Cold board did not start');
        const target = JSON.parse(readFileSync(manifest));
        const start = Date.now();
        await native('key', { ...target, key: 'cmd+a' });
        await native('type', { ...target, text: 'COLD-INPUT-OK' }); await delay(250);
        assert(JSON.parse(readFileSync(manifest)).value === 'COLD-INPUT-OK', 'Cold input did not arrive');
        await native('key', { ...target, key: 'cmd+a' });
        await native('type', { ...target, text: 'COLD' }); await delay(250);
        assert(JSON.parse(readFileSync(manifest)).value === 'COLD', 'Cold board restore failed');
        return { passed: true, elapsedMs: Date.now() - start };
      } finally { child.kill(); if (existsSync(manifest)) unlinkSync(manifest); }
    });
    const original = { x: 100, y: 100, width: 480, height: 360 };
    const a = await fixture('A', original);
    const b = await fixture('B', { ...original, x: 600 });
    const all = (await native('windows')).filter(w => w.pid === process.pid);
    const find = x => all.find(w => w.bounds.x === x && w.bounds.width === original.width);
    const wa = find(100), wb = find(600);
    assert(wa && wb && wa.id !== wb.id, 'Fixture window identities unavailable');
    report.fixture = { a: wa, b: wb };
    b.setBounds(original); b.focus(); await delay(300);
    await step('same PID, title and bounds: ping selects front window B', async () => {
      const target = await native('target', { x: 200, y: 240 });
      assert(target.id === wb.id, 'Ping did not select B');
      const list = (await native('windows')).filter(w => [wa.id, wb.id].includes(w.id));
      assert(list.length === 2 && JSON.stringify(list[0].bounds) === JSON.stringify(list[1].bounds), 'Fixture bounds differ');
      return { selected: target.id, titles: [a.getTitle(), b.getTitle()], bounds: list.map(w=>w.bounds) };
    });
    await step('exact identity raises A while B is front; only A receives typing', async () => {
      await native('key', { ...wa, key: 'cmd+a' });
      await native('type', { ...wa, text: 'ONLY-A' }); await delay(200);
      assert(await value(a) === 'ONLY-A' && await value(b) === 'B', 'Wrong text destination');
      return { a: await value(a), b: await value(b) };
    });
    await step('repeat focus changes between identical windows (10 actions)', async () => {
      for (let i=0;i<10;i++) {
        const target = i%2 ? wa : wb, window = i%2 ? a : b;
        (i%2 ? b : a).focus(); await delay(80);
        await native('key', { ...target, key: 'cmd+a' }); await native('type', { ...target, text: `TARGET-${i}` });
        await delay(80); assert(await value(window) === `TARGET-${i}`, `Wrong destination at ${i}`);
      }
      return { a: await value(a), b: await value(b) };
    });
    await step('stale coordinates rejected after target moves', async () => {
      a.setBounds({ ...original, x: 150 }); await delay(200);
      return rejected('click', { ...wa, expectedBounds: original, x: 200, y: 240 }, /Window moved/);
    });
    await step('refresh retains identity and permits click after move', async () => {
      const fresh = await native('resolve', wa); assert(fresh.id === wa.id && fresh.bounds.x === 150, 'Identity changed');
      await native('click', { ...fresh, expectedBounds: fresh.bounds, x: 250, y: 240 });
      await native('key', { ...fresh, key: 'cmd+a' }); await native('type', { ...fresh, text: 'MOVED-A' });
      await delay(100); assert(await value(a) === 'MOVED-A', 'Moved-window click did not focus textarea'); return fresh;
    });
    await step('resize checks actual bounds and reports app constraints', async () => {
      a.setMinimumSize(400, 300);
      const fresh = await native('resolve', wa);
      const error = await rejected('resize', { ...fresh, bounds: { x: 150, y: 100, width: 100, height: 100 } }, /did not reach|cannot be resized/);
      const actual = await native('resolve', wa);
      assert(actual.bounds.width >= 400 && actual.bounds.height >= 300, 'Minimum size was not enforced');
      await native('resize', { ...fresh, bounds: { ...original, x: 150 } });
      return { error, actual: actual.bounds };
    });
    await step('maximize from each work-area corner and restore original bounds', async () => {
      const work = screen.getDisplayMatching(a.getBounds()).workArea;
      const corners = [[work.x, work.y], [work.x + work.width - 480, work.y], [work.x, work.y + work.height - 360], [work.x + work.width - 480, work.y + work.height - 360]];
      for (const [x, y] of corners) {
        a.setBounds({ x, y, width: 480, height: 360 }); a.focus(); await delay(200);
        const fresh = await native('resolve', wa);
        await native('resize', { ...fresh, bounds: work });
        const enlarged = (await native('resolve', wa)).bounds;
        assert(Object.keys(work).every(k => Math.abs(work[k] - enlarged[k]) < 2), 'Maximize bounds differ');
        await native('resize', { ...fresh, bounds: fresh.bounds });
        const restored = (await native('resolve', wa)).bounds;
        assert(Object.keys(restored).every(k => Math.abs(fresh.bounds[k] - restored[k]) < 2), 'Restore bounds differ');
      }
      a.setBounds({ ...original, x: 150 }); return { corners: 4, workArea: work };
    });
    await step('wrong process birth marker rejected', () => rejected('resolve', { ...wa, processStartedAt: -1 }, /process restarted/));
    await step('floating non-focusable window blocks click without receiving input', async () => {
      const overlay = await fixture('OBSTRUCTION', { ...original, x: 150 }, { alwaysOnTop: true, focusable: false });
      const fresh = await native('resolve', wa);
      try { return await rejected('click', { ...fresh, expectedBounds: fresh.bounds, x: 250, y: 240 }, /covered|focus|dialog/); } finally { overlay.destroy(); }
    });
    await step('modal dialog prevents typing into parent', async () => {
      const modal = await fixture('DIALOG', { x: 200, y: 160, width: 300, height: 280 }, { parent: b, modal: true });
      try { const error = await rejected('type', { ...wb, text: 'MUST-NOT-TYPE' }, /focus|dialog/); assert(await value(modal)==='DIALOG', 'Dialog received input'); return error; } finally { modal.destroy(); }
    });
    await step('closed/recreated same-title same-bounds window rejects old ID', async () => {
      a.destroy(); const c = await fixture('C', original);
      const error = await rejected('type', { ...wa, text: 'MUST-NOT-TYPE' }, /closed|changed/);
      assert(await value(c) === 'C', 'Replacement received input'); return error;
    });
    report.passed = true;
  } catch(e) { report.error = e.message; report.passed = false; }
  finally {
    for (const w of fixtures) if(!w.isDestroyed()) w.destroy(); fixtures=[];
    writeFileSync(join(output, 'report.json'), JSON.stringify(report,null,2));
    control.show(); await control.webContents.executeJavaScript(`document.querySelector('pre').textContent=${JSON.stringify(JSON.stringify(report,null,2))}`); running=false;
  }
}
app.whenReady().then(async () => {
  control = new BrowserWindow({ width: 720, height: 620, title: 'LOLPing window identity tests', webPreferences: { nodeIntegration: true, contextIsolation: false } });
  await control.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<h2>LOLPing window identity tests</h2><p>Only disposable windows created by this test are edited.</p><button onclick="require('electron').ipcRenderer.send('permission')">Request Accessibility permission</button> <button onclick="require('electron').ipcRenderer.send('run')">Run tests (3 s delay)</button><pre>Ready. Results: .local/window-identity-test/report.json</pre>`));
  ipcMain.on('permission',()=>systemPreferences.isTrustedAccessibilityClient(true));
  ipcMain.on('run', () => { if (!running) setTimeout(run, 3000); });
  writeFileSync(join(output,'doctor.json'),JSON.stringify({ helper: await native('doctor'), electron: systemPreferences.isTrustedAccessibilityClient(false), executable: process.execPath }));
});
app.on('window-all-closed',()=>app.quit());
