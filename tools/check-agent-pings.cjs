// Production-renderer smoke test; no model call or desktop input.
// Run after pnpm build: pnpm exec electron tools/check-agent-pings.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const { buildSync } = require('esbuild');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const temporary = mkdtempSync(path.join(tmpdir(), 'lolping-lifetime-'));
const bundled = path.join(temporary, 'fixtures.cjs');
buildSync({ stdin: { contents: "export * from './src/main/appProtocol'; export * from './src/shared/settings';", resolveDir: process.cwd() }, bundle: true, platform: 'node', external: ['electron'], outfile: bundled });
const { registerAppScheme, serveAppScheme, DEFAULT_SETTINGS, overlaySettings } = require(bundled);
rmSync(temporary, { recursive: true, force: true });
registerAppScheme();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, preload: path.resolve('out/preload/overlay.js') } });
  try {
    serveAppScheme({ rendererRoot: path.resolve('out/renderer'), emoteDirs: () => [], assetDirs: () => [path.resolve('out/renderer')] });
    await win.loadURL('lolping://app/overlay/index.html');
    win.webContents.send('overlay:settings', overlaySettings({ ...DEFAULT_SETTINGS, muted: true }));
    const results = [];
    for (const [id, selector] of [['missing', '.ping .art'], ['bait', '.emote .fx']]) {
      const requestId = results.length + 1, start = performance.now();
      let finished = false;
      const ack = new Promise(resolve => {
        const handler = (event, received) => {
          if (event.sender !== win.webContents || received !== requestId) return;
          ipcMain.removeListener('overlay:agent-ping-ended', handler);
          finished = true; resolve(performance.now() - start);
        };
        ipcMain.on('overlay:agent-ping-ended', handler);
      });
      win.webContents.send('agent:ping', { id, x: 300, y: 200, requestId });
      await delay(4200);
      const visible = await win.webContents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)}), img = el?.querySelector('img');
        return !!el && Number(getComputedStyle(el).opacity) > .9 && !!img?.naturalWidth;
      })()`);
      assert.equal(visible, true, id + ' must remain visible after the old 3 s lifetime');
      assert.equal(finished, false, id + ' must not acknowledge early');
      const elapsedMs = await ack;
      assert.ok(elapsedMs >= 6000 && elapsedMs < 12000, id + ' lifetime: ' + elapsedMs);
      const remaining = await win.webContents.executeJavaScript("document.querySelectorAll('.ping, .emote').length");
      assert.equal(remaining, 0);
      results.push({ signal: id, visibleAt4200ms: true, elapsedMs: Math.round(elapsedMs) });
    }
    console.log(JSON.stringify({ passed: true, results })); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => { console.error('Renderer smoke test timed out'); app.exit(1); }, 30000);
