// Adapted from csxq0605's PR #8 acceptance scripts (MIT). No saved user evidence.
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, win32, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export function desktopState(helper) {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, ['doctor'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    const timeout = setTimeout(() => child.kill(), 5000);
    child.stdout.on('data', chunk => { text += chunk; if (text.length > 65536) child.kill(); });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', e => { clearTimeout(timeout); reject(e); });
    child.on('close', code => {
      clearTimeout(timeout);
      try {
        if (code !== 0) throw new Error('Desktop doctor failed or timed out');
        const value = JSON.parse(text);
        if (typeof value.locked !== 'boolean') throw new Error('Desktop doctor did not report lock state');
        resolve({ locked: value.locked, accessibility: value.accessibility, screenRecording: value.screenRecording });
      } catch (e) { reject(e); }
    });
    child.stdin.end('{}');
  });
}

export function dataDirectory(platform = process.platform, env = process.env, home = homedir()) {
  if (env.LOLPINGAI_DATA_DIR) return env.LOLPINGAI_DATA_DIR;
  if (platform === 'win32') return win32.join(env.APPDATA || home, 'LOLPingYourAI');
  if (platform === 'darwin') return posix.join(home, 'Library/Application Support/LOLPingYourAI');
  throw new Error('Use --data-dir on unsupported platforms');
}
export const boardFile = () => process.env.LOLPINGAI_TEST_BOARD_FILE || join(tmpdir(), 'lolping-test-board.json');

export class BridgeError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export class BridgeUnavailable extends Error {}
export class Bridge {
  constructor(directory, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
    this.directory = directory; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async call(method, body = {}, timeoutMs = this.timeoutMs) {
    // Reload after each restart. Never retry a mutation whose response was lost.
    let descriptor;
    try { descriptor = await readFile(join(this.directory, 'bridge.json'), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') throw new BridgeUnavailable('Bridge descriptor is unavailable'); throw e; }
    const { endpoint, token } = JSON.parse(descriptor);
    if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(endpoint) || new URL(endpoint).port > 65535 || typeof token !== 'string' || !token) throw new Error('Invalid local bridge descriptor');
    if (!/^[a-z_]+$/.test(method)) throw new Error('Invalid bridge method');
    const r = await this.fetch(`${endpoint}/${method}`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.ceil(Math.max(1, Math.min(timeoutMs, this.timeoutMs)))) })
      .catch(e => { throw new BridgeUnavailable('Bridge request failed or timed out', { cause: e }); });
    const value = await r.json();
    if (!r.ok) throw new BridgeError(String(value.error || `HTTP ${r.status}`), r.status);
    if (method === 'status' && (!['codex', 'claude', 'dsh'].includes(value?.config?.harness) || typeof value.busy !== 'boolean' || !Array.isArray(value.history))) throw new Error('Invalid bridge status response');
    return value;
  }
}

export function validateBoard(board, now = Date.now(), instance) {
  if (board?.kind !== 'lolping-test-board' || typeof board.instance !== 'string' || !board.instance ||
      !Number.isSafeInteger(board.pid) || board.pid < 1 || !/^\d+$/.test(board.windowId || '') || board.windowId === '0' ||
      !Number.isFinite(board.time) || now - board.time > 5000 || board.time - now > 1000 ||
      !['x', 'y', 'width', 'height'].every(k => Number.isFinite(board.bounds?.[k])) || board.bounds.width <= 0 || board.bounds.height <= 0) throw new Error('Test Board manifest is missing, stale or invalid; launch the updated tools/test-board.cjs');
  if (instance && board.instance !== instance) throw new Error('Test Board restarted during this run');
  return board;
}
export async function readBoard(path = boardFile(), instance) {
  const board = validateBoard(JSON.parse(await readFile(path, 'utf8')), Date.now(), instance);
  try { process.kill(board.pid, 0); } catch { throw new Error('Test Board process is no longer alive'); }
  return board;
}
export function boardTarget(board) {
  return { id: board.windowId, pid: board.pid, ...(board.processStartedAt ? { processStartedAt: board.processStartedAt } : {}), ...(board.windowToken ? { windowToken: board.windowToken } : {}), bounds: board.bounds, relative: { x: .5, y: .5 } };
}
const matchesBoard = (target, board) => target?.id === board.windowId && target?.pid === board.pid;

