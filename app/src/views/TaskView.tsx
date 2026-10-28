// 任务模式（和 Claude 一样）：一条对话从上到下——你说的话、智能体每一步（读文件、写代码、思考，同类合并、可展开）、
// 智能体的回复，输入框在底部。顶上一行是任务状态、用时、停止/继续。代码模式中间用的也是这条对话。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'react-aria-components'
import { AnimatePresence, motion } from 'motion/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '../store'
import type { Item, Todo } from '../api'
import { Icon } from '../components/Icon'
import { Key, Kbd } from '../components/Keys'
import { Markdown } from '../components/Markdown'
import { QuestionCard } from '../components/QuestionCard'
import { baseName, clock, duration, elapsed, nowLabel, toolsTitle } from '../format'
import { play } from '../sound'
import { TaskSide } from './TaskSide'

export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}

const STATUS: Record<string, { label: string; cls: string }> = {
  starting: { label: '启动中', cls: 'idle' }, running: { label: '进行中', cls: 'run' }, asking: { label: '等你决定', cls: 'ask' },
  done: { label: '完成，待审核', cls: 'ok' }, stopped: { label: '已停止，可继续', cls: 'idle' }, error: { label: '出错，可继续', cls: 'err' }, idle: { label: '空闲', cls: 'idle' },
}
const LIVE = ['starting', 'running', 'asking']

export function TaskView() {
  const panel = useStore((s) => s.settings.panel)
  return <div className="conv-page"><Conversation />{panel && <TaskSide />}</div>
}

/** 一条完整的对话：任务模式占满中间；代码模式在中间，右边是代码面板（inCode） */
export function Conversation({ inCode = false }: { inCode?: boolean }) {
  const ts = useStore((s) => s.ts)
  const questions = useStore((s) => s.questions)
  const [later, setLater] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  if (!ts?.task) return null
  const q = questions[0]
  const showQ = q && later !== q.id
  return (
    <section className={`conv ${inCode ? 'in-code' : ''}`} aria-label="对话">
      <ConvHead inCode={inCode} />
      <Stream inCode={inCode} />
      <Composer inputRef={input} pendingQuestion={q && !showQ ? () => setLater(null) : undefined} />
      <AnimatePresence>{showQ && <QuestionCard key={q.id} q={q} onLater={() => setLater(q.id)} />}</AnimatePresence>
    </section>
  )
}

/** 停止 / 继续（Ctrl .）：停止时还没送到的插话放回输入框；继续时输入框里的话一起发 */
function useToggle() {
  const ts = useStore((s) => s.ts)!
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const live = LIVE.includes(ts.status)
  return async () => {
    if (live) {
      const r = await run((api) => api.task.stop(), '停止失败')
      if (!r) return
      if (r.unsent.length) {
        const st = useStore.getState()
        st.setChatDraft([r.unsent.join('\n'), st.chatDraft].filter(Boolean).join('\n'))
        toast({ text: '已停止。还没送到的补充要求放回了输入框，改好后发送就接着做', tone: 'info' }, 6000)
      } else toast({ text: '已停止。对话和已写的文件都保留，可以随时继续', tone: 'info' })
    } else if (ts.status === 'stopped' || ts.status === 'error') {
      const st = useStore.getState()
      const draft = st.chatDraft.trim()
      if (draft) { st.setChatDraft(''); play('send') }
      await run((api) => api.task.resume(draft || undefined), '继续失败')
    }
  }
}

