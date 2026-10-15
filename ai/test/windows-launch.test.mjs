import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexLaunch } from '../harness/windows-launch.mjs';

test('Windows npm shim launches known JS as an argv element, never through a shell', () => {
  const root = mkdtempSync(join(tmpdir(), 'lolping launch & spaces '));
  try {
    const shim = join(root, 'codex.cmd'), entry = join(root, 'node_modules/@openai/codex/bin/codex.js');
    mkdirSync(join(root, 'node_modules/@openai/codex/bin'), { recursive: true }); writeFileSync(shim, 'must not execute'); writeFileSync(entry, '');
    const result = codexLaunch(shim, { platform: 'win32', node: 'node.exe', env: {} });
    assert.deepEqual(result, { command: 'node.exe', args: [entry], env: { ELECTRON_RUN_AS_NODE: '1' } });
    const exe = join(root, 'codex.exe'); writeFileSync(exe, '');
    assert.equal(codexLaunch('codex', { platform: 'win32', env: { PATH: root } }).command, exe);
    assert.throws(() => codexLaunch(join(root, 'missing.cmd'), { platform: 'win32', env: {} }), /must point/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('Windows desktop bundled CLI is discoverable without terminal PATH', () => {
  const root = mkdtempSync(join(tmpdir(), 'lolping-cli-'));
  try {
    const dir = join(root, 'OpenAI/Codex/bin/version'); mkdirSync(dir, { recursive: true });
    const exe = join(dir, 'codex.exe'); writeFileSync(exe, '');
    assert.equal(codexLaunch('codex', { platform: 'win32', env: { LOCALAPPDATA: root } }).command, exe);
    assert.deepEqual(codexLaunch('/usr/bin/codex', { platform: 'darwin' }), { command: '/usr/bin/codex', args: [], env: {} });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
