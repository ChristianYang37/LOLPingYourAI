import '../conversation.css';
import { SessionRecovery } from './SessionRecovery';
import { RichReply } from './RichReply';
import { CapturePreview } from './CapturePreview';
import workingEmote from '../../assets/working.png';
import { useEffect, useRef, useState } from 'react';
import { pingById, textureUrl } from '../../../shared/pings';

declare global { interface Window { teammateApi: { call(method: string, args?: unknown): Promise<any>; onChange(cb: () => void): () => void } } }
const call = (method: string, args?: unknown) => window.teammateApi.call(method, args);
const phases: Record<string, [string, string, string]> = {
  received: ['generic_ping', 'Received', '已收到'], understanding: ['omw', 'Understanding', '正在理解'], working: ['all_in', 'Working', '正在执行'], waiting: ['enemy_missing', 'Your turn', '等你回答'], done: ['emote_super_approved', 'Done', '已完成'], stopping: ['pingwheel_retreatrender', 'Stopping…', '正在停止…'], stopped: ['pingwheel_retreatrender', 'Stopped', '已停止'], error: ['pingwheel_retreatrender', 'Needs attention', '需要处理'],
};
export function Conversation({ state, zh, floating = false, fullPage = false, trigger = 'Option' }: { state: any; zh: boolean; floating?: boolean; fullPage?: boolean; trigger?: string }) {
  const [expanded, setExpanded] = useState(false), [text, setText] = useState(''), [error, setError] = useState(''), [sending, setSending] = useState(false), [answers, setAnswers] = useState<Record<string, string>>({});
  const t = (en: string, cn: string) => zh ? cn : en;
  const body = useRef<HTMLDivElement>(null), followBottom = useRef(true);
  const [log, setLog] = useState<{ entries: any[]; hasMore: boolean }>();
  useEffect(() => {
    if (!fullPage || !state.conversation) return;
    setLog(previous => {
      if (!previous) return state.conversation;
      const entries = [...previous.entries], positions = new Map(entries.map((row, i) => [row.id, i]));
      for (const row of state.conversation.entries) {
        const index = positions.get(row.id);
        if (index === undefined) entries.push(row); else entries[index] = row;
      }
      return { entries, hasMore: previous.hasMore };
    });
  }, [state.conversation, fullPage]);
  const older = async () => {
    try {
      const page = await call('conversation', { before: log?.entries[0]?.id });
      const height = body.current?.scrollHeight ?? 0;
      followBottom.current = false;
      setLog(previous => ({ entries: [...page.entries, ...(previous?.entries ?? [])], hasMore: page.hasMore }));
      requestAnimationFrame(() => { if (body.current) body.current.scrollTop += body.current.scrollHeight - height; });
    } catch (e) { setError(String(e)); }
  };
  const sessionBlocked = Boolean(state.sessions?.[state.config.harness]?.writerConflict);
  const task = state.task, phase = phases[sessionBlocked ? 'error' : task?.phase] ?? phases.received;
  const working = Boolean(state.busy && task?.mode !== 'emotion' && ['received', 'understanding', 'working'].includes(task?.phase));
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { if (!working) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [working]);
  useEffect(() => { if (followBottom.current && body.current) body.current.scrollTop = body.current.scrollHeight; }, [task?.text, task?.id, log]);
  const run = async (method: string, args?: unknown) => { setError(''); setSending(true); try { await call(method, args); return true; } catch (e) { setError(String(e)); return false; } finally { setSending(false); } };
  return <div className={`conversation ${working ? 'is-working' : ''} ${expanded || fullPage ? 'expanded' : ''} ${fullPage ? 'conversation-full' : ''}`}>
    <header><img className={working ? 'working-emote' : undefined} src={working ? workingEmote : textureUrl(phase[0])} alt="" /><strong role="status">{sessionBlocked ? t('Session in use', '会话被占用') : task ? phase[zh ? 2 : 1] : t('Ready when you are', '等待你的信号')}</strong>{working && <small className="work-elapsed">{Math.max(0, Math.floor((clock - (task.startedAt ?? clock)) / 1000))}s</small>}<span className="spacer" />{floating && <button title={t('Hide', '隐藏')} onClick={() => void call('hideCard')}>×</button>}</header>
    <div className="conversation-body" ref={body} onScroll={() => { const el = body.current; if (el) followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {task?.preview && <details className="current-capture"><summary>{t('View what the agent sees now', '查看 agent 当前看到的区域')}</summary><CapturePreview preview={task.preview} target={task.target} zh={zh} latest /></details>}
      {fullPage && log?.entries.length ? <div className="conversation-log" aria-label={t('Conversation and signals', '聊天与信号记录')}>
        {log.hasMore && <button type="button" onClick={() => void older()}>{t('Load earlier records', '查看更早记录')}</button>}
        {log.entries.map(row => {
          const ping = pingById(({ onmyway: 'omw', vision: 'needvision', cleared: 'visioncleared' } as Record<string, string>)[row.signal] ?? row.signal);
          const label = ({ missing: '问号', assist: '求助', danger: '警告', onmyway: '正在路上', vision: '插眼', bait: '弱爆', allin: '交战', retreat: '撤退', like: '点赞', cleared: '排眼', celebrate: '喝彩', reaction: '表情', push: '推进', enemyvision: '注意这里', generic: '看这里' } as Record<string, string>)[row.signal];
          return <article key={row.id} className={`log-entry log-${row.role} log-${row.kind}`}>
            <div className="log-meta"><strong>{row.role === 'user' ? t('You', '你') : row.role === 'timer' ? t('Ward follow-up', '回访') : (row.harness ?? 'Agent')}</strong><time dateTime={new Date(row.time).toISOString()}>{new Date(row.time).toLocaleString(zh ? 'zh-CN' : 'en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>{row.target?.app && <span title={row.target.title}>{row.target.app}</span>}</div>
            {row.kind === 'ping' && <div className="log-signal"><img src={textureUrl(ping?.icon ?? 'generic_ping')} alt="" /><strong>{zh ? label ?? row.signal : ping?.name ?? row.signal}</strong></div>}
            {row.repeatCount > 1 && <small>×{row.repeatCount} {t('in this burst', '次连发')}</small>}{row.groupedWith && <small>{t('Added to the same request', '已补充到同一请求')}</small>}
            {row.preview && <CapturePreview preview={row.preview} target={row.target} zh={zh} />}
            {row.text && <RichReply text={row.text} />}
            {row.phase && <small>{phases[row.phase]?.[zh ? 2 : 1] ?? row.phase}</small>}
            {row.error && <p role="alert">{row.errorCode === 'SESSION_WRITER_CONFLICT' ? t('Request not sent: the original session was in use by another Codex client.', '请求未发送：原会话被另一 Codex 客户端占用。') : row.error}</p>}
          </article>;
        })}
      </div> : fullPage && !task ? <div className="chat-empty">
        <div className="ping-constellation" aria-hidden="true"><img src={textureUrl('enemy_missing')} /><img src={textureUrl('assist_me')} /><img src={textureUrl('omw')} /></div>
        <h2>{t('A ping is all it takes.', '指向哪里，就从哪里开始。')}</h2>
        <p>{t(`Type below to start, or hold ${trigger} and drag to share a region.`, `在下方直接发消息，或按住 ${trigger} 拖动，带上屏幕区域。`)}</p>
        <div className="ping-examples"><span><b>?</b>{t('Explain this', '问号 · 帮我理解')}</span><span>⚑ {t('Lend a hand', '求助 · 一起完成')}</span><span>⚔ {t('Focus here', '交战 · 专注这里')}</span></div>
      </div> : <div className="reply-message">
      <small>{task?.target?.app ?? 'LOLPingYourAI'}{state.pending?.length > 0 && ` · ${state.pending.length} ${t('queued', '条排队中')}`}</small>
      <RichReply text={task?.text || (task ? t('Your teammate is preparing a reply…', '队友正在准备回复…') : t('Ping a region to start. Your teammate’s reply appears here.', '向一个区域发信号，队友的回复会出现在这里。'))} />
      </div>}
      {state.pending?.length > 0 && <details className="pending-list"><summary>{state.pending.length} {t('requests queued', '条请求排队中')}</summary>{state.pending.map((p: any) => <p key={p.id}>{p.signal} · {p.target?.app ?? t('Locating target', '定位目标中')}</p>)}</details>}
      {task?.error && task.errorCode !== 'SESSION_WRITER_CONFLICT' && <p role="alert">{task.error}</p>}
      {(state.approvals ?? []).map((p: any) => <div key={`${p.harness}:${p.request.id}`} className="approval">
        <strong>{t('Your teammate needs your answer', '队友需要你的回答')}</strong>
        {(p.request.params.questions ?? []).map((q: any) => <label key={q.id}>{q.question}<input value={answers[q.id] ?? ''} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })} /></label>)}
        <details><summary>{t('Request details', '请求详情')}</summary><pre>{JSON.stringify(p.request.params, null, 2)}</pre></details>
        <button disabled={sending} onClick={() => void run('approve', { harness: p.harness, id: p.request.id, allow: true, answers })}>{p.request.params.questions ? t('Send answer', '发送回答') : t('Allow once', '本次允许')}</button>
        {!p.request.params.questions && <button disabled={sending} onClick={() => void run('approve', { harness: p.harness, id: p.request.id, allow: false })}>{t('Decline', '拒绝')}</button>}
      </div>)}
      {error && <p role="alert">{error}</p>}
    </div>
    <SessionRecovery key={state.config.harness + (state.sessions?.[state.config.harness]?.id ?? '')} state={state} zh={zh} />
    {(!fullPage || task) && <footer>{!fullPage && <button onClick={() => { setExpanded(!expanded); if (floating) void call('resizeCard', { expanded: !expanded }); }}>{expanded ? t('Collapse', '收起') : t('Expand', '展开')}</button>}<button disabled={!task?.text} onClick={() => void run('copyReply')}>{t('Copy', '复制')}</button>{state.busy && <button className="stop-button" onClick={() => void run('stop')}>{t('Retreat', '撤退')}</button>}</footer>}
    <form onSubmit={e => { e.preventDefault(); if (sending || sessionBlocked || (!fullPage && !task) || !text.trim()) return; void run(fullPage ? 'message' : 'followup', { contextId: task?.id, text }).then(ok => { if (ok) setText(''); }); }}>{fullPage ? <textarea rows={2} aria-label={t('Message your teammate', '给队友发送消息')} maxLength={12000} placeholder={task ? t('Ask a follow-up or give your teammate direction…', '继续追问，或告诉队友下一步…') : t('Message your teammate, or ping a region for visual context…', '直接发消息，或 ping 一个区域补充画面…')} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /> : <input aria-label={t('Follow up', '追问')} placeholder={t('Ask or answer here…', '在这里追问或回答…')} value={text} onChange={e => setText(e.target.value)} />}<button disabled={sending || sessionBlocked || (!fullPage && !task) || !text.trim()}>{t('Send', '发送')}</button></form>
    {fullPage && <div className="composer-hint">{t('Enter to send · Shift + Enter for a new line · Ctrl + Alt + Esc to stop', 'Enter 发送 · Shift + Enter 换行 · Ctrl + Alt + Esc 紧急停止')}</div>}
  </div>;
}
