import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ windows: [] as unknown[], isMac: false }));
const { windows } = h;

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeContents extends Emitter {
    insertCSS = vi.fn(async () => 'fill');
    removeInsertedCSS = vi.fn(async () => undefined);
    openHandler: ((details: { url: string }) => { action: string }) | null = null;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
      this.openHandler = handler;
    }
  }
  class FakeWindow extends Emitter {
    webContents = new FakeContents();
    destroyed = false;
    minimized = false;
    setVibrancy = vi.fn();
    constructor() {
      super();
      windows.push(this);
    }
    removeMenu(): void {}
    setTitleBarOverlay(): void {}
    isDestroyed(): boolean {
      return this.destroyed;
    }
    isMinimized(): boolean {
      return this.minimized;
    }
    restore(): void { this.minimized = false; this.emit('restore'); }
    show(): void {}
    focus(): void {}
    close(): void {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  const nativeTheme = Object.assign(new Emitter(), { shouldUseDarkColors: false });
  return { app: { dock: { show: vi.fn(), hide: vi.fn() }, focus: vi.fn() }, BrowserWindow: FakeWindow, nativeImage: { createFromPath: () => ({}) }, nativeTheme };
});

vi.mock('../../src/main/paths', () => ({
  get IS_MAC() { return h.isMac; },
  buildResourcePath: () => 'icon.png',
  loadPage: () => Promise.resolve(),
  pageUrl: () => 'lolping://app/settings/index.html',
  preloadPath: () => 'preload.js',
}));

type FakeContents = EventEmitter & { openHandler: ((details: { url: string }) => { action: string }) | null };
type FakeWindow = EventEmitter & { webContents: FakeContents; close(): void };
type Mod = typeof import('../../src/main/settingsWindow');
let mod: Mod;

beforeEach(async () => {
  windows.length = 0;
  h.isMac = false;
  vi.resetModules();
  mod = await import('../../src/main/settingsWindow');
});

describe('onSettingsWindowGone', () => {
  it('fires when the window closes', () => {
    const cb = vi.fn();
    mod.onSettingsWindowGone(cb);
    mod.openSettingsWindow();
    expect(cb).not.toHaveBeenCalled();
    (windows[0] as FakeWindow).close();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires when the renderer process dies while the window stays open', () => {
    const cb = vi.fn();
    mod.onSettingsWindowGone(cb);
    mod.openSettingsWindow();
    (windows[0] as FakeWindow).webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is registered once and covers every window opened later, without piling up listeners', () => {
    const cb = vi.fn();
    mod.onSettingsWindowGone(cb);
    mod.openSettingsWindow();
    (windows[0] as FakeWindow).close();
    mod.openSettingsWindow();
    expect(windows).toHaveLength(2);
    (windows[1] as FakeWindow).close();
    expect(cb).toHaveBeenCalledTimes(2);
    for (const w of windows as FakeWindow[]) expect(w.listenerCount('closed')).toBeLessThanOrEqual(1);
  });
});

describe('navigation', () => {
  /** Tries to navigate the first window to `url` the way a drop or a link does; true when the navigation was stopped. */
  const blocked = (url: string): boolean => {
    const event = { url, preventDefault: vi.fn() };
    (windows[0] as FakeWindow).webContents.emit('will-navigate', event, url);
    return event.preventDefault.mock.calls.length > 0;
  };

  it('never leaves the settings page for another page, file or scheme', () => {
    mod.openSettingsWindow();
    for (const url of [
      'https://example.com/', 'http://localhost:5173/settings/index.html', 'file:///C:/Users/me/Pictures/cat.png',
      'lolping://app/overlay/index.html', 'lolping://app/settings/other.html', 'lolping://emotes/0123456789abcdef0123456789abcdef.webp',
      'lolping://other/settings/index.html', 'about:blank', 'javascript:alert(1)', 'data:text/html,<h1>hi</h1>', 'blob:null/1234', 'not a url', '',
    ]) {
      expect(blocked(url), url).toBe(true);
    }
  });

  it('lets the page reload itself, whatever follows its address', () => {
    mod.openSettingsWindow();
    for (const url of ['lolping://app/settings/index.html', 'lolping://app/settings/index.html#room', 'lolping://app/settings/index.html?x=1']) {
      expect(blocked(url), url).toBe(false);
    }
  });

  it('opens no new window, whatever asks for one', () => {
    mod.openSettingsWindow();
    const { openHandler } = (windows[0] as FakeWindow).webContents;
    expect(openHandler).not.toBeNull();
    for (const url of ['https://example.com/', 'lolping://app/settings/index.html', 'file:///C:/x.html', '']) {
      expect(openHandler?.({ url }), url).toEqual({ action: 'deny' });
    }
  });

  it('guards every window that is opened, not only the first', () => {
    mod.openSettingsWindow();
    (windows[0] as FakeWindow).close();
    mod.openSettingsWindow();
    const event = { url: 'https://example.com/', preventDefault: vi.fn() };
    (windows[1] as FakeWindow).webContents.emit('will-navigate', event, event.url);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect((windows[1] as FakeWindow).webContents.openHandler).not.toBeNull();
  });
});

describe('macOS Dock recovery', () => {
  const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  type MacWindow = FakeWindow & {
    minimized: boolean; restore(): void; setVibrancy: ReturnType<typeof vi.fn>;
    webContents: FakeContents & { insertCSS: ReturnType<typeof vi.fn>; removeInsertedCSS: ReturnType<typeof vi.fn> };
  };
  it('restores the settings sidebar fill and vibrancy through the native Dock path', async () => {
    h.isMac = true;
    mod.openSettingsWindow();
    const w = windows[0] as MacWindow;
    w.minimized = true; w.emit('minimize'); await flush();
    expect(w.webContents.insertCSS).toHaveBeenCalledWith(expect.stringContaining('.settings-side'));
    w.restore();
    expect(w.webContents.removeInsertedCSS).toHaveBeenCalledWith('fill');
    expect(w.setVibrancy.mock.calls).toEqual([[null], ['sidebar']]);
  });
  it('removes a fill that finishes inserting after restore and does not leak it into the next window', async () => {
    h.isMac = true;
    mod.openSettingsWindow();
    const w = windows[0] as MacWindow;
    let complete!: (key: string) => void;
    w.webContents.insertCSS.mockImplementationOnce(() => new Promise<string>(resolve => { complete = resolve; }));
    w.minimized = true; w.emit('minimize');
    mod.openSettingsWindow(); complete('late'); await flush();
    expect(w.webContents.removeInsertedCSS).toHaveBeenCalledWith('late');
    w.close(); mod.openSettingsWindow();
    expect((windows[1] as MacWindow).webContents.removeInsertedCSS).not.toHaveBeenCalled();
  });
});
