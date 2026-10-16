import { randomUUID } from 'node:crypto';

// A local display log, never a replacement for the harness's context/history.
// Stores capture references only (never image bytes), excluding tool payloads, credentials and raw prompts.
export class ConversationLog {
  constructor(store, { now = Date.now, onError = () => {} } = {}) {
    Object.assign(this, { store, now, onError }); this.rows = []; this.positions = new Map(); this.timer = null;
  }
  async init() {
    this.rows = await this.store.read('ai-conversation', []);
    this.positions = new Map(this.rows.map((row, index) => [row.id, index]));
    // Restart is not evidence that an interrupted reply completed successfully.
    for (const row of this.rows) if (row.phase && !['done', 'error', 'stopped', 'waiting'].includes(row.phase)) row.phase = 'stopped';
  }
  add(value) {
    const row = { id: randomUUID(), time: this.now(), ...value };
    if (this.positions.has(row.id)) throw new Error('Duplicate conversation ID');
    this.positions.set(row.id, this.rows.length);
    this.rows.push(row); this.schedule(); return row;
  }
  update(id, patch) {
    const row = this.rows[this.positions.get(id)];
    if (row) { Object.assign(row, patch); this.schedule(); }
  }
  schedule() {
    if (!this.timer) {
      this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, 500);
      this.timer.unref?.();
    }
  }
  async flush() { clearTimeout(this.timer); this.timer = null; await this.store.write('ai-conversation', this.rows); }
  page({ before, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid page size');
    const end = before ? (this.positions.get(before) ?? -1) : this.rows.length;
    if (end < 0) throw new Error('Unknown conversation cursor');
    const start = Math.max(0, end - limit);
    return { entries: this.rows.slice(start, end), hasMore: start > 0 };
  }
}
