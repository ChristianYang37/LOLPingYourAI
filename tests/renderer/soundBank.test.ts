import { afterEach, expect, it, vi } from 'vitest';
import { SoundBank } from '../../src/renderer/overlay/soundBank';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('completion waits for actual audio end and output latency, not an assumed ping duration', async () => {
  vi.useFakeTimers();
  const source = { buffer: null, connect: vi.fn().mockReturnThis(), disconnect: vi.fn(), start: vi.fn(), onended: null as null | (() => void) };
  vi.stubGlobal('AudioContext', class {
    state = 'running'; outputLatency = .1; destination = {};
    decodeAudioData = async () => ({ length: 1 });
    createBufferSource = () => source;
    createGain = () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() });
  });
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  const bank = new SoundBank(); await bank.load([{ key: 'long', url: 'long.wav' }]);
  let ended = false; const playing = bank.play('long', 1).then(() => { ended = true; });
  await vi.advanceTimersByTimeAsync(10000); expect(ended).toBe(false);
  source.onended!(); await vi.advanceTimersByTimeAsync(99); expect(ended).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await playing; expect(ended).toBe(true);
  await bank.play('missing', 1); await bank.play('long', 0);
  expect(source.start).toHaveBeenCalledTimes(1);
});

it('custom audio awaits playback, reloads after replacement, and tolerates missing files', async () => {
  vi.useFakeTimers();
  const source = { buffer: null, connect: vi.fn().mockReturnThis(), disconnect: vi.fn(), start: vi.fn(), onended: null as null | (() => void) };
  vi.stubGlobal('AudioContext', class {
    state = 'running'; destination = {};
    decodeAudioData = async () => ({ length: 1 });
    createBufferSource = () => source;
    createGain = () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() });
  });
  const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  vi.stubGlobal('fetch', fetch);
  const bank = new SoundBank();
  const url = 'lolping://emotes/test.sound';
  for (let i = 0; i < 3; i++) {
    let ended = false;
    const playing = bank.playUrl(url, .1).then(() => { ended = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ended).toBe(false);
    source.onended!(); await vi.runAllTimersAsync(); await playing;
    expect(ended).toBe(true);
    if (i === 1) bank.forget('lolping://emotes/');
  }
  expect(fetch).toHaveBeenCalledTimes(2);
  bank.forget('lolping://emotes/');
  fetch.mockRejectedValueOnce(new Error('missing'));
  await bank.playUrl(url, .1);
  expect(source.start).toHaveBeenCalledTimes(3);
});
