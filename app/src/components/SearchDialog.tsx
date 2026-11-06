// 搜索（Ctrl K，界面设计 v2 第 9 节）：居中弹层，搜任务（标题、描述）、产出文件名、工程。
// 没输入时列最近打开的任务和几个常用入口。↑↓ 选择，Enter 打开，Tab 切换“全部工程 / 当前工程”，Esc 关闭。
// 任务和文件由主进程在本机任务记录里找（不联网）；工程在界面里按名称和路径匹配。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { useStore } from '../store'
import { Icon } from './Icon'
import { Kbd } from './Keys'
import { projectAction, visibleProjects } from './Shell'
import type { SearchResult, Task } from '../api'

interface Entry { key: string; group: string; icon: string; label: string; sub?: string; run: () => void | Promise<void> }

const when = (ms: number) => new Date(ms).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })

export function SearchDialog() {
  const open = useStore((s) => s.searchOpen)
  const setOpen = useStore((s) => s.setSearchOpen)
  return (
    <ModalOverlay className="modal-scrim search-scrim" isDismissable isOpen={open} onOpenChange={setOpen}>
      <Modal className="search-modal">
        <Dialog className="search-dialog" aria-label="搜索">{open && <SearchBody onClose={() => setOpen(false)} />}</Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function SearchBody({ onClose }: { onClose: () => void }) {
  const ts = useStore((s) => s.ts)
  const recent = useStore((s) => s.recent)
  const allProjects = useStore((s) => s.app?.projects)
  const run = useStore((s) => s.run)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const [res, setRes] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const cur = ts?.project
  const projects = useMemo(() => visibleProjects(allProjects || [], cur?.id), [allProjects, cur?.id])
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)

  // 输入停 200 ms 再搜；只用最后一次的结果
  useEffect(() => {
    if (!terms.length) { setRes(null); setBusy(false); return }
    setBusy(true)
    let stale = false
    const t = setTimeout(() => {
      void run((api) => api.task.search(q.trim(), scope), '搜索失败').then((r) => { if (!stale) { setRes(r || { tasks: [], files: [] }); setBusy(false) } })
    }, 200)
    return () => { stale = true; clearTimeout(t) }
  }, [q, scope, run]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (f: () => void | Promise<void>) => { onClose(); void f() }
  const openTask = (pid: string, t: Task) => go(() => (pid === cur?.id ? useStore.getState().openTask(t) : useStore.getState().openTaskIn(pid, t)))

  const entries: Entry[] = useMemo(() => {
    if (!terms.length) {
      // 最近的任务（所有工程，新的在前）+ 常用入口
      const rows = projects.flatMap((p) => (recent[p.id] || []).filter((t) => !t.archived && (scope === 'all' || p.id === cur?.id)).map((t) => ({ p, t })))
        .sort((a, b) => b.t.startedAt - a.t.startedAt).slice(0, 8)
      return [
        ...rows.map(({ p, t }): Entry => ({ key: `r:${p.id}:${t.id}`, group: '最近的任务', icon: 'history', label: t.title, sub: `${p.name} · ${when(t.startedAt)}`, run: () => openTask(p.id, t) })),
        { key: 'a:all', group: '常用', icon: 'history', label: '全部任务', sub: '所有工程的任务', run: () => go(() => useStore.getState().setView('history')) },
        { key: 'a:projects', group: '常用', icon: 'folder', label: '工程列表', run: () => go(() => useStore.getState().setView('projects')) },
        { key: 'a:add', group: '常用', icon: 'folderPlus', label: '打开项目文件夹…', run: () => go(() => projectAction('__add')) },
        { key: 'a:settings', group: '常用', icon: 'settings', label: '设置', sub: 'Ctrl ,', run: () => go(() => useStore.getState().openSettings()) },
      ]
    }
    const out: Entry[] = []
    for (const r of res?.tasks || []) out.push({ key: `t:${r.pid}:${r.task.id}`, group: '任务', icon: 'history', label: r.task.title, sub: `${r.pname} · ${r.task.stageName || ''} · ${when(r.task.startedAt)}`, run: () => openTask(r.pid, r.task) })
    for (const f of res?.files || []) {
      out.push({
        key: `f:${f.pid}:${f.path}`, group: '产出文件', icon: 'file', label: f.path.split('/').pop() || f.path, sub: `${f.pname} · ${f.path}`,
        // 打开产生它的任务，右边“产出”里预览这个文件
        run: () => go(async () => {
          const t = (recent[f.pid] || []).find((x) => x.id === f.taskId) || (res?.tasks || []).find((x) => x.task.id === f.taskId)?.task
          if (t) await (f.pid === cur?.id ? useStore.getState().openTask(t) : useStore.getState().openTaskIn(f.pid, t))
          else await useStore.getState().openProjectHome(f.pid)
          useStore.getState().openInCode(f.path)
        }),
      })
    }
    for (const p of projects) {
      if (scope === 'current' && p.id !== cur?.id) continue
      const hay = `${p.name}\n${p.path}`.toLowerCase()
      if (terms.every((t) => hay.includes(t))) out.push({ key: `p:${p.id}`, group: '工程', icon: 'folder', label: p.name, sub: p.path, run: () => go(() => useStore.getState().openProjectHome(p.id)) })
    }
    return out
  }, [terms.join(' '), res, scope, projects, recent, cur?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel(0) }, [q, scope, res])
  useEffect(() => { list.current?.querySelector('.search-opt.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(entries.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const x = entries[sel]; if (x) void x.run() }
    else if (e.key === 'Tab') { e.preventDefault(); setScope((s) => (s === 'all' ? 'current' : 'all')) }
  }

  let lastGroup = ''
  return (
    <div className="search-body" onKeyDown={onKey}>
      <div className="search-row">
        <Icon name="search" size={18} stroke={1.8} />
        <input autoFocus className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索任务、产出文件、工程" aria-label="搜索" aria-controls="search-list"
          aria-activedescendant={entries[sel] ? `so-${sel}` : undefined} />
        <button type="button" className={`search-scope ${scope}`} onClick={() => setScope((s) => (s === 'all' ? 'current' : 'all'))} title="Tab 切换">
          {scope === 'all' ? '全部工程' : `只搜 ${cur?.name || '当前工程'}`}
        </button>
      </div>
      <div className="search-list" id="search-list" role="listbox" ref={list} aria-label="搜索结果">
        {entries.map((x, i) => {
          const head = x.group !== lastGroup ? <div className="search-group muted small" role="presentation">{x.group}</div> : null
          lastGroup = x.group
          return (
            <div key={x.key}>
              {head}
              <div id={`so-${i}`} role="option" aria-selected={i === sel} className={`search-opt ${i === sel ? 'on' : ''}`} onMouseMove={() => setSel(i)} onClick={() => void x.run()}>
                <Icon name={x.icon} size={16} stroke={1.7} />
                <span className="search-label">{x.label}</span>
                {x.sub && <span className="search-sub muted small">{x.sub}</span>}
              </div>
            </div>
          )
        })}
        {!!terms.length && !busy && !entries.length && <div className="pad muted small">没有找到。任务按标题和任务描述找，文件按文件名找；可以试试别的词，或按 Tab 换成{scope === 'all' ? '只搜当前工程' : '全部工程'}。</div>}
        {!!terms.length && busy && !entries.length && <div className="pad muted small">正在找…</div>}
      </div>
      <div className="search-foot muted small"><Kbd>↑↓</Kbd> 选择　<Kbd>Enter</Kbd> 打开　<Kbd>Tab</Kbd> 切换范围　<Kbd>Esc</Kbd> 关闭</div>
    </div>
  )
}
