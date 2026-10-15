import { useText } from '../text';
import { useEffect, useRef, useState } from 'react';

/** Local-only square crop; alpha is preserved. Flat-background removal is explicit. */
export function IconEditor({ onChange }: { onChange: (png: string | undefined) => void }) {
  const zh = useText().lang.startsWith('zh'), t = (en: string, cn: string) => zh ? cn : en;
  const [url, setUrl] = useState(''), [zoom, setZoom] = useState(1), [x, setX] = useState(50), [y, setY] = useState(50), [clear, setClear] = useState(false), [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!url) { onChange(undefined); return; }
    let disposed = false; const image = new Image();
    image.onload = () => {
      if (disposed || !canvas.current) return;
      const ctx = canvas.current.getContext('2d', { willReadFrequently: true }); if (!ctx) return;
      ctx.clearRect(0, 0, 256, 256);
      const side = Math.min(image.width, image.height) / zoom;
      ctx.drawImage(image, (image.width - side) * x / 100, (image.height - side) * y / 100, side, side, 0, 0, 256, 256);
      if (clear) {
        const pixels = ctx.getImageData(0, 0, 256, 256), rgb = [...pixels.data.slice(0, 3)];
        for (let i = 0; i < pixels.data.length; i += 4) if (rgb.every((v, c) => Math.abs(v - pixels.data[i + c]) < 28)) pixels.data[i + 3] = 0;
        ctx.putImageData(pixels, 0, 0);
      }
      onChange(canvas.current.toDataURL('image/png').split(',')[1]);
    };
    image.onerror = () => setError('Cannot decode this image.'); image.src = url;
    return () => { disposed = true; };
  }, [url, zoom, x, y, clear]);
  return <div>
    <label>{t('Reference / crop image', '参考图或裁切图片')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
      const f = e.target.files?.[0]; if (!f) return;
      if (f.size > 8 * 1024 * 1024) { setError('Choose an image under 8 MB.'); return; }
      const r = new FileReader(); r.onload = () => { setUrl(String(r.result)); setZoom(1); setX(50); setY(50); setError(''); }; r.readAsDataURL(f);
    }} /></label>
    {url && <><canvas ref={canvas} width={256} height={256} style={{ width: 160, height: 160, background: 'repeating-conic-gradient(#ddd 0% 25%,#fff 0% 50%) 0/20px 20px' }} />
      {[[zoom, setZoom, 1, 4, .05, 'Zoom'], [x, setX, 0, 100, 1, 'Horizontal'], [y, setY, 0, 100, 1, 'Vertical']].map(([value, setter, min, max, step, label]: any[]) => <label key={label}>{label}<input type="range" value={value} min={min} max={max} step={step} onChange={e => setter(Number(e.target.value))} /></label>)}
      <label className="ai-check"><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} />{t('Remove flat background', '去除纯色背景')}</label>
      <button onClick={() => setUrl('')}>{t('Clear reference', '清除参考图')}</button></>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
