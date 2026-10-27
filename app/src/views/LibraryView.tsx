// 技能与插件：内置的、从共享库安装的、自己做的；一键安装、卸载、更新；让智能体帮你做新技能或插件；提交到共享库审核；
// 审核人在这里看别人提交的改动，通过或退回；管理共享库（内网 Git 仓库）的地址。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useStore } from '../store'
import type { CatalogItem, LibSource, Pending, Submission } from '../api'
import { Icon } from '../components/Icon'
import { Key, Toggle } from '../components/Keys'
import { Markdown } from '../components/Markdown'
import { Diff } from '../components/Diff'
import { clock } from '../format'
import { play } from '../sound'

type Tab = 'installed' | 'available' | 'mine' | 'submissions' | 'review' | 'sources'

export function LibraryView() {
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const settings = useStore((s) => s.settings)
  const ts = useStore((s) => s.ts)
  const [tab, setTab] = useState<Tab>('installed')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [sources, setSources] = useState<LibSource[]>([])
  const [viewing, setViewing] = useState<string | null>(null)
  const [creating, setCreating] = useState<null | 'skill' | 'plugin'>(null)
  const busy = !!ts && ['starting', 'running', 'asking'].includes(ts.status)

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([run((api) => api.lib.catalog()), run((api) => api.lib.state())])
    setItems(c || [])
    if (s) setSources(s.sources)
  }, [run])
  useEffect(() => { void load() }, [load])

  const installed = items.filter((i) => i.installed)
  const available = items.filter((i) => !i.installed && !i.mine && !i.builtin)
  const mine = items.filter((i) => i.mine)
  const shared = sources.filter((s) => !s.local)
  const tabs: [Tab, string][] = [['installed', `已安装 ${installed.length}`], ['available', `可安装 ${available.length}`], ['mine', `我做的 ${mine.length}`], ['submissions', '我的提交'], ...(settings.reviewer ? [['review', '审核'] as [Tab, string]] : []), ['sources', '共享库']]

  const act = async (f: () => Promise<{ restarted?: boolean } | undefined | void>, ok: string) => {
    const r = await f()
    if (r === undefined) return
    toast({ text: r && 'restarted' in r ? `${ok}。${r.restarted ? '引擎正在重新加载，下个任务就能用' : '当前任务结束后引擎会重新加载'}` : ok, tone: 'ok' }, 5000)
    await load()
  }

  return (
    <div className="lib-layout">
      <div className="page-head pad-x">
        <div>
          <h1>技能与插件</h1>
          <div className="sub">技能告诉智能体怎么做一类工作；插件把技能、工具服务和模板打成一个包。分享到共享库要经过审核</div>
        </div>
        <div className="row gap">
          <Key size="sm" isDisabled={busy} onPress={() => setCreating('plugin')}><Icon name="puzzle" size={14} />做一个插件</Key>
          <Key size="sm" variant="primary" isDisabled={busy} onPress={() => setCreating('skill')}><Icon name="sparkle" size={14} />做一个技能</Key>
        </div>
      </div>
      <div className="pad-x lib-tabs">
        <div className="segmented" role="tablist" aria-label="分类">
          {tabs.map(([t, label]) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={`seg-btn ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{label}</button>)}
        </div>
      </div>
      <div className="lib-body pad-x">
        {tab === 'installed' && <Grid items={installed} empty="还没有安装。" render={(i) => (<>
          <Key size="sm" onPress={() => setViewing(i.key)}>查看</Key>
          {!i.builtin && i.update && <Key size="sm" variant="primary" onPress={() => void act(() => run((api) => api.lib.install(i.key), '更新失败'), `已更新 ${i.name}`)}>更新</Key>}
          {!i.builtin && <Key size="sm" onPress={() => void act(() => run((api) => api.lib.uninstall(i.kind, i.name), '卸载失败'), `已卸载 ${i.name}`)}>卸载</Key>}
        </>)} />}
        {tab === 'available' && <Grid items={available} empty={shared.length ? '共享库里还没有别的技能和插件，或者还没同步。' : '还没有配置共享库：在“共享库”里加上部门的内网 Git 仓库地址。'} render={(i) => (<>
          <Key size="sm" onPress={() => setViewing(i.key)}>查看</Key>
          <Key size="sm" variant="primary" onPress={() => void act(() => run((api) => api.lib.install(i.key), '安装失败'), `已安装 ${i.name}`)}>{i.installedFrom ? '改用这个' : '安装'}</Key>
        </>)} />}
        {tab === 'mine' && <Grid items={mine} empty="还没有自己做的。点右上角“做一个技能”，智能体会问你几个问题，然后写好放进我的库。" render={(i) => (<>
          <Key size="sm" onPress={() => setViewing(i.key)}>查看</Key>
          <Key size="sm" onPress={() => void act(() => run((api) => api.lib.install(i.key), '安装失败'), `已安装 ${i.name}，可以试用了`)}>{i.installed ? '重新试用' : '试用'}</Key>
          <SubmitButton item={i} sources={shared} onDone={() => { toast({ text: '已提交，审核通过后大家就能安装', tone: 'ok' }); void load() }} />
        </>)} />}
        {tab === 'submissions' && <Submissions />}
        {tab === 'review' && <Review sources={shared} />}
        {tab === 'sources' && <Sources sources={sources} onChange={(s) => { setSources(s); void load() }} />}
      </div>
      {viewing && <Viewer itemKey={viewing} onClose={() => setViewing(null)} />}
      {creating && <CreateDialog kind={creating} onClose={() => setCreating(null)} />}
    </div>
  )
}

function Grid({ items, empty, render }: { items: CatalogItem[]; empty: string; render: (i: CatalogItem) => React.ReactNode }) {
  if (!items.length) return <div className="lib-empty muted">{empty}</div>
  return (
    <div className="lib-grid">
      {items.map((i) => (
        <article key={i.key} className="lib-card card">
          <div className="lib-card-top">
            <span className={`lib-kind ${i.kind}`}><Icon name={i.kind === 'skill' ? 'skills' : 'puzzle'} size={15} /></span>
            <span className="lib-name">{i.title || i.name}{i.title && <span className="muted small mono block">{i.name}</span>}</span>
            {i.version && <span className="muted small mono">v{i.version}</span>}
            <span className="grow" />
            <span className={`pill sm ${i.builtin ? 'idle' : i.mine ? 'run' : 'ok'}`}>{i.sourceName}</span>
          </div>
          <p className="lib-desc">{i.description || '（没有说明）'}</p>
          {i.kind === 'plugin' && !!i.mcp?.length && <div className="lib-warn"><Icon name="terminal" size={13} />含工具服务：{i.mcp.join('、')}（会在你的电脑上运行）</div>}
          {i.update && <div className="lib-update">有新版本</div>}
          <div className="lib-actions">{render(i)}</div>
        </article>
      ))}
    </div>
  )
}

function SubmitButton({ item, sources, onDone }: { item: CatalogItem; sources: LibSource[]; onDone: () => void }) {
  const run = useStore((s) => s.run)
  const [open, setOpen] = useState(false)
  const ready = sources.filter((s) => s.cloned)
  const [target, setTarget] = useState('')
  useEffect(() => { setTarget(ready[0]?.id || '') }, [ready.length])
  return (<>
    <Key size="sm" isDisabled={!ready.length} onPress={() => setOpen(true)}><Icon name="upload" size={14} />提交到共享库</Key>
    <ModalOverlay className="modal-scrim" isDismissable isOpen={open} onOpenChange={setOpen}>
      <Modal className="modal">
        <Dialog className="modal-dialog">
          <Heading slot="title" className="modal-title">提交“{item.name}”</Heading>
          <p className="muted">会复制到共享库的一个待审核分支。审核人看过全部内容{item.kind === 'plugin' ? '（包括工具服务的代码）' : ''}并通过后，大家才能安装。</p>
          <label className="field"><span>提交到</span><select value={target} onChange={(e) => setTarget(e.target.value)}>{ready.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <div className="modal-foot">
            <Key size="sm" onPress={() => setOpen(false)}>取消</Key>
            <Key size="sm" variant="primary" isDisabled={!target} onPress={() => void run((api) => api.lib.submit(item.key, target), '提交失败').then((r) => { setOpen(false); if (r) onDone() })}>提交</Key>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  </>)
}

function Viewer({ itemKey, onClose }: { itemKey: string; onClose: () => void }) {
  const run = useStore((s) => s.run)
  const [d, setD] = useState<{ item: CatalogItem; text: string; readme: string } | null>(null)
  useEffect(() => { void run((api) => api.lib.read(itemKey)).then((r) => setD(r || null)) }, [itemKey, run])
  const body = useMemo(() => {
    if (!d) return ''
    if (d.item.kind === 'plugin') return `${d.readme || ''}\n\n**plugin.json**\n\n\`\`\`json\n${d.text}\n\`\`\``
    return d.text.replace(/^---[\s\S]*?---\s*/, '')
  }, [d])
  return (
    <ModalOverlay className="modal-scrim" isDismissable isOpen onOpenChange={(o) => { if (!o) onClose() }}>
      <Modal className="modal wide">
        <Dialog className="modal-dialog" aria-label="查看">
          <Heading slot="title" className="modal-title">{d ? d.item.name : '读取中…'}</Heading>
          {d && <p className="muted small">{d.item.description}</p>}
          <div className="viewer-body"><Markdown text={body} /></div>
          <div className="modal-foot"><Key size="sm" onPress={onClose}>关闭</Key></div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function CreateDialog({ kind, onClose }: { kind: 'skill' | 'plugin'; onClose: () => void }) {
  const run = useStore((s) => s.run)
  const setView = useStore((s) => s.setView)
  const [text, setText] = useState('')
  const start = async () => {
    if (!text.trim()) return
    const t = await run((api) => api.lib.create(kind, text.trim()), '没有开始')
    if (t) { onClose(); setView('task') }
  }
  return (
    <ModalOverlay className="modal-scrim" isDismissable isOpen onOpenChange={(o) => { if (!o) onClose() }}>
      <Modal className="modal wide">
        <Dialog className="modal-dialog" aria-label={kind === 'skill' ? '做一个技能' : '做一个插件'}>
          <Heading slot="title" className="modal-title">{kind === 'skill' ? '做一个技能' : '做一个插件'}</Heading>
          <p className="muted">{kind === 'skill'
            ? '说说这项工作：什么时候做、输入输出是什么、你平时怎么做、看哪些规范、容易错在哪。智能体会再问你几个问题，然后把技能写进我的库，你试用满意后再提交到共享库。'
            : '说说要给智能体加什么工具：算什么、查什么、依据哪份文档，最好给几组已知正确的输入和结果。智能体会做成插件（工具服务 + 使用它的技能）放进我的库。'}</p>
          <textarea className="create-text" rows={7} autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder={kind === 'skill' ? '例如：SpaceWire 报文走查。依据部门《SpaceWire 通信设计规范》第 4 章，检查报文头、长度、CRC 和超时处理……' : '例如：按《XX 通信协议》3.2 节计算 CRC-16/CCITT，核对报文里的 CRC 字段；已知 01 02 03 的 CRC 是 0x6131……'} />
          <div className="modal-foot">
            <span className="muted small grow">会把“我的库”当作项目打开，智能体只能写这里</span>
            <Key size="sm" onPress={onClose}>取消</Key>
            <Key size="sm" variant="primary" isDisabled={!text.trim()} onPress={() => void start()}>开始</Key>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function Submissions() {
  const run = useStore((s) => s.run)
  const [list, setList] = useState<Submission[] | null>(null)
  useEffect(() => { void run((api) => api.lib.submissions()).then((s) => setList(s || [])) }, [run])
  if (!list) return <div className="lib-empty muted">查询中…</div>
  if (!list.length) return <div className="lib-empty muted">还没有提交过。</div>
  return (
    <div className="card lib-table">
      {list.map((s) => (
        <div key={s.branch} className="lib-row">
          <span className={`pill sm ${s.status === '已通过' ? 'ok' : s.status === '待审核' ? 'run' : s.status === '已退回' ? 'err' : 'idle'}`}>{s.status}</span>
          <span className="grow">{s.title}<span className="muted small block mono">{s.path}</span></span>
          <span className="muted small">{s.library} · {new Date(s.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ))}
    </div>
  )
}

function Review({ sources }: { sources: LibSource[] }) {
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const ready = sources.filter((s) => s.cloned)
  const [lib, setLib] = useState(ready[0]?.id || '')
  const [list, setList] = useState<Pending[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [file, setFile] = useState<{ path: string; before: string | null; after: string | null } | null>(null)
  const load = useCallback(async () => { if (!lib) return; setList(null); const p = await run((api) => api.lib.pending(lib), '读取待审核失败'); setList(p || []) }, [lib, run])
  useEffect(() => { void load() }, [load])
  const show = async (p: Pending, path: string) => { const f = await run((api) => api.lib.pendingFile(lib, p.ref, path)); setFile(f || null) }
  // 通过、退回：按钮显示进行中，完成后明确告诉结果，这一项从列表里移走
  const [deciding, setDeciding] = useState<{ ref: string; kind: 'approve' | 'reject' } | null>(null)
  const [done, setDone] = useState<{ title: string; kind: 'approve' | 'reject'; lib: string } | null>(null)
  const decide = async (p: Pending, kind: 'approve' | 'reject') => {
    setDeciding({ ref: p.ref, kind })
    const r = await run(async (api): Promise<{ title: string }> => (kind === 'approve' ? api.lib.approve(lib, p.ref) : api.lib.reject(lib, p.ref)), kind === 'approve' ? '合并失败' : '退回失败')
    setDeciding(null)
    if (!r) return
    const libName = ready.find((s) => s.id === lib)?.name || lib
    play(kind === 'approve' ? 'commit' : 'tick')
    toast({ text: kind === 'approve' ? `已通过“${p.title}”，合并进了${libName}，大家同步后就能看到` : `已退回“${p.title}”，提交人会看到“已退回”`, tone: kind === 'approve' ? 'ok' : 'info' }, 6000)
    setDone({ title: p.title, kind, lib: libName })
    setOpen(null)
    setFile(null)
    setList((l) => (l || []).filter((x) => x.ref !== p.ref))
    useStore.setState({ kbVersion: useStore.getState().kbVersion + 1 })
  }
  if (!ready.length) return <div className="lib-empty muted">还没有同步好的共享库。</div>
  return (
    <div className="review-lib">
      <div className="row gap"><select className="kb-lib" value={lib} onChange={(e) => setLib(e.target.value)}>{ready.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><Key size="sm" onPress={() => void load()}><Icon name="refresh" size={14} />刷新</Key></div>
      {done && (
        <div className={`decided ${done.kind}`} role="status">
          <span className="decided-badge"><Icon name={done.kind === 'approve' ? 'check' : 'undo'} size={14} stroke={2.6} /></span>
          <span className="grow"><span className="strong">{done.kind === 'approve' ? '已通过' : '已退回'}</span>　{done.title}
            <span className="muted small block">{done.kind === 'approve' ? `已合并进${done.lib}的主分支。大家打开工作台或点“同步共享库”后就能看到、安装` : '提交分支已删除，提交人在“我的提交”里会看到“已退回”'}</span></span>
          <Button className="chip-x" aria-label="关闭" onPress={() => setDone(null)}><Icon name="x" size={12} stroke={2.4} /></Button>
        </div>
      )}
      {!list ? <div className="lib-empty muted">读取中…</div> : !list.length ? <div className="lib-empty muted">没有待审核的提交。</div> : list.map((p) => (
        <div key={p.ref} className="card pend">
          <Button className="pend-head" onPress={() => { setOpen(open === p.ref ? null : p.ref); setFile(null) }}>
            <span className="strong">{p.title}</span><span className="muted small">{p.author} · {clock(p.at)} · {p.files.length} 个文件</span><span className="grow" /><Icon name="chevron" size={14} />
          </Button>
          {open === p.ref && (<div className="pend-body">
            <div className="pend-files">{p.files.map((f) => <Button key={f.path} className={`file-opt ${file?.path === f.path ? 'on' : ''}`} onPress={() => void show(p, f.path)}><span className="mono small">{f.status}</span><span className="mono">{f.path}</span></Button>)}</div>
            {file && <div className="pend-diff"><Diff path={file.path} before={file.before ?? ''} after={file.after ?? ''} /></div>}
            <div className="modal-foot">
              <span className="muted small grow">插件的工具服务代码请逐行看过：会在每个安装的人电脑上运行</span>
              <Key size="sm" isDisabled={!!deciding} onPress={() => void decide(p, 'reject')}>{deciding?.ref === p.ref && deciding.kind === 'reject' ? '退回中…' : '退回'}</Key>
              <Key size="sm" variant="primary" isDisabled={!!deciding} onPress={() => void decide(p, 'approve')}>{deciding?.ref === p.ref && deciding.kind === 'approve' ? '合并中…' : '通过'}</Key>
            </div>
          </div>)}
        </div>
      ))}
    </div>
  )
}

function Sources({ sources, onChange }: { sources: LibSource[]; onChange: (s: LibSource[]) => void }) {
  const run = useStore((s) => s.run)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [f, setF] = useState({ name: '', url: '', branch: 'main', model: '' })
  return (
    <div className="sources">
      <div className="card lib-table">
        {sources.map((s) => (
          <div key={s.id} className="lib-row">
            <span className={`dot ${s.local ? 'ok' : s.error ? 'bad' : s.cloned ? 'ok' : 'off'}`} />
            <span className="grow"><span className="strong">{s.name}</span>{s.model && <span className="pill sm idle">型号 {s.model}</span>}{s.preset && <span className="muted small"> · 部门预置</span>}
              <span className="muted small block mono">{s.local ? '本机，只有你能看到' : `${s.url}（${s.branch}）`}</span>
              {s.error && <span className="err-text small block">{s.error}</span>}</span>
            <span className="muted small">{s.local ? '' : s.syncing ? '同步中…' : s.lastSync ? `同步于 ${clock(s.lastSync)}` : '未同步'}</span>
            {!s.local && <Key size="sm" onPress={() => void run((api) => api.lib.sync(s.id), '同步失败').then((r) => r && onChange(r))}>同步</Key>}
            {!s.local && !s.preset && <Key size="sm" onPress={() => void run((api) => api.lib.removeSource(s.id), '移除失败').then((r) => r && onChange(r))}>移除</Key>}
          </div>
        ))}
      </div>
      <div className="card add-source">
        <div className="strong">加一个共享库</div>
        <p className="muted small">内网 Git 服务器上的仓库。型号库填型号名：型号相关的条目只能提交到对应的型号库，看不看得到由 Git 服务器的权限决定。</p>
        <div className="field-row">
          <label className="field"><span>名字</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="部门通用库" /></label>
          <label className="field grow"><span>地址</span><input className="mono" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="http://git.intra/astrolab/library.git" /></label>
          <label className="field"><span>分支</span><input value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} /></label>
          <label className="field"><span>型号</span><input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="通用的不填" /></label>
        </div>
        <div className="modal-foot"><Key size="sm" variant="primary" isDisabled={!f.name.trim() || !f.url.trim()} onPress={() => void run((api) => api.lib.addSource(f), '添加失败').then((r) => { if (r) { onChange(r); setF({ name: '', url: '', branch: 'main', model: '' }) } })}>添加并同步</Key></div>
      </div>
      <div className="card add-source">
        <Toggle isSelected={settings.reviewer} onChange={(v) => setSettings({ reviewer: v })}>我是审核人（显示“审核”页）</Toggle>
        <p className="muted small">通过需要你在 Git 服务器上有主分支的推送权限；没有权限时，也可以在服务器的合并请求页面处理。</p>
      </div>
    </div>
  )
}
