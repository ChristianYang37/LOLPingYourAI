// Deterministic Chromium input compatibility, without a model or account.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Desktop } from '../../ai/desktop.mjs';

await mkdir('.local', { recursive: true });
const directory = await mkdtemp(resolve('.local/electron-input-'));
const boardPath = join(directory, 'board.json');
const env = { ...process.env, LOLPINGAI_TEST_BOARD_FILE: boardPath, LOLPINGAI_TEST_BOARD_FOCUS_NOTE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const board = spawn(createRequire(import.meta.url)('electron'), [resolve('tools/test-board.cjs'), `--user-data-dir=${join(directory, 'profile')}`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
let error = ''; board.stderr.on('data', d => error += d);
board.on('exit', (code, signal) => { error += `\nBoard exited: code=${code}, signal=${signal}`; });
const wait = async predicate => {
  let last;
  for (let i = 0; i < 150; i++) {
    try { const state = last = JSON.parse(await readFile(boardPath, 'utf8')); if (state.pid === board.pid && predicate(state)) return state; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Electron input readback timed out: ${error.slice(0, 2000)}; last=${JSON.stringify(last)}`);
};
const watchdog = setTimeout(() => { board.kill(); process.exitCode = 1; }, 90000);
try {
  await wait(s => s.value === 'Ready for a ping.');
  const token = String(Date.now()); await writeFile(`${boardPath}.focus`, token);
  const state = await wait(s => s.focusToken === token);
  const desktop = new Desktop({ helper: resolve(process.env.LOLPINGAI_DESKTOP_HELPER || 'native/desktop/build/desktop-helper.exe') });
  const target = { id: state.windowId, pid: state.pid, processStartedAt: state.processStartedAt, windowToken: state.windowToken };
  for (const text of ['Windows 中文 ✓ 😀\nSecond line.\r\nThird line.', 'Electron long text. '.repeat(100), 'Ready for a ping.']) {
    await desktop.native('key', { ...target, key: 'ctrl+a' });
    await desktop.native('type', { ...target, text });
    const expected = text.replaceAll('\r\n', '\n');
    assert.equal((await wait(s => s.value === expected)).value, expected);
  }
  console.log('Electron Unicode, emoji, multiline, 2,000-character input and restore independently read back');
} finally { clearTimeout(watchdog); board.kill(); }