function ConvHead({ inCode }: { inCode: boolean }) {
  const ts = useStore((s) => s.ts)!
  const panel = useStore((s) => s.settings.panel)
  const run = useStore((s) => s.run)
  const setView = useStore((s) => s.setView)
  const hasDraft = useStore((s) => !!s.chatDraft.trim())
  const task = ts.task!
  const st = STATUS[ts.status] || STATUS.idle
  const live = LIVE.includes(ts.status)
  const now = useNow(live)
  const used = elapsed((live ? now : task.endedAt || ts.summary.endedAt || now) - task.startedAt)
  const toggle = useToggle()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.ctrlKey && e.key === '.') { e.preventDefault(); void toggle() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <header className={`conv-head ${live ? 'live' : ''}`}>
      <div className="conv-head-row">
        <div className="conv-title">
          <h1 title={task.title}>{task.title}</h1>
          <div className="conv-meta">
            <span className={`pill sm ${st.cls}`}><span className={`dot ${live && ts.status !== 'starting' ? 'breathe' : ''}`} />{st.label}</span>
            <span className="conv-stage">{task.stageName}</span>
            <span><Icon name="clock" size={12} stroke={2} />{used} · 第 {ts.summary.steps} 步</span>
            {!!ts.summary.files && <span>{ts.summary.files} 个文件 <span className="add">+{ts.summary.added}</span>{ts.summary.removed ? <span className="rem"> −{ts.summary.removed}</span> : null}</span>}
          </div>
        </div>
        <div className="conv-actions">
          <PanelToggle inCode={inCode} />
          {live && <Key size="sm" onPress={() => void toggle()}><Icon name="stop" size={14} />停止<Kbd>Ctrl .</Kbd></Key>}
          {(ts.status === 'stopped' || ts.status === 'error') && <Key size="sm" variant="primary" onPress={() => void toggle()}><Icon name="play" size={14} />{hasDraft ? '发送并继续' : '继续'}</Key>}
          {!live && <Key size="sm" onPress={() => void run((api) => api.task.reset()).then(() => setView(inCode ? 'code' : 'launch'))}><Icon name="plus" size={14} stroke={2} />新任务</Key>}
        </div>
      </div>
      {/* 任务模式右边面板开着时，进度在面板里，这里不重复 */}
      {!!ts.summary.todos.length && (inCode || !panel) && <Progress todos={ts.summary.todos} live={live} />}
    </header>
  )
}

/** 右边面板的开关（和 Claude 右上角一样） */
function PanelToggle({ inCode }: { inCode: boolean }) {
  const panel = useStore((s) => s.settings.panel)
  const setSettings = useStore((s) => s.setSettings)
  const label = `${panel ? '收起' : '展开'}${inCode ? '代码面板' : '进度和产出'}`
  return (
    <Button className={`side-collapse panel-toggle ${panel ? 'on' : ''}`} aria-label={label} aria-pressed={panel} onPress={() => setSettings({ panel: !panel })}>
      <Icon name="sidebar" size={17} stroke={1.7} className="flip" /><span className="rail-tip" aria-hidden="true">{label}</span>
    </Button>
  )
}

function Progress({ todos, live }: { todos: Todo[]; live: boolean }) {
  return (
    <div className="progress" style={{ gridTemplateColumns: `repeat(${todos.length}, minmax(0, 1fr))` }}>
      {todos.map((t, i) => (
        <div key={i} className={`seg ${t.status}`} title={t.content}>
          <div className={`seg-bar ${t.status === 'in_progress' && live ? 'shimmer' : ''}`} />
          <div className="seg-label">{t.status === 'completed' && <Icon name="check" size={12} stroke={2.6} />}{t.content}</div>
        </div>
      ))}
    </div>
  )
}

type Row =
  | { key: string; type: 'item'; item: Item }
  | { key: string; type: 'queued'; id: string; text: string }
  | { key: 'live'; type: 'live' }
  | { key: 'status'; type: 'status' }

