// Opt-in authenticated model acceptance. Never run this in unattended CI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { Bridge, drive, redactor, statusSummary } from '../acceptance/core.mjs';

export async function liveCodex(directory, harness = 'codex') {
  assert.ok(['codex', 'dsh'].includes(harness), 'Supported live harness');
  const boardPath = join(directory, 'test-board.json'), evidence = join(directory, `live-${harness}.jsonl`);
  const env = { ...process.env, LOLPINGAI_TEST_BOARD_FILE: boardPath }; delete env.ELECTRON_RUN_AS_NODE;
  const board = spawn(createRequire(import.meta.url)('electron'), [resolve('tools/test-board.cjs'), `--user-data-dir=${join(directory, 'board-profile')}`], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let error = ''; board.stderr.on('data', d => error += d);
  const bridge = new Bridge(directory, { timeoutMs: 90000 }); const redact = redactor(); let writes = Promise.resolve();
  const log = value => { writes = writes.then(() => appendFile(evidence, redact({ time: Date.now(), ...value }) + '\n')); };
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) { try { ready = JSON.parse(await readFile(boardPath, 'utf8')).pid === board.pid; } catch {} if (ready) break; await new Promise(r => setTimeout(r, 100)); }
    assert.ok(ready, `Test Board failed to start: ${error.slice(-1000)}`);
    await bridge.call('config', { harness, setupComplete: true, reasoningEffort: 0 });
    const steps = [
      { signal: 'missing', message: 'Describe only this disposable Test Board, including its note. Send one onmyway reply ping. Do not edit anything.', after: 'done', expectText: 'Ready for a ping.', timeoutMs: 180000 },
      { signal: 'assist', message: 'Only edit this disposable Test Board. Replace the textarea note with this exact string, including the final period: "Ping received." Verify it with a fresh screenshot.', after: 'done', expectText: 'Ping received.', timeoutMs: 180000 },
      { signal: 'danger', message: 'Only edit this disposable Test Board. Restore the textarea note to this exact string, including the final period: "Ready for a ping." Verify with a fresh screenshot.', after: 'done', expectText: 'Ready for a ping.', timeoutMs: 180000 },
    ];
    for (const step of steps) {
      const token = String(Date.now()); await writeFile(`${boardPath}.focus`, token);
      let focused = false;
      for(let i=0;i<50;i++) { if(JSON.parse(await readFile(boardPath,'utf8')).focusToken===token) { focused=true;break; } await new Promise(r=>setTimeout(r,100)); }
      assert.ok(focused, 'Test Board acknowledged focus request');
      await drive(bridge, { harness, steps: [step] }, { boardPath, allowActions: true, log });
      console.log(`Real ${harness} Test Board: ${step.signal} passed`);
    }
    log({ kind: 'final', ...statusSummary(await bridge.call('status')) }); await writes;
    console.log(`Real ${harness} observe, edit and restore passed; this does not claim mid-turn cancellation`);
  } catch (e) { await bridge.call('stop').catch(() => {}); log({ kind: 'failed', message: e.message }); await writes; throw e; }
  finally { board.kill(); }
}
