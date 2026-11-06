// 设置（Ctrl ,，界面设计 v2 第 10 节）：左边分栏，右边内容。
// 原来标题栏上的模型状态、软件更新、皮肤、提示音都在这里（侧栏底部账户区的菜单也能直接改）。
// 密钥只说“已配置 / 未配置”，不显示内容；模型配置在安装目录的 config/local.env，由管理员改。

import { useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import { Key, Kbd, Toggle } from '../components/Keys'
import { THEMES, UpdatePanel, visibleProjects } from '../components/Shell'
import { play } from '../sound'

const TABS: [string, string, string][] = [
  ['general', '常规', 'settings'],
  ['model', '模型', 'computer'],
  ['workspace', '工作区', 'folder'],
  ['knowledge', '知识与资料', 'book'],
  ['keys', '快捷键', 'terminal'],
  ['about', '关于与更新', 'download'],
]

export function SettingsView() {
  const tab = useStore((s) => s.settingsTab)
  const open = useStore((s) => s.openSettings)
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分栏">
        <h1>设置</h1>
        {TABS.map(([id, name, icon]) => (
          <Button key={id} className={`nav settings-tab ${tab === id ? 'on' : ''}`} aria-current={tab === id ? 'page' : undefined} onPress={() => open(id)}>
            <Icon name={icon} size={16} stroke={1.7} /><span>{name}</span>
          </Button>
        ))}
        <Button className="nav settings-tab" onPress={() => useStore.getState().setView('library')}><Icon name="puzzle" size={16} stroke={1.7} /><span>技能与插件</span><Icon name="arrow" size={13} className="settings-out" /></Button>
      </nav>
      <div className="settings-main">
        {tab === 'general' && <General />}
        {tab === 'model' && <Model />}
        {tab === 'workspace' && <Workspace />}
        {tab === 'knowledge' && <Knowledge />}
        {tab === 'keys' && <Keys />}
        {tab === 'about' && <About />}
      </div>
    </div>
  )
}

function Row({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text"><div className="strong">{title}</div>{desc && <div className="muted small">{desc}</div>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

function General() {
  const s = useStore((x) => x.settings)
  const set = useStore((x) => x.setSettings)
  return (
    <section className="set-sec">
      <h2>常规</h2>
      <div className="set-group">
        <div className="set-label">皮肤</div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <Button key={t.id} className={`theme-opt ${s.theme === t.id ? 'on' : ''}`} aria-pressed={s.theme === t.id} onPress={() => { set({ theme: t.id }); play('tick') }}>
              <span className="theme-sw" aria-hidden="true">{t.sw.map((c) => <i key={c} style={{ background: c }} />)}</span>
              <span className="theme-text"><span className="strong">{t.name}</span><span className="muted small">{t.desc}</span></span>
              {s.theme === t.id && <Icon name="check" size={15} stroke={2.4} className="accent" />}
            </Button>
          ))}
        </div>
      </div>
      <Row title="提示音" desc="任务完成、需要你决定、出错时响一声">
        <Toggle isSelected={s.sound} onChange={(v) => { set({ sound: v }); if (v) setTimeout(() => play('send'), 30) }} aria-label="提示音" />
      </Row>
      {s.sound && (
        <Row title="音量">
          <input type="range" min={0.05} max={1} step={0.05} value={s.volume} aria-label="音量" onChange={(e) => set({ volume: Number(e.target.value) })} onPointerUp={() => play('tick')} />
        </Row>
      )}
      <Row title="完成或需要我决定时通知" desc="在后台的任务也会弹系统通知，标题带工程名">
        <Toggle isSelected={s.notify} onChange={(v) => set({ notify: v })} aria-label="系统通知" />
      </Row>
      <Row title="收起侧栏" desc="Ctrl B 随时切换">
        <Toggle isSelected={s.sideCollapsed} onChange={(v) => set({ sideCollapsed: v })} aria-label="收起侧栏" />
      </Row>
      <Row title="任务页右边的面板" desc="进度、产出、用到的、审核与提交">
        <Toggle isSelected={s.panel} onChange={(v) => set({ panel: v })} aria-label="显示右边面板" />
      </Row>
    </section>
  )
}