/** 对话流：按时间排好的消息和动作，虚拟滚动（长任务几百步也不卡），在底部时自动跟随 */
function Stream({ inCode }: { inCode: boolean }) {
  const items = useStore((s) => s.items)
  const ts = useStore((s) => s.ts)!
  const rows = useMemo<Row[]>(() => {
    const r: Row[] = items
      .filter((i) => i.kind !== 'tools' || !(i.hidden || i.calls.every((c) => c.hidden)))
      .map((item) => ({ key: item.id, type: 'item', item }))
    for (const q of ts.queued) r.push({ key: `q-${q.id}`, type: 'queued', id: q.id, text: q.text })
    if (ts.status === 'starting' || (['running', 'asking'].includes(ts.status) && ts.summary.current)) r.push({ key: 'live', type: 'live' })
    else if (['done', 'stopped', 'error'].includes(ts.status)) r.push({ key: 'status', type: 'status' })
    return r
  }, [items, ts.queued, ts.status, ts.summary.current])
  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 48, overscan: 10, getItemKey: (i) => rows[i].key })
  const stick = useRef(true)
  useEffect(() => {
    const el = parent.current
    if (!el) return
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => { if (stick.current && rows.length) v.scrollToIndex(rows.length - 1, { align: 'end' }) }, [rows, v])
  return (
    <div className="conv-scroll" ref={parent}>
      <div className="conv-col" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((r) => {
          const row = rows[r.index]
          return (
            <div key={r.key} data-index={r.index} ref={v.measureElement} className="conv-vrow" style={{ transform: `translateY(${r.start}px)` }}>
              {row.type === 'item' ? <ItemRow item={row.item} />
                : row.type === 'queued' ? <div className="queued"><div className="bubble user pending">{row.text}</div><div className="queued-chip"><Icon name="check" size={12} stroke={2.4} />{ts.status === 'starting' ? '已收到，任务开始后送到' : '已收到，下一步之前送到'}</div></div>
                  : row.type === 'live' ? <LiveRow />
                    : <StatusRow inCode={inCode} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ItemRow({ item }: { item: Item }) {
  const ts = useStore((s) => s.ts)!
  if (item.kind === 'user') return <div className="msg-user"><div className="bubble user">{item.text}</div></div>
  if (item.kind === 'assistant') {
    return (
      <div className="msg-agent">
        <Markdown text={item.text} />
        <Button className="bubble-act" aria-label="存到知识库" onPress={() => useStore.getState().openKbEditor({ meta: { kind: '经验', title: '', source: `${ts.task?.stageName || ''}任务：${ts.task?.title || ''}` }, body: item.text })}><Icon name="book" size={13} />存到知识库</Button>
      </div>
    )
  }
  return <ActRow item={item} />
}

const END_REASON: Record<string, string> = { completed: '本轮结束', aborted: '已停止', blocked: '本轮被拦下', 'max-tokens': '输出太长被截断', error: '本轮出错' }

function ActRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false)
  if (item.kind === 'turn-end') {
    return <div className="act-row end" title={clock(item.at)}><span className="act-end-line" /><span className="muted small">{END_REASON[item.reason] || `本轮中断（${item.reason}）`}</span><span className="act-end-line" /></div>
  }
  if (item.kind === 'thinking') {
    return (
      <div className="act-row" title={clock(item.at)}>
        <span className="act-icon think"><Icon name="bulb" size={13} stroke={2} /></span>
        <div className="act-body">
          <Button className="act-toggle" onPress={() => setOpen(!open)} aria-expanded={open}>
            思考{item.ms ? ` ${duration(item.ms)}` : ''}<Icon name="chevron" size={14} stroke={2} className={`chev ${open ? 'up' : ''}`} />
          </Button>
          <AnimatePresence initial={false}>{open && <motion.div className="act-more" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>{item.text}</motion.div>}</AnimatePresence>
        </div>
      </div>
    )
  }
  if (item.kind !== 'tools') return null
  const t = toolsTitle(item)
  const icon = t.tone === 'warn' ? 'warn' : t.tone === 'err' ? 'x' : item.group === 'run' ? 'terminal' : item.group === 'skill' ? 'skills' : item.group === 'ask' ? 'at' : t.tone === 'run' ? 'clock' : 'check'
  const calls = item.calls.filter((c) => !c.hidden)
  return (
    <div className={`act-row ${t.tone}`} title={clock(item.at)}>
      <span className={`act-icon ${t.tone}`}><Icon name={icon} size={13} stroke={2.2} /></span>
      <div className="act-body">
        <Button className="act-toggle" onPress={() => setOpen(!open)} aria-expanded={open}>
          <span>{t.title}</span>
          {'added' in t && t.added ? <span className="add mono small">+{t.added}</span> : null}
          {'removed' in t && t.removed ? <span className="rem mono small">−{t.removed}</span> : null}
          <Icon name="chevron" size={14} stroke={2} className={`chev ${open ? 'up' : ''}`} />
        </Button>
        {item.group === 'write' || item.group === 'read'
          ? <FileLinks calls={calls} fallback={t.detail} />
          : t.detail && <div className="act-detail">{t.detail}</div>}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div className="act-more calls" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              {calls.map((c) => (
                <div key={c.callId} className="call">
                  <div className="call-head"><span className={`call-dot ${c.status}`} /><span className="mono">{c.name}</span><span className="muted">{c.command || c.path || c.summary}</span></div>
                  {c.result && <pre className="call-result">{c.result.slice(0, 1500)}</pre>}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** 读写过的文件：点一下在代码面板里看（写过的直接看改动） */
function FileLinks({ calls, fallback }: { calls: Extract<Item, { kind: 'tools' }>['calls']; fallback?: string }) {
  const project = useStore((s) => s.ts?.project?.path || '')
  const openInCode = useStore((s) => s.openInCode)
  const rel = (p: string) => {
    const a = p.replace(/\\/g, '/')
    const root = project.replace(/\\/g, '/').replace(/\/$/, '')
    return root && a.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? a.slice(root.length + 1) : a.replace(/^\.\//, '')
  }
  const paths = [...new Set(calls.map((c) => c.path).filter(Boolean).map((p) => rel(p!)))].filter((p) => !/^([a-z]:|\/)/i.test(p))
  if (!paths.length) return fallback ? <div className="act-detail">{fallback}</div> : null
  return (
    <div className="act-files">
      {paths.slice(0, 8).map((p) => (
        <Button key={p} className="act-file mono" onPress={() => openInCode(p)} aria-label={`在代码面板里看 ${p}`}>{baseName(p)}</Button>
      ))}
      {paths.length > 8 && <span className="muted small">等 {paths.length} 个</span>}
    </div>
  )
}

/** 对话最后一行：正在做什么（进行中） */
function LiveRow() {
  const ts = useStore((s) => s.ts)!
  const now = useNow(true)
  const cur = ts.summary.current
  const text = ts.status === 'starting'
    ? (ts.engine?.state === 'starting' ? '正在启动引擎（加载工具服务和技能，第一次启动可能要一两分钟）。现在就可以在下面补充要求' : '正在把任务交给智能体')
    : cur?.kind === 'thinking' ? '思考中' : nowLabel(cur) || '思考中'
  return (
    <div className="act-row live">
      <span className="act-icon"><span className="led" /></span>
      <span className="act-body"><span className="ink-2">{text}<span className="dots"><i>·</i><i>·</i><i>·</i></span></span>{cur && <span className="muted small"> 已 {duration(now - cur.since)}</span>}</span>
    </div>
  )
}

/** 对话最后一行：结束时的状态和下一步（做完了去看改动；停了可以继续） */
function StatusRow({ inCode }: { inCode: boolean }) {
  const ts = useStore((s) => s.ts)!
  const panel = useStore((s) => s.settings.panel)
  const setSettings = useStore((s) => s.setSettings)
  const toggle = useToggle()
  const hasDraft = useStore((s) => !!s.chatDraft.trim())
  // 代码模式里不写文件数：右边面板按快照算的才准（这里的数是写文件的次数）
  const text = ts.status === 'done' ? (ts.summary.files ? (inCode ? '做完了，等你审核后提交' : `做完了：改动 ${ts.summary.files} 个文件，等你审核后提交`) : '做完了')
    : ts.status === 'stopped' ? '已停止。对话和已写的文件都保留，点“继续”接着做，也可以先在下面补一句纠正说明'
      : ts.error || '引擎出错'
  return (
    <div className={`tc-now conv-status ${ts.status}`}>
      <Icon name={ts.status === 'error' ? 'warn' : ts.status === 'done' ? 'check' : 'terminal'} size={16} />
      <span className="grow">{text}</span>
      {ts.status === 'done' && !!ts.summary.files && (panel
        ? <span className="muted small">{inCode ? '在右边看改动，满意就提交' : '在右边“产出”里预览，满意就提交'}</span>
        : <Key size="sm" variant="primary" onPress={() => setSettings({ panel: true })}>{inCode ? '看改动' : '看产出'}<Icon name="arrow" size={14} stroke={2} /></Key>)}
      {(ts.status === 'stopped' || ts.status === 'error') && <Key size="sm" variant="primary" onPress={() => void toggle()}><Icon name="play" size={14} />{hasDraft ? '发送并继续' : '继续'}</Key>}
    </div>
  )
}

function Composer({ inputRef, pendingQuestion }: { inputRef: React.RefObject<HTMLTextAreaElement | null>; pendingQuestion?: () => void }) {
  const ts = useStore((s) => s.ts)!
  const app = useStore((s) => s.app)
  const run = useStore((s) => s.run)
  const text = useStore((s) => s.chatDraft)
  const setText = useStore((s) => s.setChatDraft)
  const live = LIVE.includes(ts.status)
  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    play('send')
    await run((api) => api.task.send(t), '没有发出去')
  }
  return (
    <div className="conv-foot">
      {pendingQuestion && <div className="tc-ask"><span className="led ask" />有问题等你回答，任务暂停中<Key size="sm" variant="primary" onPress={pendingQuestion}>回答</Key></div>}
      <div className="composer conv-composer">
        <label className="sr-only" htmlFor="chat-input">补充要求</label>
        <textarea id="chat-input" ref={inputRef} rows={2} value={text}
          placeholder={ts.status === 'stopped' ? '补一句纠正说明，发送后接着做' : live ? '补充要求，下一步生效（不用等它做完）' : '追问或提出修改'}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void send() } }} />
        <div className="composer-bar">
          <span className="grow mono small muted">Ctrl Enter 发送 · {app?.mock ? '模拟引擎' : `部门模型 ${app?.model.model}`}</span>
          <Key variant="primary" className="send" aria-label="发送" isDisabled={!text.trim()} onPress={() => void send()}><Icon name="send" size={16} stroke={2.2} /></Key>
        </div>
      </div>
    </div>
  )
}
