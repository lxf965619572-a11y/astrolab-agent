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
import { FilePicker, MAX_SKILLS, SkillPickerButton, filterSkills } from '../components/Pickers'
import { categoryOf, skillIcon } from '../skills'
import { modeOf } from '../modes'
import { RenameInput, TaskMenu } from '../components/Shell'
import type { SkillCard } from '../api'

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
  const [renaming, setRenaming] = useState(false)
  const pinned = useStore((s) => s.settings.pinned)
  const setSettings = useStore((s) => s.setSettings)
  const pid = ts.project?.id
  // 提交后标题也要跟着变（左栏、历史早就显示“已提交”）
  const st = ts.status === 'done' && task.commit ? { label: '已提交', cls: 'ok' } : STATUS[ts.status] || STATUS.idle
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
          {ts.project && (
            <div className="conv-crumb">
              <Button className="crumb-proj" onPress={() => void useStore.getState().openProjectHome(ts.project!.id)} aria-label={`回到工程 ${ts.project.name} 的主页`}><Icon name="folder" size={12} stroke={1.8} />{ts.project.name}</Button>
            </div>
          )}
          <div className="conv-title-row">
            {renaming && pid
              ? <RenameInput value={task.title} className="conv-rename" onDone={(v) => { setRenaming(false); if (v !== null) void useStore.getState().renameTask(pid, task, v) }} />
              : <h1 title={`${task.title}\n双击改名`} onDoubleClick={() => setRenaming(true)}>{task.title}</h1>}
            {!renaming && pid && (
              <TaskMenu pid={pid} task={task} live={live} className="conv-menu-btn" pinned={pinned.includes(task.id)}
                onPin={() => setSettings({ pinned: pinned.includes(task.id) ? pinned.filter((x) => x !== task.id) : [task.id, ...pinned] })}
                onRename={() => setRenaming(true)} />
            )}
          </div>
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

