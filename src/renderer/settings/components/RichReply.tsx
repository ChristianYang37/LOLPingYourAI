import { memo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// Raw HTML stays inert. Remote images are links, never silently fetched from
// model output. Math is rendered without trusted commands or unbounded macros.
export const RichReply = memo(function RichReply({ text }: { text: string }) {
  return <div className="reply-text markdown-reply"><Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, strict: 'warn', maxExpand: 200, maxSize: 20 }]]} skipHtml components={{
    img: ({ alt }) => <span className="omitted-image">[{alt || 'Image'}]</span>,
    a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href && /^https?:\/\//i.test(href)) void window.teammateApi.call('openLink', { url: href }); }} rel="noreferrer noopener">{children}</a>,
  }}>{text}</Markdown></div>;
});