// Structural summaries deliberately omit prompts, replies, paths, tokens, titles and raw tool arguments.
export function eventSummary({ harness, time, event = {} }) {
  const p = event.params ?? {}, result = { harness, time, method: event.method };
  if (event.method === 'item/started' || event.method === 'item/completed') result.item = p.item?.type;
  if (event.method === 'claude/message') {
    result.type = p.type; result.subtype = p.subtype;
    if (p.type === 'system' && p.subtype === 'init') result.model = p.model;
    result.tools = (Array.isArray(p.message?.content) ? p.message.content : []).filter(c => c.type === 'tool_use').map(c => c.name);
    if (p.type === 'result') result.failed = Boolean(p.is_error);
  }
  if (event.method === 'dsh/update') { result.type = p.update?.sessionUpdate; result.status = p.update?.status; result.kind = p.update?.kind; }
  if (event.method === 'dsh/message') result.type = p.type;
  return result;
}
export function statusSummary(s) {
  return {
    harness: s.config?.harness, busy: s.busy, setupComplete: s.config?.setupComplete,
    requestedEffort: s.config?.reasoningEffort, adapterEffort: s.effectiveEffort, adapterModel: s.effectiveModel,
    task: s.task ? { phase: s.task.phase, signal: s.task.signal, failed: Boolean(s.task.error) } : null,
    target: s.context?.target ? { bounds: s.context.target.bounds } : null,
    source: s.context?.source, mode: s.context?.mode, pendingCount: s.pending?.length ?? 0,
    wards: (s.wards ?? []).map(w => ({ dueAt: w.dueAt, status: w.status })),
  };
}
export function redactor() {
  const ids = new Map();
  return value => JSON.stringify(value).replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, id => {
    if (!ids.has(id)) ids.set(id, `id-${ids.size + 1}`); return ids.get(id);
  });
}

export async function poll(read, check, { timeoutMs = 60000, intervalMs = 500, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), onSample = () => {} } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('Timeout and interval must be positive');
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const value = await read(deadline - now()); onSample(value);
    if (now() >= deadline) break;
    if (await check(value)) return value;
    await sleep(Math.min(intervalMs, deadline - now()));
  }
  throw new Error(`Acceptance condition timed out after ${timeoutMs} ms`);
}