/** 只读查看另一个任务（当前任务进行中时）：只有对话记录，不能继续、不能审核；当前任务结束后再打开它 */
export function PeekView() {
  const peek = useStore((s) => s.peek)
  const ts = useStore((s) => s.ts)
  const setView = useStore((s) => s.setView)
  if (!peek) return null
  const t = peek.task
  const items = peek.items.filter((i) => i.kind !== 'tools' || !(i.hidden || i.calls.every((c) => c.hidden)))
  const back = () => setView(ts?.task && modeOf(ts.task) === 'code' ? 'code' : 'task')
  return (
    <div className="conv-page">
      <section className="conv" aria-label="只读查看">
        <header className="conv-head">
          <div className="conv-head-row">
            <div className="conv-title">
              <h1 title={t.title}>{t.title}</h1>
              <div className="conv-meta">
                <span className="pill sm idle"><span className="dot" />只读</span>
                <span className="conv-stage">{t.stageName}</span>
                <span>{new Date(t.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{t.endedAt ? ` · 用时 ${elapsed(t.endedAt - t.startedAt)}` : ''}</span>
              </div>
            </div>
            <div className="conv-actions">
              {ts?.task && <Key size="sm" variant="primary" onPress={back}><Icon name="arrow" size={14} stroke={2} className="flip" />回到进行中的任务</Key>}
            </div>
          </div>
          <div className="note-line muted small"><span className="led" />当前有任务在进行，这里只能查看记录；要继续、追问或审核这个任务，等当前任务结束后再打开它。</div>
        </header>
        <div className="conv-scroll">
          <div className="conv-col">
            {items.map((item) => <div key={item.id} className="conv-vrow static"><ItemRow item={item} task={t} /></div>)}
            {!items.length && <div className="pad muted">这个任务没有对话记录。</div>}
          </div>
        </div>
      </section>
    </div>
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
  | { key: string; type: 'run'; items: Item[] }
  | { key: string; type: 'queued'; id: string; text: string }
  | { key: 'live'; type: 'live' }
  | { key: 'status'; type: 'status' }

/** 对话流：按时间排好的消息和动作，虚拟滚动（长任务几百步也不卡），在底部时自动跟随 */
function Stream({ inCode }: { inCode: boolean }) {
  const items = useStore((s) => s.items)
  const ts = useStore((s) => s.ts)!
  const rows = useMemo<Row[]>(() => {
    // 两句话之间连续的动作（读文件、改文件、运行命令、思考）合成一行摘要，点开看每一步；提问（ask）单独一行
    const r: Row[] = []
    const groupable = (i: Item) => i.kind === 'thinking' || (i.kind === 'tools' && i.group !== 'ask')
    for (const item of items.filter((i) => i.kind !== 'tools' || !(i.hidden || i.calls.every((c) => c.hidden)))) {
      const last = r[r.length - 1]
      if (groupable(item) && last && last.type === 'run') last.items.push(item)
      else if (groupable(item) && last && last.type === 'item' && groupable(last.item)) r[r.length - 1] = { key: `run-${last.item.id}`, type: 'run', items: [last.item, item] }
      else r.push({ key: item.id, type: 'item', item })
    }
    for (const q of ts.queued) r.push({ key: `q-${q.id}`, type: 'queued', id: q.id, text: q.text })
    if (ts.status === 'starting' || (['running', 'asking'].includes(ts.status) && ts.summary.current)) r.push({ key: 'live', type: 'live' })
    else if (['done', 'stopped', 'error'].includes(ts.status)) r.push({ key: 'status', type: 'status' })
    return r
  }, [items, ts.queued, ts.status, ts.summary.current])
  const parent = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 48, overscan: 10, getItemKey: (i) => rows[i].key })
  const stick = useRef(true)
  // 往上翻看记录时不自动跟随；右下角出现“回到最新”
  const [away, setAway] = useState(false)
  useEffect(() => {
    const el = parent.current
    if (!el) return
    const onScroll = () => { const at = el.scrollHeight - el.scrollTop - el.clientHeight < 80; stick.current = at; setAway(!at) }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => { if (stick.current && rows.length) v.scrollToIndex(rows.length - 1, { align: 'end' }) }, [rows, v])
  const toLatest = () => { stick.current = true; setAway(false); if (rows.length) v.scrollToIndex(rows.length - 1, { align: 'end' }) }
  // 动作摘要行展开与否：点过的按点的；没点过的，任务进行中时最后一组展开（看得到正在做什么），其余收起
  const [openRuns, setOpenRuns] = useState<Record<string, boolean>>({})
  const live = LIVE.includes(ts.status)
  const lastRun = [...rows].reverse().find((x) => x.type === 'run' || x.type === 'item')
  const isOpen = (key: string) => openRuns[key] ?? (live && lastRun?.key === key)
  return (
    <div className="conv-scroll-wrap">
    {away && <Button className="to-latest" onPress={toLatest}><Icon name="arrow" size={14} stroke={2} className="down" />回到最新</Button>}
    <div className="conv-scroll" ref={parent}>
      <div className="conv-col" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((r) => {
          const row = rows[r.index]
          return (
            <div key={r.key} data-index={r.index} ref={v.measureElement} className="conv-vrow" style={{ transform: `translateY(${r.start}px)` }}>
              {row.type === 'item' ? <ItemRow item={row.item} />
                : row.type === 'run' ? <RunGroup items={row.items} open={isOpen(row.key)} onToggle={() => setOpenRuns((m) => ({ ...m, [row.key]: !isOpen(row.key) }))} />
                : row.type === 'queued' ? <div className="queued"><div className="bubble user pending">{row.text}</div><div className="queued-chip"><Icon name="check" size={12} stroke={2.4} />{ts.status === 'starting' ? '已收到，任务开始后送到' : '已收到，下一步之前送到'}</div></div>
                  : row.type === 'live' ? <LiveRow />
                    : <StatusRow inCode={inCode} />}
            </div>
          )
        })}
      </div>
    </div>
    </div>
  )
}

/** 连续几步动作的摘要：“读了 12 个文件、改了 3 个文件、运行了 2 条命令、思考 20 秒”，点开逐步看 */
function RunGroup({ items, open, onToggle }: { items: Item[]; open: boolean; onToggle: () => void }) {
  const read = new Set<string>(); const write = new Set<string>()
  let cmds = 0, search = 0, other = 0, think = 0, add = 0, rem = 0, err = false, running = false
  for (const it of items) {
    if (it.kind === 'thinking') { think += it.ms || 0; continue }
    if (it.kind !== 'tools') continue
    for (const c of it.calls.filter((x) => !x.hidden)) {
      if (it.group === 'read') read.add(c.path || c.summary)
      else if (it.group === 'write') { write.add(c.path || c.summary); add += c.added || 0; rem += c.removed || 0 }
      else if (it.group === 'run') cmds++
      else if (it.group === 'search') search++
      else other++
      if (c.status === 'error') err = true
      if (c.status === 'running') running = true
    }
  }
  const parts = [read.size && `读了 ${read.size} 个文件`, write.size && `改了 ${write.size} 个文件`, cmds && `运行了 ${cmds} 条命令`, search && `搜索 ${search} 次`, other && `用了 ${other} 次工具`, think && `思考 ${duration(think)}`].filter(Boolean) as string[]
  const tone = running ? 'run' : err ? 'err' : 'ok'
  return (
    <div className={`act-row run-group ${tone}`}>
      <span className={`act-icon ${tone}`}><Icon name={running ? 'clock' : err ? 'warn' : 'check'} size={13} stroke={2.2} /></span>
      <div className="act-body">
        <Button className="act-toggle" onPress={onToggle} aria-expanded={open}>
          <span>{parts.join('、') || `${items.length} 步`}</span>
          {add ? <span className="add mono small">+{add}</span> : null}
          {rem ? <span className="rem mono small">−{rem}</span> : null}
          <span className="muted small">{items.length} 步</span>
          <Icon name="chevron" size={14} stroke={2} className={`chev ${open ? 'up' : ''}`} />
        </Button>
        {open && <div className="run-items">{items.map((it) => <ActRow key={it.id} item={it} />)}</div>}
      </div>
    </div>
  )
}

function ItemRow({ item, task: own }: { item: Item; task?: { stageName?: string; title?: string } }) {
  const ts = useStore((s) => s.ts)!
  const src = own || ts.task
  // 工作台自己插的提醒（如提醒列步骤）：不是用户说的话，显示成一行灰字
  if (item.kind === 'user' && item.text.startsWith('【工作台】')) return <div className="act-row" title={clock(item.at)}><span className="act-icon"><Icon name="sparkle" size={13} stroke={2} /></span><div className="act-body"><span className="muted small">工作台提醒：{item.text.slice(6)}</span></div></div>
  if (item.kind === 'user') return <div className="msg-user"><div className="bubble user">{item.text}</div></div>
  if (item.kind === 'assistant') {
    return (
      <div className="msg-agent">
        <Markdown text={item.text} />
        <Button className="bubble-act" aria-label="存到知识库" onPress={() => useStore.getState().openKbEditor({ meta: { kind: '经验', title: '', source: `${src?.stageName || ''}任务：${src?.title || ''}` }, body: item.text })}><Icon name="book" size={13} />存到知识库</Button>
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
    : cur?.kind === 'thinking'
      // 引擎（DSH sdk 模式）不逐字推送，模型一口气写长文档时这里只能看到“思考中”；超过 1 分钟时说明原因，免得以为卡住了
      ? (now - cur.since > 60_000 ? '还在生成，可能在写较长的内容（这一步写完才能显示出来）' : '思考中')
      : nowLabel(cur) || '思考中'
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
  const commit = ts.task?.commit
  const text = ts.status === 'done' && commit ? `做完了，已提交 ${commit.sha.slice(0, 7)}（${commit.files} 个文件）`
    : ts.status === 'done' ? (ts.summary.files ? (inCode ? '做完了，等你审核后提交' : `做完了：改动 ${ts.summary.files} 个文件，等你审核后提交`) : '做完了')
    : ts.status === 'stopped' ? '已停止。对话和已写的文件都保留，点“继续”接着做，也可以先在下面补一句纠正说明'
      : ts.error || '引擎出错'
  return (
    <div className={`tc-now conv-status ${ts.status}`}>
      <Icon name={ts.status === 'error' ? 'warn' : ts.status === 'done' ? 'check' : 'terminal'} size={16} />
      <span className="grow">{text}</span>
      {ts.status === 'done' && !commit && !!ts.summary.files && (panel
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
  const toast = useStore((s) => s.toast)
  const text = useStore((s) => s.chatDraft)
  const setText = useStore((s) => s.setChatDraft)
  const live = LIVE.includes(ts.status)
  const toggle = useToggle()
  // 追问也能带技能和文件（和发起页一样：输入 / 选技能、“技能”按钮、“添加文件”）
  const allSkills = useMemo(() => app?.skills || [], [app?.skills])
  const byName = useMemo(() => new Map(allSkills.map((s) => [s.name, s])), [allSkills])
  const [picked, setPicked] = useState<string[]>([])
  const [files, setFiles] = useState<string[]>([])
  const chosen = picked.map((n) => byName.get(n)).filter(Boolean) as SkillCard[]
  const slash = text.startsWith('/') ? text.slice(1).split(/\s/)[0] : null
  const slashList = useMemo(() => (slash === null ? [] : filterSkills(allSkills, slash).filter((s) => !picked.includes(s.name))), [slash, allSkills, picked])
  const [slashSel, setSlashSel] = useState(0)
  useEffect(() => { setSlashSel(0) }, [slash])
  const pick = (name: string) => {
    if (picked.includes(name)) return
    if (picked.length >= MAX_SKILLS) { toast({ text: `一次最多选 ${MAX_SKILLS} 个技能`, tone: 'info' }); return }
    setPicked([...picked, name])
    if (text.startsWith('/')) setText(text.replace(/^\/\S*\s?/, ''))
    play('tick')
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  const send = async () => {
    const t = text.trim()
    if (!t || t.startsWith('/')) return
    const extra = { skills: picked, files }
    setText('')
    setPicked([])
    setFiles([])
    play('send')
    await run((api) => api.task.send(t, extra), '没有发出去')
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash !== null && slashList.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSel((i) => Math.min(slashList.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSel((i) => Math.max(0, i - 1)); return }
      if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); pick(slashList[slashSel].name); return }
      if (e.key === 'Tab') { e.preventDefault(); pick(slashList[slashSel].name); return }
    }
    if (slash !== null && e.key === 'Escape') { e.preventDefault(); setText(''); return }
    // 输入框是空的、任务在进行：Esc 停止（和 Claude 一样）
    if (e.key === 'Escape' && !text && live) { e.preventDefault(); void toggle(); return }
    if (e.key === 'Backspace' && !text && picked.length) { e.preventDefault(); setPicked(picked.slice(0, -1)); return }
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void send() }
  }
  return (
    <div className="conv-foot">
      {pendingQuestion && <div className="tc-ask"><span className="led ask" />有问题等你回答，任务暂停中<Key size="sm" variant="primary" onPress={pendingQuestion}>回答</Key></div>}
      <div className="composer conv-composer">
        {slash !== null && (
          <div className="slash-menu conv-slash" role="listbox" aria-label="选技能">
            <div className="slash-head muted small">选技能 · ↑↓ 选择，Enter 确定，Esc 取消</div>
            {slashList.slice(0, 8).map((s, i) => (
              <Button key={s.name} className={`slash-opt ${i === slashSel ? 'on' : ''}`} onPress={() => pick(s.name)} onHoverStart={() => setSlashSel(i)}>
                <Icon name={skillIcon(s)} size={16} stroke={1.7} />
                <span className="slash-name">{s.title}<span className="muted small"> /{s.name}</span></span>
                <span className="slash-desc">{s.description}</span>
                <span className="pill sm idle">{categoryOf(s).name}</span>
              </Button>
            ))}
            {!slashList.length && <div className="pad muted small">没有匹配的技能</div>}
          </div>
        )}
        <label className="sr-only" htmlFor="chat-input">补充要求</label>
        <textarea id="chat-input" ref={inputRef} rows={2} value={text}
          placeholder={ts.status === 'stopped' ? '补一句纠正说明，发送后接着做' : live ? '补充要求，下一步生效（不用等它做完）。输入 / 选技能，Esc 停止' : '追问或提出修改。输入 / 选技能'}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
        <div className="chips conv-chips">
          {chosen.map((s) => (
            <span key={s.name} className="chip skill" title={s.description}>
              <Icon name={skillIcon(s)} size={13} stroke={1.8} /><span>{s.title}</span>
              <Button className="chip-x" aria-label={`不用 ${s.title}`} onPress={() => setPicked(picked.filter((n) => n !== s.name))}><Icon name="x" size={11} stroke={2.4} /></Button>
            </span>
          ))}
          {files.map((f) => (
            <span key={f} className="chip"><Icon name="file" size={13} /><span className="mono">{f}</span>
              <Button className="chip-x" aria-label={`移除 ${f}`} onPress={() => setFiles(files.filter((x) => x !== f))}><Icon name="x" size={11} stroke={2.4} /></Button>
            </span>
          ))}
          <SkillPickerButton skills={allSkills} picked={picked} onPick={pick} placement="top start" />
          <FilePicker placement="top start" onPick={(f) => { if (!files.includes(f)) setFiles([...files, f]) }} />
        </div>
        <div className="composer-bar">
          <span className="grow mono small muted">Ctrl Enter 发送 · {app?.mock ? '模拟引擎' : `部门模型 ${app?.model.model}`}</span>
          <Key variant="primary" className="send" aria-label="发送" isDisabled={!text.trim() || text.startsWith('/')} onPress={() => void send()}><Icon name="send" size={16} stroke={2.2} /></Key>
        </div>
      </div>
    </div>
  )
}
