import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { chooseEffort } from './effort.mjs';

/** Thin ACP client. DSH owns reasoning, tools, persistence and model-provider credentials. */
export class DshAdapter extends EventEmitter {
  constructor({ command = 'dsh', args = [], cwd, mcp, skillPath, patch, env = {} }) {
    super(); Object.assign(this, { command, args, cwd, mcp, skillPath, patch, env });
    this.defaultModels = new Map(); this.preparing = new Set(); this.cancelEpoch = new Map(); this.active = new Map(); this.loaded = new Map(); this.pending = new Map(); this.nextId = 1; this.effort = 0;
  }
  connect() { return this.ready ??= this.start().catch(e => { this.ready = null; throw e; }); }
  async start() {
    this.closing = false;
    const child = this.child = spawn(this.command, [...this.args, 'acp', ...(this.patch ? ['--patch', this.patch] : [])], { cwd: this.cwd, env: { ...process.env, ...this.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    child.stderr.on('data', d => this.emit('diagnostic', d.toString().slice(0, 2000)));
    child.stdin.on('error', () => {});
    const failed = error => {
      if (this.child !== child) return; this.child = null; this.ready = null; this.loaded.clear(); this.profileDefaultModel = undefined;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear();
      if (!this.closing) this.emit('failure', error);
    };
    child.on('error', failed); child.on('exit', () => failed(new Error('DSH ACP exited')));
    createInterface({ input: child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.id !== undefined && !m.method) { const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
      if (m.method === 'session/request_permission') { this.emit('approval', m); return; }
      if (m.method === 'session/update') {
        const u = m.params.update;
        if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') this.emit('event', { method: 'dsh/message', params: { threadId: m.params.sessionId, type: 'assistant', message: { content: [{ type: 'text', text: u.content.text }] } } });
        else this.emit('event', { method: 'dsh/update', params: m.params });
      } else if (m.id !== undefined && m.method) this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Unsupported client method' } }) + '\n');
    });
    this.info = await this.rpc('initialize', { protocolVersion: 1, clientInfo: { name: 'lolpingyourai', version: '0.1.0' }, clientCapabilities: {} });
  }
  rpc(method, params, timeout = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin.writable) return reject(new Error('DSH is not connected'));
      const id = this.nextId++, timer = timeout ? setTimeout(() => { this.pending.delete(id); reject(new Error(`DSH ${method} timed out`)); }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  respond(id, result) { this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
  async capabilities() { await this.connect(); return { images: Boolean(this.info.agentCapabilities?.promptCapabilities?.image), steer: 'after-current-turn', interrupt: true, desktop: 'project-mcp', protocol: 'ACP', agent: this.info.agentInfo }; }
  sessionParams() { return { cwd: this.cwd, mcpServers: [{ name: 'lolpingyourai', command: this.mcp.command, args: this.mcp.args, env: Object.entries(this.mcp.env ?? {}).map(([name, value]) => ({ name, value })) }] }; }
  async create() { await this.connect(); const r = await this.rpc('session/new', this.sessionParams()); this.loaded.set(r.sessionId, r.configOptions ?? []); this.profileDefaultModel ??= r.configOptions?.find(o => o.id === 'model')?.currentValue; this.defaultModels.set(r.sessionId, r.configOptions?.find(o => o.id === 'model')?.currentValue); return r.sessionId; }
  async resume(id) { await this.connect(); if (!this.loaded.has(id)) { const r = await this.rpc('session/resume', { ...this.sessionParams(), sessionId: id }); this.loaded.set(id, r.configOptions ?? []); } return id; }
  async listModels() {
    const id = await this.create();
    try {
      const selector = this.loaded.get(id).find(o => o.id === 'model');
      return { models: (selector?.options ?? []).flatMap(group => group.options ? group.options.map(o => ({ ...o, name: `${group.name} / ${o.name}` })) : [group]).map(o => ({ id: o.value, name: o.name ?? o.value, fastMode: false })), defaultModel: selector?.currentValue };
    } finally { await this.rpc('session/close', { sessionId: id }); this.loaded.delete(id); this.defaultModels.delete(id); }
  }
  async send(id, text, image, options = {}) {
    if (this.active.has(id) || this.preparing.has(id)) throw new Error('DSH turn is still active');
    const epoch = this.cancelEpoch.get(id); this.preparing.add(id);
    try {
    await this.resume(id);
    this.selection = { model: '', fastMode: false, ...this.selection, ...options };
    if (this.selection.fastMode) throw new Error('DSH ACP does not expose a fast-mode control');
    const modelSelector = this.loaded.get(id).find(o => o.id === 'model');
    const requested = this.selection.model || this.profileDefaultModel || this.defaultModels?.get(id);
    if (requested && requested !== modelSelector?.currentValue) {
      const result = await this.rpc('session/set_config_option', { sessionId: id, configId: 'model', value: requested });
      this.loaded.set(id, result.configOptions ?? []);
    }
    this.effectiveModel = this.loaded.get(id).find(o => o.id === 'model')?.currentValue;
    this.effectiveFastMode = false;
    this.effort = options.reasoningEffort ?? this.effort;
    if (image && !this.info.agentCapabilities?.promptCapabilities?.image) throw new Error('This DSH model does not support images. Choose a vision model in your DSH profile; text-only models can test reactions, not screenshots.');
    const selector = this.loaded.get(id).find(o => o.id === 'reasoning_effort');
    const supported = (selector?.options ?? []).flatMap(o => o.options ?? [o]).map(o => o.value);
    const thinking = options.dshThinking ?? this.thinking ?? true; this.thinking = thinking;
    const enabled = supported.filter(value => !['off', 'none'].includes(value));
    const effort = thinking ? chooseEffort(this.effort, enabled) : supported.find(value => ['off', 'none'].includes(value));
    if (!thinking && effort === undefined) throw new Error('This DSH model does not advertise a thinking-off option');
    if (thinking && supported.length && !enabled.length) throw new Error('This DSH model does not advertise a thinking-on option');
    this.effectiveEffort = effort;
    // Use native ACP/API controls. Prompt wording is a separate signal-mapping feature.
    if (effort !== undefined) await this.rpc('session/set_config_option', { sessionId: id, configId: 'reasoning_effort', value: effort });
    const prompt = [{ type: 'text', text: `${await readFile(this.skillPath, 'utf8')}\n\n${text}` }];
    if (image) prompt.push({ type: 'image', mimeType: 'image/png', data: (await readFile(image)).toString('base64') });
    if (this.cancelEpoch.get(id) !== epoch) throw new Error('DSH turn cancelled before submission');
    const record = { followups: [], cancelled: false }; this.active.set(id, record);
    record.finished = (async () => {
      let status = 'completed', batch = prompt;
      try {
        do {
          const result = await this.rpc('session/prompt', { sessionId: id, prompt: batch }, 0);
          if (result.stopReason !== 'end_turn') { status = result.stopReason === 'cancelled' ? 'interrupted' : 'failed'; break; }
          batch = record.followups.splice(0).map(text => ({ type: 'text', text }));
        } while (!record.cancelled && batch.length);
      } catch (e) { status = record.cancelled ? 'interrupted' : 'failed'; if (!record.cancelled) this.emit('failure', e); }
      finally { this.active.delete(id); this.emit('completed', { threadId: id, turn: { id, status: record.cancelled ? 'interrupted' : status } }); }
    })();
    return id;
    } finally { this.preparing.delete(id); }
  }
  async steer(id, text, image) { const r = this.active.get(id); if (!r) return this.send(id, text, image); if (image) throw new Error('DSH cannot steer images during a turn'); r.followups.push(text); return id; }
  async cancel(id) {
    this.cancelEpoch.set(id, (this.cancelEpoch.get(id) ?? 0) + 1);
    const r = this.active.get(id); if (!r) return; r.cancelled = true; r.followups.length = 0;
    this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: id } }) + '\n');
    let timer; try { await Promise.race([r.finished, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DSH has not confirmed cancellation')), 15000); })]); } finally { clearTimeout(timer); }
  }
  async close() {
    this.closing = true; const child = this.child; if (!child) return;
    await new Promise(resolve => { const timer = setTimeout(resolve, 2000); timer.unref(); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill(); });
  }
}
