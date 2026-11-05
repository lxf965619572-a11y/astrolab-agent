// 外壳：标题栏（玻璃，可拖动窗口）、任务侧栏、状态栏、提示条。

import { useEffect, useState } from 'react'
import { Button, Dialog, DialogTrigger, Menu, MenuItem, MenuTrigger, Popover, Separator } from 'react-aria-components'
import { AnimatePresence, motion } from 'motion/react'
import { useStore, type Theme } from '../store'
import type { Task, UpdateState } from '../api'
import { AppIcon, Icon } from './Icon'
import { play } from '../sound'
import { modeOf } from '../modes'
import { CollapseButton, SideResizer } from './Panels'
import { Key } from './Keys'
import { clock } from '../format'

export function TitleBar() {
  const app = useStore((s) => s.app)
  const ts = useStore((s) => s.ts)
  const run = useStore((s) => s.run)
  const project = ts?.project
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  const onAction = async (key: React.Key) => {
    if (key === '__add') {
      const s = await run((api) => api.project.add(), '打开项目失败')
      if (s) useStore.getState().applyAppState(s)
      return
    }
    await useStore.getState().openProject(String(key))
  }
  const bgIds = new Set((app?.background || []).filter((b) => ['starting', 'running', 'asking'].includes(b.status)).map((b) => b.projectId))
  return (
    <header className="titlebar">
      <div className="tb-brand"><AppIcon size={26} /><span className="tb-name">AstroLab</span></div>
      <span className="tb-sep">/</span>
      <MenuTrigger>
        <Button className="tb-project" aria-label={busy ? '切换项目（当前任务在后台接着做）' : '切换项目'}>
          <span className="tb-project-name">{project ? project.name : '打开项目'}</span>
          {project?.git && <span className="tb-branch"><Icon name="branch" size={12} stroke={2} />{project.branch || 'Git'}</span>}
          <Icon name="chevron" size={12} stroke={2} />
        </Button>
        <Popover className="menu-pop" placement="bottom start">
          <Menu className="menu" onAction={onAction} aria-label="项目">
            {(app?.projects || []).map((p) => (
              <MenuItem key={p.id} id={p.id} className="menu-item" textValue={p.name}>
                <Icon name="folder" size={15} /><span className="menu-text">{p.name}{bgIds.has(p.id) && <span className="led" aria-label="有任务在进行" />}<small>{p.path}</small></span>
              </MenuItem>
            ))}
            <Separator className="menu-sep" />
            <MenuItem id="__add" className="menu-item" textValue="打开项目文件夹"><Icon name="folderPlus" size={15} /><span className="menu-text">打开项目文件夹…</span></MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <div className="tb-drag" />
      <ModelStatus />
      <UpdateButton />
      <ThemePicker />
      <SoundToggle />
      <div className="tb-controls-space" />
    </header>
  )
}

