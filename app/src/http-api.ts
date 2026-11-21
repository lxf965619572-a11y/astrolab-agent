// 网页入口的接口实现：在浏览器里经 http://IP:端口 打开工作台时用它（main/web.mjs）。
// 接口表由主进程给（和桌面 preload 的同一份），每个方法变成 POST /api/invoke；事件走 /api/events（Server-Sent Events）。
// 和桌面不同的几处：选项目文件夹改为输入这台电脑上的路径；“用默认程序打开”“在文件夹中显示”改为下载；
// HTML 预览走 /preview/；复制在非 https 页面里退回老办法；标题栏颜色不用设。

import type { AstroApi, AstroEvent } from './api'

type Fn = (...args: unknown[]) => Promise<unknown>

async function invoke(channel: string, ...args: unknown[]) {
  const r = await fetch('/api/invoke', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-astrolab': '1' },
    body: JSON.stringify({ channel, args }),
  })
  if (r.status === 401) { location.href = '/login'; throw new Error('登录已过期，请重新登录') }
  if (!r.ok) throw new Error(`请求失败（${r.status}）`)
  const j = await r.json()
  if (!j.ok) throw new Error(j.error || '操作失败')
  return j.data
}

/** 复制：https 和本机地址用剪贴板接口；局域网的 http 页面不给用，退回 execCommand */
async function copyText(text: string) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return } } catch { /* 退回老办法 */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

function download(pid: string | undefined, rel: string) {
  const q = new URLSearchParams({ rel })
  if (pid) q.set('pid', pid)
  const a = document.createElement('a')
  a.href = `/api/file?${q}`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** 是不是从网页入口打开的：能拿到接口表就是；没登录跳到登录页；不是（例如单独看界面）返回 null，改用模拟实现 */
export async function createHttpApi(): Promise<AstroApi | null> {
  let r: Response
  try { r = await fetch('/api/manifest', { credentials: 'same-origin' }) } catch { return null }
  if (r.status === 401) { location.href = '/login'; return new Promise(() => {}) }
  if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null
  const { map, platform } = await r.json() as { map: Record<string, string>; platform: string }
  const api: Record<string, unknown> = { platform, viaWeb: true }
  for (const [name, channel] of Object.entries(map)) {
    const [group, method] = name.includes('.') ? name.split('.') : [null, name]
    const f: Fn = (...args) => invoke(channel, ...args)
    if (!group) api[method] = f
    else ((api[group] ||= {}) as Record<string, Fn>)[method] = f
  }
  const project = api.project as Record<string, Fn>
  const sys = (api.sys ||= {}) as Record<string, unknown>
  // 浏览器里弹不出这台电脑的选文件夹对话框：输入路径
  project.add = async () => {
    const dir = window.prompt('输入运行工作台的这台电脑上的项目文件夹路径，例如 D:\\work\\g3-pdus')
    if (!dir || !dir.trim()) return null
    return invoke('project:addPath', dir.trim())
  }
  sys.copy = (text: string) => copyText(text)
  sys.titlebar = async () => {}
  sys.previewUrl = (rel: string) => `/preview/${String(rel).split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`
  sys.openPath = async (rel: string) => download(undefined, rel)
  sys.showItem = async (rel: string) => download(undefined, rel)
  sys.openIn = async (pid: string, rel: string) => download(pid, rel)
  api.onEvent = (cb: (e: AstroEvent) => void) => {
    const es = new EventSource('/api/events')
    es.onmessage = (m) => { try { cb(JSON.parse(m.data)) } catch { /* 不是事件 */ } }
    return () => es.close()
  }
  return api as unknown as AstroApi
}
