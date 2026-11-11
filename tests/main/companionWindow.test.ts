import { describe, it, expect, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: class {}, screen: { getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }) } }));
vi.mock('../../src/main/paths', () => ({ loadPage: async () => {}, pageUrl: () => '', preloadPath: () => '' }));
import { CompanionWindow } from '../../src/main/companionWindow';

async function fixture() {
  let visible = true;
  let task: any = { id: 'task', signal: 'missing', point: { x: 200, y: 200 } };
  const card = new CompanionWindow(() => ({ task }));
  const win = { isVisible: () => visible, isDestroyed: () => false, hide: vi.fn(() => { visible = false; }), showInactive: vi.fn(() => { visible = true; }), getSize: () => [360, 360], setPosition: vi.fn(), webContents: { send: vi.fn() } };
  card.win = win as any;
  await card.update(); win.showInactive.mockClear();
  return { card, win, clearTask: () => { task = null; }, setTask: (value: any) => { task = value; } };
}
const deferred = () => { let done!: () => void; const promise = new Promise<void>(resolve => { done = resolve; }); return { promise, done }; };

describe('companion visibility during desktop work', () => {
  it('only refreshes content when the card is already visible', async () => {
    const { card, win } = await fixture();
    for (let i = 0; i < 20; i++) await card.update();
    expect(win.showInactive).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith('ai:changed');
  });
  it('does not restore the floating card after switching to text chat during capture', async () => {
    const { card, win, setTask } = await fixture();
    await card.withoutWindow(async () => {
      setTask({ id: 'chat', signal: 'chat' });
      await card.update();
    });
    expect(win.isVisible()).toBe(false);
    expect(win.showInactive).not.toHaveBeenCalled();
  });
  it('rechecks chat eligibility after an asynchronous page load', async () => {
    const { card, win, setTask } = await fixture();
    const loading = deferred();
    (card as any).loading = loading.promise;
    const update = card.update();
    setTask({ id: 'chat', signal: 'chat', point: { x: 200, y: 200 } });
    loading.done(); await update;
    expect(win.isVisible()).toBe(false);
    expect(win.showInactive).not.toHaveBeenCalled();
  });
  it('refreshes and hides a recovered conflict card instead of leaving stale recovery controls', async () => {
    const { card, win, clearTask } = await fixture();
    await card.withoutWindow(async () => { clearTask(); await card.update(); });
    expect(win.isVisible()).toBe(false); expect(win.showInactive).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith('ai:changed');
  });
  it('does not restore a cleared task before the next coalesced update', async () => {
    const { card, win, clearTask } = await fixture();
    await card.withoutWindow(async () => { clearTask(); });
    expect(win.isVisible()).toBe(false);
    expect(win.showInactive).not.toHaveBeenCalled();
  });
  it('shows a new task once after a dismissed card and keeps streaming updates inactive', async () => {
    const { card, win, setTask } = await fixture();
    card.hide();
    await card.update();
    expect(win.isVisible()).toBe(false);
    setTask({ id: 'new-emote', signal: 'reaction', point: { x: 200, y: 200 } });
    await card.update(); await card.update();
    expect(win.isVisible()).toBe(true);
    expect(win.showInactive).toHaveBeenCalledTimes(1);
  });
  it('stays hidden through progress updates and restores after a failed action', async () => {
    const { card, win } = await fixture();
    await expect(card.withoutWindow(async () => { await card.update(); expect(win.isVisible()).toBe(false); throw Error('covered by another app'); })).rejects.toThrow('covered');
    expect(win.isVisible()).toBe(true); expect(win.showInactive).toHaveBeenCalledTimes(1);
  });
  it('restores after overlapping capture and action finish in either order', async () => {
    const { card, win } = await fixture(), a = deferred(), b = deferred();
    const first = card.withoutWindow(() => a.promise), second = card.withoutWindow(() => b.promise);
    a.done(); await first; expect(win.isVisible()).toBe(false);
    b.done(); await second; expect(win.isVisible()).toBe(true); expect(win.showInactive).toHaveBeenCalledTimes(1);
  });
  it('does not reopen a card dismissed while an action runs', async () => {
    const { card, win } = await fixture();
    await card.withoutWindow(async () => { card.hide(); });
    expect(win.isVisible()).toBe(false); expect(win.showInactive).not.toHaveBeenCalled();
  });
  it('removes the card before executing input and restores it afterwards', async () => {
    const { card, win } = await fixture();
    const result = await card.withoutInputObstruction(async () => { expect(win.isVisible()).toBe(false); return 'executed'; });
    expect(result).toBe('executed'); expect(win.isVisible()).toBe(true);
  });
});
