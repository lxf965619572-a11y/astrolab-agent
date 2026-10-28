// 代码模式（和 Claude 一样）：左边照常是任务侧栏，中间是对话，右边是代码面板（文件树 + 代码/差异 + 提交）。
// 改动相对任务开始前的快照；智能体每写一个文件就自动刷新。审核和提交也在这里，不用再去单独的审核页。
// 只读：代码只由智能体改（这样快照、审核、提交的链条是完整的）；想自己改，点“用编辑器打开”。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { motion } from 'motion/react'
import { useStore } from '../store'
import type { Change } from '../api'
import { Icon } from '../components/Icon'
import { Key, Kbd } from '../components/Keys'
import { CodeFile, Diff } from '../components/Diff'
import { FileRender, RENDERABLE } from '../components/FileRender'
import { CodeResizer } from '../components/Panels'
import { play } from '../sound'
import { Conversation } from './TaskView'
import { LaunchView } from './LaunchView'

type Shown = { path: string; binary: boolean; before: string | null; after: string | null; changed: Change | null; tooLarge?: boolean }
type Node = { name: string; path: string; dir: boolean; children: Node[]; change?: Change; changedBelow: number }

const ST: Record<string, { text: string; tag: string }> = { A: { text: '新', tag: '新文件' }, M: { text: '改', tag: '修改' }, D: { text: '删', tag: '已删除' } }

