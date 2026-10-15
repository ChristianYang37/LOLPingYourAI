import { BrowserWindow, screen } from 'electron';
import { loadPage, pageUrl, preloadPath } from './paths';

/** A small inactive window: never make the full-screen ping overlay intercept clicks. */
export class CompanionWindow {
  win: BrowserWindow | null = null;
  private taskId = '';
  private dismissed = '';
  private loading?: Promise<void>;
  private hiddenForCapture = 0;
  constructor(private status: () => any) {}
  async update() {
    if (!this.status().task) return;
    if (this.status().task.signal === 'chat') { this.win?.hide(); return; }
    if (!this.win || this.win.isDestroyed()) {
      const win = this.win = new BrowserWindow({ width: 360, height: 280, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#101d27', webPreferences: { preload: preloadPath('companion'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => { if (url !== pageUrl('companion')) event.preventDefault(); });
      this.loading = loadPage(win, 'companion');
    }
    await this.loading;
    if (!this.win || this.win.isDestroyed()) return;
    const task = this.status().task;
    const fresh = task.id !== this.taskId;
    if (fresh) {
      this.taskId = task.id;
      const b = task.target?.bounds, r = task.target?.relative;
      const point = task.point ?? (b ? { x: b.x + b.width * (r?.x ?? .5), y: b.y + b.height * (r?.y ?? .5) } : screen.getCursorScreenPoint());
      const area = screen.getDisplayNearestPoint(point).workArea, [width, height] = this.win.getSize();
      const x = point.x + 48 + width <= area.x + area.width ? point.x + 48 : point.x - width - 48;
      this.win.setPosition(Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))), Math.round(Math.max(area.y, Math.min(point.y - 24, area.y + area.height - height))));
    }
    this.win.webContents.send('ai:changed');
    if (this.dismissed !== task.id && !this.hiddenForCapture) this.win.showInactive();
  }
  hide() { this.dismissed = this.taskId; this.win?.hide(); }
  resize(expanded: boolean) {
    const win = this.win; if (!win) return;
    const b = win.getBounds(), area = screen.getDisplayMatching(b).workArea;
    const width = Math.min(area.width, expanded ? 440 : 360), height = Math.min(area.height, expanded ? 560 : 280);
    win.setBounds({ x: Math.max(area.x, Math.min(b.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(b.y, area.y + area.height - height)), width, height });
  }
  async withoutWindow<T>(fn: () => Promise<T>): Promise<T> {
    const visible = this.win?.isVisible(); this.hiddenForCapture++; this.win?.hide();
    try { return await fn(); }
    finally { this.hiddenForCapture--; if (visible && this.dismissed !== this.taskId && !this.hiddenForCapture) this.win?.showInactive(); }
  }
  close() { this.win?.destroy(); this.win = null; }
}
