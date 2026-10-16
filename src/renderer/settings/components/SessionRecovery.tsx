import { useState } from 'react';

/** Reconnect the same native thread. No archive, fork, history rewrite or task replay. */
export function SessionRecovery({ state, zh }: { state: any; zh: boolean }) {
  const [pending, setPending] = useState(false), [result, setResult] = useState('');
  const t = (en: string, cn: string) => zh ? cn : en;
  const harness = state.config.harness, session = state.sessions?.[harness];
  const conflict = session?.writerConflict;
  if (!conflict) return result ? <p role="status">{result}</p> : null;
  const recover = async () => {
    setPending(true); setResult('');
    try {
      await window.teammateApi.call('recoverSession', { harness, sessionId: session.id });
      setResult(t('Original session reconnected. Send your request again when ready; nothing was replayed.', '原会话已重新连接。请按需要重新发送请求，之前失败的操作没有自动重放。'));
    } catch (error) {
      const message = String(error);
      setResult(/active writer|SESSION_WRITER_CONFLICT/.test(message)
        ? t('The session is still in use. Release it in the other client, then retry. Your history is unchanged.', '会话仍被占用。请在另一客户端释放后重试，历史记录保持不变。')
        : message);
    } finally { setPending(false); }
  };
  return <section className="session-recovery" role="alert" data-testid="session-recovery">
    <strong>{t('This Codex session is in use elsewhere', '这个 Codex 会话正被其他客户端占用')}</strong>
    <p>{t('The original session and its full history are preserved. Repeated pings will not bypass this conflict.', '原会话及完整历史已保留，重复发 ping 无法绕过占用。')}</p>
    <ol>
      <li>{t('Let any task in the other Codex client finish first.', '先等待另一 Codex 客户端中的任务结束。')}</li>
      <li>{t('For Codex desktop, temporarily archive this idle conversation, then restore it from Archived. For a CLI session, exit that session. Simply switching tabs may not release it.', '如果占用方是 Codex 桌面端，将这个空闲会话临时归档，再从“已归档”恢复；如果是 CLI，退出对应会话。仅切换标签页可能不会释放占用。')}</li>
      <li>{t('Reconnect below, then send the intended request again.', '点击下方重新连接，再发送你希望执行的请求。')}</li>
    </ol>
    <p>{t('Session ID', '会话 ID')}：<code>{session.id}</code></p>
    <button type="button" disabled={pending || state.busy} onClick={() => void recover()}>{pending ? t('Reconnecting…', '正在重新连接…') : t('Reconnect original session', '重新连接原会话')}</button>
    {result && <p role="status">{result}</p>}
    <details><summary>{t('Technical details', '技术详情')}</summary><pre>{conflict.detail}</pre></details>
  </section>;
}
