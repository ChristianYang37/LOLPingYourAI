// Live Electron regression: actual OverlayManager, renderer, animation and Web Audio completion.
// Run after pnpm build: pnpm exec electron tools/check-agent-queue.cjs
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { buildSync } = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const out = path.resolve('out/main/queue-smoke.cjs');
buildSync({ stdin: { contents: `export { OverlayManager } from './src/main/overlayManager'; export { registerAppScheme, serveAppScheme } from './src/main/appProtocol'; export { DEFAULT_SETTINGS, overlaySettings } from './src/shared/settings';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', external: ['electron'], outfile: out });
const { OverlayManager, registerAppScheme, serveAppScheme, DEFAULT_SETTINGS, overlaySettings } = require(out);
fs.unlinkSync(out);
registerAppScheme();
app.whenReady().then(async () => {
  serveAppScheme({ rendererRoot: path.resolve('out/renderer'), emoteDirs: () => [], assetDirs: () => [path.resolve('out/renderer')] });
  const settings = overlaySettings({ ...DEFAULT_SETTINGS, pingDurationS: .1, agentPingDurationS: 3, volume: 15 });
  const manager = new OverlayManager(settings, slug => ({ kind: 'bundled', slug }));
  const watchdog = setTimeout(() => { console.error('Queue smoke test timed out'); manager.destroy(); app.exit(1); }, 30000);
  try {
    manager.start();
    const wins = BrowserWindow.getAllWindows();
    await Promise.all(wins.map(w => new Promise(resolve => w.webContents.isLoading() ? w.webContents.once('did-finish-load', resolve) : resolve())));
    const win = wins.find(w => w.getBounds().x === screen.getPrimaryDisplay().bounds.x) ?? wins[0];
    await win.webContents.executeJavaScript(`window.queueProbe = { starts: [], max: 0 }; new MutationObserver(records => {
      const count = document.querySelectorAll('#pings > .ping, #emotes > .emote').length;
      window.queueProbe.max = Math.max(window.queueProbe.max, count);
      for (const record of records) for (const node of record.addedNodes) if ((node.classList?.contains('ping') || node.classList?.contains('emote'))) window.queueProbe.starts.push(performance.now());
    }).observe(document.body, { childList: true, subtree: true });`);
    const audioMs = await win.webContents.executeJavaScript(`(async()=>{ const a=new AudioContext(); const r=await fetch('lolping://assets/sounds/MIA.wav'); const b=await a.decodeAudioData(await r.arrayBuffer()); await a.close(); return b.duration*1000; })()`);
    const completed = new Promise(resolve => {
      let count = 0;
      ipcMain.on('overlay:agent-ping-ended', () => { if (++count === 5) resolve(); });
    });
    ['missing', 'missing', 'missing', 'bait', 'like'].forEach((id, i) => manager.spawnAgent({ displayId: screen.getPrimaryDisplay().id, id, x: 400, y: 300, tag: { name: `Queue test ${i + 1}/5`, color: 4 } }));
    await completed;
    const probe = await win.webContents.executeJavaScript('window.queueProbe');
    assert.equal(probe.max, 1); assert.equal(probe.starts.length, 5);
    const intervals = probe.starts.slice(1).map((t, i) => t - probe.starts[i]);
    assert(intervals[3] >= 3120);
    assert(intervals.every(ms => ms >= Math.max(250, audioMs) - 30), JSON.stringify({ intervals, audioMs }));
    console.log(JSON.stringify({ passed: true, maxConcurrent: probe.max, audioMs, intervalsMs: intervals }));
    clearTimeout(watchdog); manager.destroy(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(watchdog); manager.destroy(); app.exit(1); }
});