/** fresh：代码模式的新任务页（中间是输入框，右边浏览项目）；否则中间是当前代码任务的对话 */
export function CodeView({ fresh = false }: { fresh?: boolean }) {
  const ts = useStore((s) => s.ts)
  const panel = useStore((s) => s.settings.panel)
  const items = useStore((s) => s.items)
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const focus = useStore((s) => s.codeFocus)
  const draft = useStore((s) => s.draft)
  const task = fresh ? null : ts?.task
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false

  const [changes, setChanges] = useState<Change[]>([])
  const [tree, setTree] = useState<string[]>([])
  const [onlyChanged, setOnlyChanged] = useState(true)
  const [scopeChosen, setScopeChosen] = useState(false) // 用户自己点过“改动/全部文件”后不再自动切
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [mode, setMode] = useState<'diff' | 'full' | 'view'>('diff')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)

  const byPath = useMemo(() => new Map(changes.map((c) => [c.path, c])), [changes])

  const load = useCallback(async () => {
    const [c, t] = await Promise.all([
      task?.snapshot ? run((api) => api.review.changes()) : Promise.resolve([] as Change[]),
      run((api) => api.project.tree()),
    ])
    setChanges(c || [])
    setTree(t || [])
  }, [run, task?.snapshot])

  // 智能体每写完一个文件（活动里多了一条工具记录）就刷新，合并 0.7 秒内的多次变化
  const toolCount = useMemo(() => items.filter((i) => i.kind === 'tools').length, [items])
  const loadedOnce = useRef(false)
  useEffect(() => {
    const t = setTimeout(() => { loadedOnce.current = true; void load() }, loadedOnce.current ? 700 : 0) // 刚进来立刻读，之后合并
    return () => clearTimeout(t)
  }, [load, toolCount, ts?.status, task?.id, task?.restoredAt, task?.commit?.sha])
  useEffect(() => { if (task) setMessage(`${task.stageName}：${task.title}`) }, [task?.id])
  // 没有改动时看全部文件；一有改动就切到“改动”（用户自己选过的不动）
  useEffect(() => { if (!scopeChosen) setOnlyChanged(changes.length > 0) }, [changes.length, scopeChosen])

  // 默认打开第一个改动的文件；从任务页点进来的文件优先
  useEffect(() => {
    if (focus) { setSel(focus); useStore.getState().setCodeFocus(null); return }
    if (!sel && changes[0]) setSel(changes[0].path)
  }, [changes, focus, sel])

  // 读选中的文件：有快照时读“开始前/现在”两个版本，否则只读现在
  useEffect(() => {
    if (!sel) { setShown(null); return }
    let alive = true
    const c = byPath.get(sel) || null
    void (async () => {
      if (task?.snapshot) {
        const f = await run((api) => api.review.file(sel))
        if (alive && f) setShown({ path: sel, binary: f.binary, before: f.before, after: f.after, changed: c })
      } else {
        const f = await run((api) => api.project.read(sel))
        if (alive && f) setShown({ path: sel, binary: f.binary, before: f.text, after: f.text, changed: null, tooLarge: f.tooLarge })
      }
    })()
    return () => { alive = false }
  }, [sel, byPath, run, task?.snapshot, toolCount])

  // 文件树：只看改动时只放改动的文件；搜索时按路径筛
  const root = useMemo(() => {
    const paths = onlyChanged ? changes.map((c) => c.path) : [...new Set([...tree, ...changes.map((c) => c.path)])]
    const k = q.trim().toLowerCase()
    return buildTree(paths.filter((p) => !k || p.toLowerCase().includes(k)), byPath)
  }, [onlyChanged, changes, tree, q, byPath])
  // 有改动或搜到的目录默认展开
  useEffect(() => {
    const next = new Set(open)
    // 没有改动时（浏览项目）先展开第一层目录，免得一进来只看到一排折叠的文件夹
    const walk = (n: Node, d: number) => { if (n.dir && (n.changedBelow || q || (!changes.length && d === 0))) next.add(n.path); n.children.forEach((c) => walk(c, d + 1)) }
    root.children.forEach((c) => walk(c, 0))
    if (next.size !== open.size) setOpen(next)
  }, [root]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    if (!changes.length || committing || busy || task?.commit) return
    setCommitting(true)
    const sha = await run((api) => api.review.commit(message.trim() || `${task?.stageName}：${task?.title}`, changes.map((c) => c.path)), '提交失败')
    setCommitting(false)
    if (!sha) { void load(); return }
    play('commit')
    toast({ text: `已提交 · ${sha.slice(0, 7)}`, tone: 'ok', action: { label: '撤销', run: () => void run((api) => api.review.undo(), '撤销失败').then(() => toast({ text: '已撤销提交，改动仍在工作区', tone: 'info' })) } }, 8000)
  }

  // 键盘：J/K 切换改动的文件，Ctrl S 提交
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void commit(); return }
      if (typing || !changes.length) return
      const i = changes.findIndex((c) => c.path === sel)
      if (e.key === 'j') setSel(changes[Math.min(changes.length - 1, i + 1)].path)
      if (e.key === 'k') setSel(changes[Math.max(0, i - 1)].path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const added = changes.reduce((s, c) => s + (c.added || 0), 0)
  const removed = changes.reduce((s, c) => s + (c.removed || 0), 0)
  const cur = shown && shown.path === sel ? shown : null
  const isChanged = !!cur?.changed
  const showDiff = isChanged && mode === 'diff'
  // Markdown、SVG、HTML 可以看渲染后的样子（HTML 比如信息流插件的交互版，能点能缩放）
  const renderable = !!cur && !cur.binary && cur.changed?.status !== 'D' && RENDERABLE.test(cur.path)
  const isHtml = !!cur && /\.html?$/i.test(cur.path)
  // 换到不能预览的文件时回到代码
  useEffect(() => { if (mode === 'view' && cur && !renderable) setMode('diff') }, [mode, cur, renderable])

  return (
    <div className="code-layout">
      {/* 中间是对话（和任务模式同一条）；没有任务时是新任务输入框。右边是代码面板 */}
      <div className="code-center">
        {task ? <Conversation inCode /> : <LaunchView compact />}
      </div>

      {/* 环境和上下文跟着任务走；还没开始时把位置让给中间的输入框 */}
      {panel && task && <InfoColumn task={task} />}
      {panel && <aside className="code-panel" aria-label="代码">
        <CodeResizer />
        <div className="cp-head">
          <div className="cp-title">
            <span className="strong cp-route">{task?.snapshot ? <><Icon name="branch" size={14} />{ts?.project?.branch || 'HEAD'}<Icon name="arrow" size={13} stroke={2} />工作区</> : '项目文件'}
              {/* 窗口窄、环境那一列藏起来时，上下文用量放这里 */}
              {task && (ts?.summary.usage || task.usage) && <span className="cp-ctx-mini" title="上下文已用">上下文 {ctxPct(ts?.summary.usage || task.usage, useStore.getState().app?.model.contextWindow)}</span>}
            </span>
            <span className="muted small">
              {!task ? `${ts?.project?.name || ''} · 只读浏览`
                : task.snapshot
                  ? <>{changes.length ? <>{changes.length} 个文件 <span className="add mono">+{added}</span>{removed ? <span className="rem mono"> −{removed}</span> : null}</> : '还没有改动'}{busy && <span className="live-note"><span className="led" />写完一个文件就刷新</span>}</>
                  : '不是 Git 仓库：只能看文件，看不到改动对比'}
            </span>
          </div>
          {task?.snapshot && (
            <div className="segmented small" role="tablist" aria-label="文件范围">
              <button type="button" role="tab" aria-selected={onlyChanged} className={`seg-btn ${onlyChanged ? 'on' : ''}`} disabled={!changes.length} onClick={() => { setOnlyChanged(true); setScopeChosen(true) }}>改动 {changes.length}</button>
              <button type="button" role="tab" aria-selected={!onlyChanged} className={`seg-btn ${!onlyChanged ? 'on' : ''}`} onClick={() => { setOnlyChanged(false); setScopeChosen(true) }}>全部文件</button>
            </div>
          )}
        </div>

        <div className="cp-body">
          <div className="cp-tree">
            <input className="file-search" placeholder="搜文件" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="tree-list" role="tree">
              {root.children.map((n) => <TreeRow key={n.path} n={n} depth={0} open={open} setOpen={setOpen} sel={sel} onPick={(p) => { setSel(p); setMode('diff') }} />)}
              {!root.children.length && <div className="muted small pad">{q ? '没有找到' : onlyChanged ? '还没有改动' : '没有文件'}</div>}
            </div>
          </div>

          <section className="code-pane" aria-label="文件内容">
            {cur ? (<>
              <div className="diff-head">
                <span className="diff-path code-path" title={cur.path}>
                  <span className="mono strong">{cur.path.split('/').pop()}</span>
                  {cur.path.includes('/') && <span className="mono muted small"> {cur.path.slice(0, cur.path.lastIndexOf('/'))}</span>}
                </span>
                {cur.changed && <span className={`tag fs-${cur.changed.status}`}>{ST[cur.changed.status]?.tag}</span>}
                {cur.changed && !cur.binary && <span className="mono small"><span className="add">+{cur.changed.added ?? 0}</span>{cur.changed.removed ? <span className="rem"> −{cur.changed.removed}</span> : null}</span>}
                <span className="grow" />
                {((isChanged && !cur.binary && cur.changed?.status === 'M') || renderable) && (
                  <div className="segmented small" role="tablist" aria-label="显示方式">
                    {renderable && <button type="button" role="tab" aria-selected={mode === 'view'} className={`seg-btn ${mode === 'view' ? 'on' : ''}`} onClick={() => setMode('view')}>预览</button>}
                    {cur.changed?.status === 'M' && <button type="button" role="tab" aria-selected={mode === 'diff'} className={`seg-btn ${mode === 'diff' ? 'on' : ''}`} onClick={() => setMode('diff')}>改动</button>}
                    <button type="button" role="tab" aria-selected={mode === 'full' || (mode === 'diff' && cur.changed?.status !== 'M')} className={`seg-btn ${mode === 'full' || (mode === 'diff' && cur.changed?.status !== 'M') ? 'on' : ''}`} onClick={() => setMode('full')}>{renderable ? '源码' : '全文'}</button>
                  </div>
                )}
                {!task && cur.changed?.status !== 'D' && (
                  <Key size="sm" onPress={() => {
                    if (!draft.files.includes(cur.path)) useStore.getState().setDraft({ files: [...draft.files, cur.path] })
                    toast({ text: `已把 ${cur.path.split('/').pop()} 加到新任务里`, tone: 'ok' })
                  }}><Icon name="plus" size={13} stroke={2.2} />加到新任务</Key>
                )}
                {cur.changed?.status !== 'D' && <Key size="sm" aria-label={/\.(docx?|xlsx?)$/i.test(cur.path) ? '用 Office 打开' : '用编辑器打开'} onPress={() => void run((api) => api.sys.openPath(cur.path), '打开失败')}><Icon name="external" size={13} />打开</Key>}
              </div>
              <motion.div key={`${cur.path}|${mode}`} className="diff-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>
                {cur.binary && <div className="pad muted">这是二进制文件（如 Word、Excel），不能逐行查看。点右上角“打开”用对应程序看。</div>}
                {/* HTML 预览不用读进来（主进程直接给预览框），大文件也能看 */}
                {mode === 'view' && renderable && (isHtml || !cur.tooLarge) ? <FileRender path={cur.path} text={cur.after ?? cur.before ?? ''} version={toolCount} />
                  : cur.tooLarge ? <div className="pad muted">文件太大（超过 2 MB），这里不显示。点右上角“打开”用编辑器看。</div> : null}
                {mode !== 'view' && !cur.binary && !cur.tooLarge && (showDiff
                  ? <Diff path={cur.path} before={cur.before ?? ''} after={cur.after ?? ''} />
                  : <CodeFile path={cur.path} text={cur.after ?? cur.before ?? ''} />)}
              </motion.div>
            </>) : <div className="pad muted code-empty"><Icon name="file" size={18} />在左边选一个文件</div>}
          </section>
        </div>

        {task?.snapshot && !!changes.length && (
          <div className="commit-bar code-commit">
            {task.commit ? (<>
              <Icon name="check" size={16} className="ok-ink" />
              <span className="grow ellipsis">已提交 <span className="mono">{task.commit.sha.slice(0, 7)}</span> · {task.commit.message}</span>
              <Key size="sm" onPress={() => void run((api) => api.review.undo(), '撤销失败')}>撤销提交</Key>
            </>) : (<>
              <label htmlFor="code-commit-msg" className="sr-only">提交说明</label>
              <input id="code-commit-msg" className="commit-input" value={message} onChange={(e) => setMessage(e.target.value)} title="提交说明" />
              <RestoreButton disabled={busy} onDone={() => void load()} />
              <Key variant="primary" isDisabled={busy || committing} onPress={() => void commit()}>
                {busy ? '做完再提交' : committing ? '提交中…' : `接受并提交 ${changes.length} 个文件`}<Kbd>Ctrl S</Kbd>
              </Key>
            </>)}
          </div>
        )}
        {task?.snapshot && <div className="cp-note muted small"><Icon name="undo" size={13} />开始前已保存快照，不满意可以一键恢复</div>}
      </aside>}
    </div>
  )
}

