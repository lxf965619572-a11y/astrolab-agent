// 设置（Ctrl ,，界面设计 v2 第 10 节）：左边分栏，右边内容。
// 原来标题栏上的模型状态、软件更新、皮肤、提示音都在这里（侧栏底部账户区的菜单也能直接改）。
// 密钥只说“已配置 / 未配置”，不显示内容；模型配置在安装目录的 config/local.env，由管理员改。

import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import { Key, Kbd, Toggle } from '../components/Keys'
import { THEMES, UpdatePanel, visibleProjects } from '../components/Shell'
import { play } from '../sound'
import type { WebState, ModelDraft, ModelList, ModelPreset, ModelProbe, ModelProfile } from '../api'

const TABS: [string, string, string][] = [
  ['general', '常规', 'settings'],
  ['model', '模型', 'computer'],
  ['workspace', '工作区', 'folder'],
  ['web', '网页访问', 'external'],
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
        {tab === 'web' && <WebAccess />}
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

const THINKING: Record<string, string> = {
  deepseek: 'DeepSeek 官方（thinking + reasoning_effort）',
  'chat-template': 'vLLM 模板参数（chat_template_kwargs）',
  'qwen-chat-template': 'Qwen（enable_thinking + preserve_thinking）',
  qwen: 'Qwen 云接口（enable_thinking）',
}
const PROBE_MARK = { ok: ['check', 'ok-ink', '通过'], warn: ['warn', 'warn-ink', '注意'], fail: ['warn', 'err-ink', '失败'] } as const

const fmtK = (n?: number | null) => (n ? `${Math.round(n / 1024)}K` : '—')

/** 检测结果（设置页的“检测模型”和表单里的“检测”共用） */
function ProbeResult({ probe, onApply, envFile }: { probe: ModelProbe; onApply?: (s: Record<string, string>) => void; envFile?: string }) {
  const sug = Object.entries(probe.suggest || {})
  return (
    <div className="probe card" aria-live="polite">
      <div className="probe-head">
        <span className={`dot ${probe.ok ? 'ok' : 'bad'}`} />
        <span className="strong">{probe.ok ? '可以作为智能体的模型使用' : '还不能用，先处理失败项'}</span>
        <span className="muted small mono">{probe.server}{probe.model ? ` · ${probe.model}` : ''}{probe.maxModelLen ? ` · ${fmtK(probe.maxModelLen)}` : ''}{probe.tokPerSec ? ` · ${probe.tokPerSec} tok/s` : ''}</span>
      </div>
      <ul className="probe-list">
        {probe.checks.map((c) => {
          const [icon, ink, word] = PROBE_MARK[c.status]
          return (
            <li key={c.item} className={`probe-row ${c.status}`}>
              <span className={`probe-mark ${ink}`}><Icon name={icon} size={13} stroke={2.4} />{word}</span>
              <span className="strong">{c.item}</span>
              <span className="probe-detail">{c.detail}{c.fix && <span className="probe-fix muted small">→ {c.fix}</span>}</span>
            </li>
          )
        })}
      </ul>
      {!!sug.length && (
        <div className="probe-sug">
          <div className="muted small">{onApply ? '按服务端的情况，建议这样改：' : <>建议改设置文件 <span className="mono">{envFile || 'local.env'}</span>（改完重启工作台）：</>}</div>
          <pre className="mono">{sug.map(([k, v]) => `${k}=${v}`).join('\n')}</pre>
          {onApply
            ? <Key size="sm" onPress={() => onApply(probe.suggest)}><Icon name="check" size={13} stroke={2.4} />采用建议</Key>
            : <Key size="sm" variant="ghost" onPress={() => void navigator.clipboard.writeText(sug.map(([k, v]) => `${k}=${v}`).join('\n')).then(() => useStore.getState().toast({ text: '已复制，粘贴进 local.env', tone: 'ok' }, 2500))}>复制</Key>}
        </div>
      )}
    </div>
  )
}

const EMPTY: ModelDraft = { name: '', baseURL: 'http://', model: '', thinkingFormat: 'chat-template', contextWindow: 131072, maxTokens: 32768, input: 'text', key: '' }
const fromProfile = (m: ModelProfile): ModelDraft => ({ id: m.id, name: m.name, baseURL: m.baseURL, model: m.model, thinkingFormat: m.thinkingFormat, contextWindow: m.contextWindow, maxTokens: m.maxTokens, input: m.input, key: '' })

function Model() {
  const app = useStore((s) => s.app)
  const run = useStore((s) => s.run)
  const [list, setList] = useState<ModelList | null>(null)
  const [test, setTest] = useState<null | 'busy' | { ok: boolean; ms: number; model: string; reply?: string; error?: string }>(null)
  const [probe, setProbe] = useState<null | 'busy' | ModelProbe>(null)
  const [edit, setEdit] = useState<null | { draft: ModelDraft; hasKey: boolean; preset?: string }>(null)
  useEffect(() => { void run((api) => api.model.list(), '读不到模型配置').then((l) => l && setList(l)) }, [run])
  if (!app) return null
  const m = app.model
  const state = app.mock ? '模拟引擎（不调用模型）' : !app.engineReady ? '引擎未安装' : !m.hasKey ? '模型未配置' : '已配置'
  const refresh = async (l: ModelList | null | undefined) => {
    if (!l) return
    setList(l)
    const st = await run((api) => api.getState(), '刷新失败')
    if (st) useStore.getState().applyAppState(st)
  }
  const use = async (x: ModelProfile) => {
    const l = await run((api) => api.model.activate(x.id), '切换失败')
    if (l) { await refresh(l); setProbe(null); useStore.getState().toast({ text: `已切换到“${x.name}”，引擎正在用新模型重启`, tone: 'ok' }, 3000); play('done') }
  }
  const remove = async (x: ModelProfile) => {
    if (!confirm(`删除模型“${x.name}”？`)) return
    await refresh(await run((api) => api.model.remove(x.id), '删除失败'))
  }
  const checkSaved = (x: ModelProfile) => {
    setProbe('busy')
    void run((api) => (x.id === 'dept' ? api.model.probe() : api.model.probeDraft(fromProfile(x))), '检测失败').then((r) => { setProbe(r || null); if (r) play(r.ok ? 'done' : 'error') })
  }
  return (
    <section className="set-sec">
      <h2>模型</h2>
      <p className="muted small">部门默认模型来自设置文件 <span className="mono">local.env</span>。也可以在这里加自己的模型（局域网或内网的 vLLM、SGLang 等 OpenAI 兼容接口），检测通过后切换使用；密钥只存在本机，不在界面上显示。</p>
      {list?.locked && <div className="badge-warn up-note"><Icon name="warn" size={14} />部门锁定了模型配置（local.env 的 ASTROLAB_MODEL_LOCK），只能用部门默认模型。</div>}

      <div className="set-facts card">
        <dl>
          <dt>状态</dt><dd><span className={`dot ${app.mock || (app.engineReady && m.hasKey) ? 'ok' : 'bad'}`} /> {state}</dd>
          <dt>在用</dt><dd>{m.name || '部门默认'} <span className="mono muted">{m.model || '—'}</span></dd>
          <dt>地址</dt><dd className="mono">{m.baseURL || '—'}</dd>
          {!!m.contextWindow && <><dt>上下文</dt><dd>{Math.round(m.contextWindow / 1024)}K tokens{m.maxTokens ? ` · 单次输出 ${Math.round(m.maxTokens / 1024)}K` : ''}</dd></>}
          {!!m.thinkingFormat && <><dt>思考参数</dt><dd>{THINKING[m.thinkingFormat] || m.thinkingFormat}</dd></>}
        </dl>
      </div>
      <div className="set-actions">
        <Key size="sm" isDisabled={test === 'busy'} onPress={() => { setTest('busy'); void run((api) => api.model.test(), '测试失败').then((r) => setTest(r || null)) }}>
          <Icon name="refresh" size={14} stroke={2} />{test === 'busy' ? '正在测试…' : '测试连接'}
        </Key>
        <Key size="sm" isDisabled={probe === 'busy'} onPress={() => { setProbe('busy'); void run((api) => api.model.probe(), '检测失败').then((r) => { setProbe(r || null); if (r) play(r.ok ? 'done' : 'error') }) }}>
          <Icon name="search" size={14} stroke={2} />{probe === 'busy' ? '正在检测：模型、上下文、工具调用、思考…' : '检测模型'}
        </Key>
        {test && test !== 'busy' && (test.ok
          ? <span className="small ok-ink"><Icon name="check" size={13} stroke={2.4} /> 连接正常 · {test.model} · {test.ms} ms</span>
          : <span className="small err-ink"><Icon name="warn" size={13} /> 连不上：{test.error}</span>)}
      </div>
      {probe && probe !== 'busy' && <ProbeResult probe={probe} envFile={probe.envFile} />}

      <div className="set-label models-head">
        <span>可用的模型（{list ? list.models.length : '…'} 个）</span>
        <Key size="sm" isDisabled={!list || list.locked || !!edit} onPress={() => setEdit({ draft: { ...EMPTY }, hasKey: false })}><Icon name="plus" size={14} stroke={2} />添加模型</Key>
      </div>
      <div className="set-list card models-list">
        {list?.models.map((x) => (
          <div key={x.id} className={`model-row ${x.active ? 'on' : ''}`}>
            <span className={`model-radio ${x.active ? 'on' : ''}`} aria-hidden="true" />
            <div className="model-main">
              <div className="model-title"><span className="strong">{x.name}</span>{x.active && <span className="pill sm ok"><span className="dot" />在用</span>}{x.builtin && <span className="pill sm idle">local.env</span>}</div>
              <div className="mono muted small ellipsis">{x.model} · {x.baseURL}</div>
              <div className="muted small">上下文 {fmtK(x.contextWindow)} · 单次输出 {fmtK(x.maxTokens)} · {THINKING[x.thinkingFormat] || x.thinkingFormat}{x.input.includes('image') ? ' · 能看图' : ''} · 密钥{x.hasKey ? '已配置' : '未配置'}</div>
            </div>
            <div className="model-acts">
              {!x.active && <Key size="sm" variant="primary" isDisabled={list.locked} onPress={() => void use(x)}>使用</Key>}
              <Key size="sm" variant="ghost" onPress={() => checkSaved(x)}>检测</Key>
              {!x.builtin && <Key size="sm" variant="ghost" isDisabled={list.locked || !!edit} onPress={() => setEdit({ draft: fromProfile(x), hasKey: x.hasKey })}>编辑</Key>}
              {!x.builtin && <Key size="sm" variant="ghost" isDisabled={list.locked} onPress={() => void remove(x)}><Icon name="trash" size={13} /></Key>}
            </div>
          </div>
        ))}
      </div>
      {edit && list && <ModelEditor init={edit} presets={list.presets} onCancel={() => setEdit(null)} onSaved={(l, used) => { setEdit(null); void refresh(l); useStore.getState().toast({ text: used ? '已保存，并切换到这个模型' : '已保存', tone: 'ok' }, 2500) }} />}
    </section>
  )
}

function ModelEditor({ init, presets, onCancel, onSaved }: { init: { draft: ModelDraft; hasKey: boolean; preset?: string }; presets: ModelPreset[]; onCancel(): void; onSaved(l: ModelList, used: boolean): void }) {
  const run = useStore((s) => s.run)
  const [d, setD] = useState<ModelDraft>(init.draft)
  const [preset, setPreset] = useState<ModelPreset | null>(null)
  const [found, setFound] = useState<ModelProbe['listMeta'] | null>(null)
  const [busy, setBusy] = useState<'' | 'list' | 'probe' | 'save'>('')
  const [probe, setProbe] = useState<ModelProbe | null>(null)
  const [err, setErr] = useState('')
  const isNew = !d.id
  const set = (p: Partial<ModelDraft>) => { setD((x) => ({ ...x, ...p })); setErr('') }
  const pick = (p: ModelPreset) => { setPreset(p); setFound(null); setProbe(null); set({ name: p.name, baseURL: p.baseURL, model: p.model, thinkingFormat: p.thinkingFormat, contextWindow: p.contextWindow, maxTokens: p.maxTokens, input: p.input, key: p.defaultKey }) }
  const fetchList = async () => {
    setBusy('list'); setErr('')
    const r = await run((api) => api.model.probeDraft({ ...d, listOnly: true }), '获取失败')
    setBusy('')
    if (!r) return
    if (!r.ok || !r.listMeta) { setErr(r.checks.map((c) => `${c.detail}${c.fix ? `（${c.fix}）` : ''}`).join('；')); return }
    setFound(r.listMeta)
    const first = r.listMeta.find((x) => x.id === d.model) || r.listMeta[0]
    if (first) chooseModel(first)
  }
  const chooseModel = (x: NonNullable<ModelProbe['listMeta']>[number]) => {
    const p: Partial<ModelDraft> = { model: x.id }
    if (x.maxModelLen) { p.contextWindow = x.maxModelLen; p.maxTokens = Math.min(32768, Math.floor(x.maxModelLen / 4)) }
    if (x.family === 'qwen') p.thinkingFormat = 'qwen-chat-template'
    if (x.family === 'deepseek' && !/api\.deepseek\.com/.test(d.baseURL)) p.thinkingFormat = 'chat-template'
    set(p)
  }
  const check = async () => {
    setBusy('probe'); setProbe(null)
    const r = await run((api) => api.model.probeDraft(d), '检测失败')
    setBusy(''); if (r) { setProbe(r); play(r.ok ? 'done' : 'error') }
  }
  const apply = (sg: Record<string, string>) => {
    const p: Partial<ModelDraft> = {}
    if (sg.DEPT_LLM_MODEL) p.model = sg.DEPT_LLM_MODEL
    if (sg.DEPT_LLM_CONTEXT_WINDOW) p.contextWindow = Number(sg.DEPT_LLM_CONTEXT_WINDOW)
    if (sg.DEPT_LLM_MAX_TOKENS) p.maxTokens = Number(sg.DEPT_LLM_MAX_TOKENS)
    if (sg.DEPT_LLM_THINKING_FORMAT) p.thinkingFormat = sg.DEPT_LLM_THINKING_FORMAT
    set(p); setProbe(null)
  }
  const save = async (useIt: boolean) => {
    setBusy('save'); setErr('')
    try {
      const api = useStore.getState().api!
      const l = await api.model.save({ ...d, key: d.key ? d.key : undefined, use: useIt })
      onSaved(l, useIt)
    } catch (e) { setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)); play('error') } finally { setBusy('') }
  }
  return (
    <div className="model-edit card">
      <div className="model-edit-head"><span className="strong">{isNew ? '添加模型' : `编辑“${init.draft.name}”`}</span><span className="muted small">OpenAI 兼容接口（/v1/chat/completions）</span></div>
      {isNew && (
        <div className="preset-row" role="group" aria-label="从预设开始">
          {presets.map((p) => <Button key={p.id} className={`preset ${preset?.id === p.id ? 'on' : ''}`} onPress={() => pick(p)}>{p.name}</Button>)}
        </div>
      )}
      {preset && <div className="muted small preset-note"><Icon name="bulb" size={13} />{preset.note}</div>}
      <div className="field-row">
        <label className="field grow"><span>名称</span><input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="例如：局域网 Qwen3.8-27B" /></label>
      </div>
      <div className="field-row">
        <label className="field grow"><span>地址（末尾带 /v1）</span><input className="mono" value={d.baseURL} onChange={(e) => { set({ baseURL: e.target.value }); setFound(null) }} placeholder="http://192.168.10.20:8000/v1" /></label>
        <Key size="sm" isDisabled={busy !== '' || !/^https?:\/\/.+/.test(d.baseURL)} onPress={() => void fetchList()}><Icon name="download" size={13} />{busy === 'list' ? '正在获取…' : '获取模型列表'}</Key>
      </div>
      <div className="field-row">
        <label className="field grow"><span>模型名（--served-model-name）</span><input className="mono" value={d.model} onChange={(e) => set({ model: e.target.value })} placeholder="qwen3.8-27b" /></label>
        <label className="field grow"><span>密钥（vLLM 没设 --api-key 时随便填）</span><input type="password" value={d.key || ''} onChange={(e) => set({ key: e.target.value })} placeholder={init.hasKey ? '已配置，留空不改' : '没有可以留空'} autoComplete="off" /></label>
      </div>
      {found && found.length > 0 && (
        <div className="found-row"><span className="muted small">服务端有：</span>{found.map((x) => <Button key={x.id} className={`preset sm ${d.model === x.id ? 'on' : ''}`} onPress={() => chooseModel(x)}>{x.id}{x.maxModelLen ? ` · ${fmtK(x.maxModelLen)}` : ''}</Button>)}</div>
      )}
      <div className="field-row">
        <label className="field"><span>思考参数</span>
          <select value={d.thinkingFormat} onChange={(e) => set({ thinkingFormat: e.target.value })}>
            <option value="qwen-chat-template">Qwen（vLLM / SGLang）</option>
            <option value="chat-template">vLLM 模板参数（DeepSeek 等）</option>
            <option value="deepseek">DeepSeek 官方接口</option>
            <option value="qwen">Qwen 云接口</option>
            <option value="off">不思考</option>
          </select>
        </label>
        <label className="field"><span>上下文（tokens）</span><input type="number" min={8192} step={1024} value={d.contextWindow} onChange={(e) => set({ contextWindow: Number(e.target.value) })} /></label>
        <label className="field"><span>单次输出上限</span><input type="number" min={1024} step={1024} value={d.maxTokens} onChange={(e) => set({ maxTokens: Number(e.target.value) })} /></label>
        <div className="field"><span>能看图</span><Toggle isSelected={d.input === 'text,image'} onChange={(v) => set({ input: v ? 'text,image' : 'text' })} aria-label="能看图" /></div>
      </div>
      {err && <div className="err-ink small model-err"><Icon name="warn" size={13} />{err}</div>}
      {probe && <ProbeResult probe={probe} onApply={apply} />}
      <div className="set-actions model-edit-acts">
        <Key size="sm" isDisabled={busy !== ''} onPress={() => void check()}><Icon name="search" size={13} />{busy === 'probe' ? '正在检测…' : '检测'}</Key>
        <span className="grow" />
        <Key size="sm" variant="ghost" isDisabled={busy === 'save'} onPress={onCancel}>取消</Key>
        <Key size="sm" isDisabled={busy !== ''} onPress={() => void save(false)}>保存</Key>
        <Key size="sm" variant="primary" isDisabled={busy !== ''} onPress={() => void save(true)}>保存并使用</Key>
      </div>
    </div>
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
  ['Ctrl Shift B', '收起或展开任务页右边的面板'],
  ['Ctrl Shift T', '切换任务模式和代码模式'],
  ['Ctrl 1～9', '打开侧栏里第 1～9 个工程的主页'],
  ['Ctrl ,', '设置'],
  ['Ctrl Enter', '发送（输入框里 Enter 是换行）'],
  ['/', '输入框里选技能'],
  ['Tab', '新任务页：选推荐的技能；搜索里：切换范围'],
  ['P / R / A / D', '任务的“⋯”菜单开着时：置顶、重命名、归档、删除'],
  ['Esc', '关闭弹层、菜单；任务进行中、输入框为空时停止当前一轮'],
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

/**
 * 网页访问：工作台还在这台电脑上运行、代码留在本机，在浏览器里打开 http://IP:端口 用同一个工作台（main/web.mjs）。
 * 智能体能在这台电脑上读写文件、执行命令，所以一定要口令，局域网访问要单独打开。
 */
function WebAccess() {
  const run = useStore((x) => x.run)
  const toast = useStore((x) => x.toast)
  const viaWeb = useStore((x) => !!x.api?.viaWeb)
  const [st, setSt] = useState<WebState | null>(null)
  const [port, setPort] = useState('')
  const [show, setShow] = useState(false)
  useEffect(() => {
    void run((api) => api.web.state(), '读取网页访问设置失败').then((r) => { if (r) { setSt(r); setPort(String(r.port)) } })
    const api = useStore.getState().api
    return api?.onEvent((e) => { if (e.type === 'web') setSt(e.payload) })
  }, [run])
  const set = async (patch: Parameters<NonNullable<ReturnType<typeof useStore.getState>['api']>['web']['set']>[0], msg?: string) => {
    const r = await run((api) => api.web.set(patch), '设置失败')
    if (r) { setSt(r); setPort(String(r.port)); if (msg) toast({ text: msg, tone: r.error ? 'err' : 'ok' }) }
  }
  const copy = (text: string, what: string) => void run((api) => (api.sys.copy ? api.sys.copy(text) : navigator.clipboard.writeText(text))).then(() => toast({ text: `已复制${what}`, tone: 'ok' }))
  if (!st) return <section className="set-sec"><h2>网页访问</h2><p className="muted">正在读取…</p></section>
  const confirm = useStore.getState().askConfirm
  return (
    <section className="set-sec">
      <h2>网页访问</h2>
      <p className="muted small">工作台还在这台电脑上运行，代码留在本机；在浏览器里打开下面的地址，用的是同一个工作台，桌面窗口和网页看到的一样。开着网页访问时，关闭窗口会缩到托盘，网页照常能用。</p>
      {viaWeb && <div className="web-note small"><Icon name="external" size={14} />你现在就是从网页打开的。<a href="/logout">退出网页登录</a></div>}
      <Row title="开启网页访问" desc={st.running ? `运行中${st.clients ? ` · ${st.clients} 个浏览器连着` : ''}` : st.error || '关着'}>
        <Toggle isSelected={st.enabled} onChange={(v) => {
          if (!v && viaWeb) confirm({ title: '关闭网页访问？', body: '你现在就是从网页打开的，关掉后这个页面会断开，要回到那台电脑上的桌面窗口再打开。', ok: '关闭', danger: true, run: () => set({ enabled: false }) })
          else void set({ enabled: v }, v ? '网页访问已开启' : '网页访问已关闭')
        }} aria-label="开启网页访问" />
      </Row>
      <Row title="端口" desc="1024～65535，被别的程序占用时换一个">
        <span className="web-port">
          <input className="field-input" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="端口" />
          {port !== String(st.port) && <Key size="sm" onPress={() => void set({ port: Number(port) }, '端口已改')}>保存</Key>}
        </span>
      </Row>
      <Row title="允许局域网访问" desc={st.lan ? `和这台电脑同一网段的电脑和手机输入地址和口令就能用；别的网段连不进来${st.subnets && st.subnets.length ? `（网段：${st.subnets.join('、')}）` : ''}` : '关着时只有这台电脑自己的浏览器能打开（127.0.0.1）'}>
        <Toggle isSelected={st.lan} onChange={(v) => {
          if (v) confirm({ title: '允许局域网访问？', body: '和这台电脑同一网段、知道地址和口令的人，都能用这个工作台在你电脑上读写文件、运行命令（拿到口令就等于是你）。只在可信的内网打开，口令只留给自己用。', ok: '允许', run: () => set({ lan: true }, '已允许局域网访问') })
          else void set({ lan: false }, '只允许本机访问')
        }} aria-label="允许局域网访问" />
      </Row>
      {st.enabled && (
        <div className="set-group">
          <div className="set-label">访问地址</div>
          {st.urls.length ? st.urls.map((u) => (
            <div key={u} className="web-url"><span className="mono">{u}</span><Key size="sm" onPress={() => copy(u, '地址')}>复制</Key></div>
          )) : <div className="muted small">没找到这台电脑的局域网地址（没连网？）</div>}
        </div>
      )}
      <div className="set-group">
        <div className="set-label">访问口令</div>
        <div className="web-url">
          <span className="mono">{show ? st.token : '•'.repeat(st.token.length)}</span>
          <Key size="sm" onPress={() => setShow(!show)}>{show ? '隐藏' : '显示'}</Key>
          <Key size="sm" onPress={() => copy(st.token, '口令')}>复制</Key>
          <Key size="sm" onPress={() => confirm({ title: '换一个口令？', body: '已经登录的浏览器都要用新口令重新登录。', ok: '换口令', run: () => set({ newToken: true }, '已换新口令') })}>换口令</Key>
        </div>
      </div>
      <div className="set-group">
        <div className="set-label">最近登录{st.sessions ? `（${st.sessions} 个浏览器登录着）` : ''}</div>
        {(st.logins || []).length ? (st.logins || []).slice(0, 8).map((l, i) => (
          <div key={i} className={`web-login small ${l.ok ? '' : 'bad'}`}><span className="mono">{l.ip}</span><span>{new Date(l.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span>{l.ok ? '登录' : '口令错误'}</span></div>
        )) : <div className="muted small">这次开启以来还没有人登录</div>}
        {!!st.sessions && <div className="web-url"><Key size="sm" onPress={() => confirm({ title: '让所有浏览器下线？', body: `已登录的浏览器（${st.sessions} 个）都要重新输口令${viaWeb ? '，包括你现在这个页面' : ''}。口令不变。`, ok: '全部下线', danger: true, run: () => set({ kickAll: true }, '已全部下线') })}>全部下线</Key></div>}
      </div>
      <div className="sched-notes muted small">
        <p>· 拿到口令就等于是你：能看到这台电脑上的全部工作，也能让智能体在这里读写文件、运行命令。口令只留给自己用；同事要用，请在他自己的电脑上装 AstroLab。</p>
        <p>· 网页里“打开项目文件夹”要输入这台电脑上的路径；“用默认程序打开”“在文件夹中显示”改为下载文件。</p>
        <p>· 同一个口令连错 10 次，那个地址锁 10 分钟。登录 7 天后要重新登录。</p>
        <p>· 网页是 http（不加密），只在内网用；不要把端口映射到外网。</p>
      </div>
    </section>
  )
}
