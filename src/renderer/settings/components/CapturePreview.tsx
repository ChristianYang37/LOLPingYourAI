import { useEffect, useState } from 'react';

export function CapturePreview({ preview, target, zh, latest = false }: { preview: any; target?: any; zh: boolean; latest?: boolean }) {
  const [result, setResult] = useState<{ url?: string; expired?: boolean; error?: boolean }>();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let current = true; setResult(undefined);
    void window.teammateApi.call('capturePreview', { file: preview.file }).then(value => { if (current) setResult(value); }, () => { if (current) setResult({ error: true }); });
    return () => { current = false; };
  }, [preview.file]);
  const label = latest ? (zh ? 'Agent 最新看到的区域' : 'Latest agent view') : (zh ? '此次请求的区域' : 'Request region');
  return <figure className={`capture-preview ${expanded ? 'capture-expanded' : ''}`}>
    <figcaption><strong>{label}</strong><span>{target?.app} {target?.title}</span><time>{new Date(preview.capturedAt).toLocaleTimeString()}</time></figcaption>
    {result?.url ? <button type="button" aria-label={zh ? '放大或缩小区域截图' : 'Expand or collapse region capture'} onClick={() => setExpanded(v => !v)}><img src={result.url} alt={label} /></button> : <small>{result?.expired ? (zh ? '截图已按本地保留规则清理' : 'Capture expired from local retention') : result?.error ? (zh ? '截图暂不可用' : 'Capture unavailable') : (zh ? '加载截图…' : 'Loading capture…')}</small>}
    <small>{preview.region?.imageWidth ?? ''} × {preview.region?.imageHeight ?? ''} · {zh ? '本地截图' : 'Local capture'}</small>
  </figure>;
}
