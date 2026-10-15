import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, delimiter, isAbsolute } from 'node:path';

// No shell and no evaluation of npm's .cmd shim. Launch its known JS entry with Node.
export function codexLaunch(command, { platform = process.platform, env = process.env, node = process.execPath } = {}) {
  if (platform !== 'win32') return { command, args: [], env: {} };
  const candidate = file => {
    if (!existsSync(file)) return;
    if (/\.exe$/i.test(file)) return { command: file, args: [], env: {} };
    if (/\.cmd$/i.test(file)) {
      const entry = join(dirname(file), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(entry)) return { command: node, args: [entry], env: { ELECTRON_RUN_AS_NODE: '1' } };
    }
  };
  if (isAbsolute(command) || /[\\/]/.test(command)) {
    const found = candidate(command); if (found) return found;
    throw new Error('LOLPINGAI_CODEX must point to a native codex.exe or an installed npm codex.cmd');
  }
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const suffix of /\.(exe|cmd)$/i.test(command) ? [''] : ['.exe', '.cmd']) {
      const found = candidate(join(dir.replace(/^"|"$/g, ''), command + suffix)); if (found) return found;
    }
  }
  if (command === 'codex') {
    const bundled = join(env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin');
    try {
      const paths = readdirSync(bundled).map(dir => join(bundled, dir, 'codex.exe')).filter(existsSync).sort((a,b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      for (const path of paths) { const found = candidate(path); if (found) return found; }
    } catch { /* Not installed. Try the standard npm user prefix. */ }
    if (env.APPDATA) { const found = candidate(join(env.APPDATA, 'npm', 'codex.cmd')); if (found) return found; }
  }
  throw new Error('Codex executable not found. Install Codex CLI or set LOLPINGAI_CODEX to its native codex.exe path.');
}
