// 智能体的回复按 Markdown 显示。不允许内嵌 HTML，输出再过一遍 DOMPurify；链接不跳转（离线、也不打开外部页面）。

import { useMemo } from 'react'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false })

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(md.render(text || ''), { FORBID_TAGS: ['style', 'img'], FORBID_ATTR: ['style'] }), [text])
  return <div className={`md ${className}`} onClick={(e) => { if ((e.target as HTMLElement).closest('a')) e.preventDefault() }} dangerouslySetInnerHTML={{ __html: html }} />
}
