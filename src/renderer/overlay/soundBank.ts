/** Safety ceiling: more overlapping sounds than this are skipped (the ping still shows). */
export const MAX_VOICES = 8;

/** Pre-decoded Web Audio buffers: HTMLAudioElement per play added audible latency in the prototype. */
export class SoundBank {
  private readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private readonly buffers = new Map<string, AudioBuffer>();
  private voices = 0;
  private readonly revisions = new Map<string, number>();

  /** Decodes every sound up front, each under its key. Resolves with the URLs that failed to load. */
  async load(entries: readonly { key: string; url: string }[]): Promise<string[]> {
    const results = await Promise.all(
      entries.map(async ({ key, url }) => {
        const revision = this.revisions.get(key) ?? 0;
        this.revisions.set(key, revision);
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
          // Settings can replace/remove a sound while its old bytes are still decoding.
          if (this.revisions.get(key) === revision) this.buffers.set(key, buffer);
          return null;
        } catch {
          return url;
        }
      }),
    );
    return results.filter((r): r is string => r !== null);
  }

  /** Plays the sound at `url`, loading it under that key the first time. A file that won't load plays nothing. */
  async playUrl(url: string, volume01: number): Promise<void> {
    if (!this.buffers.has(url)) await this.load([{ key: url, url }]);
    await this.play(url, volume01);
  }

  /** Drops the loaded sounds whose key starts with `prefix`, so the next play loads them again. */
  forget(prefix: string): void {
    for (const [key, revision] of this.revisions) {
      if (!key.startsWith(prefix)) continue;
      this.revisions.set(key, revision + 1);
      this.buffers.delete(key);
    }
  }

  async play(key: string, volume01: number): Promise<void> {
    const buffer = this.buffers.get(key);
    if (!buffer || volume01 <= 0 || this.voices >= MAX_VOICES) return;
    try { if (this.ctx.state !== 'running') await this.ctx.resume(); } catch { return; }
    if (this.ctx.state !== 'running' || this.voices >= MAX_VOICES) return;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    gain.gain.value = volume01;
    src.connect(gain).connect(this.ctx.destination);
    this.voices++;
    await new Promise<void>(resolve => {
      src.onended = () => {
        this.voices--;
        src.disconnect(); gain.disconnect();
        setTimeout(resolve, Math.max(0, this.ctx.outputLatency ?? 0) * 1000);
      };
      try { src.start(); } catch { this.voices--; src.disconnect(); gain.disconnect(); resolve(); }
    });
  }
}