/** 代码模式：环境（本机、项目、分支、快照）和上下文用量（和 Claude Code 右边那一列一样） */
function InfoColumn({ task }: { task: import('../api').Task | null | undefined }) {
  const ts = useStore((s) => s.ts)
  const app = useStore((s) => s.app)
  const p = ts?.project
  const usage = task ? ts?.summary.usage || task.usage || null : null
  const win = app?.model.contextWindow || 1048576
  const pct = usage ? Math.min(100, (usage.used / win) * 100) : 0
  const live = !!task && !!ts && ['starting', 'running', 'asking'].includes(ts.status)
  return (
    <aside className="code-info" aria-label="环境和上下文">
      <section className="ci-card">
        <div className="ci-title">环境</div>
        <div className="ci-row"><Icon name="computer" size={15} stroke={1.7} /><span className="grow">本机</span><span className="muted small">{app?.mock ? '模拟引擎' : app?.model.model}</span></div>
        <div className="ci-row" title={p?.path}><Icon name="folder" size={15} stroke={1.7} /><span className="ellipsis"><span className="strong">{p?.name}</span><span className="muted small"> · {p?.path}</span></span></div>
        <div className="ci-row"><Icon name="branch" size={15} stroke={1.7} /><span className="mono">{p?.git === false ? '不是 Git 仓库' : p?.branch || 'main'}</span></div>
        <div className="ci-row"><Icon name="undo" size={15} stroke={1.7} /><span className="small">{!task ? '开始任务时保存快照' : task.snapshot ? '任务前快照已保存' : '没有快照（不能一键恢复）'}</span></div>
        <div className="ci-row"><Icon name="shield" size={15} stroke={1.7} /><span className="small">只能写项目目录，不能提交 Git</span></div>
      </section>
      <section className="ci-card">
        <div className="ci-title">上下文</div>
        {usage ? (<>
          <div className="ci-ctx"><span className="strong">{pct < 1 ? pct.toFixed(1) : Math.round(pct)}% 已用</span><span className="muted small mono">{tok(usage.used)} / {tok(win)}</span></div>
          <div className="ci-bar" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="上下文已用"><span style={{ width: `${Math.max(1.5, pct)}%` }} /></div>
          <div className="ci-kv"><span className="ci-dot a" />最近一次输入<span className="grow" /><span className="mono">{tok(usage.input + usage.cacheRead)}</span></div>
          <div className="ci-kv"><span className="ci-dot b" />其中缓存命中<span className="grow" /><span className="mono">{tok(usage.cacheRead)}</span></div>
          <div className="ci-kv"><span className="ci-dot c" />最近一次输出<span className="grow" /><span className="mono">{tok(usage.output)}</span></div>
          <div className="ci-kv"><span className="ci-dot d" />调用模型<span className="grow" /><span className="mono">{usage.calls} 次</span></div>
          {pct > 80 && <div className="ci-warn small"><Icon name="warn" size={13} />快满了：引擎会自动压缩早先的对话，细节可能丢，必要时开个新任务</div>}
        </>) : <div className="muted small">{live ? '等第一次模型调用…' : task ? '这个任务没有记录用量' : '开始任务后显示用了多少上下文'}</div>}
      </section>
    </aside>
  )
}