function Model() {
  const app = useStore((s) => s.app)
  const run = useStore((s) => s.run)
  const [test, setTest] = useState<null | 'busy' | { ok: boolean; ms: number; model: string; reply?: string; error?: string }>(null)
  if (!app) return null
  const m = app.model
  const state = app.mock ? '模拟引擎（不调用模型）' : !app.engineReady ? '引擎未安装' : !m.hasKey ? '模型未配置' : '已配置'
  return (
    <section className="set-sec">
      <h2>模型</h2>
      <p className="muted small">模型由部门统一配置，工作台不提供切换。配置在安装目录的 <span className="mono">config/local.env</span>，由管理员修改；密钥不在界面上显示。</p>
      <div className="set-facts card">
        <dl>
          <dt>状态</dt><dd><span className={`dot ${app.mock || (app.engineReady && m.hasKey) ? 'ok' : 'bad'}`} /> {state}</dd>
          <dt>模型</dt><dd className="mono">{m.model || '—'}</dd>
          <dt>路由</dt><dd className="mono">{m.provider || '—'}</dd>
          <dt>地址</dt><dd className="mono">{m.baseURL || '—'}</dd>
          <dt>密钥</dt><dd>{m.hasKey ? '已配置' : '未配置'}</dd>
          {!!m.contextWindow && <><dt>上下文</dt><dd>{Math.round(m.contextWindow / 1024)}K tokens</dd></>}
        </dl>
      </div>
      <div className="set-actions">
        <Key size="sm" isDisabled={test === 'busy'} onPress={() => { setTest('busy'); void run((api) => api.model.test(), '测试失败').then((r) => setTest(r || null)) }}>
          <Icon name="refresh" size={14} stroke={2} />{test === 'busy' ? '正在测试…' : '测试连接'}
        </Key>
        {test && test !== 'busy' && (test.ok
          ? <span className="small ok-ink"><Icon name="check" size={13} stroke={2.4} /> 连接正常 · {test.model} · {test.ms} ms</span>
          : <span className="small err-ink"><Icon name="warn" size={13} /> 连不上：{test.error}</span>)}
      </div>
    </section>
  )
}

function Workspace() {
  const ts = useStore((s) => s.ts)
  const all = useStore((s) => s.app?.projects) || []
  const hide = useStore((s) => s.hideProject)
  const cur = ts?.project?.id
  const projects = visibleProjects(all, cur)
  return (
    <section className="set-sec">
      <h2>工作区</h2>
      <ul className="set-rules">
        <li>每个工程是一个项目文件夹，任务在里面运行。智能体只读写当前工程和技能目录里的文件，不能提交 Git；提交由你在审核页完成。</li>
        <li>同一个工程一次只做一个任务；不同工程可以同时做，最多 3 个。</li>
        <li>移出列表不会删除文件夹和任务记录，重新打开就回来。</li>
      </ul>
      <div className="set-label">打开过的工程（{projects.length} 个）</div>
      <div className="set-list card">
        {projects.map((p) => (
          <div key={p.id} className="set-list-row">
            <Icon name="folder" size={16} stroke={1.7} />
            <span className="strong">{p.name}</span>{p.id === cur && <span className="pill sm idle">正在用</span>}
            <span className="mono muted small set-path" title={p.path}>{p.path}</span>
            <Key size="sm" variant="ghost" onPress={() => void useStore.getState().openProjectHome(p.id)}>打开</Key>
            <Key size="sm" variant="ghost" isDisabled={p.id === cur} onPress={() => void hide(p.id)}>移出列表</Key>
          </div>
        ))}
      </div>
    </section>
  )
}

