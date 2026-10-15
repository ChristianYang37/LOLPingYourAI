import '../conversation.css';
import { useState } from 'react';
import { textureUrl } from '../../../shared/pings';

declare global { interface Window { teammateApi: { call(method: string, args?: unknown): Promise<any>; onChange(cb: () => void): () => void } } }
const call = (method: string, args?: unknown) => window.teammateApi.call(method, args);
const readable = (text: string) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part);
const phases: Record<string, [string, string, string]> = {
  received: ['generic_ping', 'Received', '已收到'], understanding: ['omw', 'Understanding', '正在理解'], working: ['all_in', 'Working', '正在执行'], waiting: ['enemy_missing', 'Your turn', '等你回答'], done: ['emote_super_approved', 'Done', '已完成'], stopping: ['pingwheel_retreatrender', 'Stopping…', '正在停止…'], stopped: ['pingwheel_retreatrender', 'Stopped', '已停止'], error: ['pingwheel_retreatrender', 'Needs attention', '需要处理'],
};
export function Conversation({ state, zh, floating = false }: { state: any; zh: boolean; floating?: boolean }) {
  const [expanded, setExpanded] = useState(false), [text, setText] = useState(''), [error, setError] = useState(''), [sending, setSending] = useState(false), [answers, setAnswers] = useState<Record<string, string>>({});
  const t = (en: string, cn: string) => zh ? cn : en;
  const task = state.task, phase = phases[task?.phase] ?? phases.received;
  const run = async (method: string, args?: unknown) => { setError(''); setSending(true); try { await call(method, args); return true; } catch (e) { setError(String(e)); return false; } finally { setSending(false); } };
  return <div className={`conversation ${expanded ? 'expanded' : ''}`}>
    <header><img src={textureUrl(phase[0])} alt="" /><strong>{phase[zh ? 2 : 1]}</strong><span className="spacer" />{floating && <button title={t('Hide', '隐藏')} onClick={() => void call('hideCard')}>×</button>}</header>
    <div className="conversation-body">
      <small>{task?.target?.app ?? 'LOLPingYourAI'}{state.pending?.length > 0 && ` · ${state.pending.length} ${t('queued', '条排队中')}`}</small>
      <p className="reply-text">{task?.text ? readable(task.text) : t('Ping a region to start. Your teammate’s reply appears here.', '向一个区域发信号，队友的回复会出现在这里。')}</p>
      {task?.error && <p role="alert">{task.error}</p>}
      {(state.approvals ?? []).map((p: any) => <div key={`${p.harness}:${p.request.id}`} className="approval">
        <strong>{t('Your teammate needs your answer', '队友需要你的回答')}</strong>
        {(p.request.params.questions ?? []).map((q: any) => <label key={q.id}>{q.question}<input value={answers[q.id] ?? ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} /></label>)}
        <details><summary>{t('Request details', '请求详情')}</summary><pre>{JSON.stringify(p.request.params, null, 2)}</pre></details>
        <button disabled={sending} onClick={() => void run('approve', { harness: p.harness, id: p.request.id, allow: true, answers })}>{p.request.params.questions ? t('Send answer', '发送回答') : t('Allow once', '本次允许')}</button>
        {!p.request.params.questions && <button disabled={sending} onClick={() => void run('approve', { harness: p.harness, id: p.request.id, allow: false })}>{t('Decline', '拒绝')}</button>}
      </div>)}
      {error && <p role="alert">{error}</p>}
    </div>
    <footer><button onClick={() => { setExpanded(!expanded); if (floating) void call('resizeCard', { expanded: !expanded }); }}>{expanded ? t('Collapse', '收起') : t('Expand', '展开')}</button><button disabled={!task?.text} onClick={() => void run('copyReply')}>{t('Copy', '复制')}</button>{state.busy && <button onClick={() => void run('stop')}>{t('Retreat', '撤退')}</button>}</footer>
    <form onSubmit={e => { e.preventDefault(); if (sending || !text.trim()) return; void run('followup', { contextId: task.id, text }).then(ok => { if (ok) setText(''); }); }}><input aria-label={t('Follow up', '追问')} placeholder={t('Ask or answer here…', '在这里追问或回答…')} value={text} onChange={e => setText(e.target.value)} /><button disabled={sending || !task || !text.trim()}>{t('Send', '发送')}</button></form>
  </div>;
}
