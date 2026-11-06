// 外壳：标题栏（玻璃，可拖动窗口）、任务侧栏、状态栏、提示条。

import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Heading, Menu, MenuItem, MenuTrigger, Modal, ModalOverlay, Popover, Separator } from 'react-aria-components'
import { AnimatePresence, motion } from 'motion/react'
import { useStore, type Theme } from '../store'
import type { BgTask, Project, Task, UpdateState } from '../api'
import { AppIcon, Icon } from './Icon'
import { play } from '../sound'
import { modeOf } from '../modes'
import { CollapseButton, SideResizer } from './Panels'
import { Key } from './Keys'
import { clock } from '../format'

/** 切换项目（工作区）或打开新的项目文件夹；标题栏和发起页输入框下面的工作区共用 */
export async function projectAction(key: string) {
  const st = useStore.getState()
  if (key === '__add') {
    const s = await st.run((api) => api.project.add(), '打开项目失败')
    if (s) useStore.getState().applyAppState(s)
    return
  }
  if (key !== st.ts?.project?.id) await st.openProject(key)
}

// 标题栏只放品牌和拖动区（和 Claude 一样）；模型状态、更新、皮肤、提示音在侧栏底部的账户区和设置页
export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="tb-brand"><AppIcon size={26} /><span className="tb-name">AstroLab</span></div>
      <div className="tb-drag" />
      <div className="tb-controls-space" />
    </header>
  )
}

