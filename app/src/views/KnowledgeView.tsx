// 知识库：检索个人库、部门通用库、型号库里的经验、好的设计和代码；看条目；在我的库里新建、编辑、确认草稿；提交到共享库审核。
// 智能体在任务中会检索（知识库工具服务）；用户在对话里要求“记到知识库”时，它把内容记成我的库里的草稿，在这里确认。

import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useStore } from '../store'
import type { Inbox, InboxItem, InboxReport, KbEntry, KbHit, KbKind, KbMeta, LibSource } from '../api'
import { Icon } from '../components/Icon'
import { Key } from '../components/Keys'
import { Markdown } from '../components/Markdown'

const KINDS: KbKind[] = ['经验', '设计', '代码', '问题']
const KIND_TONE: Record<string, string> = { 经验: 'run', 设计: 'ok', 代码: 'idle', 问题: 'ask' }

export function KnowledgeView() {
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const openEditor = useStore((s) => s.openKbEditor)
  const version = useStore((s) => s.kbVersion)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<string>('')
  const [libId, setLibId] = useState<string>('')
  const [hits, setHits] = useState<KbHit[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [entry, setEntry] = useState<KbEntry | null>(null)
  const [sources, setSources] = useState<LibSource[]>([])
  const [tab, setTab] = useState<'entries' | 'inbox'>('entries')
  const [inbox, setInbox] = useState<Inbox | null>(null)
  useEffect(() => { void run((api) => api.kb.inbox()).then((b) => b && setInbox(b)) }, [run, version, tab])
  const inboxCount = inbox ? inbox.items.length : 0

  useEffect(() => { void run((api) => api.lib.state()).then((s) => s && setSources(s.sources)) }, [run, version])
  useEffect(() => {
    const t = setTimeout(() => {
      void run((api) => api.kb.search(q, { kind: kind || undefined, lib: libId || undefined })).then((h) => {
        setHits(h || [])
        if (h && h.length && (!sel || !h.some((x) => x.id === sel))) setSel(h[0].id)
        if (h && !h.length) setSel(null)
      })
    }, 160)
    return () => clearTimeout(t)
  }, [q, kind, libId, run, version])
  useEffect(() => {
    if (!sel) { setEntry(null); return }
    void run((api) => api.kb.read(sel)).then((e) => setEntry(e || null))
  }, [sel, run, version])

  const drafts = hits.filter((h) => h.status === '草稿').length
  const shared = sources.filter((s) => !s.local)
  const synced = shared.filter((s) => s.cloned && !s.error).length

  return (
    <div className="kb-layout">
      <div className="page-head pad-x">
        <div>
          <h1>知识库</h1>
          <div className="sub">
            个人的经验、好的设计和代码，加上部门通用库、型号库里大家分享的 · 共享库 {synced}/{shared.length} 已同步
            {shared.some((s) => s.error) && <span className="err-text"> · {shared.filter((s) => s.error).map((s) => `${s.name}：${s.error}`).join('；')}</span>}
          </div>
        </div>
        <div className="row gap">
          <div className="segmented small" role="tablist" aria-label="知识库">
            <button type="button" role="tab" aria-selected={tab === 'entries'} className={`seg-btn ${tab === 'entries' ? 'on' : ''}`} onClick={() => setTab('entries')}>条目</button>
            <button type="button" role="tab" aria-selected={tab === 'inbox'} className={`seg-btn ${tab === 'inbox' ? 'on' : ''}`} onClick={() => setTab('inbox')}>待整理{inboxCount ? <span className="seg-count">{inboxCount}</span> : null}</button>
          </div>
          <ObsidianButton />
          {tab === 'entries' && <Key size="sm" onPress={() => void run((api) => api.lib.sync(), '同步失败').then((s) => { if (s) { setSources(s); useStore.setState({ kbVersion: version + 1 }) } })}><Icon name="refresh" size={14} />同步共享库</Key>}
          {tab === 'entries' && <Key size="sm" variant="primary" onPress={() => openEditor({ meta: { kind: '经验' }, body: '' })}><Icon name="plus" size={14} stroke={2} />新建条目</Key>}
        </div>
      </div>

      {tab === 'inbox' && inbox && <InboxPanel inbox={inbox} onChanged={() => useStore.setState({ kbVersion: version + 1 })} />}
      {tab === 'entries' && <div className="kb-body pad-x">
        <section className="kb-list card" aria-label="检索结果">
          <div className="kb-search">
            <Icon name="search" size={15} className="muted" />
            <input autoFocus placeholder="搜经验、设计和代码，例如：1553B 复位 超时" value={q} onChange={(e) => setQ(e.target.value)} aria-label="检索知识库" />
          </div>
          <div className="kb-filters">
            {['', ...KINDS].map((k) => <button key={k || 'all'} type="button" className={`fchip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k || '全部'}</button>)}
            <select className="kb-lib" value={libId} onChange={(e) => setLibId(e.target.value)} aria-label="来源库">
              <option value="">全部库</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {drafts > 0 && <div className="kb-note"><span className="led ask" />{drafts} 条是智能体记下的草稿，看过确认后才算数</div>}
          <div className="kb-hits">
            {hits.map((h) => (
              <Button key={h.id} className={`kb-hit ${sel === h.id ? 'on' : ''}`} onPress={() => setSel(h.id)}>
                <span className="kb-hit-top"><span className={`pill sm ${KIND_TONE[h.kind] || 'idle'}`}>{h.kind}</span>{h.status === '草稿' && <span className="pill sm ask">草稿</span>}<span className="kb-hit-title">{h.title}</span></span>
                <span className="kb-hit-snip">{h.snippet}</span>
                <span className="kb-hit-meta">{h.libName}{h.model ? ` · ${h.model}` : ''}{h.date ? ` · ${h.date}` : ''}{h.tags.length ? ` · ${h.tags.slice(0, 3).join('、')}` : ''}</span>
              </Button>
            ))}
            {!hits.length && <div className="pad muted small">{q ? '没有找到。换个说法，或者新建一条。' : '还没有条目。做完任务后智能体会记草稿，也可以自己新建。'}</div>}
          </div>
        </section>

        <section className="kb-detail card" aria-label="条目">
          {entry ? <EntryView entry={entry} sources={shared} onChanged={(id) => { useStore.setState({ kbVersion: version + 1 }); if (id !== undefined) setSel(id) }} toast={toast} /> : <div className="pad muted">选一条看全文。</div>}
        </section>
      </div>}
    </div>
  )
}

const day = (ms: number) => { const d = new Date(ms); return `${d.getMonth() + 1} 月 ${d.getDate()} 日` }

/** 待整理：知识整理出的候选和整理报告。采纳 = 移进我的库的 knowledge/；在 Obsidian 里移动、删除也一样 */
function InboxPanel({ inbox, onChanged }: { inbox: Inbox; onChanged: () => void }) {
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const ts = useStore((s) => s.ts)
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  const [sel, setSel] = useState<string | null>(null)
  const all: (({ type: 'item' } & InboxItem) | ({ type: 'report' } & InboxReport))[] = [...inbox.reports.map((r) => ({ type: 'report' as const, ...r })), ...inbox.items.map((i) => ({ type: 'item' as const, ...i }))]
  useEffect(() => { if (!sel || !all.some((x) => x.path === sel)) setSel(all[0]?.path || null) }, [inbox])
  const cur = all.find((x) => x.path === sel) || null
  const d = inbox.distill
  const distill = async () => { await run((api) => api.kb.distill(), '没有发起整理') }
  const accept = async (path: string) => {
    const id = await run((api) => api.kb.accept(path), '没有采纳')
    if (id) { toast({ text: '已采纳，收进了我的库', tone: 'ok' }); onChanged() }
  }
  const discard = async (path: string, what: string) => {
    const ok = await run(async (api) => { await api.kb.discard(path); return true }, '没有删掉')
    if (ok) { toast({ text: `已丢弃这条${what}`, tone: 'info' }); onChanged() }
  }
  return (
    <div className="kb-body pad-x">
      <section className="kb-list card" aria-label="待整理">
        <div className="inbox-head">
          <div className="small">
            <div>{d.lastRun ? `上次整理：${day(d.lastRun)}` : '还没有整理过'}{d.pending ? ` · 之后结束了 ${d.pending} 个任务` : ' · 之后没有新任务'}</div>
            {d.scope === 'sample' && <div className="muted">现在用的是公网接口，只整理示例工程的任务{d.skipped ? `（${d.skipped} 个其他工程的任务等换成部门模型再整理）` : ''}</div>}
          </div>
          <Key size="sm" variant="primary" isDisabled={busy || !d.pending} onPress={() => void distill()}><Icon name="sparkle" size={14} />整理最近的任务</Key>
        </div>
        <div className="kb-hits">
          {all.map((x) => (
            <Button key={x.path} className={`kb-hit ${sel === x.path ? 'on' : ''}`} onPress={() => setSel(x.path)}>
              {x.type === 'report'
                ? <span className="kb-hit-top"><span className="pill sm idle">报告</span><span className="kb-hit-title">{x.title}</span></span>
                : <span className="kb-hit-top"><span className={`pill sm ${KIND_TONE[x.meta.kind] || 'idle'}`}>{x.meta.kind || '？'}</span>{x.problems.length > 0 && <span className="pill sm ask">要补</span>}<span className="kb-hit-title">{x.meta.title || x.path}</span></span>}
              <span className="kb-hit-meta">{x.type === 'report' ? x.date : x.meta.source || '缺来源'}</span>
            </Button>
          ))}
          {!all.length && <div className="pad muted small">没有待整理的。整理会读最近任务里人改过的地方、中途说的话和出过的错，挑出值得记的写成候选，你看过才收进知识库。</div>}
        </div>
      </section>
      <section className="kb-detail card" aria-label="候选">
        {!cur && <div className="pad muted">选一条看全文。</div>}
        {cur && cur.type === 'report' && (
          <div className="kb-entry">
            <div className="kb-entry-head"><div className="kb-entry-tags"><span className="pill sm idle">整理报告</span><span className="muted small">{cur.date}</span></div><h2>{cur.title}</h2></div>
            <div className="kb-entry-body"><Markdown text={cur.body} /></div>
            <div className="kb-entry-foot">
              <ObsidianButton path={cur.path} label="在 Obsidian 中打开" />
              <span className="grow" />
              <Key size="sm" onPress={() => void discard(cur.path, '报告')}><Icon name="x" size={14} stroke={2} />删掉报告</Key>
            </div>
          </div>
        )}
        {cur && cur.type === 'item' && (
          <div className="kb-entry">
            <div className="kb-entry-head">
              <div className="kb-entry-tags"><span className={`pill sm ${KIND_TONE[cur.meta.kind] || 'idle'}`}>{cur.meta.kind || '？'}</span><span className="pill sm ask">候选</span>{cur.meta.model && <span className="muted small">{cur.meta.model}</span>}</div>
              <h2>{cur.meta.title || cur.path}</h2>
              <div className="muted small">{[cur.meta.tags.length && `标签 ${cur.meta.tags.join('、')}`, cur.meta.source && `来源 ${cur.meta.source}`].filter(Boolean).join(' · ')}</div>
              {cur.problems.length > 0 && <div className="badge-warn inbox-problems"><Icon name="warn" size={14} />先补上再采纳：{cur.problems.join('；')}（在 Obsidian 里改，或者改好后再点采纳）</div>}
            </div>
            <div className="kb-entry-body"><Markdown text={cur.body} /></div>
            <div className="kb-entry-foot">
              <Key size="sm" variant="primary" isDisabled={cur.problems.length > 0} onPress={() => void accept(cur.path)}><Icon name="check" size={14} stroke={2.4} />采纳</Key>
              <ObsidianButton path={cur.path} label="在 Obsidian 中改" />
              <span className="grow" />
              <Key size="sm" onPress={() => void discard(cur.path, '候选')}><Icon name="x" size={14} stroke={2} />丢弃</Key>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/** 在 Obsidian 里打开我的库（或其中一个文件）。Obsidian 还不认识这个库时，告诉用户怎么把它加进去 */
function ObsidianButton({ path, label = 'Obsidian' }: { path?: string; label?: string }) {
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const [help, setHelp] = useState<null | { installed: boolean; dir: string }>(null)
  const open = async () => {
    const r = await run((api) => api.kb.obsidian(path), '打不开 Obsidian')
    if (r && !r.opened) setHelp({ installed: r.installed, dir: r.dir })
  }
  return (<>
    <Key size="sm" onPress={() => void open()}><Icon name="book" size={14} />{label}</Key>
    <ModalOverlay className="modal-scrim" isDismissable isOpen={!!help} onOpenChange={(o) => { if (!o) setHelp(null) }}>
      <Modal className="modal">
        <Dialog className="modal-dialog">
          <Heading slot="title" className="modal-title">把我的库加进 Obsidian</Heading>
          {help && !help.installed && <p className="muted">这台电脑上还没有用过 Obsidian：先安装（内网安装包找管理员），打开一次。</p>}
          <p>在 Obsidian 里选“打开本地仓库”（Open folder as vault），选这个文件夹。只要加一次，以后这里的按钮会直接打开。</p>
          <div className="mono small obs-dir">{help?.dir}</div>
          <p className="muted small">在 Obsidian 里改的条目，工作台每 3 分钟提交一次；“待整理”里的候选拖进 knowledge 下对应类别的文件夹就算采纳。共享库在 Obsidian 里只能看：同步时本地改动会被丢掉，要分享请在这里“提交到共享库”。</p>
          <div className="modal-foot">
            <Key size="sm" onPress={() => void run((api) => api.kb.openMine())}><Icon name="folder" size={14} />打开文件夹</Key>
            <Key size="sm" onPress={() => { if (help) void run(async (api) => { await api.sys.copy?.(help.dir); toast({ text: '路径已复制', tone: 'ok' }) }) }}>复制路径</Key>
            <span className="grow" />
            <Key size="sm" variant="primary" onPress={() => setHelp(null)}>知道了</Key>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  </>)
}

function EntryView({ entry, sources, onChanged, toast }: { entry: KbEntry; sources: LibSource[]; onChanged: (id?: string | null) => void; toast: (t: { text: string; tone?: 'ok' | 'err' | 'info' }) => void }) {
  const run = useStore((s) => s.run)
  const openEditor = useStore((s) => s.openKbEditor)
  const [target, setTarget] = useState('')
  const m = entry.meta
  const targets = useMemo(() => sources.filter((s) => s.cloned && (!m.model || !s.model || s.model === m.model)), [sources, m.model])
  useEffect(() => { setTarget(targets[0]?.id || '') }, [entry.id, targets])
  const mine = entry.writable
  const confirm = async () => {
    const meta = { ...m }
    delete meta.status
    const id = await run((api) => api.kb.save({ id: entry.id, meta, body: entry.body }), '保存失败')
    if (id) { toast({ text: '已确认，这条经验收进了我的库', tone: 'ok' }); onChanged(id) }
  }
  const publish = async () => {
    if (!target) return
    const r = await run((api) => api.kb.publish(entry.id, target), '提交失败')
    if (r) toast({ text: `已提交到${sources.find((s) => s.id === target)?.name}，审核通过后大家就能看到`, tone: 'ok' })
  }
  const copyToMine = () => openEditor({ meta: { ...m, status: undefined, source: m.source || `${entry.libName} ${entry.path}` }, body: entry.body })
  return (
    <div className="kb-entry">
      <div className="kb-entry-head">
        <div className="kb-entry-tags"><span className={`pill sm ${KIND_TONE[m.kind] || 'idle'}`}>{m.kind || '经验'}</span>{m.status === '草稿' && <span className="pill sm ask">草稿 · 智能体记的</span>}<span className="muted small">{entry.libName}{m.model ? ` · ${m.model}` : ''}</span></div>
        <h2>{m.title || entry.path}</h2>
        <div className="muted small">{[m.author && `作者 ${m.author}`, m.date, m.tags.length && `标签 ${m.tags.join('、')}`, m.source && `来源 ${m.source}`].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="kb-entry-body"><Markdown text={entry.body} /></div>
      <div className="kb-entry-foot">
        {mine ? (<>
          {m.status === '草稿' && <Key size="sm" variant="primary" onPress={() => void confirm()}><Icon name="check" size={14} stroke={2.4} />确认收下</Key>}
          <Key size="sm" onPress={() => openEditor({ id: entry.id, meta: m, body: entry.body })}><Icon name="edit" size={14} />编辑</Key>
          <DeleteEntry id={entry.id} onDone={() => onChanged(null)} />
          <span className="grow" />
          {m.status !== '草稿' && (targets.length
            ? (<><select className="kb-lib" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="提交到">{targets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <Key size="sm" onPress={() => void publish()}><Icon name="upload" size={14} />提交到共享库</Key></>)
            : <span className="muted small">{sources.length ? (m.model ? `没有“${m.model}”的型号库可提交` : '共享库还没同步') : '没有配置共享库'}</span>)}
        </>) : (<>
          <span className="muted small">这是{entry.libName}里的条目，改动要走审核</span>
          <span className="grow" />
          <Key size="sm" onPress={copyToMine}><Icon name="edit" size={14} />复制到我的库再改</Key>
        </>)}
      </div>
    </div>
  )
}

function DeleteEntry({ id, onDone }: { id: string; onDone: () => void }) {
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const [open, setOpen] = useState(false)
  return (<>
    <Key size="sm" onPress={() => setOpen(true)}><Icon name="x" size={14} stroke={2} />删除</Key>
    <ModalOverlay className="modal-scrim" isDismissable isOpen={open} onOpenChange={setOpen}>
      <Modal className="modal">
        <Dialog className="modal-dialog">
          <Heading slot="title" className="modal-title">删除这一条？</Heading>
          <p className="muted">只删我的库里的这一条。之前提交到共享库的不受影响（Git 里有历史，能找回）。</p>
          <div className="modal-foot">
            <Key size="sm" onPress={() => setOpen(false)}>取消</Key>
            <Key size="sm" variant="primary" onPress={() => void run(async (api) => { await api.kb.remove(id); return true }, '删除失败').then((ok) => { setOpen(false); if (ok) { toast({ text: '已删除', tone: 'info' }); onDone() } })}>删除</Key>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  </>)
}

/** 新建或编辑条目（全局一个，任务页、审核页的“存到知识库”也用它） */
export function KbEditor() {
  const ed = useStore((s) => s.kbEditor)
  const close = useStore((s) => s.closeKbEditor)
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const [meta, setMeta] = useState<KbMeta>({ title: '', kind: '经验', tags: [] })
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  useEffect(() => {
    if (!ed) return
    setMeta(ed.meta)
    setTags(ed.meta.tags.join('、'))
    setBody(ed.body)
  }, [ed])
  if (!ed) return null
  const save = async () => {
    if (!meta.title.trim()) { toast({ text: '写一句标题：这条经验的结论', tone: 'info' }); return }
    const m: KbMeta = { ...meta, title: meta.title.trim(), tags: tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean), model: meta.model?.trim() || undefined }
    const id = await run((api) => api.kb.save({ id: ed.id, meta: m, body }), '保存失败')
    if (id) { toast({ text: '已存到我的库', tone: 'ok' }); close(true) }
  }
  return (
    <ModalOverlay className="modal-scrim" isDismissable isOpen onOpenChange={(o) => { if (!o) close() }}>
      <Modal className="modal wide">
        <Dialog className="modal-dialog kb-editor" aria-label="知识条目">
          <Heading slot="title" className="modal-title">{ed.id ? '编辑条目' : '存到知识库'}</Heading>
          <label className="field"><span>标题（一句话结论）</span><input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="例如：1553B RT 复位等待用“大于或等于”判就绪" autoFocus /></label>
          <div className="field-row">
            <div className="field"><span>类别</span>
              <div className="segmented small">{KINDS.map((k) => <button key={k} type="button" className={`seg-btn ${meta.kind === k ? 'on' : ''}`} onClick={() => setMeta({ ...meta, kind: k })}>{k}</button>)}</div>
            </div>
            <label className="field"><span>型号（通用的不填）</span><input value={meta.model || ''} onChange={(e) => setMeta({ ...meta, model: e.target.value })} placeholder="型号A" /></label>
            <label className="field grow"><span>标签</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="1553B、复位、超时" /></label>
          </div>
          <label className="field"><span>正文（Markdown，代码放在 ``` 代码块里）</span><textarea className="mono" rows={14} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <label className="field"><span>来源</span><input value={meta.source || ''} onChange={(e) => setMeta({ ...meta, source: e.target.value })} placeholder="任务、文件、设计条目号" /></label>
          <div className="modal-foot">
            <span className="muted small grow">先存到我的库，只有你能看到；要分享时再提交到共享库审核</span>
            <Key size="sm" onPress={() => close()}>取消</Key>
            <Key size="sm" variant="primary" onPress={() => void save()}>保存</Key>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
