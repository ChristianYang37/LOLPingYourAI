import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.mjs';
import { ConversationLog } from '../conversation.mjs';

test('disk persistence and older pages retain every record, including same-time entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lolping-log-'));
  try {
    const log = new ConversationLog(new Store(dir), { now: () => 100 }); await log.init();
    for (let i = 0; i < 230; i++) log.add({ id: `row-${i}`, role: 'user', text: `Message ${i}` });
    log.add({ id: 'unfinished', role: 'agent', text: 'Partial answer', phase: 'working' });
    await log.flush();
    const next = new ConversationLog(new Store(dir)); await next.init();
    const last = next.page(), middle = next.page({ before: last.entries[0].id }), first = next.page({ before: middle.entries[0].id });
    assert.equal(last.entries.length, 100); assert.equal(last.entries.at(-1).phase, 'stopped');
    assert.equal(first.hasMore, false);
    assert.deepEqual([...first.entries, ...middle.entries, ...last.entries].map(r => r.id), log.rows.map(r => r.id));
    assert.throws(() => next.page({ before: 'missing' }));
    assert.throws(() => next.page({ limit: 1000 }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