const ctxPct = (u: { used: number } | null | undefined, win?: number) => { const p = u ? (u.used / (win || 1048576)) * 100 : 0; return `${p < 1 ? p.toFixed(1) : Math.round(p)}%` }
const tok = (n: number) => (n >= 1048576 && n % 1048576 === 0 ? `${n / 1048576}M` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function buildTree(paths: string[], byPath: Map<string, Change>): Node {
  const root: Node = { name: '', path: '', dir: true, children: [], changedBelow: 0 }
  for (const p of paths) {
    const parts = p.split('/')
    let n = root
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      const last = i === parts.length - 1
      let c = n.children.find((x) => x.name === name && x.dir === !last)
      if (!c) { c = { name, path, dir: !last, children: [], changedBelow: 0 }; n.children.push(c) }
      if (last) c.change = byPath.get(p)
      n = c
    })
  }
  const finish = (n: Node): number => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'zh') : a.dir ? -1 : 1))
    n.changedBelow = n.dir ? n.children.reduce((s, c) => s + finish(c), 0) : n.change ? 1 : 0
    return n.changedBelow
  }
  finish(root)
  // 只有一个子目录的目录链压成一行（像 utest/rt1553/src）
  const squash = (n: Node) => {
    n.children.forEach(squash)
    n.children = n.children.map((c) => {
      let x = c
      while (x.dir && x.children.length === 1 && x.children[0].dir) x = { ...x.children[0], name: `${x.name}/${x.children[0].name}` }
      return x
    })
  }
  squash(root)
  return root
}

