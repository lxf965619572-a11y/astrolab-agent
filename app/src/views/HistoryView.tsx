// 任务列表（界面设计 v2 第 3、6 节）：
//   HistoryView  “全部任务”：所有工程的任务，按工程、研制环节类别筛选（侧栏“最近 → 查看全部”进来）；
//   ProjectTasks 工程主页下半部分：当前工程的全部任务。
// 两处共用 TaskList：点开查看（别的工程的任务先切过去），每行右边“⋯”（或右键）置顶、改名、归档、删除；归档的在“已归档”里。

import { useEffect, useMemo, useState } from 'react'
import { RenameInput, TaskMenu, visibleProjects } from '../components/Shell'
import { Button } from 'react-aria-components'
import { useStore } from '../store'
import { modeOf } from '../modes'
import type { Task } from '../api'
import { Icon, STAGE_ICON } from '../components/Icon'
import { CATEGORIES } from '../skills'
import { elapsed } from '../format'

const S: Record<string, string> = { done: '待审核', stopped: '已停止', error: '出错', running: '进行中', asking: '等你决定', starting: '启动中', interrupted: '已中断', idle: '' }
const LIVE = ['starting', 'running', 'asking']

export interface TaskRow { pid: string; pname: string; t: Task }

/** 一组任务的列表：类别筛选条 + 已归档 + 行。showProject 时多一列工程名（全部任务页） */
export function TaskList({ rows, showProject = false, empty = '还没有任务。', flat = false }: { rows: TaskRow[]; showProject?: boolean; empty?: string; flat?: boolean }) {
  const ts = useStore((s) => s.ts)
  const app = useStore((s) => s.app)
  const bg = app?.background
  const pinned = useStore((s) => s.settings.pinned)
  const setSettings = useStore((s) => s.setSettings)
  const [cat, setCat] = useState('全部')
  const [archived, setArchived] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  // 类别：新任务记在 task.category；旧任务按环节换算
  const OLD: Record<string, string> = { requirements: '需求', hld: '设计', dd: '设计', coding: '编码', utest: '测试', review: '走查', skill: '创作', plugin: '创作' }
  const catOf = (t: Task) => t.category || OLD[t.stage] || (app?.skills || []).find((x) => x.name === t.skill)?.category || '其他'
  const iconOf = (t: Task) => STAGE_ICON[t.stage] || CATEGORIES.find((c) => c.id === catOf(t))?.icon || 'file'
  const active = rows.filter((r) => !r.t.archived)
  const arch = rows.filter((r) => r.t.archived)
  const base = archived ? arch : active
  const cats = ['全部', ...CATEGORIES.map((c) => c.id).filter((c) => active.some((r) => catOf(r.t) === c))]
  const shown = archived || cat === '全部' ? base : base.filter((r) => catOf(r.t) === cat)
  useEffect(() => { if (archived && !arch.length) setArchived(false) }, [archived, arch.length])
  useEffect(() => { if (cat !== '全部' && !cats.includes(cat)) setCat('全部') }, [cat, cats])
  const curPid = ts?.project?.id
  const busy = ts ? LIVE.includes(ts.status) : false
  // 状态：当前任务看实时状态；后台任务看后台；其余看记录（记着“进行中”的其实是上次关软件时中断了）
  const statusOf = (r: TaskRow) => {
    if (r.pid === curPid && r.t.id === ts?.task?.id && ts) return { st: ts.status, live: busy }
    const b = (bg || []).find((x) => x.task.id === r.t.id)
    if (b) return { st: b.asking ? 'asking' : b.status, live: LIVE.includes(b.status) || b.asking }
    return { st: LIVE.includes(r.t.status) ? 'interrupted' : r.t.status, live: false }
  }
  // 别的工程的任务：先切到那个工程再打开；同一工程有任务进行中时只读查看（store.openTask）
  const open = (r: TaskRow) => (r.pid === curPid ? useStore.getState().openTask(r.t) : useStore.getState().openTaskIn(r.pid, r.t))
  return (
    <>
      <div className="cat-filter pad-x" role="tablist" aria-label="按类别筛选">
        {cats.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={!archived && cat === c} className={`cat-chip ${!archived && cat === c ? 'on' : ''}`} onClick={() => { setArchived(false); setCat(c) }}>
            {c}<span className="cat-n">{c === '全部' ? active.length : active.filter((r) => catOf(r.t) === c).length}</span>
          </button>
        ))}
        {!!arch.length && (
          <button type="button" role="tab" aria-selected={archived} className={`cat-chip arch ${archived ? 'on' : ''}`} onClick={() => setArchived(true)}>
            <Icon name="archive" size={12} stroke={2} />已归档<span className="cat-n">{arch.length}</span>
          </button>
        )}
      </div>
      <div className={`history-list card ${flat ? 'flat' : ''}`}>
        {shown.map((r) => {
          const { t, pid } = r
          const { st, live } = statusOf(r)
          const key = `${pid}:${t.id}`
          return (
            <div key={key} className={`hist-item ${menuFor === key ? 'menu-open' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMenuFor(key) }}>
              {renaming === key
                ? <div className="hist-row editing"><Icon name={iconOf(t)} size={18} stroke={1.7} /><RenameInput value={t.title} className="hist-rename" onDone={(v) => { setRenaming(null); if (v !== null) void useStore.getState().renameTask(pid, t, v) }} /></div>
                : <Button className={`hist-row ${showProject ? 'with-proj' : ''}`} onPress={() => void open(r)}>
                    <Icon name={iconOf(t)} size={18} stroke={1.7} />
                    <span className="hist-stage">{t.stageName}</span>
                    <span className={`hist-mode ${modeOf(t)}`}>{modeOf(t) === 'code' ? '代码' : '任务'}</span>
                    {showProject && <span className="hist-proj" title={r.pname}>{r.pname}</span>}
                    <span className="hist-title">{t.title}</span>
                    <span className="muted small">{new Date(t.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="muted small mono">{t.endedAt ? elapsed(t.endedAt - t.startedAt) : ''}</span>
                    <span className={`pill sm ${live ? (st === 'asking' ? 'ask' : 'run') : t.commit ? 'ok' : st === 'done' ? 'ok' : st === 'error' ? 'err' : 'idle'}`}>{t.commit && !live ? '已提交' : S[st] || st}</span>
                  </Button>}
              {renaming !== key && (
                <TaskMenu pid={pid} task={t} live={live} className="hist-menu-btn" isOpen={menuFor === key} onOpenChange={(o) => setMenuFor(o ? key : null)}
                  pinned={pinned.includes(t.id)} onPin={() => setSettings({ pinned: pinned.includes(t.id) ? pinned.filter((x) => x !== t.id) : [t.id, ...pinned] })}
                  onOpen={() => void open(r)} onRename={() => setRenaming(key)} />
              )}
            </div>
          )
        })}
        {!shown.length && <div className="pad muted">{active.length ? '这个类别还没有任务。' : empty}</div>}
      </div>
    </>
  )
}

/** 工程主页下半部分：当前工程的全部任务（列表由工程主页取，右栏的统计也用它） */
export function ProjectTasks({ list }: { list: Task[] }) {
  const ts = useStore((s) => s.ts)
  const p = ts?.project
  if (!p) return null
  const busy = ts ? LIVE.includes(ts.status) : false
  return (
    <section className="proj-tasks" aria-label={`${p.name} 的任务`}>
      <div className="proj-tasks-head pad-x"><h2>任务</h2><span className="muted small">{list.filter((t) => !t.archived).length} 个</span></div>
      {busy && <div className="note-line muted small pad-x"><span className="led" />任务进行中：同一工程的其他任务可以点开只读查看，等当前任务结束后再继续或审核它们</div>}
      <TaskList rows={list.map((t) => ({ pid: p.id, pname: p.name, t }))} flat empty="这个工程还没有任务：在上面的输入框里写下要做什么。" />
    </section>
  )
}

/** 全部任务：所有工程（没移出列表的）的任务，新的在前 */
export function HistoryView() {
  const run = useStore((s) => s.run)
  const ts = useStore((s) => s.ts)
  const allProjects = useStore((s) => s.app?.projects)
  const histVer = useStore((s) => s.histVer)
  const bgKey = useStore((s) => (s.app?.background || []).map((b) => `${b.task.id}:${b.status}`).join())
  const [byProject, setByProject] = useState<Record<string, Task[]>>({})
  const [proj, setProj] = useState<string>('全部')
  useEffect(() => { void run((api) => api.task.recent(500)).then((r) => setByProject(r || {})) }, [run, ts?.project?.id, ts?.task?.id, ts?.status, ts?.task?.title, histVer, bgKey])
  const projects = useMemo(() => visibleProjects(allProjects || [], ts?.project?.id).filter((p) => (byProject[p.id] || []).length), [allProjects, ts?.project?.id, byProject])
  const rows = useMemo(() => projects.flatMap((p) => (byProject[p.id] || []).map((t) => ({ pid: p.id, pname: p.name, t }))).sort((a, b) => b.t.startedAt - a.t.startedAt), [projects, byProject])
  useEffect(() => { if (proj !== '全部' && !projects.some((p) => p.id === proj)) setProj('全部') }, [proj, projects])
  const shown = proj === '全部' ? rows : rows.filter((r) => r.pid === proj)
  const total = rows.filter((r) => !r.t.archived).length
  return (
    <div className="history-layout">
      <div className="page-head pad-x">
        <div><h1>全部任务</h1><div className="sub">{projects.length} 个工程 · 共 {total} 个任务</div></div>
      </div>
      {projects.length > 1 && (
        <div className="cat-filter proj-filter pad-x" role="tablist" aria-label="按工程筛选">
          {[{ id: '全部', name: '全部工程' }, ...projects].map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={proj === p.id} className={`cat-chip ${proj === p.id ? 'on' : ''}`} onClick={() => setProj(p.id)}>
              {p.id !== '全部' && <Icon name="folder" size={12} stroke={1.8} />}{p.name}
              <span className="cat-n">{p.id === '全部' ? total : rows.filter((r) => r.pid === p.id && !r.t.archived).length}</span>
            </button>
          ))}
        </div>
      )}
      <TaskList rows={shown} showProject={proj === '全部' && projects.length > 1} />
    </div>
  )
}
