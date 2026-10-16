import { describe, it, expect } from 'vitest';
import { normalizeMath } from '../src/renderer/settings/components/normalizeMath';
describe('native harness LaTeX delimiters', () => {
  it('normalizes inline and display math', () => {
    expect(normalizeMath('Use \\(x\\).\n\\[\nx^2\n\\]')).toBe('Use $x$.\n$$\nx^2\n$$');
  });
  it('preserves code including partial streaming fences and backtick spans', () => {
    const text = '```latex\n\\[ x \\]\n```\n`\\(x\\)` and \\(y\\)';
    expect(normalizeMath(text)).toBe('```latex\n\\[ x \\]\n```\n`\\(x\\)` and $y$');
    expect(normalizeMath('~~~latex\n\\[ x \\]')).toBe('~~~latex\n\\[ x \\]');
    expect(normalizeMath('``a`\\(x\\)``')).toBe('``a`\\(x\\)``');
  });
});