function TreeRow({ n, depth, open, setOpen, sel, onPick }: { n: Node; depth: number; open: Set<string>; setOpen: (s: Set<string>) => void; sel: string | null; onPick: (p: string) => void }) {
  const isOpen = open.has(n.path)
  const pad = { paddingLeft: 10 + depth * 14 }
  if (n.dir) {
    return (<>
      <Button className="tree-row dir" style={pad} onPress={() => { const s = new Set(open); if (isOpen) s.delete(n.path); else s.add(n.path); setOpen(s) }} aria-expanded={isOpen}>
        <Icon name="chevron" size={12} stroke={2.2} className={`tree-caret ${isOpen ? 'open' : ''}`} />
        <Icon name="folder" size={14} stroke={1.7} />
        <span className="tree-name">{n.name}</span>
        {!!n.changedBelow && <span className="tree-count">{n.changedBelow}</span>}
      </Button>
      {isOpen && n.children.map((c) => <TreeRow key={c.path} n={c} depth={depth + 1} open={open} setOpen={setOpen} sel={sel} onPick={onPick} />)}
    </>)
  }
  const st = n.change?.status
  return (
    <Button className={`tree-row file ${sel === n.path ? 'on' : ''} ${st ? `ch-${st}` : ''}`} style={pad} onPress={() => onPick(n.path)}>
      <span className="tree-caret-space" />
      <Icon name="file" size={14} stroke={1.7} />
      <span className="tree-name mono">{n.name}</span>
      {st && <span className={`fs fs-${st}`}>{ST[st].text}</span>}
      {n.change && !n.change.binary && st !== 'D' && <span className="tree-delta mono"><span className="add">+{n.change.added ?? 0}</span>{n.change.removed ? <span className="rem">−{n.change.removed}</span> : null}</span>}
    </Button>
  )
}

/** 恢复快照：撤掉这次任务的全部改动（对话保留） */
export function RestoreButton({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  return (
    <DialogTrigger>
      <Key isDisabled={disabled}>恢复快照</Key>
      <ModalOverlay className="modal-scrim" isDismissable>
        <Modal className="modal">
          <Dialog className="modal-dialog">
            {({ close }) => (<>
              <Heading slot="title" className="modal-title">恢复到任务开始前？</Heading>
              <p className="muted">这次任务改动、新建的文件都会撤掉，工作区回到开始前的样子。对话记录保留，之后还可以让智能体重做。</p>
              <div className="modal-foot">
                <Key onPress={close}>取消</Key>
                <Key variant="primary" onPress={async () => { const n = await run((api) => api.review.restore(), '恢复失败'); close(); if (n !== undefined) { toast({ text: `已恢复 ${n} 个文件`, tone: 'ok' }); onDone() } }}>恢复</Key>
              </div>
            </>)}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  )
}