function Knowledge() {
  const app = useStore((s) => s.app)
  const run = useStore((s) => s.run)
  const libs = useStore((s) => s.libraries)
  return (
    <section className="set-sec">
      <h2>知识与资料</h2>
      <Row title="我的库" desc={app?.libraryDir || ''}>
        <Key size="sm" onPress={() => void run((api) => api.kb.openMine(), '打不开我的库')}><Icon name="folder" size={14} />打开</Key>
      </Row>
      {!!libs.length && (
        <>
          <div className="set-label">知识和技能的来源（{libs.length} 个）</div>
          <div className="set-list card">
            {libs.map((l) => (
              <div key={l.id} className="set-list-row">
                <Icon name={l.writable ? 'edit' : 'book'} size={16} stroke={1.7} />
                <span className="strong">{l.name}</span>
                <span className="mono muted small set-path" title={l.url}>{l.local ? '本机' : l.url}</span>
                <span className="muted small">{l.error ? `出错：${l.error}` : l.lastSync ? `${new Date(l.lastSync).toLocaleDateString('zh-CN')} 同步` : l.writable ? '' : '还没同步'}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="set-actions">
        <Key size="sm" onPress={() => useStore.getState().setView('knowledge')}>打开知识库</Key>
        <Key size="sm" onPress={() => useStore.getState().setView('library')}>管理技能、插件和共享库</Key>
      </div>
    </section>
  )
}

const KEYS: [string, string][] = [
  ['Ctrl N', '新任务'],
  ['Ctrl K', '搜索任务、产出文件、工程'],
  ['Ctrl B', '收起或展开侧栏'],
  ['Ctrl ,', '设置'],
  ['Ctrl Enter', '发送（输入框里 Enter 是换行）'],
  ['/', '输入框里选技能'],
  ['Tab', '新任务页：选推荐的技能；搜索里：切换范围'],
  ['P / R / A / D', '任务的“⋯”菜单开着时：置顶、重命名、归档、删除'],
  ['Esc', '关闭弹层、菜单'],
]

function Keys() {
  return (
    <section className="set-sec">
      <h2>快捷键</h2>
      <div className="set-list card">
        {KEYS.map(([k, d]) => <div key={k} className="set-list-row keys-row"><span className="keys-k">{k.split(' / ').map((x, i) => <span key={x}>{i > 0 && ' / '}<Kbd>{x}</Kbd></span>)}</span><span>{d}</span></div>)}
      </div>
    </section>
  )
}

function About() {
  const app = useStore((s) => s.app)
  const ts = useStore((s) => s.ts)
  const run = useStore((s) => s.run)
  if (!app) return null
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  const v = app.versions
  return (
    <section className="set-sec">
      <h2>关于与更新</h2>
      <div className="set-facts card">
        <dl>
          <dt>AstroLab</dt><dd className="mono">{v?.app || app.update?.version || '—'}{app.installed ? '' : '（开发版）'}</dd>
          {v && <><dt>Electron</dt><dd className="mono">{v.electron}</dd><dt>Node.js</dt><dd className="mono">{v.node}</dd></>}
          {app.dataDir && <><dt>数据目录</dt><dd className="mono">{app.dataDir}</dd></>}
          {app.logDir && <><dt>日志</dt><dd className="mono">{app.logDir}</dd></>}
        </dl>
      </div>
      {!!app.logDir && (
        <div className="set-actions">
          <Key size="sm" variant="ghost" onPress={() => void run(async (api) => { if (api.sys.copy) await api.sys.copy(app.logDir!); else await navigator.clipboard.writeText(app.logDir!); return true }, '复制失败').then((ok) => { if (ok) useStore.getState().toast({ text: '日志目录已复制，出问题时把里面最新的日志发给维护人员', tone: 'ok' }, 3000) })}>复制日志目录</Key>
        </div>
      )}
      <div className="set-label">软件更新</div>
      <div className="set-update card">{app.update ? <UpdatePanel up={app.update} busy={busy} /> : <div className="pad muted small">这个版本不支持自动更新。</div>}</div>
    </section>
  )
}
