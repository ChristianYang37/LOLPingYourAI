import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePreview } from '../capture-preview.mjs';
test('capture IPC only reads registered local captures and handles retention', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lolping-preview-'));
  const service = { conversation: { rows: [{ preview: { file: 'ping-1.png' } }, { preview: { file: 'ping-2.png' } }] } };
  try {
    await mkdir(join(dir, 'captures')); await writeFile(join(dir, 'captures/ping-1.png'), 'fixture');
    assert.match((await capturePreview(service, dir, 'ping-1.png')).url, /^data:image\/png;base64,/);
    assert.deepEqual(await capturePreview(service, dir, 'ping-2.png'), { expired: true });
    await assert.rejects(capturePreview(service, dir, '../secret'), /Invalid/);
    await assert.rejects(capturePreview(service, dir, 'ping-3.png'), /not part/);
    if (process.platform !== 'win32') {
      await writeFile(join(dir, 'secret'), 'private'); await symlink(join(dir, 'secret'), join(dir, 'captures/ping-2.png'));
      await assert.rejects(capturePreview(service, dir, 'ping-2.png'), /Invalid/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
