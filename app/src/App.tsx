import { useEffect } from 'react'
import { useStore } from './store'
import { getApi } from './api'
import { Sidebar, StatusBar, TitleBar, Toasts } from './components/Shell'
import { SideRail } from './components/Panels'
import { modeOf } from './modes'
import { LaunchView } from './views/LaunchView'
import { TaskView } from './views/TaskView'
import { CodeView } from './views/CodeView'
import { HistoryView } from './views/HistoryView'
import { KbEditor, KnowledgeView } from './views/KnowledgeView'
import { LibraryView } from './views/LibraryView'
import { AppIcon } from './components/Icon'

export function App() {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const ts = useStore((s) => s.ts)
  const init = useStore((s) => s.init)
  useEffect(() => { void getApi().then(init) }, [init])
  const sideW = useStore((s) => s.settings.sideW)
  const codeW = useStore((s) => s.settings.codeW)
  const collapsed = useStore((s) => s.settings.sideCollapsed)
  // 宽度放在根元素的 CSS 变量里：拖动把手时直接改它，松手才存
  useEffect(() => { document.documentElement.style.setProperty('--side-w', `${sideW}px`) }, [sideW])
  useEffect(() => { document.documentElement.style.setProperty('--code-w', `${codeW}px`) }, [codeW])
  // Ctrl B：收起 / 展开侧栏；Ctrl N：新任务
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl N：新任务（任务在后台照常进行；侧栏收起时也能用）
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); const st = useStore.getState(); st.setView(st.mode === 'code' ? 'code-launch' : 'launch'); return }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); const s = useStore.getState(); s.setSettings({ sideCollapsed: !s.settings.sideCollapsed }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!ready) return <div className="boot"><AppIcon size={56} /><span>AstroLab</span></div>
  // 当前任务不属于这个模式（或没有任务）时，显示这个模式的新任务页
  const cur = ts?.task ? modeOf(ts.task) : null
  const v = view === 'task' && cur !== 'task' ? 'launch' : (view === 'code' || view === 'review') && cur !== 'code' ? 'code-launch' : view === 'review' ? 'code' : view
  return (
    <div className="app">
      <div className="app-blob a" aria-hidden="true" />
      <div className="app-blob b" aria-hidden="true" />
      <TitleBar />
      <div className="app-body">
        {collapsed ? <SideRail /> : <Sidebar />}
        <div className="app-main">
          {v === 'launch' && <LaunchView />}
          {v === 'task' && <TaskView />}
          {(v === 'code' || v === 'code-launch') && <CodeView fresh={v === 'code-launch'} />}
          {v === 'history' && <HistoryView />}
          {v === 'knowledge' && <KnowledgeView />}
          {v === 'library' && <LibraryView />}
        </div>
      </div>
      <StatusBar />
      <KbEditor />
      <Toasts />
    </div>
  )
}
