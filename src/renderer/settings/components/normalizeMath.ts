/** Harnesses commonly emit LaTeX delimiters. Convert outside Markdown code;
 * incomplete streaming fences/spans stay literal until the next delta. */
export function normalizeMath(text: string): string {
  let fence = '', inline = '';
  return text.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = '';
      return line;
    }
    if (!inline && marker) { fence = marker; return line; }
    let out = '';
    for (let i = 0; i < line.length;) {
      if (line[i] === '`') {
        const ticks = /^`+/.exec(line.slice(i))![0];
        if (!inline) inline = ticks; else if (inline === ticks) inline = '';
        out += ticks; i += ticks.length;
      } else if (!inline && line[i] === '\\' && line[i - 1] !== '\\' && /[()[\]]/.test(line[i + 1] ?? '')) {
        out += '[]'.includes(line[i + 1]) ? '$$' : '$'; i += 2;
      } else out += line[i++];
    }
    return out;
  }).join('\n');
}