function ModelStatus() {
  const app = useStore((s) => s.app)
  if (!app) return null
  const ok = app.engineReady && (app.mock || app.model.hasKey)
  const text = app.mock ? '模拟引擎（不调用模型）' : !app.engineReady ? '引擎未安装' : !app.model.hasKey ? '模型未配置' : `部门模型 · ${app.model.model}`
  return <span className={`tb-model ${ok ? 'ok' : 'bad'}`} title={app.model.baseURL}><span className="dot" />{text}</span>
}

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`

/** 软件更新：平时是个图标（看版本、检查更新）；有新版本或已准备好时变成带字的提示 */
function UpdateButton() {
  const up = useStore((s) => s.app?.update)
  const ts = useStore((s) => s.ts)
  if (!up) return null
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  const next = up.staged?.version || (up.check?.available ? up.check.latest?.version : '')
  return (
    <DialogTrigger>
      {next
        ? <Button className="tb-update-pill" aria-label={up.staged ? `新版本 ${next} 已准备好` : `有新版本 ${next}`}><Icon name={up.staged ? 'refresh' : 'download'} size={14} stroke={2} />{up.staged ? '重启更新' : `新版本 ${next}`}</Button>
        : <Button className="tb-icon" aria-label={`版本 ${up.version}，检查更新`}><Icon name="download" size={17} /></Button>}
      <Popover className="pop up-pop" placement="bottom end">
        <Dialog className="up-dialog" aria-label="软件更新"><UpdatePanel up={up} busy={busy} /></Dialog>
      </Popover>
    </DialogTrigger>
  )
}

function UpdatePanel({ up, busy }: { up: UpdateState; busy: boolean }) {
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

const THEMES: { id: Theme; name: string; desc: string; sw: [string, string, string] }[] = [
  { id: 'lavender', name: '浅紫', desc: '冷静的浅紫，默认', sw: ['#F3F1F9', '#C4B5FD', '#8B7CF6'] },
  { id: 'cream', name: '奶油', desc: '暖奶油面板，钴蓝点缀', sw: ['#E8E2D8', '#F5F1EA', '#2F45D8'] },
  { id: 'mars', name: '黑橙', desc: '纯黑底，火星橙线框', sw: ['#060504', '#2A140A', '#FF6A1F'] },
]

/** 换皮肤：只改颜色，界面结构不变；立刻生效，下次打开记住 */
function ThemePicker() {
  const theme = useStore((s) => s.settings.theme)
  const set = useStore((s) => s.setSettings)
  return (
    <DialogTrigger>
      <Button className="tb-icon" aria-label="换皮肤"><Icon name="palette" size={17} /></Button>
      <Popover className="pop theme-pop" placement="bottom end">
        <Dialog className="theme-dialog" aria-label="皮肤">
          <div className="theme-title">皮肤</div>
          {THEMES.map((t) => (
            <Button key={t.id} className={`theme-opt ${theme === t.id ? 'on' : ''}`} aria-pressed={theme === t.id} onPress={() => { set({ theme: t.id }); play('tick') }}>
              <span className="theme-sw" aria-hidden="true">{t.sw.map((c) => <i key={c} style={{ background: c }} />)}</span>
              <span className="theme-text"><span className="strong">{t.name}</span><span className="muted small">{t.desc}</span></span>
              {theme === t.id && <Icon name="check" size={15} stroke={2.4} className="accent" />}
            </Button>
          ))}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

function SoundToggle() {
  const settings = useStore((s) => s.settings)
  const set = useStore((s) => s.setSettings)
  return (
    <Button className="tb-icon" aria-label={settings.sound ? '关闭提示音' : '打开提示音'} onPress={() => { set({ sound: !settings.sound }); if (!settings.sound) setTimeout(() => play('send'), 30) }}>
      <Icon name={settings.sound ? 'volume' : 'mute'} size={17} />
    </Button>
  )
}

const statusText: Record<string, string> = { starting: '启动中', running: '进行中', asking: '等你决定', done: '待审核', stopped: '已停止', error: '出错', interrupted: '已中断', idle: '' }

// 侧栏（和 Claude 一样）：上面是模式切换、新任务和共用页面（全部任务、知识库、技能与插件），下面是这个模式的最近任务。
// 任务模式按天分组；代码模式按项目分组（和 Claude Code 按仓库分组一样）。
export function Sidebar() {
  const ts = useStore((s) => s.ts)
  const view = useStore((s) => s.view)
  const mode = useStore((s) => s.mode)
  const setView = useStore((s) => s.setView)
  const run = useStore((s) => s.run)
  const [list, setList] = useState<Task[]>([])
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  const bg = useStore((s) => s.app?.background || [])
  useEffect(() => { void run((api) => api.task.history()).then((h) => setList(h || [])) }, [run, ts?.project?.id, ts?.task?.id, ts?.status, ts?.task?.commit?.sha])
  const curId = ts?.task?.id
  const all = curId && ts?.task && !list.some((t) => t.id === curId) ? [ts.task, ...list] : list
  const items = all.filter((t) => modeOf(t) === mode)
  const other = all.length - items.length
  const groups = mode === 'code'
    ? (items.length ? [{ label: ts?.project?.name || '项目', items: items.slice(0, 40).sort((a, b) => b.startedAt - a.startedAt) }] : [])
    : groupByDay(items.slice(0, 40))
  const newView = mode === 'code' ? 'code-launch' : 'launch'
  // 当前任务进行中时，点别的任务只读查看（store.openTask）
  const open = (t: Task) => useStore.getState().openTask(t)
  const peekId = useStore((s) => (s.view === 'peek' ? s.peek?.task.id : null))
  return (
    <nav className="sidebar side2" aria-label="任务">
      <SideTop />
      <Button className={`nav side-new ${view === newView ? 'on' : ''}`} onPress={() => setView(newView)}>
        <Icon name="newTask" size={17} stroke={1.8} /><span className="nav-name">{mode === 'code' ? '新的代码任务' : '新任务'}</span><span className="side-kbd">Ctrl N</span>
      </Button>
      <Button className={`nav ${view === 'history' ? 'on' : ''}`} onPress={() => setView('history')}><Icon name="search" size={17} stroke={1.7} /><span className="nav-name">全部任务</span></Button>
      <Button className={`nav ${view === 'knowledge' ? 'on' : ''}`} onPress={() => setView('knowledge')}><Icon name="book" size={17} stroke={1.7} /><span className="nav-name">知识库</span></Button>
      <Button className={`nav ${view === 'library' ? 'on' : ''}`} onPress={() => setView('library')}><Icon name="puzzle" size={17} stroke={1.7} /><span className="nav-name">技能与插件</span></Button>
      <div className="side-scroll">
        {/* 其他项目在后台进行（或做完等审核）的任务：两种模式都显示，点一下切到那个项目 */}
        {!!bg.length && (
          <div className="side-group">
            <div className="nav-label"><Icon name="folder" size={12} stroke={1.8} />其他项目</div>
            {bg.map((b) => {
              const live = ['starting', 'running', 'asking'].includes(b.status)
              return (
                <Button key={b.task.id} className="nav side-item" onPress={() => void useStore.getState().openProject(b.projectId)} aria-label={`${b.projectName}：${b.task.title}`}>
                  <span className="side-title">{b.task.title}</span>
                  <span className="side-meta">
                    {live ? <span className={`led ${b.asking || b.status === 'asking' ? 'ask' : ''}`} /> : <span className={`dot st-${b.status}`} />}
                    {b.projectName}<span className="side-dot">·</span>{b.asking ? '等你决定' : statusText[b.status] || ''}
                  </span>
                </Button>
              )
            })}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="side-group">
            <div className="nav-label">{mode === 'code' && <Icon name="folder" size={12} stroke={1.8} />}{g.label}{mode === 'code' && ts?.project?.branch ? <span className="side-branch mono">{ts.project.branch}</span> : null}</div>
            {g.items.map((t) => {
              const isCur = t.id === curId
              // 不是当前任务却记着“进行中”：上次关闭软件时它还没做完，实际已经中断（打开后可以继续）
              const status = isCur ? ts!.status : ['starting', 'running', 'asking'].includes(t.status) ? 'interrupted' : t.status
              const live = isCur && busy
              const on = (isCur && ['task', 'code'].includes(view)) || peekId === t.id
              const committed = isCur ? !!ts?.task?.commit : !!t.commit
              return (
                <Button key={t.id} className={`nav side-item ${on ? 'on' : ''}`} onPress={() => void open(t)}
                  aria-label={`${t.title}，${t.stageName}`}>
                  <span className="side-title">{t.title}</span>
                  <span className="side-meta">
                    {live ? <span className={`led ${status === 'asking' ? 'ask' : ''}`} /> : <span className={`dot st-${committed ? 'done' : status}`} />}
                    {t.stageName}<span className="side-dot">·</span>{committed ? '已提交' : statusText[status] || ''}
                  </span>
                </Button>
              )
            })}
          </div>
        ))}
        {!items.length && <div className="side-empty muted small">{mode === 'code' ? '还没有代码任务。编码、单元测试、代码走查在这里做。' : '还没有任务。需求、设计、文档和图在这里做。'}{other ? `另一个模式里有 ${other} 个任务。` : ''}</div>}
        {/* 正在运行的任务属于另一个模式：给个入口，不然切过来就看不到它了 */}
        {busy && ts?.task && modeOf(ts.task) !== mode && (
          <Button className="nav side-item side-elsewhere" onPress={() => setView(modeOf(ts.task!) === 'code' ? 'code' : 'task')}>
            <span className="side-title">{ts.task.title}</span>
            <span className="side-meta"><span className="led" />在{modeOf(ts.task) === 'code' ? '代码' : '任务'}模式里进行中 · 点击过去</span>
          </Button>
        )}
      </div>
      <div className="nav-foot">
        <Icon name="shield" size={14} />
        <span>智能体只能写项目目录，不能提交 Git</span>
      </div>
      <SideResizer />
    </nav>
  )
}

function groupByDay(tasks: Task[]) {
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }
  const today = day(Date.now())
  const label = (t: number) => {
    const d = (today - day(t)) / 86400_000
    return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 7 ? '最近 7 天' : '更早'
  }
  const out: { label: string; items: Task[] }[] = []
  for (const t of [...tasks].sort((a, b) => b.startedAt - a.startedAt)) {
    const l = label(t.startedAt)
    if (!out.length || out[out.length - 1].label !== l) out.push({ label: l, items: [] })
    out[out.length - 1].items.push(t)
  }
  return out
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

/** 侧栏顶上一行：模式切换 + 收起 */
export function SideTop() {
  return <div className="side-top"><ModeSwitch /><CollapseButton /></div>
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
