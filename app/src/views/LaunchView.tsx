// 发起任务：选环节（触感键帽）、说清楚要做什么、带上相关文件，按“开始”。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, DialogTrigger, Popover, RadioGroup, Radio } from 'react-aria-components'
import { motion } from 'motion/react'
import { useStore } from '../store'
import { Icon, STAGE_ICON } from '../components/Icon'
import { Key, Kbd, Toggle } from '../components/Keys'
import { play } from '../sound'
import type { Mention, Task } from '../api'
import { clock, elapsed } from '../format'
import { useNow } from './TaskView'

const HINTS: Record<string, { placeholder: string; hint: string; report: string }> = {
  requirements: { placeholder: '例如：根据任务书第 3 章整理 RT 通信软件的需求规格', hint: '会按部门需求规格模板逐条编号，并标出任务书里说得不清的地方', report: '生成需求规格说明（部门模板）' },
  hld: { placeholder: '例如：为 RT 通信软件划分模块并定义接口', hint: '每个模块都会追溯到需求条目，缺口会单独列出', report: '生成概要设计说明（部门模板）' },
  dd: { placeholder: '例如：写 rt_drv 模块的详细设计，含流程图', hint: '流程图会以 Word 可编辑的形式放进文档', report: '生成详细设计说明（部门模板）' },
  coding: { placeholder: '例如：按详细设计 4.2 实现 rt_reset 和 rt_stack_push', hint: '写完会用平台编译器编译、跑 Cppcheck，问题修完再交给你', report: '附编码说明和静态检查结果' },
  utest: { placeholder: '例如：为 rt_drv 和 rt_msg 设计并运行单元测试', hint: '预期值只取自设计，失败不会改预期；疑似缺陷会单独列出', report: '生成单元测试报告（部门模板）' },
  review: { placeholder: '例如：走查 rt_msg.c，重点看中断和共享数据', hint: '按部门走查单逐项检查，每条意见都给出行号和依据', report: '生成走查记录（部门模板）' },
}

const RECENT: Record<string, string> = { done: '待审核', stopped: '已停止，可继续', error: '出错，可继续', running: '进行中', asking: '等你决定', starting: '启动中', idle: '' }

function greeting() {
  const h = new Date().getHours()
  return h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
}

