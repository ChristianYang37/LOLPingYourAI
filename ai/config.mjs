export const defaults = Object.freeze({ regionSize: 512, wardHours: 0.5, harness: 'codex', banter: true, reasoningEffort: 0, dshThinking: true, modelSelections: {}, setupComplete: false, diagnosticsEnabled: false });

export const signals = Object.freeze({
  missing: { label: 'Question', mode: 'explore', prompt: 'Explain the selected page region thoroughly. Proactively use computer use to navigate, scroll and expand relevant content, and search related files, memory and sessions through the harness. Infer plausible intentions from evidence; when ambiguous, explain the most useful interpretations rather than immediately handing the question back. Distinguish observed facts from hypotheses. Deliver a useful Markdown explanation with LaTeX or code when helpful. Exploration is for understanding, not editing data or sending messages.' },
  assist: { label: 'Assist me', mode: 'execute', prompt: 'Inspect progress in the highlighted region and help finish the current task. If the goal is unclear, reply with a question ping and ask one concise question.' },
  danger: { label: 'Danger', mode: 'interrupt', prompt: 'Your current approach is wrong near this region. Stop, inspect this fresh screenshot, explain the correction, then proceed only when the correction is clear.' },
  onmyway: { label: 'On my way', mode: 'execute', prompt: 'Expand the selected window to fill its work area and improve readability using reversible view settings. Preserve document content and save the original view for restoration.' },
  vision: { label: 'Ward', mode: 'ward', prompt: 'Register one follow-up visit after the configured ward duration. Reply with a ward ping once registered.' },
  bait: { label: 'Weak!', mode: 'emotion', prompt: 'The user sent a dramatic, usually non-instructional taunt. When banter is enabled, answer with expressive, exaggerated teammate emotes and a witty comeback; a playful question or weak emote back is welcome. Read the mood in context: repeated pings can express frustration or disbelief. Do not undo work or infer a new task from emotion alone.' },
  allin: { label: 'All in', mode: 'execute', prompt: 'Focus your work on this target region. Inspect current progress and pursue the existing goal here; ask if the goal is not known.' },
  retreat: { label: 'Retreat', mode: 'stop', prompt: 'Stop work and return control to the user.' },
  like: { label: 'Nice', mode: 'emotion', prompt: 'The user approves your current direction. Continue the existing task.' },
  cleared: { label: 'Clear ward', mode: 'unward', prompt: 'Cancel pending follow-up visits for this window.' },
  reaction: { label: 'Reaction', mode: 'emotion', prompt: 'The user sent an emote. Respond briefly in its spirit; do not change the task.' },
  celebrate: { label: 'Celebrate', mode: 'emotion', prompt: 'Celebrate the completed task with a brief friendly emote.' },
  push: { label: 'Push', mode: 'execute', prompt: 'Continue advancing the current task in this region. Ask if no task has been established.' },
  enemyvision: { label: 'Attention here', mode: 'observe', prompt: 'Pay attention to the highlighted region and explain what you notice. Observe only.' },
  generic: { label: 'Look here', mode: 'observe', prompt: 'Inspect the highlighted region and describe it. Observe only.' },
});

export function validateConfig(value = {}) {
  const result = { ...defaults, ...value };
  delete result.sessionHours; // Migrate old settings; session lifetime belongs to the harness.
  for (const [key, min, max] of [['regionSize', 128, 2048], ['wardHours', 0.001, 168]]) {
    if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max) throw new Error(`${key} must be between ${min} and ${max}`);
  }
  if (!Number.isInteger(result.regionSize)) throw new Error('regionSize must be an integer');
  if (!['codex', 'claude', 'dsh'].includes(result.harness)) throw new Error('Unknown harness');
  if (typeof result.dshThinking !== 'boolean') throw new Error('dshThinking must be boolean');
  if (typeof result.banter !== 'boolean') throw new Error('banter must be boolean');
  if (!Number.isInteger(result.reasoningEffort) || result.reasoningEffort < 0 || result.reasoningEffort > 8) throw new Error('Reasoning level must be an integer from 0 to 8');
  if (typeof result.diagnosticsEnabled !== 'boolean') throw new Error('diagnosticsEnabled must be boolean');
  if (typeof result.setupComplete !== 'boolean') throw new Error('setupComplete must be boolean');
  if (!result.modelSelections || typeof result.modelSelections !== 'object' || Array.isArray(result.modelSelections)) throw new Error('Invalid model selections');
  for (const [harness, selection] of Object.entries(result.modelSelections)) {
    if (!['codex', 'claude', 'dsh'].includes(harness) || !selection || typeof selection.model !== 'string' || selection.model.length > 500 || typeof selection.fastMode !== 'boolean') throw new Error('Invalid model selection');
  }
  const modes = new Set(['observe', 'explore', 'execute', 'interrupt', 'stop', 'ward', 'unward', 'emotion']);
  for (const [id, entry] of Object.entries(result.mappings ?? {})) {
    if (!/^[a-zA-Z0-9_:-]{1,80}$/.test(id) || !modes.has(entry.mode) || typeof entry.prompt !== 'string' || entry.prompt.length > 12000) throw new Error('Invalid signal mapping');
  }
  return result;
}

export function signalFor(config, id) {
  const result = config.mappings?.[id] ?? signals[id];
  if (!result) throw new Error(`Unknown signal: ${id}`);
  return result;
}
