// UI indices are relative to each model: 0 = lowest, 1 = second lowest, clamped at the top.
export const effortOrder = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export function chooseEffort(level = 0, supported = []) {
  const choices = effortOrder.filter(v => supported.includes(v));
  if (!Number.isInteger(level) || level < 0) throw new Error('Reasoning level must be a non-negative integer');
  return choices[Math.min(level, choices.length - 1)];
}