export async function drive(bridge, plan, { boardPath, allowActions = false, log = () => {}, loadBoard = readBoard, waitOptions = {} } = {}) {
  if (!['codex', 'claude', 'dsh'].includes(plan?.harness) || !Array.isArray(plan.steps) || !plan.steps.length) throw new Error('Plan requires a harness and nonempty steps');
  // Validate the whole plan before any ping; a malformed later step must not
  // abandon an earlier turn that deliberately waits at working/received.
  for (const step of plan.steps) {
    if (!step || typeof step.signal !== 'string' || (step.message !== undefined && typeof step.message !== 'string') || (step.expectText !== undefined && typeof step.expectText !== 'string')) throw new Error('Invalid plan step');
    const after = step.after ?? 'done';
    if (!['done', 'working', 'waiting', 'stopped', 'received'].includes(after)) throw new Error('Unsupported wait condition');
    const timeoutMs = step.timeoutMs ?? 120000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3600000) throw new Error('Invalid step timeout');
  }
  const initial = await loadBoard(boardPath);
  let previousId;
  for (const step of plan.steps) {
    const after = step.after ?? 'done', timeoutMs = step.timeoutMs ?? 120000;
    const board = await loadBoard(boardPath, initial.instance), s = await bridge.call('status');
    if (s.config?.harness !== plan.harness) throw new Error('Select the plan harness in app settings before running');
    const mapping = s.config?.mappings?.[step.signal] ?? s.signals?.[step.signal];
    if (!mapping) throw new Error(`Unknown signal: ${step.signal} (Question uses missing)`);
    if (!['observe', 'emotion', 'execute', 'interrupt', 'stop'].includes(mapping.mode)) throw new Error('Place/cancel wards manually and use the ward watcher');
    if (mapping.mode !== 'observe' && !allowActions) throw new Error('Non-observation steps require --allow-actions');
    if (s.busy && (!previousId || s.context?.id !== previousId || !['interrupt', 'stop'].includes(mapping.mode))) throw new Error('Another turn is active; refusing to queue or interrupt it');
    if (mapping.mode === 'stop' && !matchesBoard(s.context?.target, board)) throw new Error('Stop must belong to this Test Board');
    const id = randomUUID();
    try {
    const sent = await bridge.call('ping', { id, harness: plan.harness, signal: step.signal, message: step.message, target: boardTarget(board) });
    if (sent.queued || sent.superseded || sent.duplicate || sent.ignored || sent.delivered && sent.contextId !== id) throw new Error('Ping was not admitted as an isolated test turn');
    log({ kind: 'ping', id, signal: step.signal });
    await poll(left => bridge.call('status', {}, left), async current => {
      const liveBoard = await loadBoard(boardPath, initial.instance);
      if (current.config?.harness !== plan.harness) throw new Error('Harness changed during test');
      if (mapping.mode === 'stop') {
        if (current.context?.id !== previousId && current.context?.id !== s.context?.id) throw new Error('Context changed during stop');
        return sent.stopped === true && current.task?.phase === 'stopped' && !current.busy;
      }
      if (current.context?.id !== id || !matchesBoard(current.context?.target, liveBoard)) throw new Error('Test target or context was superseded');
      if (current.task?.phase === 'error' || current.task?.phase === 'stopped' || current.task?.error) throw new Error('Teammate turn failed or was interrupted');
      const done = after === 'received' || (after === 'done' ? current.task?.phase === 'done' && !current.busy : current.task?.phase === after);
      if (done && step.expectText !== undefined && liveBoard.value !== step.expectText) throw new Error('Test Board value does not match expectText');
      return done;
    }, { ...waitOptions, timeoutMs, onSample: current => log({ kind: 'status', ...statusSummary(current) }) });
    previousId = id;
    } catch (error) {
      // A failed client-side wait must not silently abandon its own still-running test.
      // If ownership changed, do not stop the user's newer task.
      try {
        const current = await bridge.call('status');
        if (current.busy && current.context?.id === id && matchesBoard(current.context?.target, board) && current.config?.harness === plan.harness) {
          await bridge.call('stop');
          const stopped = await bridge.call('status');
          log({ kind: 'cleanup-stop', confirmed: !stopped.busy && stopped.task?.phase === 'stopped' });
        }
      } catch { log({ kind: 'cleanup-stop-unconfirmed' }); }
      throw error;
    }
  }
}

export async function checkStale(bridge, contextId, { boardPath, loadBoard = readBoard } = {}) {
  const board = await loadBoard(boardPath), s = await bridge.call('status');
  if (!contextId || s.context?.id === contextId || !matchesBoard(s.context?.target, board) || s.busy) throw new Error('Need an old context ID and an idle current Test Board context');
  try { await bridge.call('desktop_action', { contextId, action: 'key', key: 'shift' }); }
  catch (error) {
    if (error instanceof BridgeError && error.status === 400 && /Stale ping context/.test(error.message)) return { rejected: true };
    throw error;
  }
  throw new Error('Stale context was accepted');
}

export async function watchWard(bridge, id, expected, options = {}) {
  if (!id || !['completed', 'cancelled'].includes(expected)) throw new Error('Specify ward ID and expected completed/cancelled');
  return poll(async left => {
    try { return await bridge.call('status', {}, left); }
    catch (e) { if (!(e instanceof BridgeUnavailable)) throw e; return null; } // app restart is expected
  }, s => {
    if (!s) return false;
    const ward = s.wards?.find(w => w.id === id);
    if (!ward) throw new Error('Ward disappeared from persisted state');
    if (['failed', 'uncertain'].includes(ward.status) || ['completed', 'cancelled'].includes(ward.status) && ward.status !== expected) throw new Error(`Unexpected ward state: ${ward.status}`);
    return ward.status === expected && !s.busy;
  }, options);
}
