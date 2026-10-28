// 侧栏和代码面板：拖边缘调宽度（有上下限），侧栏拖到下限以下或按 Ctrl B 收成一列图标（和 Claude 一样）。
// 拖动时直接改 CSS 变量（不重绘 React），松手才存设置，所以拖起来不卡。

import { useRef } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from '../store'
import { Icon } from './Icon'

export const SIDE = { min: 200, max: 420, def: 248 }
/** 代码面板：最窄放得下文件树 + 代码；最宽时中间的对话也还留 380px（CSS 里再按窗口宽度限一次） */
export const CODE = { min: 480, max: 1400, def: 620 }

type Props = {
  /** right：把手在左边栏的右边缘（往右拖变宽）；left：把手在右边栏的左边缘（往左拖变宽） */
  edge: 'right' | 'left'
  cssVar: '--side-w' | '--code-w'
  width: number
  min: number
  max: number
  def: number
  label: string
  onDone: (w: number) => void
  /** 拖到下限以下再往里 60px 就收起（只有侧栏有） */
  onCollapse?: () => void
  /** 拖动开始时的实际宽度（被 CSS 限住时和设置里的不同） */
  widthNow?: () => number
}

export function Resizer({ edge, cssVar, width, min, max, def, label, onDone, onCollapse, widthNow }: Props) {
  const cur = useRef(width)
  const root = () => document.documentElement
  const set = (w: number) => { cur.current = w; root().style.setProperty(cssVar, `${w}px`) }
  const clamp = (w: number) => Math.max(min, Math.min(max, w))

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const x0 = e.clientX
    const w0 = Math.max(min, Math.min(max, widthNow ? widthNow() : width))
    cur.current = width
    let collapsed = false
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0
      const w = edge === 'right' ? w0 + dx : w0 - dx
      if (onCollapse && w < min - 60) {
        if (!collapsed) { collapsed = true; stop(); set(w0); onCollapse() }
        return
      }
      set(clamp(w))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.classList.remove('resizing')
      if (!collapsed) onDone(cur.current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16
    const grow = edge === 'right' ? 'ArrowRight' : 'ArrowLeft'
    const shrink = edge === 'right' ? 'ArrowLeft' : 'ArrowRight'
    if (e.key === grow) { e.preventDefault(); const w = clamp(width + step); set(w); onDone(w) }
    if (e.key === shrink) {
      e.preventDefault()
      if (onCollapse && width <= min) { onCollapse(); return }
      const w = clamp(width - step); set(w); onDone(w)
    }
    if (e.key === 'Enter') { e.preventDefault(); set(def); onDone(def) }
  }

  return (
    <div className={`resizer ${edge}`} role="separator" aria-orientation="vertical" aria-label={label}
      aria-valuenow={width} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
      title={`拖动调整宽度（${min}–${max}）· 双击恢复默认${onCollapse ? ' · 拖到最窄再往里收起' : ''}`}
      onPointerDown={onPointerDown} onDoubleClick={() => { set(def); onDone(def) }} onKeyDown={onKeyDown} />
  )
}

/** 侧栏右边缘的把手 */
export function SideResizer() {
  const w = useStore((s) => s.settings.sideW)
  const setSettings = useStore((s) => s.setSettings)
  return <Resizer edge="right" cssVar="--side-w" width={w} {...SIDE} label="侧栏宽度" onDone={(v) => setSettings({ sideW: v })} onCollapse={() => setSettings({ sideCollapsed: true })} />
}

/** 代码面板左边缘的把手 */
export function CodeResizer() {
  const w = useStore((s) => s.settings.codeW)
  const setSettings = useStore((s) => s.setSettings)
  // 实际宽度可能被窗口宽度限住（CSS 的 min()），从实际宽度开始拖，不会一拖就跳
  const real = () => (document.querySelector('.code-panel') as HTMLElement | null)?.offsetWidth || w
  return <Resizer edge="left" cssVar="--code-w" width={w} widthNow={real} {...CODE} label="代码面板宽度" onDone={(v) => setSettings({ codeW: v })} />
}

/** 侧栏收起后的一列图标：模式切换、新任务（或文件）、底部导航。点任何一个都能用，点最上面的展开 */
export function SideRail() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const ts = useStore((s) => s.ts)
  const setSettings = useStore((s) => s.setSettings)
  const code = view === 'code' || view === 'review'
  const expand = () => setSettings({ sideCollapsed: false })
  const B = ({ icon, label, on, onPress }: { icon: string; label: string; on?: boolean; onPress: () => void }) => (
    <Button className={`nav rail-btn ${on ? 'on' : ''}`} aria-label={label} aria-current={on ? 'page' : undefined} onPress={onPress}>
      <Icon name={icon} size={18} stroke={1.7} /><span className="rail-tip" aria-hidden="true">{label}</span>
    </Button>
  )
  return (
    <nav className="rail" aria-label="侧栏（已收起）">
      <B icon="sidebar" label="展开侧栏 · Ctrl B" onPress={expand} />
      <div className="rail-sep" />
      <B icon="chat" label="任务" on={!code} onPress={() => { if (code) setView(ts?.task ? 'task' : 'launch') }} />
      <B icon="coding" label="代码" on={code} onPress={() => setView('code')} />
      <div className="rail-sep" />
      <B icon="newTask" label="新任务 · Ctrl N" on={view === 'launch'} onPress={() => setView(code ? 'code' : 'launch')} />
      <span className="grow" />
      <B icon="book" label="知识库" on={view === 'knowledge'} onPress={() => setView('knowledge')} />
      <B icon="puzzle" label="技能与插件" on={view === 'library'} onPress={() => setView('library')} />
      <B icon="history" label="全部任务" on={view === 'history'} onPress={() => setView('history')} />
    </nav>
  )
}

/** 展开的侧栏顶上：模式切换 + 收起按钮 */
export function CollapseButton() {
  const setSettings = useStore((s) => s.setSettings)
  return (
    <Button className="side-collapse" aria-label="收起侧栏（Ctrl B）" onPress={() => setSettings({ sideCollapsed: true })}>
      <Icon name="sidebar" size={17} stroke={1.7} /><span className="rail-tip" aria-hidden="true">收起 · Ctrl B</span>
    </Button>
  )
}