/** 模型状态的一句话：账户区菜单和设置页用 */
export function modelText(app: { mock: boolean; engineReady: boolean; model: { model: string; hasKey: boolean } } | null) {
  if (!app) return { ok: false, text: '' }
  const ok = app.engineReady && (app.mock || app.model.hasKey)
  const text = app.mock ? '模拟引擎（不调用模型）' : !app.engineReady ? '引擎未安装' : !app.model.hasKey ? '模型未配置' : `部门模型 · ${app.model.model}`
  return { ok, text }
}

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`

/** 软件更新面板：设置页“关于与更新”里用 */
export function UpdatePanel({ up, busy }: { up: UpdateState; busy: boolean }) {
  const [err, setErr] = useState('')
  const act = async (f: (api: NonNullable<ReturnType<typeof useStore.getState>['api']>) => Promise<unknown>) => {
    const api = useStore.getState().api
    if (!api) return
    setErr('')
    try { await f(api) } catch (e) { setErr(e instanceof Error ? e.message : String(e)); play('error') }
  }
  const c = up.check
  const p = up.progress
  return (
    <>
      <div className="up-head"><span className="strong">AstroLab</span><span className="mono muted">{up.version}</span></div>
      {up.configured
        ? <div className="up-dir muted small">更新位置 <span className="mono">{up.dir}</span></div>
        : <div className="up-dir muted small">还没有配置更新位置：在设置文件 local.env 里填 <span className="mono">ASTROLAB_UPDATE_DIR</span>（部门的共享文件夹），填好后点“检查更新”。</div>}
      {up.last && !up.last.ok && <div className="badge-warn up-note"><Icon name="warn" size={14} />上次更新到 {up.last.to} 没有成功，已经换回原来的版本：{up.last.error}</div>}

      <div className="up-body">
        {up.working === 'check' && <div className="muted">正在检查…</div>}
        {up.working === 'stage' && (
          <div className="up-progress">
            <div className="up-bar"><i style={{ width: `${p && p.totalBytes ? Math.round((100 * p.bytes) / p.totalBytes) : p && p.total ? Math.round((100 * p.files) / p.total) : 3}%` }} /></div>
            <div className="muted small">{p ? `正在复制 ${p.files}/${p.total} 个文件（${mb(p.bytes)} / ${mb(p.totalBytes)}）` : '正在比较两个版本…'}</div>
          </div>
        )}
        {up.working === 'apply' && <div className="muted">正在退出并更新，换完文件会自动重新打开</div>}
        {!up.working && up.staged && (
          <>
            <div><span className="strong">{up.staged.version} 已准备好</span><span className="muted small">　换 {up.staged.changed} 个文件{up.staged.removed ? `，删 ${up.staged.removed} 个` : ''}</span></div>
            {up.staged.notes && <div className="up-notes">{up.staged.notes}</div>}
            <div className="muted small">更新时软件会关闭再打开。你的任务记录、设置和技能库不受影响。</div>
            <div className="up-actions">
              <Key size="sm" variant="primary" isDisabled={busy} onPress={() => void act((api) => api.update.apply())}><Icon name="refresh" size={14} stroke={2} />重启并更新</Key>
              {busy && <span className="muted small">任务还在进行，结束或停止后再更新</span>}
            </div>
          </>
        )}
        {!up.working && !up.staged && c?.available && c.latest && (
          <>
            <div><span className="strong">新版本 {c.latest.version}</span>{c.latest.date && <span className="muted small">　{c.latest.date.slice(0, 10)}</span>}</div>
            {c.latest.notes && <div className="up-notes">{c.latest.notes}</div>}
            <div className="up-actions">
              <Key size="sm" variant="primary" isDisabled={!up.installed} onPress={() => void act((api) => api.update.stage())}><Icon name="download" size={14} stroke={2} />下载更新</Key>
              {!up.installed && <span className="muted small">开发环境用 git pull 更新</span>}
            </div>
          </>
        )}
        {!up.working && !up.staged && c && !c.available && (c.error
          ? <div className="muted small">上次检查没有成功：{c.error}</div>
          : <div className="muted small"><Icon name="check" size={13} stroke={2.4} className="ok-ink" /> 已是最新版本 · {clock(c.at)} 检查</div>)}
        {err && <div className="up-err small">{err}</div>}
      </div>
      <div className="up-foot">
        <Key size="sm" isDisabled={!!up.working || !up.configured} onPress={() => void act((api) => api.update.check())}>检查更新</Key>
      </div>
    </>
  )
}

export const THEMES: { id: Theme; name: string; desc: string; sw: [string, string, string] }[] = [
  { id: 'lavender', name: '浅紫', desc: '冷静的浅紫，默认', sw: ['#F3F1F9', '#C4B5FD', '#8B7CF6'] },
  { id: 'cream', name: '奶油', desc: '暖奶油面板，钴蓝点缀', sw: ['#E8E2D8', '#F5F1EA', '#2F45D8'] },
  { id: 'mars', name: '黑橙', desc: '纯黑底，火星橙线框', sw: ['#060504', '#2A140A', '#FF6A1F'] },
]

const NOBG: BgTask[] = []
const NOPROJ: Project[] = []
const statusText: Record<string, string> = { starting: '启动中', running: '进行中', asking: '等你决定', done: '待审核', stopped: '已停止', error: '出错', interrupted: '已中断', idle: '' }

/** 侧栏和工作区菜单里列哪些工作区：没移出列表的；“我的库”只在正在用时列出。置顶的在前，其余按加进来的先后（新的在前），切换时位置不跳 */
export function visibleProjects(list: Project[], curId?: string) {
  return list.filter((p) => !p.hidden && (!p.library || p.id === curId))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.addedAt || 0) - (a.addedAt || 0) || a.name.localeCompare(b.name))
}

const LIVE = ['starting', 'running', 'asking']

// 侧栏（和 Claude 一样，尽量少字；界面设计 v2 第 4 节）：
//   顶上一行：收起按钮 + 模式切换；
//   入口：新任务、工程、知识库、技能与插件（一行一个，不加粗不浮起）；
//   分组：置顶的任务 / 工程（每个工程一行，下面缩进列它最近的任务） / 最近（所有工程），组名可以点击折叠（记住）。
//   工程是容器：点工程名进工程主页（新建 + 它的全部任务），所以工程下面不放“查看全部”；
//   最近是时间线：末尾放“查看全部”去全部任务。只有一个工程有任务时不显示最近（和工程下面那几条重复）。
// 任务一行只放标题；状态只在需要注意时才在右边亮一个小点，环节和状态的文字放在悬停提示里。
// 悬停时右边出现“⋯”：任务可以置顶；工作区可以置顶、在里面新建任务、移出列表。
export function Sidebar() {
  const ts = useStore((s) => s.ts)
  const view = useStore((s) => s.view)
  const mode = useStore((s) => s.mode)
  const setView = useStore((s) => s.setView)
  const pinned = useStore((s) => s.settings.pinned)
  const fold = useStore((s) => s.settings.sideFold)
  const setSettings = useStore((s) => s.setSettings)
  const allProjects = useStore((s) => s.app?.projects) || NOPROJ
  const recent = useStore((s) => s.recent)
  const loadRecent = useStore((s) => s.loadRecent)
  const bg = useStore((s) => s.app?.background) || NOBG
  const peekId = useStore((s) => (s.view === 'peek' ? s.peek?.task.id : null))
  const cur = ts?.project || null
  const curId = ts?.task?.id
  const busy = ts ? LIVE.includes(ts.status) : false
  const bgKey = bg.map((b) => `${b.task.id}:${b.status}:${b.asking}`).join()
  useEffect(() => { void loadRecent() }, [loadRecent, cur?.id, curId, ts?.status, ts?.task?.commit?.sha, bgKey, allProjects.length])

  const projects = visibleProjects(allProjects, cur?.id)
  const pinSet = new Set(pinned)
  const newView = mode === 'code' ? 'code-launch' : 'launch'
  const togglePin = (id: string) => setSettings({ pinned: pinSet.has(id) ? pinned.filter((x) => x !== id) : [id, ...pinned] })
  const toggleFold = (k: string) => setSettings({ sideFold: fold.includes(k) ? fold.filter((x) => x !== k) : [...fold, k] })

  // 一个工作区的任务：记录 + 当前任务 + 后台进行中的任务（可能还没写进记录），只要这个模式的，新的在前
  const tasksOf = (pid: string) => {
    let list = recent[pid] || []
    if (pid === cur?.id && ts?.task && !list.some((t) => t.id === curId)) list = [ts.task, ...list]
    for (const b of bg) if (b.projectId === pid && !list.some((t) => t.id === b.task.id)) list = [b.task as Task, ...list]
    return list.filter((t) => modeOf(t) === mode && !t.archived).sort((a, b) => b.startedAt - a.startedAt)
  }
  const byProject = new Map(projects.map((p) => [p.id, tasksOf(p.id)]))
  const all = projects.flatMap((p) => (byProject.get(p.id) || []).map((t) => ({ pid: p.id, pname: p.name, t })))
  const pinItems = all.filter((x) => pinSet.has(x.t.id))
  const recentItems = all.filter((x) => !pinSet.has(x.t.id)).sort((a, b) => b.t.startedAt - a.t.startedAt).slice(0, 10)
  // 只有一个工程有任务时，最近和工程下面那几条是同一批，不显示
  const showRecent = !!recentItems.length && projects.filter((p) => (byProject.get(p.id) || []).length).length > 1

  // 任务的状态：当前任务看实时状态；后台任务看后台；其余看记录（记着“进行中”的其实是上次关软件时中断了）
  const statusOf = (t: Task) => {
    if (t.id === curId && ts) return { st: ts.status, committed: !!ts.task?.commit, live: busy }
    const b = bg.find((x) => x.task.id === t.id)
    if (b) return { st: b.asking ? 'asking' : b.status, committed: false, live: LIVE.includes(b.status) || b.asking }
    return { st: LIVE.includes(t.status) ? 'interrupted' : t.status, committed: !!t.commit, live: false }
  }

  const row = (pid: string, pname: string, t: Task, nested = false) => {
    const { st, committed, live } = statusOf(t)
    const on = (t.id === curId && pid === cur?.id && ['task', 'code'].includes(view)) || peekId === t.id
    const word = live ? (st === 'asking' ? '等你决定' : statusText[st]) : committed ? '已提交' : statusText[st] || ''
    const other = pid !== cur?.id
    return (
      <SideRow key={`${pid}:${t.id}`} title={t.title} on={on} nested={nested}
        hint={[other && !nested ? pname : '', t.stageName, word].filter(Boolean).join(' · ')}
        mark={<StatusMark status={live ? st : committed ? 'committed' : st} />}
        menu={{ pid, task: t, live, pinned: pinSet.has(t.id), onPin: () => togglePin(t.id) }}
        onPress={() => void (other ? useStore.getState().openTaskIn(pid, t) : useStore.getState().openTask(t))} />
    )
  }

  return (
    <nav className="sidebar side3" aria-label="任务">
      <SideTop />
      <div className="side-nav">
        <Button className={`nav s-nav ${view === newView ? 'on' : ''}`} onPress={() => setView(newView)}>
          <Icon name="newTask" size={16} stroke={1.8} /><span className="nav-name">{mode === 'code' ? '新的代码任务' : '新任务'}</span><span className="side-kbd">Ctrl N</span>
        </Button>
        <Button className="nav s-nav" onPress={() => useStore.getState().setSearchOpen(true)}><Icon name="search" size={16} stroke={1.7} /><span className="nav-name">搜索</span><span className="side-kbd">Ctrl K</span></Button>
        <Button className={`nav s-nav ${view === 'projects' ? 'on' : ''}`} onPress={() => setView('projects')}><Icon name="folder" size={16} stroke={1.7} /><span className="nav-name">工程</span></Button>
        <Button className={`nav s-nav ${view === 'knowledge' ? 'on' : ''}`} onPress={() => setView('knowledge')}><Icon name="book" size={16} stroke={1.7} /><span className="nav-name">知识库</span></Button>
        <Button className={`nav s-nav ${view === 'library' ? 'on' : ''}`} onPress={() => setView('library')}><Icon name="puzzle" size={16} stroke={1.7} /><span className="nav-name">技能与插件</span></Button>
      </div>
      <div className="side-scroll">
        {/* 正在运行的任务属于另一个模式：给个入口，不然切过来就看不到它了 */}
        {busy && ts?.task && modeOf(ts.task) !== mode && (
          <Button className="nav s-row side-elsewhere" onPress={() => setView(modeOf(ts.task!) === 'code' ? 'code' : 'task')} aria-label={`${ts.task.title}，在${modeOf(ts.task) === 'code' ? '代码' : '任务'}模式里进行中`}>
            <span className="led" /><span className="s-title">{ts.task.title}</span><span className="s-tag">{modeOf(ts.task) === 'code' ? '代码' : '任务'}模式</span>
          </Button>
        )}
        {!!pinItems.length && (
          <SideSection id="pinned" label="置顶" folded={fold.includes('pinned')} onToggle={toggleFold}>{pinItems.map((x) => row(x.pid, x.pname, x.t))}</SideSection>
        )}
        <SideSection id="ws" label="工程" folded={fold.includes('ws')} onToggle={toggleFold}
          action={<Button className="s-sec-add" aria-label="打开项目文件夹" onPress={() => void projectAction('__add')}><Icon name="plus" size={14} stroke={2} /><span className="rail-tip" aria-hidden="true">打开项目文件夹</span></Button>}>
          {projects.map((p) => {
            const isCur = p.id === cur?.id
            const ts2 = byProject.get(p.id) || []
            const max = isCur ? 5 : 3
            const live = bg.some((b) => b.projectId === p.id && (LIVE.includes(b.status) || b.asking))
            const asking = bg.some((b) => b.projectId === p.id && (b.asking || b.status === 'asking'))
            const folded = fold.includes(`p:${p.id}`)
            return (
              <div key={p.id} className={`s-proj ${isCur ? 'cur' : ''}`}>
                <ProjRow project={p} cur={isCur} on={isCur && view === 'project'} folded={folded} count={ts2.length} live={live} asking={asking}
                  onToggle={() => toggleFold(`p:${p.id}`)}
                  onOpen={() => void useStore.getState().openProjectHome(p.id)} />
                {!folded && ts2.slice(0, max).map((t) => row(p.id, p.name, t, true))}
              </div>
            )
          })}
          {!projects.length && (
            <Button className="nav s-row s-more" onPress={() => void projectAction('__add')}><Icon name="folderPlus" size={15} /><span className="s-title">打开项目文件夹…</span></Button>
          )}
        </SideSection>
        {showRecent && (
          <SideSection id="recent" label="最近" folded={fold.includes('recent')} onToggle={toggleFold}>
            {recentItems.map((x) => row(x.pid, x.pname, x.t))}
            <Button className={`nav s-row s-more ${view === 'history' ? 'on' : ''}`} onPress={() => setView('history')}><span className="s-title">查看全部</span></Button>
          </SideSection>
        )}
        {!all.length && !!projects.length && <div className="side-empty muted small">{mode === 'code' ? '还没有代码任务。编码、单元测试、代码走查在这里做。' : '还没有任务。需求、设计、文档和图在这里做。'}</div>}
      </div>
      <AccountRow />
      <SideResizer />
    </nav>
  )
}

/** 工作区一行：文件夹图标（悬停变成折叠箭头）+ 名字 + 分支；右边“⋯”：新任务、置顶、移出列表 */
function ProjRow({ project: p, cur, on, folded, count, live, asking, onToggle, onOpen }: { project: Project; cur: boolean; on: boolean; folded: boolean; count: number; live: boolean; asking: boolean; onToggle: () => void; onOpen: () => void }) {
  const pin = useStore((s) => s.pinProject)
  const hide = useStore((s) => s.hideProject)
  return (
    <div className={`s-item has-menu s-proj-row ${cur ? 'cur' : ''} ${on ? 'on' : ''}`}>
      <Button className="nav s-row s-proj-head" onPress={onOpen} aria-label={cur ? `工程 ${p.name}（正在用），打开工程主页` : `切到工程 ${p.name}，打开工程主页`} aria-current={on ? 'page' : undefined}>
        <span className="s-proj-ico"><Icon name="folder" size={15} stroke={1.7} /></span>
        <span className="s-title" title={p.path}>{p.name}</span>
        {cur && p.git && p.branch && <span className="s-branch mono">{p.branch}</span>}
        <span className="s-mark-slot">{live && <span className={`led s-mark ${asking ? 'ask' : ''}`} aria-hidden="true" />}{!live && p.pinned && <Icon name="pin" size={12} stroke={1.8} className="s-pin" />}</span>
      </Button>
      {count > 0 && (
        <Button className="s-fold-btn" onPress={onToggle} aria-label={folded ? `展开 ${p.name} 的任务` : `收起 ${p.name} 的任务`} aria-expanded={!folded}>
          <Icon name="chevron" size={12} stroke={2.2} className={folded ? 'r' : ''} />
        </Button>
      )}
      <MenuTrigger>
        <Button className="s-menu-btn" aria-label={`${p.name} 的更多操作`}><Icon name="more" size={16} stroke={2.6} /></Button>
        <Popover className="menu-pop cmp-menu" placement="bottom start">
          <Menu className="menu" aria-label="工程操作" disabledKeys={cur ? ['hide'] : ['folder']} onAction={(k) => {
            if (k === 'new') onOpen()
            if (k === 'folder') void useStore.getState().run((api) => api.sys.openPath('.'), '打不开文件夹')
            if (k === 'pin') void pin(p.id, !p.pinned)
            if (k === 'hide') void hide(p.id)
          }}>
            <MenuItem id="new" className="menu-item" textValue="在这里新建任务"><Icon name="newTask" size={15} /><span className="menu-text">在这里新建任务</span></MenuItem>
            <MenuItem id="pin" className="menu-item" textValue={p.pinned ? '取消置顶' : '置顶'}><Icon name="pin" size={15} /><span className="menu-text">{p.pinned ? '取消置顶' : '置顶'}</span></MenuItem>
            <MenuItem id="folder" className="menu-item" textValue="打开文件夹"><Icon name="folder" size={15} /><span className="menu-text">打开文件夹{!cur && <small>先切到这个工程</small>}</span></MenuItem>
            <Separator className="menu-sep" />
            <MenuItem id="hide" className="menu-item" textValue="移出列表"><Icon name="x" size={15} /><span className="menu-text">移出列表<small>{cur ? '正在用的工作区不能移出' : '文件夹和任务记录都保留，重新打开就回来'}</small></span></MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  )
}

/** 可折叠的分组：组名一行，点一下收起 / 展开（和 Claude 的 Pinned ▾ / Recents ▾ 一样） */
function SideSection({ id, label, extra, action, folded, onToggle, children }: { id: string; label: string; extra?: React.ReactNode; action?: React.ReactNode; folded: boolean; onToggle: (id: string) => void; children: React.ReactNode }) {
  return (
    <section className={`s-sec ${folded ? 'folded' : ''}`}>
      <button type="button" className="s-sec-head" aria-expanded={!folded} onClick={() => onToggle(id)}>
        <span>{label}</span>{extra}<Icon name="chevron" size={12} stroke={2} className="s-sec-chev" />
      </button>
      {action && <span className="s-sec-action">{action}</span>}
      {!folded && <div className="s-sec-body">{children}</div>}
    </section>
  )
}

/** 右边的小状态点：只在需要注意时出现 */
function StatusMark({ status }: { status: string }) {
  if (status === 'running' || status === 'starting') return <span className="led s-mark" aria-hidden="true" />
  if (status === 'asking') return <span className="led ask s-mark" aria-hidden="true" />
  if (status === 'error') return <span className="dot st-error s-mark" aria-hidden="true" />
  if (status === 'interrupted') return <span className="dot st-interrupted s-mark" aria-hidden="true" />
  if (status === 'done') return <span className="s-ring s-mark" aria-hidden="true" />
  return null
}

/** 侧栏里的一行任务：标题 + 右边状态点；悬停换成“⋯”菜单，右键也能打开；改名时标题变成输入框 */
function SideRow({ title, hint, mark, on, nested, onPress, menu }: { title: string; hint: string; mark: React.ReactNode; on?: boolean; nested?: boolean; onPress: () => void; menu?: { pid: string; task: Task; live: boolean; pinned: boolean; onPin: () => void } }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  if (editing && menu) {
    return (
      <div className={`s-item editing ${nested ? 'nested' : ''}`}>
        <RenameInput value={menu.task.title} className="s-rename" onDone={(v) => { setEditing(false); if (v !== null) void useStore.getState().renameTask(menu.pid, menu.task, v) }} />
      </div>
    )
  }
  return (
    <div className={`s-item ${on ? 'on' : ''} ${nested ? 'nested' : ''} ${menu ? 'has-menu' : ''}`}
      onContextMenu={menu ? (e) => { e.preventDefault(); setOpen(true) } : undefined}>
      <Button className="nav s-row" onPress={onPress} aria-label={`${title}，${hint}`} aria-current={on ? 'page' : undefined}>
        <span className="s-title" title={`${title}\n${hint}\n右键或“⋯”：置顶、改名、归档、删除`}>{title}</span>
        <span className="s-mark-slot">{mark}</span>
      </Button>
      {menu && <TaskMenu {...menu} isOpen={open} onOpenChange={setOpen} onOpen={onPress} onRename={() => setEditing(true)} />}
    </div>
  )
}

const MENU_KEYS: Record<string, string> = { p: 'pin', r: 'rename', a: 'archive', d: 'delete' }

/** 任务的“⋯”菜单（和 Claude 一样）：打开、置顶、重命名、归档、删除；菜单开着时按 P / R / A / D 直接执行。
 *  侧栏和任务历史共用。删除前要确认；进行中的任务不能删。 */
export function TaskMenu({ pid, task, live, pinned, onPin, onOpen, onRename, isOpen, onOpenChange, className = 's-menu-btn' }: {
  pid: string; task: Task; live: boolean; pinned?: boolean; onPin?: () => void; onOpen?: () => void; onRename: () => void
  isOpen?: boolean; onOpenChange?: (o: boolean) => void; className?: string
}) {
  const [own, setOwn] = useState(false)
  const open = isOpen ?? own
  const setOpen = onOpenChange ?? setOwn
  const act = (k: string) => {
    setOpen(false)
    const st = useStore.getState()
    if (k === 'open') onOpen?.()
    if (k === 'pin' && onPin) onPin()
    // 等菜单关掉、焦点回到按钮以后再出输入框，不然输入框一出来就被抢走焦点
    if (k === 'rename') setTimeout(onRename, 30)
    if (k === 'archive') void st.archiveTask(pid, task, !task.archived)
    if (k === 'delete' && !live) {
      st.askConfirm({
        title: '删除这个任务？', ok: '删除', danger: true,
        body: `“${task.title}”的对话记录会被删除，不能恢复。项目里的文件、Git 提交和快照都不受影响。只想让它不出现在侧栏，可以用“归档”。`,
        run: () => st.removeTask(pid, task),
      })
    }
  }
  const disabled = [...(live ? ['delete'] : []), ...(onPin ? [] : ['pin'])]
  return (
    <MenuTrigger isOpen={open} onOpenChange={setOpen}>
      <Button className={className} aria-label={`${task.title} 的更多操作`}><Icon name="more" size={16} stroke={2.6} /></Button>
      <Popover className="menu-pop cmp-menu task-menu" placement="bottom start">
        <div onKeyDownCapture={(e) => {
          if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
          const k = MENU_KEYS[e.key.toLowerCase()]
          if (k && !disabled.includes(k)) { e.preventDefault(); e.stopPropagation(); act(k) }
        }}>
          <Menu className="menu" aria-label="任务操作" disabledKeys={disabled} onAction={(k) => act(String(k))}>
            {onOpen && <MenuItem id="open" className="menu-item" textValue="打开"><Icon name="arrow" size={15} /><span className="menu-text">打开</span></MenuItem>}
            {onOpen && <Separator className="menu-sep" />}
            <MenuItem id="pin" className="menu-item" textValue={pinned ? '取消置顶' : '置顶'}><Icon name="pin" size={15} /><span className="menu-text">{pinned ? '取消置顶' : '置顶'}</span><span className="menu-kbd">P</span></MenuItem>
            <MenuItem id="rename" className="menu-item" textValue="重命名"><Icon name="edit" size={15} /><span className="menu-text">重命名</span><span className="menu-kbd">R</span></MenuItem>
            <Separator className="menu-sep" />
            <MenuItem id="archive" className="menu-item" textValue={task.archived ? '取消归档' : '归档'}><Icon name="archive" size={15} /><span className="menu-text">{task.archived ? '取消归档' : '归档'}</span><span className="menu-kbd">A</span></MenuItem>
            <MenuItem id="delete" className="menu-item danger" textValue="删除"><Icon name="trash" size={15} /><span className="menu-text">删除{live && <small>任务进行中，先停止再删除</small>}</span><span className="menu-kbd">D</span></MenuItem>
          </Menu>
        </div>
      </Popover>
    </MenuTrigger>
  )
}

/** 改名输入框：Enter 或点别处保存，Esc 取消；空的或没改就当取消 */
export function RenameInput({ value, onDone, className = '' }: { value: string; onDone: (v: string | null) => void; className?: string }) {
  const [v, setV] = useState(value)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const t = v.replace(/\s+/g, ' ').trim()
    onDone(save && t && t !== value ? t : null)
  }
  return (
    <input className={`rename-input ${className}`} value={v} autoFocus maxLength={120} aria-label="任务名称"
      onFocus={(e) => e.currentTarget.select()} onChange={(e) => setV(e.target.value)} onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true) }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false) }
      }} />
  )
}

/** 需要确认的操作（删除任务）：store.askConfirm 打开 */
export function ConfirmDialog() {
  const c = useStore((s) => s.confirm)
  const close = useStore((s) => s.closeConfirm)
  const [busy, setBusy] = useState(false)
  return (
    <ModalOverlay className="modal-scrim" isDismissable={!busy} isOpen={!!c} onOpenChange={(o) => { if (!o && !busy) close() }}>
      <Modal className="modal">
        <Dialog className="modal-dialog" role="alertdialog">
          {c && (<>
            <Heading slot="title" className="modal-title">{c.title}</Heading>
            <p>{c.body}</p>
            <div className="modal-foot">
              <Key size="sm" isDisabled={busy} onPress={close}>取消</Key>
              <Key size="sm" variant="primary" className={c.danger ? 'k-danger' : ''} isDisabled={busy} autoFocus
                onPress={async () => { setBusy(true); try { await c.run() } finally { setBusy(false); close() } }}>{c.ok}</Key>
            </div>
          </>)}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

export function StatusBar() {
  const ts = useStore((s) => s.ts)
  const app = useStore((s) => s.app)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [muteUntil, setMuteUntil] = useState(0)
  useEffect(() => {
    if (!muteUntil) return
    const t = setTimeout(() => { setSettings({ sound: true }); setMuteUntil(0) }, Math.max(0, muteUntil - Date.now()))
    return () => clearTimeout(t)
  }, [muteUntil, setSettings])
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  const eng = ts?.engine?.state || 'off'
  const engText = !app?.engineReady ? '引擎未安装'
    : eng === 'starting' ? '引擎启动中…' : eng === 'ready' ? '引擎就绪' : eng === 'error' ? '引擎启动失败，开始任务时会重试' : '引擎未启动'
  const engDot = !app?.engineReady || eng === 'error' ? 'bad' : eng === 'ready' ? 'ok' : eng === 'starting' ? 'run breathe' : 'off'
  return (
    <footer className="statusbar">
      <span className="sb-item" title={ts?.engine?.error || undefined}><span className={`dot ${engDot}`} />{app?.mock ? `模拟引擎 · ${engText}` : engText}</span>
      <span className="sb-item">{busy ? '1 个任务运行中' : ts?.task?.commit ? '任务已提交' : ts?.status === 'done' ? '任务完成，待审核' : '没有运行中的任务'}</span>
      {ts?.task?.snapshot && <span className="sb-item">已保存任务前快照</span>}
      <span className="sb-grow" />
      <span className="sb-item"><Icon name={settings.sound ? 'volume' : 'mute'} size={13} />{settings.sound ? '提示音开 · 需要耳机' : muteUntil ? '已静音 1 小时' : '提示音关'}</span>
      {settings.sound && <Button className="sb-link" onPress={() => { setSettings({ sound: false }); setMuteUntil(Date.now() + 3600_000) }}>静音 1 小时</Button>}
    </footer>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const drop = useStore((s) => s.dropToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className={`toast ${t.tone || ''}`} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}>
            {t.tone === 'ok' && <span className="toast-badge"><Icon name="check" size={11} stroke={3} /></span>}
            <span>{t.text}</span>
            {t.action && <Button className="toast-action" onPress={() => { t.action!.run(); drop(t.id) }}>{t.action.label}</Button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/** 侧栏顶上一行：左边收起，右边模式切换（和 Claude 一样） */
export function SideTop() {
  return <div className="side-top"><CollapseButton /><span className="side-top-grow" /><ModeSwitch /></div>
}

// 侧栏最上面的模式切换（和 Claude 一样）：任务模式中间是对话；代码模式中间还是对话，右边多一个代码面板。
// 没有任务时代码模式也能用：右边浏览项目文件，中间直接写新任务。
export function ModeSwitch() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  return (
    <div className="mode-switch" role="tablist" aria-label="模式">
      <button type="button" role="tab" aria-selected={mode === 'task'} className={`mode-btn ${mode === 'task' ? 'on' : ''}`} onClick={() => setMode('task')} title="任务模式：需求、设计、文档与图">
        <Icon name="chat" size={15} stroke={1.8} />任务
      </button>
      <button type="button" role="tab" aria-selected={mode === 'code'} className={`mode-btn ${mode === 'code' ? 'on' : ''}`} onClick={() => setMode('code')} title="代码模式：编码、单元测试、代码走查">
        <Icon name="coding" size={15} stroke={1.8} />代码
      </button>
    </div>
  )
}

/** 侧栏底部账户区（和 Claude 一样）：本机用户名，点开是设置、模型状态、更新、皮肤、提示音、关于。
 *  有新版本时名字右边亮蓝点，模型连不上时亮红点。右边小盾牌提示“只写工作区、不提交 Git”。 */
function AccountRow() {
  const app = useStore((s) => s.app)
  const sound = useStore((s) => s.settings.sound)
  const theme = useStore((s) => s.settings.theme)
  const set = useStore((s) => s.setSettings)
  const openSettings = useStore((s) => s.openSettings)
  const up = app?.update
  const next = up?.staged?.version || (up?.check?.available ? up.check.latest?.version : '') || ''
  const m = modelText(app)
  const name = app?.user || '本机用户'
  const dot = app && !m.ok ? 'bad' : next ? 'new' : ''
  return (
    <div className="side-account">
      <MenuTrigger>
        <Button className="acct-btn" aria-label={`${name}：设置和更多${dot === 'bad' ? '（模型连不上）' : dot === 'new' ? `（有新版本 ${next}）` : ''}`}>
          <span className="acct-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          <span className="acct-name">{name}</span>
          {dot && <span className={`acct-dot ${dot}`} aria-hidden="true" />}
          <Icon name="chevron" size={12} stroke={2.2} className="acct-chev" />
        </Button>
        <Popover className="menu-pop" placement="top start">
          <Menu className="menu acct-menu" aria-label="设置和更多" onAction={(k) => {
            if (k === 'settings') openSettings('general')
            if (k === 'model') openSettings('model')
            if (k === 'update' || k === 'about') openSettings('about')
            if (k === 'sound') { set({ sound: !sound }); if (!sound) setTimeout(() => play('send'), 30) }
            if (typeof k === 'string' && k.startsWith('theme:')) { set({ theme: k.slice(6) as Theme }); play('tick') }
          }}>
            <MenuItem id="settings" className="menu-item" textValue="设置"><Icon name="settings" size={15} /><span className="menu-text">设置</span><span className="menu-kbd">Ctrl ,</span></MenuItem>
            <MenuItem id="model" className="menu-item" textValue="模型"><span className={`dot ${m.ok ? 'ok' : 'bad'}`} /><span className="menu-text">{m.text || '模型'}</span></MenuItem>
            <MenuItem id="update" className="menu-item" textValue="软件更新"><Icon name={up?.staged ? 'refresh' : 'download'} size={15} /><span className="menu-text">{up?.staged ? `新版本 ${next} 已准备好` : next ? `有新版本 ${next}` : '检查更新'}</span></MenuItem>
            <Separator className="menu-sep" />
            {THEMES.map((t) => (
              <MenuItem key={t.id} id={`theme:${t.id}`} className="menu-item" textValue={`皮肤：${t.name}`}>
                <span className="theme-sw sm" aria-hidden="true">{t.sw.map((c) => <i key={c} style={{ background: c }} />)}</span>
                <span className="menu-text">皮肤：{t.name}</span>{theme === t.id && <Icon name="check" size={14} stroke={2.4} className="accent" />}
              </MenuItem>
            ))}
            <MenuItem id="sound" className="menu-item" textValue={sound ? '关闭提示音' : '打开提示音'}><Icon name={sound ? 'volume' : 'mute'} size={15} /><span className="menu-text">{sound ? '关闭提示音' : '打开提示音'}</span></MenuItem>
            <Separator className="menu-sep" />
            <MenuItem id="about" className="menu-item" textValue="关于 AstroLab"><Icon name="sparkle" size={15} /><span className="menu-text">关于 AstroLab<small>{app?.versions?.app || up?.version || ''}</small></span></MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <span className="acct-shield" title="智能体只能写工作区（项目文件夹），不能提交 Git；提交由你在审核后完成" aria-label="只写工作区，不提交 Git"><Icon name="shield" size={14} /></span>
    </div>
  )
}