export function LaunchView() {
  const app = useStore((s) => s.app)
  const ts = useStore((s) => s.ts)
  const stageId = useStore((s) => s.launchStage)
  const setStage = useStore((s) => s.setLaunchStage)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const run = useStore((s) => s.run)
  const setView = useStore((s) => s.setView)
  const toast = useStore((s) => s.toast)
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const { prompt, files, report, dismissed } = draft
  const [starting, setStarting] = useState(false)
  // 描述里直接写了文件名：唯一匹配的自动带上（可以去掉），同名多个的让用户选
  const [mentions, setMentions] = useState<Mention[]>([])
  useEffect(() => {
    if (!prompt.includes('.')) { setMentions([]); return }
    const t = setTimeout(() => { void run((api) => api.project.mentions(prompt)).then((m) => setMentions(m || [])) }, 300)
    return () => clearTimeout(t)
  }, [prompt, run])
  const auto = mentions.filter((m) => m.paths.length === 1 && !files.includes(m.paths[0]) && !dismissed.includes(m.paths[0])).map((m) => m.paths[0])
  const ambiguous = mentions.filter((m) => m.paths.length > 1 && !m.paths.some((p) => files.includes(p)))
  const [recent, setRecent] = useState<Task[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const stages = (app?.stages || []).filter((s) => !s.hidden)
  const stage = stages.find((s) => s.id === stageId) || stages[4]
  const h = HINTS[stage?.id || 'utest']
  const project = ts?.project
  // 同一时间只运行一个任务：任务进行中可以先把下一个写好，结束后再开始
  const busy = !!ts && ['starting', 'running', 'asking'].includes(ts.status)

  useEffect(() => { void run((api) => api.task.history()).then((h) => setRecent((h || []).slice(0, 3))) }, [run, project?.id])
  useEffect(() => { ta.current?.focus() }, [stageId])

  const start = async () => {
    if (busy) { toast({ text: '当前任务结束后才能开始新任务，写好的内容会保留', tone: 'info' }); return }
    if (!prompt.trim() || starting || !stage) return
    setStarting(true)
    play('send')
    const t = await run((api) => api.task.start({ stage: stage.id, prompt: prompt.trim(), files: [...files, ...auto], options: { report } }), '任务没有启动')
    setStarting(false)
    if (t) { setDraft({ prompt: '', files: [], dismissed: [] }); setView('task') }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && /^[1-6]$/.test(e.key) && stages[Number(e.key) - 1]) { e.preventDefault(); setStage(stages[Number(e.key) - 1].id) }
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); void start() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const openTask = async (id: string) => {
    if (ts?.task?.id === id) { setView('task'); return }
    const s = await run(async (api) => { await api.task.open(id); return api.getState() }, '打不开这个任务')
    if (s) { useStore.getState().applyAppState(s); setView('task') }
  }

  if (!project) return <NoProject />

  return (
    <div className="launch">
      <div className="launch-bg" aria-hidden="true"><div className="launch-blob a" /><div className="launch-blob b" /></div>
      <motion.div className="launch-hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1>{greeting()}，今天要推进哪一步？</h1>
        <p>选环节、说清楚要做什么，其余交给智能体。过程中随时可以插话或停止。</p>
      </motion.div>

      {!!app?.notes?.length && <div className="notes">{app.notes.map((n) => <div key={n} className="note warn"><Icon name="warn" size={14} />{n}</div>)}</div>}

      {busy ? <RunningBanner /> : <UnreviewedNote />}

      <motion.section className="composer-card" aria-label="新任务" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay: 0.04 }}>
        <RadioGroup className="caps" aria-label="研发环节" value={stage?.id} onChange={(v) => { setStage(v); play('tick') }} orientation="horizontal">
          {stages.map((s, i) => (
            <Radio key={s.id} value={s.id} className="cap">
              {({ isSelected }) => (<>
                {isSelected && <span className="led cap-led" />}
                <Icon name={STAGE_ICON[s.id]} size={24} stroke={1.6} />
                <span className="cap-name">{s.name}</span>
                <span className="cap-key">{s.hasSkill ? `Alt ${i + 1}` : '暂无技能'}</span>
              </>)}
            </Radio>
          ))}
        </RadioGroup>

        <div className="ask-box">
          <label className="sr-only" htmlFor="launch-prompt">要做什么</label>
          <textarea id="launch-prompt" ref={ta} rows={3} value={prompt} placeholder={h.placeholder} onChange={(e) => setDraft({ prompt: e.target.value })} />
          <div className="chips">
            {files.map((f) => (
              <span key={f} className="chip"><Icon name="file" size={13} /><span className="mono">{f}</span>
                <Button className="chip-x" aria-label={`移除 ${f}`} onPress={() => setDraft({ files: files.filter((x) => x !== f) })}><Icon name="x" size={11} stroke={2.4} /></Button>
              </span>
            ))}
            {auto.map((f) => (
              <span key={f} className="chip auto" title={`描述里提到了它，会作为相关文件交给智能体：${f}`}><Icon name="file" size={13} /><span className="mono">{f}</span><span className="chip-tag">识别</span>
                <Button className="chip-x" aria-label={`不带上 ${f}`} onPress={() => setDraft({ dismissed: [...dismissed, f] })}><Icon name="x" size={11} stroke={2.4} /></Button>
              </span>
            ))}
            {ambiguous.map((m) => (
              <FilePicker key={m.name} label={`${m.name} 有 ${m.paths.length} 个同名文件，选一个`} className="chip warn" initialQuery={m.name} onPick={(f) => { if (!files.includes(f)) setDraft({ files: [...files, f] }) }} />
            ))}
            <FilePicker onPick={(f) => { if (!files.includes(f)) setDraft({ files: [...files, f] }) }} />
          </div>
          <div className="ask-hint"><Icon name="sparkle" size={14} className="accent" />{stage?.hasSkill ? h.hint : `这个环节还没有部门技能，智能体会按通用方法做`}</div>
        </div>

        <div className="launch-foot">
          <Toggle isSelected={report} onChange={(v) => setDraft({ report: v })}>{h.report}</Toggle>
          <Toggle isSelected={settings.notify} onChange={(v) => setSettings({ notify: v })}>完成或需要我决定时提醒</Toggle>
          <span className="grow" />
          {stage?.hasSkill && <span className="muted small">技能 {stage.skill}</span>}
          {busy
            ? <Key variant="primary" size="lg" isDisabled>等当前任务结束</Key>
            : <Key variant="primary" size="lg" isDisabled={!prompt.trim() || starting} onPress={() => void start()}>
                {starting ? '启动中…' : '开始'}<Kbd>Ctrl Enter</Kbd>
              </Key>}
        </div>
      </motion.section>

      {!!recent.length && (
        <section className="recent" aria-label="最近">
          {recent.map((t) => (
            <Button key={t.id} className="recent-card" isDisabled={busy && ts?.task?.id !== t.id} onPress={() => void openTask(t.id)}>
              <span className="recent-meta"><span className={`dot st-${t.status}`} />{t.stageName} · {clock(t.startedAt)}</span>
              <span className="recent-title">{t.title}</span>
              <span className="recent-sub">{t.commit ? `已提交 ${t.commit.files} 个文件` : RECENT[t.status] || t.status}</span>
            </Button>
          ))}
        </section>
      )}
    </div>
  )
}

