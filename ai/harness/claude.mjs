import { chooseEffort } from './effort.mjs';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

// Read-only built-ins let the skill recover intent from history, project files and memory. No other built-in is exposed.
export const contextTools = ['Read', 'Grep', 'Glob'];
const desktopTool = /^mcp__lolpingyourai__/;
const privateDirs = ['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.config/gcloud', '.config/gh', 'Library/Keychains', 'Library/Cookies'];
const privateFile = /(^|[\\/])(\.env(\.[^\\/]*)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials|id_[a-z0-9_]+|bridge\.json|[^\\/]*\.(pem|key|p12|pfx))$/i;
const inside = (path, dir) => { const r = relative(dir, path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/** Returns why a Claude tool call is refused, or null. Defense in depth for the cooperating backend, not an OS sandbox. */
export function toolPolicy(name, input = {}, cwd, home = homedir()) {
  if (desktopTool.test(name)) return null;
  if (!contextTools.includes(name)) return 'Only read-only context tools and the LOLPingYourAI desktop tools are available to this teammate.';
  const target = resolve(cwd, String((name === 'Read' ? input.file_path : input.path) ?? cwd));
  if (privateDirs.some(dir => inside(target, join(home, dir))) || privateFile.test(target) || privateFile.test(String(input.glob ?? ''))) return 'Credentials and private keys are outside teammate context.';
  if (name !== 'Read' && inside(home, target)) return 'Search a specific project, history or memory folder, not the whole home directory.';
  return null;
}

export class ClaudeAdapter extends EventEmitter {
  constructor({ cwd, mcp, skillPath, executable, sdk }) { super(); Object.assign(this, { cwd, mcp, skillPath, executable }); this.sdk = sdk; this.active = new Map(); this.known = new Set(); this.cancelEpoch = new Map(); }
  async load() { return this.sdk ??= await import('@anthropic-ai/claude-agent-sdk'); }
  async capabilities() { await this.load(); return { images: true, steer: 'after-current-turn', interrupt: true, desktop: 'project-mcp', context: contextTools, nativeDesktop: false }; }
  async create() { const id = randomUUID(); return id; }
  async resume(id) { this.known.add(id); return id; }
  async send(id, prompt, image, settings = {}) {
    this.effort = settings.reasoningEffort ?? this.effort ?? 0;
    if (this.active.has(id)) throw new Error('Claude turn is still active');
    const { query } = await this.load();
    const content = [{ type: 'text', text: prompt }];
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: (await readFile(image)).toString('base64') } });
    const skill = await readFile(this.skillPath, 'utf8');
    const refuse = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    this.effectiveEffort = chooseEffort(this.effort, ['low', 'medium', 'high']);
    const options = { effort: this.effectiveEffort, cwd: this.cwd, systemPrompt: { type: 'preset', preset: 'claude_code', append: skill }, mcpServers: { lolpingyourai: this.mcp }, permissionMode: 'default', tools: contextTools,
      strictMcpConfig: true,
      ...(this.executable ? { pathToClaudeCodeExecutable: this.executable } : {}),
      // Hooks run before settings allow-rules, so a user's global allow list cannot widen this teammate's tools.
      hooks: { PreToolUse: [{ hooks: [async input => { const reason = toolPolicy(input.tool_name, input.tool_input ?? {}, this.cwd); return reason ? refuse(reason) : {}; }] }] },
      canUseTool: async (name, input) => { const reason = toolPolicy(name, input, this.cwd); return reason ? { behavior: 'deny', message: reason } : { behavior: 'allow', updatedInput: input }; } };
    const record = { followUps: [], finished: null, wake: null, results: 0, stderr: '' };
    const message = text => ({ type: 'user', session_id: id, parent_tool_use_id: null, message: { role: 'user', content: typeof text === 'string' ? [{ type: 'text', text }] : text } });
    // One user message per turn: a queued reaction is written only after the previous turn's result, so turns never merge.
    async function* messages() {
      record.inputClosed = false;
      try {
      await record.settingsReady;
      if (record.cancelled) return;
      yield message(content);
      for (let turn = 1; ; turn++) {
        while (record.results < turn && !record.closed) await new Promise(resolve => { record.wake = resolve; });
        if (record.closed || record.cancelled || !record.followUps.length) return;
        yield message(record.followUps.splice(0).join('\n\n'));
      }
      } finally { record.inputClosed = true; }
    }
    const start = resume => {
      Object.assign(record, { results: 0, stderr: '' });
      record.stream = query({ prompt: messages(), options: { ...options, stderr: data => { record.stderr = (record.stderr + data).slice(-4000); }, ...(resume ? { resume: id } : { sessionId: id }) } });
      record.settingsReady = (async () => {
        if (!record.stream.supportedModels || !record.stream.applyFlagSettings) return;
        const models = await record.stream.supportedModels();
        const model = models.find(m => m.value === this.model) ?? models.find(m => m.value === 'default') ?? models[0];
        const supported = model?.supportedEffortLevels ?? ['low', 'medium', 'high'];
        this.effectiveEffort = chooseEffort(this.effort, supported);
        if (this.effectiveEffort) await record.stream.applyFlagSettings({ effortLevel: this.effectiveEffort });
      })();
      record.settingsReady.catch(() => {});

    };
    start(this.known.has(id));
    this.active.set(id, record);
    record.finished = (async () => {
      let status = 'completed', retried = false;
      try {
        for (;;) {
          try {
            for await (const message of record.stream) {
              if (message.type === 'system' && message.subtype === 'init') this.model = message.model;
              this.emit('event', { method: 'claude/message', params: { ...message, threadId: id } });
              if (message.session_id) this.known.add(message.session_id);
              if (message.type === 'result') { if (message.is_error) status = 'failed'; record.results++; record.wake?.(); }
            }
            break;
          } catch (error) {
            // A first turn that failed before Claude saved it leaves an ID that cannot be resumed; start it fresh once.
            if (retried || record.cancelled || !/No conversation found with session ID/.test(`${error.message}\n${record.stderr}`)) throw error;
            retried = true; status = 'completed'; this.known.delete(id); start(false);
          }
        }
      } catch (error) { status = record.cancelled ? 'interrupted' : 'failed'; if (!record.cancelled) this.emit('failure', error); }
      finally { record.closed = true; record.wake?.(); this.active.delete(id); this.emit('completed', { threadId: id, turn: { id, status: record.cancelled ? 'interrupted' : status } }); }
    })();
    return id;
  }
  // Claude has no mid-turn steering here. Deliver the reaction after the current turn rather than interrupting its work.
  async steer(id, prompt, image) { const epoch = this.cancelEpoch.get(id); const record = this.active.get(id); if (!record || record.closed || record.inputClosed || image) { await record?.finished; if (this.cancelEpoch.get(id) !== epoch) throw new Error('Follow-up cancelled'); return this.send(id, prompt, image); } record.followUps.push(prompt); return id; }
  async cancel(id) {
    this.cancelEpoch.set(id, (this.cancelEpoch.get(id) ?? 0) + 1);
    const record = this.active.get(id); if (!record) return;
    record.cancelled = true; record.followUps.length = 0; record.wake?.(); await record.stream.interrupt();
    await Promise.race([record.finished, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('Claude has not confirmed cancellation')), 15000); t.unref(); })]);
  }
  close() { for (const record of this.active.values()) record.stream.close(); }
}
