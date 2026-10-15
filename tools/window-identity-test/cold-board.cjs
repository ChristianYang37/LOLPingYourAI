// Separate process: do not enable accessibility or inspect this process with
// an AX inspector before the controller runs its first input action.
const { app, BrowserWindow } = require('electron');
const { writeFileSync, renameSync } = require('node:fs');
const file = process.argv[2];
let win, timer;
app.whenReady().then(async () => {
  win = new BrowserWindow({ x: 120, y: 120, width: 500, height: 400 });
  await win.loadURL('data:text/html,' + encodeURIComponent('<title>Cold input fixture</title><textarea autofocus style="width:90%;height:180px">COLD</textarea>'));
  const save = async () => {
    const value = await win.webContents.executeJavaScript("document.querySelector('textarea').value");
    writeFileSync(file + '.tmp', JSON.stringify({ id: win.getMediaSourceId().split(':')[1], pid: process.pid, value, bounds: win.getBounds() })); renameSync(file + '.tmp', file);
  };
  await save(); timer = setInterval(() => void save(), 100);
});
app.on('window-all-closed', () => { clearInterval(timer); app.quit(); });