/** 任务进行中：哪个环节、用了多久、做到哪，一键回去 */
function RunningBanner() {
  const ts = useStore((s) => s.ts)!
  const setView = useStore((s) => s.setView)
  const now = useNow(true)
  const task = ts.task!
  const asking = ts.status === 'asking'
  return (
    <motion.div className={`run-banner ${asking ? 'ask' : ''}`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
      <span className={`led ${asking ? 'ask' : ''}`} />
      <span className="grow">
        <span className="strong">{task.stageName}</span>{asking ? ' 有问题等你回答' : ts.status === 'starting' ? ' 正在启动' : ' 进行中'}
        <span className="muted"> · 已用 {elapsed(now - task.startedAt)} · {task.title}</span>
        <span className="muted small block">同一时间只运行一个任务。可以先把下一个写好，当前任务结束后再开始，写好的内容会保留</span>
      </span>
      <Key size="sm" variant={asking ? 'primary' : undefined} onPress={() => setView('task')}>{asking ? '去回答' : '回到任务'}<Icon name="arrow" size={14} stroke={2} /></Key>
    </motion.div>
  )
}

/** 上一个任务的改动还没提交：新任务的快照会把它们算进去，审核时分不清，先提醒 */
function UnreviewedNote() {
  const ts = useStore((s) => s.ts)
  const setView = useStore((s) => s.setView)
  const t = ts?.task
  if (!t || !t.snapshot || t.commit || t.restoredAt || !ts.summary.files || !['done', 'stopped', 'error'].includes(ts.status)) return null
  return (
    <div className="run-banner quiet">
      <Icon name="branch" size={16} stroke={2} />
      <span className="grow"><span className="strong">{t.stageName}</span>任务改了 {ts.summary.files} 个文件，还没提交<span className="muted small block">建议先审核提交，再开始新任务，这样每个任务的改动能分开看</span></span>
      <Key size="sm" onPress={() => setView('review')}>去审核<Icon name="arrow" size={14} stroke={2} /></Key>
    </div>
  )
}

function FilePicker({ onPick, label = '添加文件', className = 'chip add', initialQuery = '' }: { onPick: (f: string) => void; label?: string; className?: string; initialQuery?: string }) {
  const run = useStore((s) => s.run)
  const [q, setQ] = useState(initialQuery)
  const [list, setList] = useState<string[]>([])
  useEffect(() => {
    const t = setTimeout(() => { void run((api) => api.project.files(q)).then((r) => setList(r || [])) }, 120)
    return () => clearTimeout(t)
  }, [q, run])
  const shown = useMemo(() => list.slice(0, 60), [list])
  return (
    <DialogTrigger>
      <Button className={className}><Icon name="plus" size={12} stroke={2.2} />{label}</Button>
      <Popover className="pop file-pop" placement="bottom start">
        <Dialog className="file-dialog" aria-label="选择文件">
          {({ close }) => (<>
            <input autoFocus className="file-search" placeholder="搜索文件名，例如 rt_drv" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="file-list-pop">
              {shown.map((f) => (
                <Button key={f} className="file-opt" onPress={() => { onPick(f); close() }}><Icon name="file" size={13} /><span className="mono">{f}</span></Button>
              ))}
              {!shown.length && <div className="muted small pad">没有找到</div>}
            </div>
          </>)}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

function NoProject() {
  const run = useStore((s) => s.run)
  return (
    <div className="launch empty">
      <div className="empty-box">
        <span className="empty-icon"><Icon name="folderPlus" size={22} /></span>
        <div>
          <div className="strong">打开一个项目文件夹</div>
          <div className="muted small">智能体只在这个文件夹里读写。建议是 Git 仓库，这样审核时能看到改动对比、一键提交</div>
        </div>
        <Key onPress={() => void run((api) => api.project.add()).then((s) => s && useStore.getState().applyAppState(s))}>打开文件夹</Key>
      </div>
    </div>
  )
}
