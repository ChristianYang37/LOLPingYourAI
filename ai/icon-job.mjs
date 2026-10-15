import { startBridge } from './server.mjs';

// A separate adapter and bearer token keep a generation request out of teammate
// sessions. Its endpoint exposes exactly one tool and expires with the job.
export class IconJob {
  constructor({ icons, makeAdapter, mcp, notice = () => {}, timeoutMs = 15 * 60 * 1000 }) {
    Object.assign(this, { icons, makeAdapter, mcp, notice, timeoutMs });
  }
  async start({ prompt, reference }, settings) {
    if (this.job) throw new Error('An emote is already being generated');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw new Error('Describe the emote in 1–4000 characters.');
    const job = this.job = { active: true };
    try {
      const image = reference ? await this.icons.reference(reference) : undefined;
      job.bridge = await startBridge(null, null, { submit_icon: async args => {
        if (!job.active) throw new Error('Icon generation request expired');
        const result = await this.icons.submit(args, 'image-tool', { referenceProvided: Boolean(image) });
        this.notice('Icon ready. Preview your new emote in settings.'); return result;
      } }, { only: ['submit_icon'], persist: false });
      if (!job.active) throw new Error('Icon generation cancelled');
      const mcp = { ...this.mcp, env: { ...this.mcp.env, LOLPINGAI_ENDPOINT: job.bridge.endpoint, LOLPINGAI_TOKEN: job.bridge.token } };
      const adapter = job.adapter = this.makeAdapter(mcp, settings.harness);
      adapter.on('failure', error => { this.notice(error.message); this.finish(job); });
      adapter.on('completed', () => this.finish(job));
      // No implicit approval of tools or commands outside the icon bridge.
      adapter.on('approval', () => { this.notice('Icon generation needs native harness approval; please retry with an available image tool or SVG.'); void this.cancel(); });
      job.timer = setTimeout(() => { this.notice('Icon generation timed out'); void this.cancel(); }, this.timeoutMs); job.timer.unref?.();
      job.id = await adapter.create();
      if (!job.active) throw new Error('Icon generation cancelled');
      await adapter.send(job.id, `Create an original transparent emote: ${prompt}\nUse an available image-generation tool, otherwise a standalone SVG. Call submit_icon for user preview. ${image ? 'A reference image is attached.' : 'No reference image is provided.'} This is an icon generation request, not a desktop ping. Do not use desktop tools or reply pings.`, image, settings);
      return { started: true, session: job.id };
    } catch (error) { this.finish(job); throw error; }
  }
  finish(job) { job.active = false; clearTimeout(job.timer); job.bridge?.close(); job.adapter?.close(); if (this.job === job) this.job = null; }
  async cancel() { const job = this.job; if (!job) return; job.active = false; job.bridge?.close(); try { if (job.id) await job.adapter.cancel(job.id); } finally { this.finish(job); } }
  close() { if (this.job) this.finish(this.job); }
}
