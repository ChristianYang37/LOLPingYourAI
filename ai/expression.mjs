// Consecutive nearby signals carry tone, not additional execution authority.
export function sameExpression(previous, event, locationOnly = false) {
  if (!previous || event.source !== 'user' || event.followup || !['missing', 'bait', 'reaction', 'like', 'celebrate'].includes(event.signal)) return false;
  const a = previous.event, p = a.point, q = event.point;
  if (!p || !q || ![p.x, p.y, q.x, q.y].every(Number.isFinite)) return false;
  return a.source === 'user' && a.generation === event.generation && a.harness === event.harness && a.signal === event.signal &&
    event.receivedAt - previous.at >= 0 && event.receivedAt - previous.at <= 3000 &&
    Math.hypot(p.x - q.x, p.y - q.y) <= 48 &&
    (locationOnly || (a.target && event.target && a.target.id === event.target.id && a.target.pid === event.target.pid && a.target.processStartedAt === event.target.processStartedAt && a.target.windowToken === event.target.windowToken));
}
export function expressionHint(count = 1) {
  return count > 1 ? `The user repeated this signal ${count} times in a short burst. Consider heightened confusion, disbelief, urgency or playful frustration in context; do not assume anger or expand action authority. Acknowledge the tone and address the underlying question.` : 'Interpret the signal with the current task and visible evidence, not as a rigid command word.';
}
// Exploration permits view navigation, not arbitrary typing/shortcuts. Clicks still
// need agent judgment: no coordinate classifier can prove a button is read-only.
export function checkExplorationAction(args) {
  if (!['click', 'scroll', 'key'].includes(args.action)) throw new Error('Exploration only permits navigation; use an execution ping for edits');
  if (args.action === 'click' && (args.button === 'right' || typeof args.purpose !== 'string' || !args.purpose.trim())) throw new Error('Explain the navigation purpose of an exploration click');
  if (args.action === 'key' && !/^(up|down|left|right|escape|tab|shift\+tab|(?:meta|cmd|command|control|ctrl)\+f)$/i.test(args.key ?? '')) throw new Error('This shortcut is not permitted for exploration');
}
