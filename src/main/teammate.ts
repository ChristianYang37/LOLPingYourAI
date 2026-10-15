import { CompanionWindow } from './companionWindow';
import { resolveLang } from '../shared/i18n';
import { homedir } from 'node:os';
import * as electron from 'electron';
import { allSoundNames, allTextureNames } from '../shared/pings';
import { existsSync } from 'node:fs';
import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OverlayManager } from './overlayManager';
import type { EmoteLibrary } from './emoteLibrary';
import type { SettingsStore } from './settingsStore';
import { settingsDir } from './paths';
import { settingsWindow, openSettingsWindow } from './settingsWindow';

const pingMap: Record<string, string> = { omw: 'onmyway', needvision: 'vision', visioncleared: 'cleared' };
const reverse: Record<string, string> = { onmyway: 'omw', vision: 'needvision', cleared: 'visioncleared', missing: 'missing', danger: 'danger', assist: 'assist', allin: 'allin', bait: 'bait', retreat: 'retreat', like: 'like', celebrate: 'celebrate', generic: 'generic', push: 'push', enemyvision: 'enemyvision' };

export async function startTeammate(overlays: OverlayManager, library: EmoteLibrary, settings: SettingsStore) {
  const { app, ipcMain, screen, globalShortcut, powerMonitor } = electron;
  const root = app.isPackaged ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked') : app.getAppPath();
  const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(join(root, 'ai', file)).href);
  const [{ Store }, { Teammate }, { Desktop }, { CodexAdapter }, { ClaudeAdapter }, { DshAdapter }, { startBridge }, { IconCandidates }] = await Promise.all(['store.mjs', 'service.mjs', 'desktop.mjs', 'harness/codex.mjs', 'harness/claude.mjs', 'harness/dsh.mjs', 'server.mjs', 'icons.mjs'].map(load));
  const store = new Store(settingsDir());
  const helper = app.isPackaged ? join(process.resourcesPath, process.platform === 'darwin' ? 'desktop-helper' : 'desktop-helper.exe') : join(root, 'native/desktop/build', process.platform === 'darwin' ? 'desktop-helper' : 'desktop-helper.exe');
  let companion: CompanionWindow | undefined;
  const desktop = new Desktop({ electron, helper, dataDir: settingsDir(), overlays: { spawnAgent: (p: any) => overlays.spawnAgent(p), captureWithoutOverlays: (fn: () => Promise<any>) => companion ? companion.withoutWindow(() => overlays.captureWithoutOverlays(fn)) : overlays.captureWithoutOverlays(fn) }, pingIds: reverse });
  const mcp = { command: process.execPath, args: [join(root, 'ai/mcp.mjs')], env: { ELECTRON_RUN_AS_NODE: '1', LOLPINGAI_ENDPOINT: '', LOLPINGAI_TOKEN: '' } };
  const bundledCodex = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  const skillDir = join(settingsDir(), '.agents/skills/lolping-your-ai');
  await mkdir(skillDir, { recursive: true, mode: 0o700 });
  await copyFile(join(root, 'skills/lolping-your-ai/SKILL.md'), join(skillDir, 'SKILL.md'));
  const dshEntry = process.env.LOLPINGAI_DSH ?? join(homedir(), '.local/share/lolpingyourai-dsh/node_modules/@deepseek-ai/dsh/lib/bin.js');
  const adapters = {
    codex: new CodexAdapter({ command: process.env.LOLPINGAI_CODEX ?? process.env.CODEX_CLI_PATH ?? (existsSync(bundledCodex) ? bundledCodex : 'codex'), cwd: settingsDir(), mcp, skillPath: join(skillDir, 'SKILL.md') }),
    dsh: new DshAdapter({ command: process.execPath, args: [dshEntry], cwd: settingsDir(), mcp, skillPath: join(skillDir, 'SKILL.md'), patch: process.env.LOLPINGAI_DSH_PATCH ?? (existsSync(join(settingsDir(), 'dsh.patch.yml')) ? join(settingsDir(), 'dsh.patch.yml') : undefined), env: { ELECTRON_RUN_AS_NODE: '1' } }),
    claude: new ClaudeAdapter({ cwd: settingsDir(), mcp, skillPath: join(skillDir, 'SKILL.md'), executable: process.env.LOLPINGAI_CLAUDE }),
  };
  const service = new Teammate({ store, desktop, adapters }); await service.init();
  const icons = new IconCandidates(join(settingsDir(), 'icon-candidates'));
  const bridge = await startBridge(service, store, { submit_icon: async (args: unknown) => { const result = await icons.submit(args); overlays.toast('Icon ready', 'Preview your new emote in Teammate settings.'); return result; } });
  mcp.env.LOLPINGAI_ENDPOINT = bridge.endpoint; mcp.env.LOLPINGAI_TOKEN = bridge.token;
  service.on('notice', (message: string) => overlays.toast('LOLPingYourAI', message));
  const view = () => ({ ...service.status(), language: resolveLang(settings.get().language, app.getLocale()), customEmotes: settings.get().customEmotes });
  companion = new CompanionWindow(view);
  service.on('change', () => { settingsWindow()?.webContents.send('ai:changed', null); void companion?.update().catch((e: Error) => service.notice(e.message)); });
  const enqueue = (signal: string, displayId: number, x: number, y: number) => {
    const d = screen.getAllDisplays().find(d => d.id === displayId); if (!d) return;
    void service.dispatch({ signal: pingMap[signal] ?? signal, point: { x: x + d.bounds.x, y: y + d.bounds.y }, source: 'user' }).catch(() => {});
  };
  overlays.on('shared', p => enqueue(p.id, p.displayId, p.x, p.y));
  overlays.on('sharedEmote', p => {
    const builtins: Record<string, string> = { unworthy: 'bait', unworthy_cn: 'bait', facepalm: 'bait', poro_ride: 'retreat', super_approved: 'like', nice: 'like', gg_heart: 'celebrate', teamwork: 'celebrate' };
    const signal = service.config.mappings?.[p.ref] ? p.ref : builtins[p.ref] ?? 'reaction';
    enqueue(signal, p.displayId, p.x, p.y);
  });
  const packDir = join(settingsDir(), 'asset-pack');
  const handlers: Record<string, (args: any) => any> = {
    status: view, config: args => service.configure(args), stop: () => { service.generation++; return service.stop(); },
    doctor: () => desktop.doctor(), connection: async () => adapters[service.config.harness as keyof typeof adapters].capabilities(),
    followup: args => service.followup(args), wardAction: args => service.wardAction(args),
    copyReply: () => electron.clipboard.writeText(service.task?.text ?? ''), hideCard: () => companion?.hide(), resizeCard: args => companion?.resize(Boolean(args.expanded)),
    testPing: async () => { await new Promise(resolve => setTimeout(resolve, 3000)); return service.dispatch({ signal: 'missing', point: screen.getCursorScreenPoint(), message: 'Setup test: briefly describe the visible region, then reply with one onmyway ping. Observe only.' }); },
    bind: args => service.bind(args), approve: args => service.approve(args),
    candidates: () => icons.list(),
    importCrop: args => icons.submit({ name: args.name || 'My emote', pngBase64: args.pngBase64 }, 'local-crop'),
    importPack: async () => { const picked = await electron.dialog.showOpenDialog({ title: 'Choose a local asset pack', properties: ['openDirectory'] }); if (picked.canceled) return { cancelled: true }; const pack = await load('assets.mjs'); return pack.importAssetPack(picked.filePaths[0], packDir, allTextureNames(), allSoundNames()); },
    clearPack: async () => (await load('assets.mjs')).clearAssetPack(packDir),
    acceptIcon: async args => { const result = await library.save(await icons.prepare(args.id), settings.get().customEmotes); if (!result.ok) throw new Error(`Import failed: ${result.error}`); settings.update({ customEmotes: [...settings.get().customEmotes, result.emote] }); return result; },
    generateIcon: async args => {
      if (service.busy()) throw new Error('Wait for your teammate to finish before generating an emote.');
      if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 4000) throw new Error('Describe the emote in 1–4000 characters.');
      service.gate.pause(); const adapter = adapters[service.config.harness as keyof typeof adapters];
      const reference = args.reference ? await icons.reference(args.reference) : undefined;
      const id = await adapter.create();
      await adapter.send(id, `Create an original transparent emote for this description: ${args.prompt}\nUse an available image-generation tool if present, otherwise design a standalone SVG. Call submit_icon with the result for user review. If an image is attached, use it as the visual reference. Do not use desktop tools or send acknowledgement pings for this request.`, reference, { reasoningEffort: service.config.reasoningEffort, dshThinking: service.config.dshThinking });
      return { started: true, session: id };
    },
    openAccess: () => { electron.systemPreferences.isTrustedAccessibilityClient(true); return electron.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); },
    openScreen: async () => { if (process.platform !== 'darwin') return; await electron.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {}); return electron.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); },
  };
  ipcMain.handle('ai:call', async (event, method: string, args: unknown) => {
    const isSettings = event.sender === settingsWindow()?.webContents;
    const cardMethods = ['status', 'followup', 'approve', 'stop', 'copyReply', 'hideCard', 'resizeCard'];
    if (event.senderFrame !== event.sender.mainFrame || (!isSettings && (event.sender !== companion?.win?.webContents || !cardMethods.includes(method)))) throw new Error('Unauthorized teammate sender');
    if (!Object.hasOwn(handlers, method)) throw new Error('Unknown teammate operation');
    return handlers[method](args ?? {});
  });
  const timer = setInterval(() => { void service.wards.tick().catch((e: Error) => service.notice(e.message)); }, 5000);
  powerMonitor.on('resume', () => { void service.wards.tick(); });
  powerMonitor.on('lock-screen', () => { service.generation++; void service.stop().catch((e: Error) => service.notice(e.message)); });
  globalShortcut.register('Control+Alt+Escape', () => { service.generation++; void service.stop().then(() => service.notice('Stopped.')).catch((e: Error) => service.notice(e.message)); });
  if (!service.config.setupComplete) openSettingsWindow('teammate');
  return { service, open: () => openSettingsWindow('teammate'), close: () => { clearInterval(timer); companion?.close(); bridge.close(); service.close(); globalShortcut.unregister('Control+Alt+Escape'); } };
}
