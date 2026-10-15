import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Read only model names. Provider credentials stay with Claude; never return env/settings.
export async function configuredClaudeModels(cwd, env = process.env) {
  let model, variables = {};
  for (const file of [join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json'), join(cwd, '.claude/settings.json'), join(cwd, '.claude/settings.local.json')]) {
    try { const s = JSON.parse(await readFile(file, 'utf8')); if (typeof s.model === 'string') model = s.model; Object.assign(variables, s.env); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('Unable to read Claude model settings'); }
  }
  variables = { ...variables, ...env };
  const names = [model, ...['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'].map(key => variables[key])];
  return [...new Set(names.filter(value => typeof value === 'string' && value.length > 0 && value.length <= 500))];
}
