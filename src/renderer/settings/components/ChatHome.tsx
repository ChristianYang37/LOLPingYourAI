import { useEffect, useState } from 'react';
import type { AppStatus } from '../../../shared/ipc';
import { triggerLabel, type Settings } from '../../../shared/settings';
import { api } from '../api';
import { useText } from '../text';
import { Conversation } from './Conversation';

export function ChatHome({ settings, status, openSettings }: { settings: Settings; status: AppStatus; openSettings: () => void }) {
  const zh = useText().lang.startsWith('zh');
  const [state, setState] = useState<any>(), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try { const next = await window.teammateApi.call('status'); if (alive) { setState(next); setError(''); } }
      catch (e) { if (alive) setError(String(e)); }
    };
    void refresh();
    const off = window.teammateApi.onChange(() => void refresh());
    return () => { alive = false; off(); };
  }, []);
  const config = state?.config, selection = config?.modelSelections?.[config.harness];
  const unavailable = status.helper === 'noAccess' || status.helper === 'failed' || !status.enabled;
  return <main className="chat-home">
    <div className="chat-heading"><div><span className="eyebrow">{zh ? '队友频道' : 'TEAM CHANNEL'}</span><h1>{zh ? '一起，把事情做好。' : 'Your teammate is here.'}</h1></div>
      <button className="model-chip" onClick={openSettings} title={zh ? '选择队友与模型' : 'Choose teammate and model'}>{config?.harness === 'dsh' ? 'DSH' : config?.harness === 'claude' ? 'Claude' : 'Codex'}<span>{selection?.model || (zh ? '默认模型' : 'Default model')}</span><span aria-hidden="true">⌄</span></button>
    </div>
    {(unavailable || config?.setupComplete === false) && <div className="connection-banner"><span>{status.helper === 'noAccess' ? (zh ? '桌面权限未就绪，完成授权后即可发信号。' : 'Desktop permissions are needed before you can ping.') : status.helper === 'failed' ? (zh ? '输入助手未连接，请到设置检查。' : 'Input helper is disconnected. Check settings.') : !status.enabled ? (zh ? '桌面信号已暂停。' : 'Desktop pings are paused.') : (zh ? '连接你的队友，开始第一次协作。' : 'Connect your teammate to get started.')}</span><button onClick={openSettings}>{zh ? '前往设置' : 'Open settings'} →</button></div>}
    {error && <p role="alert">{error}</p>}
    {state ? <Conversation state={state} zh={zh} fullPage trigger={triggerLabel(settings.trigger, zh ? 'zh-CN' : 'en', api.platform)} /> : <p role="status">{zh ? '正在连接队友…' : 'Connecting to your teammate…'}</p>}
  </main>;
}
