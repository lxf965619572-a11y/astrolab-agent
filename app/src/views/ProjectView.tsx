// 工程主页（界面设计 v2 第 6 节，对应 Claude 的项目页）：点侧栏的工程名进来。
//   上：在这个工程里新建任务的输入框（进来就聚焦，点工程名后可以直接写）；
//   下：这个工程的全部任务；
//   右：工程信息（路径、Git 分支、任务数）。
// 工程列表（ProjectsView）：侧栏“工程”入口，所有打开过的工程，点一行进它的主页。

import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import { Key } from '../components/Keys'
import { projectAction, visibleProjects } from '../components/Shell'
import { LaunchView } from './LaunchView'
import { ProjectTasks } from './HistoryView'
import type { Task } from '../api'

const LIVE = ['starting', 'running', 'asking']

export function ProjectView() {
  const ts = useStore((s) => s.ts)
  const run = useStore((s) => s.run)
  const histVer = useStore((s) => s.histVer)
  const bgKey = useStore((s) => (s.app?.background || []).map((b) => `${b.task.id}:${b.status}`).join())
  const [list, setList] = useState<Task[]>([])
  const p = ts?.project
  useEffect(() => { void run((api) => api.task.history()).then((h) => setList(h || [])) }, [run, p?.id, ts?.task?.id, ts?.status, ts?.task?.title, histVer, bgKey])
  if (!p) return <LaunchView />
  const active = list.filter((t) => !t.archived)
  const live = ts && LIVE.includes(ts.status) ? 1 : 0
  const review = active.filter((t) => t.status === 'done' && !t.commit).length
  const last = active[0]?.startedAt
  return (
    <div className="project-layout">
      <div className="project-main">
        <header className="project-head pad-x">
          <h1><Icon name="folder" size={22} stroke={1.7} /><span>{p.name}</span></h1>
          <div className="sub mono" title={p.path}>{p.path}{p.git && p.branch ? ` · ${p.branch}` : ''}</div>
        </header>
        <LaunchView inProject />
        <ProjectTasks list={list} />
      </div>
      <aside className="project-side" aria-label="工程信息">
        <section className="proj-card card">
          <h3>工程信息</h3>
          <dl className="proj-facts">
            <dt>路径</dt><dd className="mono" title={p.path}>{p.path}</dd>
            {p.git && <><dt>Git 分支</dt><dd className="mono">{p.branch || '—'}</dd></>}
            <dt>任务</dt><dd>{active.length} 个{live ? ` · 进行中 ${live} 个` : ''}{review ? ` · 待审核 ${review} 个` : ''}</dd>
            {last && <><dt>最近</dt><dd>{new Date(last).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd></>}
          </dl>
          <div className="proj-actions">
            <Key size="sm" onPress={() => void run((api) => api.sys.openPath('.'), '打不开文件夹')}><Icon name="folder" size={14} />打开文件夹</Key>
            <Key size="sm" variant="ghost" onPress={() => void run(async (api) => { if (api.sys.copy) await api.sys.copy(p.path); else await navigator.clipboard.writeText(p.path); return true }, '复制失败').then((ok) => { if (ok) useStore.getState().toast({ text: '路径已复制', tone: 'ok' }, 2000) })}>复制路径</Key>
          </div>
        </section>
      </aside>
    </div>
  )
}

/** 工程列表：所有打开过的（没移出列表的）工程 */
export function ProjectsView() {
  const ts = useStore((s) => s.ts)
  const all = useStore((s) => s.app?.projects) || []
  const recent = useStore((s) => s.recent)
  const loadRecent = useStore((s) => s.loadRecent)
  const bg = useStore((s) => s.app?.background) || []
  useEffect(() => { void loadRecent() }, [loadRecent])
  const cur = ts?.project?.id
  const projects = visibleProjects(all, cur)
  return (
    <div className="history-layout">
      <div className="page-head pad-x">
        <div><h1>工程</h1><div className="sub">{projects.length} 个工程 · 每个工程是一个项目文件夹，任务在里面运行</div></div>
        <Key size="sm" variant="primary" onPress={() => void projectAction('__add')}><Icon name="folderPlus" size={15} />打开项目文件夹</Key>
      </div>
      <div className="history-list card">
        {projects.map((p) => {
          const ts2 = (recent[p.id] || []).filter((t) => !t.archived)
          const running = (p.id === cur && ts && LIVE.includes(ts.status)) || bg.some((b) => b.projectId === p.id && (LIVE.includes(b.status) || b.asking))
          return (
            <Button key={p.id} className="proj-row" onPress={() => void useStore.getState().openProjectHome(p.id)}>
              <Icon name="folder" size={18} stroke={1.7} />
              <span className="proj-row-name">{p.name}{p.id === cur && <span className="pill sm idle">正在用</span>}{running && <span className="pill sm run">有任务进行中</span>}</span>
              <span className="proj-row-path mono muted small" title={p.path}>{p.path}</span>
              <span className="muted small">{ts2.length ? `${ts2.length}${ts2.length >= 12 ? '+' : ''} 个任务` : '还没有任务'}</span>
              <span className="muted small">{ts2[0] ? new Date(ts2[0].startedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : ''}</span>
            </Button>
          )
        })}
        {!projects.length && <div className="pad muted">还没有工程：点右上角“打开项目文件夹”。</div>}
      </div>
    </div>
  )
}
