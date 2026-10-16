import { readFile, realpath, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Private renderer IPC only: callers name a recorded capture, never an arbitrary path.
export async function capturePreview(service, dataDir, file) {
  if (typeof file !== 'string' || !/^ping-\d+(?:-[0-9a-f-]{36})?\.png$/.test(file)) throw new Error('Invalid capture reference');
  const known = service.task?.preview?.file === file || service.conversation.rows.some(row => row.preview?.file === file);
  if (!known) throw new Error('Capture is not part of this conversation');
  try {
    const dir = await realpath(join(dataDir, 'captures')), path = await realpath(join(dir, file));
    if (dirname(path) !== dir || (await stat(path)).size > 12_000_000) throw new Error('Invalid capture file');
    return { url: `data:image/png;base64,${(await readFile(path)).toString('base64')}` };
  } catch (error) { if (error.code === 'ENOENT') return { expired: true }; throw error; }
}
