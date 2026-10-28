// 外壳：标题栏（玻璃，可拖动窗口）、任务侧栏、状态栏、提示条。

import { useEffect, useState } from 'react'
import { Button, Dialog, DialogTrigger, Menu, MenuItem, MenuTrigger, Popover, Separator } from 'react-aria-components'
import { AnimatePresence, motion } from 'motion/react'
import { useStore, type Theme } from '../store'
import type { Task } from '../api'
import { AppIcon, Icon } from './Icon'
import { play } from '../sound'
import { modeOf } from '../modes'
import { CollapseButton, SideResizer } from './Panels'

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
    const s = await run((api) => api.project.open(String(key)), '切换项目失败')
    if (s) { useStore.getState().applyAppState(s); useStore.getState().setView('launch') }
  }
  return (
    <header className="titlebar">
      <div className="tb-brand"><AppIcon size={26} /><span className="tb-name">AstroLab</span></div>
      <span className="tb-sep">/</span>
      <MenuTrigger>
        <Button className="tb-project" isDisabled={busy} aria-label={busy ? '任务进行中，结束后才能切换项目' : '切换项目'}>
          <span className="tb-project-name">{project ? project.name : '打开项目'}</span>
          {project?.git && <span className="tb-branch"><Icon name="branch" size={12} stroke={2} />{project.branch || 'Git'}</span>}
          <Icon name="chevron" size={12} stroke={2} />
        </Button>
        <Popover className="menu-pop" placement="bottom start">
          <Menu className="menu" onAction={onAction} aria-label="项目">
            {(app?.projects || []).map((p) => (
              <MenuItem key={p.id} id={p.id} className="menu-item" textValue={p.name}>
                <Icon name="folder" size={15} /><span className="menu-text">{p.name}<small>{p.path}</small></span>
              </MenuItem>
            ))}
            <Separator className="menu-sep" />
            <MenuItem id="__add" className="menu-item" textValue="打开项目文件夹"><Icon name="folderPlus" size={15} /><span className="menu-text">打开项目文件夹…</span></MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <div className="tb-drag" />
      <ModelStatus />
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
  useEffect(() => { void run((api) => api.task.history()).then((h) => setList(h || [])) }, [run, ts?.project?.id, ts?.task?.id, ts?.status, ts?.task?.commit?.sha])
  const curId = ts?.task?.id
  const all = curId && ts?.task && !list.some((t) => t.id === curId) ? [ts.task, ...list] : list
  const items = all.filter((t) => modeOf(t) === mode)
  const other = all.length - items.length
  const groups = mode === 'code'
    ? (items.length ? [{ label: ts?.project?.name || '项目', items: items.slice(0, 40).sort((a, b) => b.startedAt - a.startedAt) }] : [])
    : groupByDay(items.slice(0, 40))
  const newView = mode === 'code' ? 'code-launch' : 'launch'
  const open = async (t: Task) => {
    const target = modeOf(t) === 'code' ? 'code' : 'task'
    if (curId === t.id) { setView(target); return }
    const st = await run(async (api) => { await api.task.open(t.id); return api.getState() }, '打不开这个任务')
    if (st) { useStore.getState().applyAppState(st); setView(target) }
  }
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
        {groups.map((g) => (
          <div key={g.label} className="side-group">
            <div className="nav-label">{mode === 'code' && <Icon name="folder" size={12} stroke={1.8} />}{g.label}{mode === 'code' && ts?.project?.branch ? <span className="side-branch mono">{ts.project.branch}</span> : null}</div>
            {g.items.map((t) => {
              const isCur = t.id === curId
              // 不是当前任务却记着“进行中”：上次关闭软件时它还没做完，实际已经中断（打开后可以继续）
              const status = isCur ? ts!.status : ['starting', 'running', 'asking'].includes(t.status) ? 'interrupted' : t.status
              const live = isCur && busy
              const on = isCur && ['task', 'code'].includes(view)
              const committed = isCur ? !!ts?.task?.commit : !!t.commit
              return (
                <Button key={t.id} className={`nav side-item ${on ? 'on' : ''}`} isDisabled={busy && !isCur} onPress={() => void open(t)}
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
