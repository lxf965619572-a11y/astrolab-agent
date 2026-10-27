// 外壳：标题栏（玻璃，可拖动窗口）、研发环节侧栏、状态栏、提示条。

import { useEffect, useState } from 'react'
import { Button, Dialog, DialogTrigger, Menu, MenuItem, MenuTrigger, Popover, Separator } from 'react-aria-components'
import { AnimatePresence, motion } from 'motion/react'
import { useStore, type Theme, type View } from '../store'
import { AppIcon, Icon, STAGE_ICON } from './Icon'
import { play } from '../sound'

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

const statusText: Record<string, string> = { starting: '启动中', running: '进行中', asking: '等你决定', done: '待审核', stopped: '已停止', error: '出错', idle: '' }

export function Sidebar() {
  const app = useStore((s) => s.app)
  const ts = useStore((s) => s.ts)
  const view = useStore((s) => s.view)
  const launchStage = useStore((s) => s.launchStage)
  const setView = useStore((s) => s.setView)
  const setLaunchStage = useStore((s) => s.setLaunchStage)
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  const current = ts?.task?.stage
  return (
    <nav className="sidebar" aria-label="研发环节">
      <div className="nav-label">研发环节</div>
      {(app?.stages || []).filter((s) => !s.hidden).map((s) => {
        const isTask = current === s.id && !!ts?.task
        const on = view === 'launch' ? launchStage === s.id : isTask
        const live = isTask && busy
        return (
          <Button key={s.id} className={`nav ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}
            onPress={() => {
              // 随时都能切换：当前任务所在的环节回到任务页，其他环节打开发起页（任务在后台照常进行）
              if (isTask) setView('task')
              else { setLaunchStage(s.id); setView('launch') }
            }}>
            <Icon name={STAGE_ICON[s.id]} size={18} stroke={1.7} />
            <span className="nav-name">{s.name}</span>
            {live && <span className={`led ${ts?.status === 'asking' ? 'ask' : ''}`} />}
            {isTask && <span className={`nav-status st-${ts?.task?.commit ? 'done' : ts?.status}`}>{ts?.task?.commit ? '已提交' : statusText[ts?.status || 'idle']}</span>}
            {!isTask && !s.hasSkill && <span className="nav-status muted">无技能</span>}
          </Button>
        )
      })}
      {ts?.task && (app?.stages || []).find((s) => s.id === ts.task!.stage)?.hidden && (
        <Button className={`nav ${['task', 'review'].includes(view) ? 'on' : ''}`} onPress={() => setView('task')}>
          <Icon name={ts.task.stage === 'plugin' ? 'puzzle' : 'sparkle'} size={18} stroke={1.7} />
          <span className="nav-name">{ts.task.stageName}</span>
          {busy && <span className={`led ${ts.status === 'asking' ? 'ask' : ''}`} />}
          <span className={`nav-status st-${ts.task.commit ? 'done' : ts.status}`}>{ts.task.commit ? '已提交' : statusText[ts.status || 'idle']}</span>
        </Button>
      )}
      <div className="nav-sep" />
      <Button className={`nav ${view === 'knowledge' ? 'on' : ''}`} onPress={() => setView('knowledge')}><Icon name="book" size={18} stroke={1.7} /><span className="nav-name">知识库</span></Button>
      <Button className={`nav ${view === 'library' ? 'on' : ''}`} onPress={() => setView('library')}><Icon name="puzzle" size={18} stroke={1.7} /><span className="nav-name">技能与插件</span></Button>
      <Button className={`nav ${view === 'history' ? 'on' : ''}`} onPress={() => setView('history')}><Icon name="history" size={18} stroke={1.7} /><span className="nav-name">任务历史</span></Button>
      <div className="nav-grow" />
      <div className="nav-foot">
        <Icon name="shield" size={14} />
        <span>智能体只能写项目目录，不能提交 Git</span>
      </div>
    </nav>
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

export function ViewTabs({ value, onChange, review }: { value: View; onChange: (v: View) => void; review?: number }) {
  const tabs: [View, string][] = [['task', '任务'], ['review', review ? `审核 ${review}` : '审核'], ['history', '历史']]
  return (
    <div className="segmented" role="tablist" aria-label="视图">
      {tabs.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={`seg-btn ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}
