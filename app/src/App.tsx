import { useEffect } from 'react'
import { useStore } from './store'
import { getApi } from './api'
import { Sidebar, StatusBar, TitleBar, Toasts } from './components/Shell'
import { LaunchView } from './views/LaunchView'
import { TaskView } from './views/TaskView'
import { ReviewView } from './views/ReviewView'
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
  if (!ready) return <div className="boot"><AppIcon size={56} /><span>AstroLab</span></div>
  const v = (view === 'task' || view === 'review') && !ts?.task ? 'launch' : view
  return (
    <div className="app">
      <div className="app-blob a" aria-hidden="true" />
      <div className="app-blob b" aria-hidden="true" />
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          {v === 'launch' && <LaunchView />}
          {v === 'task' && <TaskView />}
          {v === 'review' && <ReviewView />}
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
