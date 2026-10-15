#!/usr/bin/env node
import { readFile, mkdir, open } from 'node:fs/promises';
import { join, resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Bridge, BridgeUnavailable, dataDirectory, drive, checkStale, watchWard, statusSummary, eventSummary, redactor, desktopState } from './core.mjs';

const help = `Usage: node tools/acceptance/run.mjs <command> [options]
  status                         Structural status snapshot (no replies/images)
  watch --seconds 60             Watch status/events; tolerate app restarts
  drive --plan plan.json         Run a harness-specific plan on the Test Board
  stale --context OLD_ID         Assert that an old context is refused
  ward --id ID --expect completed|cancelled --timeout-ms 2100000
  timeline --input transcript.jsonl   Summarize Claude JSONL or status history JSON

Options: --data-dir DIR, --output FILE, --board FILE, --allow-actions
Watch: --helper PATH also polls the installed desktop helper's read-only lock state.
Drive is observation-only by default. Other signal modes and stale probes require
--allow-actions. Plans use signal "missing" for Question. Nothing types into a shell.
Logs default to the app's private data directory; no media or raw payloads are saved.`;
const [command, ...argv] = process.argv.slice(2);
let output;
try {
  if (!command || ['help', '--help', '-h'].includes(command)) { console.log(help); }
  else {
    if (!['status', 'watch', 'drive', 'stale', 'ward', 'timeline'].includes(command)) throw new Error('Unknown command');
    const options = {};
    for (let i = 0; i < argv.length; i++) {
      const key = argv[i];
      if (key === '--allow-actions') { options[key] = true; continue; }
      if (!['--data-dir', '--output', '--board', '--seconds', '--plan', '--context', '--id', '--expect', '--timeout-ms', '--input', '--helper'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option ${key}`);
      options[key] = argv[++i];
    }
    const numeric = (key, fallback) => {
      const n = Number(options[key] ?? fallback);
      if (!Number.isFinite(n) || n <= 0 || n > 86400000) throw new Error(`Invalid ${key}`);
      return n;
    };
    const directory = options['--data-dir'] || dataDirectory();
    const path = resolve(options['--output'] || join(directory, 'acceptance', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.jsonl`));
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), rel = relative(repo, path);
    const inRepo = rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    if (inRepo && !rel.startsWith(`.local${sep}`)) throw new Error('Keep generated evidence outside the repository (or in ignored .local/)');
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    output = await open(path, 'wx', 0o600);
    const redact = redactor();
    let writes = Promise.resolve();
    const log = data => { const line = redact({ time: Date.now(), ...data }) + '\n'; writes = writes.then(() => output.write(line)); };
    const bridge = new Bridge(directory);
    console.log(`Local report: ${path}`);
    log({ kind: 'start', command, platform: process.platform, node: process.version });
    try {
      if (command === 'status') log({ kind: 'status', ...statusSummary(await bridge.call('status')) });
      if (command === 'watch') {
        const end = Date.now() + numeric('--seconds', 60) * 1000;
        let observed = false, counts = new Map();
        while (Date.now() < end) {
          if (options['--helper']) log({ kind: 'desktop', ...await desktopState(resolve(options['--helper'])) });
          try {
            const s = await bridge.call('status', {}, end - Date.now()); observed = true;
            log({ kind: 'status', ...statusSummary(s) });
            // Count occurrences, not timestamps alone: multiple events can share one ms.
            const next = new Map();
            for (const entry of s.history ?? []) {
              const key = JSON.stringify(entry), n = (next.get(key) ?? 0) + 1; next.set(key, n);
              if (n > (counts.get(key) ?? 0)) log({ kind: 'event', ...eventSummary(entry) });
            }
            counts = next;
          } catch (e) { if (!(e instanceof BridgeUnavailable)) throw e; log({ kind: 'unavailable' }); }
          await new Promise(r => setTimeout(r, Math.max(0, Math.min(1000, end - Date.now()))));
        }
        if (!observed) throw new Error('No bridge samples were available');
        log({ kind: 'observation-complete', note: 'A watch records observations; it does not assert acceptance passed.' });
      }
      if (command === 'drive') await drive(bridge, JSON.parse(await readFile(options['--plan'], 'utf8')), { boardPath: options['--board'], allowActions: options['--allow-actions'], log });
      if (command === 'stale') {
        if (!options['--allow-actions']) throw new Error('Stale probe requires --allow-actions');
        log(await checkStale(bridge, options['--context'], { boardPath: options['--board'] }));
      }
      if (command === 'ward') {
        await watchWard(bridge, options['--id'], options['--expect'], { timeoutMs: numeric('--timeout-ms', 2100000), onSample: s => log(s ? { kind: 'status', ...statusSummary(s) } : { kind: 'unavailable' }) });
      }
      if (command === 'timeline') {
        const text = await readFile(options['--input'], 'utf8');
        let records;
        try { const s = JSON.parse(text); records = Array.isArray(s) ? s : s.history ?? [s]; }
        catch { records = text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)); }
        for (const record of records) {
          const entry = record.event ? record : { harness: 'claude', time: record.timestamp, event: { method: 'claude/message', params: record } };
          log({ kind: 'event', ...eventSummary(entry) });
        }
      }
      log({ kind: 'command-completed' });
    } catch (error) { log({ kind: 'command-failed', errorType: error.name, status: error.status }); throw error; }
    finally { await writes; }
  }
} catch (error) { console.error(`Acceptance: ${error.message}`); process.exitCode = 1; }
finally { await output?.close(); }
