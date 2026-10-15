// Copies text evidence from raw/ to public/ with the redactions in redact.json applied: home path → ~, session ids →
// labels, listed phrases replaced, and any line matching one of the "lines" patterns replaced by a marker.
// Usage: node scrub.mjs <redact.json> <out-dir> <file>...
import { readFileSync, writeFileSync } from 'node:fs'; import { basename, join } from 'node:path'; import { homedir } from 'node:os';
const [redactFile, outDir, ...files] = process.argv.slice(2), red = JSON.parse(readFileSync(redactFile, 'utf8'));
const patterns = (red.lines ?? []).map(p => new RegExp(p, 'i'));
for (const f of files) {
  let text = readFileSync(f, 'utf8').split(homedir()).join('~');
  for (const [id, l] of Object.entries(red.sessions ?? {})) text = text.split(id).join(l);
  for (const [a, b] of red.text ?? []) text = text.split(a).join(b);
  text = text.split('\n').map(line => patterns.some(p => p.test(line)) ? `${line.match(/^\S*\s*\[?\s*[\d.]+s?\]?|^\S+/)?.[0] ?? ''} [line redacted: content of another window]` : line).join('\n');
  writeFileSync(join(outDir, basename(f)), text);
}
