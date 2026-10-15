// Real Electron renderer regression with deterministic local IPC fixtures; no model or desktop actions.
// pnpm build && pnpm exec electron tools/check-chat-ui.cjs
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const { buildSync } = require('esbuild');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const temp = mkdtempSync(path.join(require('node:os').tmpdir(), 'lolping-chat-'));
buildSync({ stdin: { contents: "export * from './src/main/appProtocol'; export * from './src/shared/settings';", resolveDir: process.cwd() }, bundle: true, platform: 'node', external: ['electron'], outfile: path.join(temp, 'fixtures.cjs') });
const { registerAppScheme, serveAppScheme, DEFAULT_SETTINGS } = require(path.join(temp, 'fixtures.cjs'));
rmSync(temp, { recursive: true, force: true });
registerAppScheme();
const settings = { ...DEFAULT_SETTINGS, language: 'zh-CN' };
let state = { config: { harness: 'codex', setupComplete: true, modelSelections: {}, reasoningEffort: 0, regionSize: 512, wardHours: .5, banter: true }, task: null, signals: {}, sessions: {}, pending: [], approvals: [], wards: [] };
const calls = [];
for (const [channel, value] of Object.entries({ 'settings:get': settings, 'status:get': { enabled: true, helper: 'running' }, 'app:about': null, 'app:capture': null, 'update:get': null })) ipcMain.handle(channel, () => value);
ipcMain.handle('ai:call', (_e, method, args) => { calls.push({ method, args }); if (method === 'status') return state; if (method === 'conversation') return { entries: [{ id: 'older', role: 'user', kind: 'text', time: 1, text: '更早的聊天' }], hasMore: false }; if (method === 'config') { state = { ...state, config: { ...state.config, ...args } }; return state.config; } if (method === 'candidates') return []; if (method === 'models') return { models: [], defaultModel: '' }; return {}; });
const delay = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(label, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error('Timed out waiting for ' + label);
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 980, height: 720, webPreferences: { backgroundThrottling: false, preload: path.resolve('out/preload/settings.js') } });
  win.webContents.on('console-message', event => console.log('renderer:', event.message));
  win.webContents.on('render-process-gone', (_event, details) => console.error('renderer exited:', details));
  const js = code => win.webContents.executeJavaScript(code);
  const visible = selector => js(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`);
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  try {
    serveAppScheme({ rendererRoot: path.resolve('out/renderer'), emoteDirs: () => [], assetDirs: () => [path.resolve('out/renderer')] });
    nativeTheme.themeSource = 'light';
    await win.loadURL('lolping://app/settings/index.html');
    await waitFor('initial chat render', () => visible('.chat-empty'));
    assert.equal(await visible('.chat-empty'), true);
    assert.equal(await visible('.settings-layout'), false);
    assert.equal(await js("document.querySelector('.conversation-full textarea').disabled"), false);
    await js("const first=document.querySelector('.conversation-full textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(first,'直接开始聊天'); first.dispatchEvent(new Event('input',{bubbles:true}));");
    await delay(50); await js("document.querySelector('.conversation-full form').requestSubmit()"); await delay(50);
    assert.equal(calls.find(c => c.method === 'message')?.args.text, '直接开始聊天');
    assert.equal(calls.find(c => c.method === 'message')?.args.contextId, undefined);
    calls.length = 0;
    writeFileSync(path.join(tmpdir(), 'lolping-chat-home.png'), (await win.webContents.capturePage()).toPNG());
    await click('.workspace-switch'); await waitFor('settings view', () => visible('.settings-layout'));
    assert.equal(await visible('.settings-layout'), true);
    assert.equal(await visible('.chat-home'), false);
    await js("[...document.querySelectorAll('.settings-side button')].find(b=>b.textContent.includes('信号与声音')).click()"); await delay(100);
    assert.equal(await visible('#pings'), false); // Heading is intentionally replaced by the page title.
    assert.equal(await js("document.querySelector('.settings-content h1').textContent"), '信号与声音');
    writeFileSync(path.join(tmpdir(), 'lolping-chat-settings.png'), (await win.webContents.capturePage()).toPNG());
    await click('.workspace-switch'); await delay(100);
    state = { ...state, busy: true, task: { id: 'ui-test', phase: 'working', target: { app: 'Preview' }, text: '第一段：完整回复。\n'.repeat(60) } };
    win.webContents.send('ai:changed'); await waitFor('updated teammate state', () => state.task ? visible('.reply-text') : js("document.querySelectorAll('.log-entry').length === 3"));
    assert.equal(await js("getComputedStyle(document.querySelector('.reply-text')).webkitLineClamp"), 'none');
    await js("const input=document.querySelector('.conversation-full textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'保留这段草稿'); input.dispatchEvent(new Event('input',{bubbles:true}));");
    await click('.workspace-switch'); await delay(100); await click('.workspace-switch'); await delay(100);
    assert.equal(await js("document.querySelector('.conversation-full textarea').value"), '保留这段草稿');
    await js("document.querySelector('.conversation-full textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));");
    await delay(50); assert.equal(calls.some(c => c.method === 'message'), false);
    await click('.conversation-full .stop-button'); await delay(100);
    assert.equal(calls.some(c => c.method === 'stop'), true);
    await js("document.querySelector('.conversation-full form').requestSubmit()"); await delay(100);
    assert.deepEqual(calls.find(c => c.method === 'message')?.args, { contextId: 'ui-test', text: '保留这段草稿' });
    state = { ...state, task: null, busy: false, conversation: { entries: [
      { id: 'history-user', role: 'user', kind: 'ping', signal: 'assist', time: 100, text: '解释这个区域' },
      { id: 'history-agent', role: 'agent', kind: 'text', harness: 'codex', time: 110, text: '已经保存的回复', phase: 'done' },
      { id: 'history-reaction', role: 'agent', kind: 'ping', harness: 'codex', time: 120, signal: 'like', text: '完成' },
    ], hasMore: true } };
    win.webContents.send('ai:changed'); await waitFor('updated teammate state', () => state.task ? visible('.reply-text') : js("document.querySelectorAll('.log-entry').length === 3"));
    assert.equal(await visible('.chat-empty'), false);
    assert.equal(await js("document.querySelectorAll('.log-entry').length"), 3);
    assert.equal(await js("document.querySelector('.conversation-log').textContent.includes('已经保存的回复')"), true);
    await click('.conversation-log > button'); await waitFor('older messages', () => js("document.querySelectorAll('.log-entry').length === 4"));
    assert.equal(await js("document.querySelectorAll('.log-entry').length"), 4);
    assert.equal(calls.find(c => c.method === 'conversation')?.args.before, 'history-user');
    await click('.workspace-switch'); await delay(100);
    await js("[...document.querySelectorAll('.settings-side button')].find(b=>b.textContent.includes('AI 队友')).click()"); await delay(100);
    assert.equal(await js("document.querySelector('.settings-content').textContent.includes('闲置重置')"), false);
    assert.equal(await js("document.querySelector('[data-testid=diagnostics-toggle]').checked"), false);
    assert.equal(await js("document.querySelector('[data-testid=diagnostics-panel]') === null"), true);
    assert.equal(calls.some(c => c.method === 'doctor' || c.method === 'connection'), false);
    await click('[data-testid=diagnostics-toggle]');
    await waitFor('diagnostics enabled', () => visible('[data-testid=diagnostics-panel]'));
    assert.equal(await js("document.querySelector('[data-testid=diagnostics-panel]').open"), false);
    await click('[data-testid=diagnostics-toggle]');
    await waitFor('diagnostics disabled', () => js("document.querySelector('[data-testid=diagnostics-panel]') === null"));

    await click('.workspace-switch'); await delay(100);
    writeFileSync(path.join(tmpdir(), 'lolping-conversation-history.png'), (await win.webContents.capturePage()).toPNG());
    nativeTheme.themeSource = 'dark'; win.setSize(720, 520); await delay(250);
    assert.equal(await js("document.documentElement.scrollWidth <= innerWidth"), true);
    assert.equal(await js("document.querySelector('.conversation-full form').getBoundingClientRect().bottom <= innerHeight"), true);
    writeFileSync(path.join(tmpdir(), 'lolping-chat-small-dark.png'), (await win.webContents.capturePage()).toPNG());
    console.log('Chat default, settings navigation, full replies, draft retention, follow-up context, stop action and compact dark layout passed.'); app.exit(0);
  } catch (e) { console.error(e); console.error('Renderer content:', await js('document.body.innerText').catch(String)); app.exit(1); }
});
setTimeout(() => { console.error('Chat smoke test timed out'); app.exit(1); }, 60000);
