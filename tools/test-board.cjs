const { app, BrowserWindow, ipcMain } = require('electron');
const { writeFileSync, renameSync, readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
process.on('uncaughtException', error => { console.error(error.stack); app.exit(1); });
app.setName('LOLPingYourAI Test Board');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 680, height: 520, x: 100, y: 100, title: 'LOLPingYourAI Test Board', webPreferences: { nodeIntegration: true, contextIsolation: false } });
  const identity = process.platform === 'win32' ? JSON.parse(execFileSync(join(__dirname, '../native/desktop/build/desktop-helper.exe'), ['identify'], {
    input: JSON.stringify({ id: win.getMediaSourceId().split(':')[1], pid: process.pid }), encoding: 'utf8', windowsHide: true,
  })) : {};
  const instance = randomUUID(), path = process.env.LOLPINGAI_TEST_BOARD_FILE || join(app.getPath('temp'), 'lolping-test-board.json');
  let note = 'Ready for a ping.', focusToken, selection;
  const publish = () => {
    if (win.isDestroyed()) return;
    // Optional runner focus control affects only this disposable fixture.
    try { const token=readFileSync(`${path}.focus`, 'utf8'); if(token!==focusToken) {
      win.show(); win.moveTop(); win.focus();
      if (process.env.LOLPINGAI_TEST_BOARD_FOCUS_NOTE === '1') {
        win.webContents.executeJavaScript("document.querySelector('textarea').focus()").then(() => { focusToken=token; }).catch(() => {});
      } else focusToken=token;
    } } catch {}
    const value = { kind: 'lolping-test-board', instance, pid: process.pid, windowId: win.getMediaSourceId().split(':')[1], processStartedAt: identity.processStartedAt, windowToken: identity.windowToken, bounds: win.getBounds(), focusToken, value: note, selection, time: Date.now() };
    // A live heartbeat prevents a previous run's value/window ID from authorizing a new test.
    try {
      writeFileSync(`${path}.${instance}.tmp`, JSON.stringify(value), { mode: 0o600 });
      renameSync(`${path}.${instance}.tmp`, path);
    } catch (error) {
      // Windows can hold the destination during a reader/antivirus scan. Keep
      // the actual note in memory and retry publishing on the next heartbeat.
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
    }
  };
  ipcMain.on('board:value', (event, value) => { if (win.isDestroyed() || event.sender !== win.webContents || typeof value !== 'string') return; note = value; publish(); });
  ipcMain.on('board:selection', (event, value) => { if (win.isDestroyed() || event.sender !== win.webContents) return; selection = value; publish(); });
  win.webContents.on('did-finish-load', () => win.webContents.executeJavaScript(`
    (() => {
      const note = document.querySelector('textarea'); let ctrlReleased = true;
      const report = () => require('electron').ipcRenderer.send('board:selection', { start: note.selectionStart, end: note.selectionEnd, ctrlReleased });
      note.addEventListener('keydown', e => { if (e.key === 'Control') ctrlReleased = false; report(); });
      note.addEventListener('keyup', e => { if (e.key === 'Control') ctrlReleased = true; report(); });
      note.addEventListener('select', report); note.addEventListener('input', report); report();
    })()
  `).catch(error => { console.error(error); app.exit(1); }));
  const heartbeat = setInterval(publish, 1000);
  win.on('closed', () => clearInterval(heartbeat));
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>LOLPingYourAI Test Board</title><style>body{font:18px system-ui;background:#f6f3eb;padding:32px;color:#243a39}h1{font-size:26px}textarea{display:block;width:95%;height:120px;font:20px system-ui;border:2px solid #398e82;border-radius:12px;padding:10px}small{display:block;margin:24px 0;line-height:1.5}</style><h1>Teammate practice board</h1><p>Only this disposable test window may be edited.</p><textarea aria-label="Practice note" id="note">Ready for a ping.</textarea><small>Test: replace the note with “Ping received”, then restore it when corrected.</small><button onclick="document.querySelector('textarea').value='Ready for a ping.';document.querySelector('textarea').dispatchEvent(new Event('input'))">Reset note</button><script>const {ipcRenderer}=require('electron');document.querySelector('textarea').addEventListener('input',e=>ipcRenderer.send('board:value',e.target.value));ipcRenderer.send('board:value',document.querySelector('textarea').value);</script>`));
});
app.on('window-all-closed', () => app.quit());
