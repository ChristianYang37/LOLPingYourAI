import { app, type BrowserWindow } from 'electron';
import { join, resolve } from 'node:path';
import { platformOf, type Platform } from '../shared/platform';
import { APP_SCHEME } from './appProtocol';

export type Page = 'overlay' | 'settings' | 'companion';

export const PLATFORM: Platform = platformOf(process.platform);
export const IS_MAC = PLATFORM === 'mac';

const HELPER_FILE = IS_MAC ? 'hook-helper' : 'hook-helper.exe';

export const helperExePath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, HELPER_FILE)
    : join(app.getAppPath(), 'native', 'hook-helper', 'build', HELPER_FILE);

/** Files from build/ that ship as extraResources (application and menu bar icons). */
export const buildResourcePath = (file: string): string =>
  app.isPackaged ? join(process.resourcesPath, file) : join(app.getAppPath(), 'build', file);

export const preloadPath = (name: Page): string => join(__dirname, '../preload', `${name}.js`);

/** Files from assets/ (in production they are copied into out/renderer by Vite's publicDir). */
export const assetPath = (...parts: string[]): string =>
  app.isPackaged ? join(__dirname, '../renderer', ...parts) : join(app.getAppPath(), 'assets', ...parts);

export const settingsDir = (): string => process.env.LOLPINGAI_DATA_DIR
  ? resolve(process.env.LOLPINGAI_DATA_DIR) : join(app.getPath('appData'), 'LOLPingYourAI');

/** Where `page` is served from: the Vite dev server in development, lolping://app in production. `hash` is without the #. */
export function pageUrl(page: Page, hash = ''): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const suffix = hash ? `#${hash}` : '';
  return devUrl ? `${devUrl}/${page}/index.html${suffix}` : `${APP_SCHEME}://app/${page}/index.html${suffix}`;
}

/** `hash` (without #) is passed to the page, e.g. the settings section to open at. */
export function loadPage(win: BrowserWindow, page: Page, hash = ''): Promise<void> {
  return win.loadURL(pageUrl(page, hash));
}
