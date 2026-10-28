// 文件“看渲染后的样子”：Markdown 排版、SVG 当图片、HTML（比如信息流插件的交互版）放进隔离的预览框。
// HTML 走主进程的 astro-preview: 地址（带自己的 CSP：页面脚本能跑，但连不了网），iframe 不给 allow-same-origin，碰不到工作台。

import { useMemo } from 'react'
import { useStore } from '../store'
import { Markdown } from './Markdown'

export const RENDERABLE = /\.(md|svg|html?)$/i

export function FileRender({ path, text, version = 0 }: { path: string; text: string; version?: number }) {
  const api = useStore((s) => s.api)
  const svgUrl = useMemo(() => (/\.svg$/i.test(path) && text ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}` : ''), [path, text])
  // 文件变了（智能体又写了一次）就换个地址重新加载
  const htmlUrl = useMemo(() => (/\.html?$/i.test(path) && api?.sys.previewUrl ? api.sys.previewUrl(path) : ''), [path, api, version, text]) // eslint-disable-line react-hooks/exhaustive-deps
  if (/\.md$/i.test(path)) return <div className="fp-md"><Markdown text={text} /></div>
  if (svgUrl) return <div className="fp-img"><img src={svgUrl} alt={path.split('/').pop()} /></div>
  if (/\.html?$/i.test(path)) {
    return htmlUrl
      ? <iframe className="fp-html" title={`预览 ${path.split('/').pop()}`} src={htmlUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" />
      : (<div className="fp-html-wrap">
          <div className="fp-html-note">浏览器里打开的界面预览：页面脚本不运行（在软件里能交互）</div>
          <iframe className="fp-html" title={`预览 ${path.split('/').pop()}`} srcDoc={text} sandbox="" />
        </div>)
  }
  return null
}
