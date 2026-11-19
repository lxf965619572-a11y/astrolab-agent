// 定时任务（对应 Claude 的“定时任务”）：到点在工程里自动发起任务，做完进审核。
// “我的”列出定时任务：触发说明、下次运行、最近一次的结果；点一行展开要做什么和运行记录，点记录打开那次的任务。
// “模板”是部门常用的几种巡检，点一下带到新建框里。底部是开机自动启动（最小化到托盘）。
// 每次运行都是一个新任务、无人值守（不提问，假设写进“待确认”），见 main/schedule.mjs 和 main/task.mjs。

import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import { Key, Toggle } from '../components/Keys'
import { SkillPickerButton } from '../components/Pickers'
import type { Freq, Schedule, SkillCard, ScheduleDraft, ScheduleState, ScheduleTemplate, Trigger } from '../api'
import { DAY_NAMES, FREQ_NAMES, WEEK_ORDER, describeTrigger, nextRun, nextText, runState, whenText } from '../schedule'

const NO_SKILLS: SkillCard[] = []
const pad = (n: number) => String(n).padStart(2, '0')
const localInput = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }

export function SchedulesView() {
  const run = useStore((s) => s.run)
  const schedVer = useStore((s) => s.schedVer)
  const histVer = useStore((s) => s.histVer)
  const tsStatus = useStore((s) => s.ts?.status)
  const [st, setSt] = useState<ScheduleState | null>(null)
  const [tab, setTab] = useState<'mine' | 'tpl'>('mine')
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<ScheduleDraft | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // 选择器要返回原来的数组（每次 filter 出新数组，zustand 会认为变了而无限重画）
  const allProjects = useStore((s) => s.app?.projects)
  const projects = useMemo(() => (allProjects || []).filter((p) => !p.hidden && !p.library), [allProjects])
  const curPid = useStore((s) => s.ts?.project?.id)
  useEffect(() => { void run((api) => api.schedule.list(), '读取定时任务失败').then((r) => r && setSt(r)) }, [run, schedVer, histVer, tsStatus])
  // 下次运行、排队这些文字跟着时间走：每分钟刷新一次
  useEffect(() => {
    const t = setInterval(() => { void useStore.getState().api?.schedule.list().then(setSt).catch(() => {}) }, 60_000)
    return () => clearInterval(t)
  }, [])

  const list = st?.schedules || []
  const pname = (id: string) => projects.find((p) => p.id === id)?.name || '（工程已移出）'
  const blank = (): ScheduleDraft => ({ name: '', prompt: '', projectId: curPid || projects[0]?.id || '', skills: [], mode: 'task', options: {}, trigger: { freq: 'weekdays', time: '09:00' }, enabled: true })
  const fromTemplate = (t: ScheduleTemplate): ScheduleDraft => ({ name: t.name, prompt: t.prompt, projectId: curPid || projects[0]?.id || '', skills: t.skills, mode: t.mode, options: {}, trigger: { ...t.trigger }, enabled: true })
  const edit = (s: Schedule): ScheduleDraft => ({ id: s.id, name: s.name, prompt: s.prompt, projectId: s.projectId, skills: s.skills, mode: s.mode, options: s.options, trigger: { ...s.trigger }, enabled: s.enabled })

  const toggle = async (s: Schedule, on: boolean) => { const r = await run((api) => api.schedule.enable(s.id, on), on ? '启用失败' : '停用失败'); if (r) setSt(r) }
  const runNow = async (s: Schedule) => {
    setBusy(s.id)
    try {
      const r = await run((api) => api.schedule.runNow(s.id), '没能运行')
      if (r) { setSt(r.state); useStore.getState().toast({ text: `“${s.name}”开始运行（${pname(s.projectId)}）`, tone: 'ok' }) }
    } finally { setBusy(null) }
  }
  const remove = (s: Schedule) => useStore.getState().askConfirm({
    title: `删除定时任务“${s.name}”？`, body: '以后不再运行。已经运行过的任务记录和产出都保留。', ok: '删除', danger: true,
    run: async () => { const r = await run((api) => api.schedule.remove(s.id), '删除失败'); if (r) setSt(r) },
  })

  return (
    <div className="history-layout sched-layout">
      <div className="page-head pad-x">
        <div>
          <h1>定时任务</h1>
          <div className="sub">到点自动在工程里发起任务，做完放进审核，你回来再看。软件开着（可以缩在托盘里）、电脑醒着时运行。</div>
        </div>
        <Key variant="primary" onPress={() => setDraft(blank())} isDisabled={!projects.length}><Icon name="plus" size={14} stroke={2} /> 新建定时任务</Key>
      </div>
      <div className="cat-filter pad-x" role="tablist" aria-label="定时任务分类">
        <button type="button" role="tab" aria-selected={tab === 'mine'} className={`cat-chip ${tab === 'mine' ? 'on' : ''}`} onClick={() => setTab('mine')}>我的<span className="cat-n">{list.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'tpl'} className={`cat-chip ${tab === 'tpl' ? 'on' : ''}`} onClick={() => setTab('tpl')}>模板<span className="cat-n">{st?.templates.length || 0}</span></button>
      </div>

      <div className="sched-scroll">
        {tab === 'mine' && list.length > 0 && (
          <div className="sched-list card">
            {list.map((s) => (
              <ScheduleRow key={s.id} s={s} pname={pname(s.projectId)} now={st?.now || Date.now()} open={open === s.id} busy={busy === s.id}
                onToggleOpen={() => setOpen(open === s.id ? null : s.id)} onEnable={(v) => void toggle(s, v)} onRun={() => void runNow(s)} onEdit={() => setDraft(edit(s))} onRemove={() => remove(s)} />
            ))}
          </div>
        )}
        {tab === 'mine' && st && !list.length && (
          <div className="sched-empty pad-x">
            <div className="empty-box">
              <span className="empty-icon"><Icon name="clock" size={24} stroke={1.7} /></span>
              <div>
                <div className="sched-empty-title">还没有定时任务</div>
                <div className="muted small">比如每天晚上做一次静态分析、每周五写研制周报。从下面的模板开始，或者自己新建。</div>
              </div>
            </div>
          </div>
        )}
        {(tab === 'tpl' || (st && !list.length)) && (
          <div className="tpl-grid pad-x">
            {(st?.templates || []).map((t) => (
              <Button key={t.id} className="tpl-card" onPress={() => setDraft(fromTemplate(t))} isDisabled={!projects.length} aria-label={`用模板“${t.name}”新建`}>
                <span className="tpl-icon"><Icon name={t.icon} size={18} stroke={1.7} /></span>
                <span className="tpl-text">
                  <span className="tpl-name">{t.name}</span>
                  <span className="tpl-sum">{t.summary}</span>
                  <span className="tpl-when"><Icon name="clock" size={12} stroke={1.8} />{describeTrigger(t.trigger)}</span>
                </span>
              </Button>
            ))}
          </div>
        )}

        <div className="sched-foot pad-x">
          <div className="set-row">
            <div className="set-text">
              <span>开机自动启动</span>
              <span className="muted small">{st?.login.supported ? '登录系统后在托盘里启动（不弹窗口），定时任务到点就能跑。' : st?.login.note || ''}</span>
            </div>
            <Toggle isSelected={!!st?.login.on} isDisabled={!st?.login.supported} onChange={(v) => void run((api) => api.schedule.login(v), '设置开机启动失败').then((r) => r && setSt(r))} aria-label="开机自动启动" />
          </div>
          <div className="sched-notes muted small">
            <p>· 有启用的定时任务时，关闭窗口只是缩到托盘，定时任务照常运行；要完全退出，在托盘图标上点右键选“退出”。运行期间电脑不会自动睡眠。</p>
            <p>· 电脑没开或在睡眠时错过的，下次打开只补跑最近一次（7 天内）。工程里有任务在进行时，等它做完再跑，最多等 2 小时。</p>
            <p>· 无人值守：智能体不提问，按最合理的理解做，把做过的假设写在最后回复的“待确认”里；改动照常等你审核、提交，智能体不会自己提交。</p>
          </div>
        </div>
      </div>

      {draft && <ScheduleEditor draft={draft} projects={projects} onClose={() => setDraft(null)} onSaved={(r) => { setSt(r); setDraft(null); setTab('mine') }} />}
    </div>
  )
}

function ScheduleRow({ s, pname, now, open, busy, onToggleOpen, onEnable, onRun, onEdit, onRemove }: {
  s: Schedule; pname: string; now: number; open: boolean; busy: boolean
  onToggleOpen: () => void; onEnable: (v: boolean) => void; onRun: () => void; onEdit: () => void; onRemove: () => void
}) {
  const skills = useStore((x) => x.app?.skills || NO_SKILLS)
  const titleOf = (n: string) => skills.find((k) => k.name === n)?.title || n
  const last = s.runs[0]
  const ls = last ? runState(last) : null
  return (
    <div className={`sched-item ${open ? 'open' : ''} ${s.enabled ? '' : 'off'}`}>
      <div className="sched-row">
        <Button className="sched-main" onPress={onToggleOpen} aria-expanded={open} aria-label={`${s.name}，${s.describe}，${nextText(s, now)}`}>
          <span className="sched-icon"><Icon name="clock" size={17} stroke={1.7} /></span>
          <span className="sched-text">
            <span className="sched-name">{s.name}</span>
            <span className="sched-meta">{s.describe} · {pname}{s.skills.length ? ` · ${s.skills.map(titleOf).join(' + ')}` : ''}</span>
          </span>
          <span className={`sched-next ${s.pending ? 'pending' : ''}`}>{nextText(s, now)}</span>
          {ls ? <span className={`pill sm ${ls.tone}`} title={last?.reason || ''}><span className="dot" />{ls.text}</span> : <span className="pill sm idle">还没运行</span>}
          <Icon name="chevron" size={14} className="sched-chev" />
        </Button>
        <Toggle isSelected={s.enabled} onChange={onEnable} aria-label={`启用“${s.name}”`} />
        <span className="sched-acts">
          <Button className="out-act" onPress={onRun} isDisabled={busy} aria-label={`立即运行“${s.name}”`}>{busy ? <span className="spin" /> : <Icon name="play" size={15} />}</Button>
          <Button className="out-act" onPress={onEdit} aria-label={`编辑“${s.name}”`}><Icon name="edit" size={15} /></Button>
          <Button className="out-act" onPress={onRemove} aria-label={`删除“${s.name}”`}><Icon name="trash" size={15} /></Button>
        </span>
      </div>
      {open && (
        <div className="sched-detail">
          <div className="sched-prompt">{s.prompt}</div>
          <div className="sched-runs-head small muted">运行记录{s.runs.length ? `（最近 ${s.runs.length} 次）` : ''}</div>
          {!s.runs.length && <div className="small muted">还没运行过。点右边的 ▶ 可以马上试一次。</div>}
          {s.runs.map((r) => {
            const rs = runState(r)
            const canOpen = !!(r.taskId && r.projectId && r.task)
            const body = (<>
              <span className="run-when">{whenText(r.at, now)}</span>
              <span className={`pill sm ${rs.tone}`}><span className="dot" />{rs.text}</span>
              <span className="run-text">
                {r.catchup && <span className="chip-tag">补跑</span>}
                {r.manual && <span className="chip-tag">手动</span>}
                {r.reason || (r.task ? r.task.title : '')}
              </span>
              {canOpen && <Icon name="arrow" size={13} className="run-go" />}
            </>)
            return canOpen
              ? <Button key={r.id} className="run-row" onPress={() => void useStore.getState().openTaskById(r.projectId!, r.taskId!)} aria-label={`打开 ${whenText(r.at, now)} 那次运行的任务`}>{body}</Button>
              : <div key={r.id} className="run-row static">{body}</div>
          })}
        </div>
      )}
    </div>
  )
}

function ScheduleEditor({ draft, projects, onClose, onSaved }: { draft: ScheduleDraft; projects: { id: string; name: string }[]; onClose: () => void; onSaved: (s: ScheduleState) => void }) {
  const run = useStore((s) => s.run)
  const skills = useStore((s) => s.app?.skills || NO_SKILLS)
  const [d, setD] = useState<ScheduleDraft>(draft)
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<ScheduleDraft>) => setD((x) => ({ ...x, ...p }))
  const setT = (p: Partial<Trigger>) => setD((x) => ({ ...x, trigger: { ...x.trigger, ...p } }))
  const changeFreq = (f: Freq) => {
    const t: Trigger = { freq: f }
    if (f === 'hourly') t.minute = d.trigger.minute ?? 0
    if (f === 'daily' || f === 'weekdays' || f === 'weekly') t.time = d.trigger.time || '09:00'
    if (f === 'weekly') t.days = d.trigger.days?.length ? d.trigger.days : [1]
    if (f === 'once') t.at = d.trigger.at && d.trigger.at > Date.now() ? d.trigger.at : nextRun({ freq: 'daily', time: '20:00' }, Date.now()) || Date.now() + 3600_000
    set({ trigger: t })
  }
  const next = useMemo(() => nextRun(d.trigger, Date.now()), [d.trigger])
  const titleOf = (n: string) => skills.find((k) => k.name === n)?.title || n
  const save = async () => {
    setSaving(true)
    try {
      const r = await run((api) => api.schedule.save(d), '保存失败')
      if (r) { onSaved(r.state); useStore.getState().toast({ text: d.id ? `已保存“${d.name}”` : `已新建“${d.name}”${d.enabled !== false && next ? `，下次 ${whenText(next)}` : ''}`, tone: 'ok' }) }
    } finally { setSaving(false) }
  }
  const timed = d.trigger.freq === 'daily' || d.trigger.freq === 'weekdays' || d.trigger.freq === 'weekly'
  return (
    <ModalOverlay className="modal-scrim" isDismissable isOpen onOpenChange={(o) => { if (!o) onClose() }}>
      <Modal className="modal wide sched-modal">
        <Dialog className="modal-dialog" aria-label={d.id ? '编辑定时任务' : '新建定时任务'}>
          <Heading slot="title" className="modal-title">{d.id ? '编辑定时任务' : '新建定时任务'}</Heading>
          <label className="field"><span>名称</span>
            <input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="每晚静态分析巡检" autoFocus maxLength={60} />
          </label>
          <label className="field"><span>每次运行要做什么</span>
            <textarea value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={6} placeholder="对本工程的 C 代码做一次静态分析，结果写到 巡检/静态分析/<今天的日期>/，和上次比较，列出新增的问题。不要修改源代码。" />
          </label>
          <div className="sched-hint muted small">每次运行都是一个新任务，不记得上次的对话：写清楚要做什么、结果写到哪里。运行时没人回答问题，智能体会按最合理的理解做，把假设写在最后回复的“待确认”里。</div>
          <div className="field"><span>技能（可不选，智能体自己判断）</span>
            <div className="chips sched-skills">
              {d.skills.map((n) => (
                <span key={n} className="chip">{titleOf(n)}<Button className="chip-x" onPress={() => set({ skills: d.skills.filter((x) => x !== n) })} aria-label={`去掉技能 ${titleOf(n)}`}><Icon name="x" size={12} /></Button></span>
              ))}
              {d.skills.length < 3 && <SkillPickerButton skills={skills} picked={d.skills} onPick={(n) => set({ skills: d.skills.includes(n) ? d.skills.filter((x) => x !== n) : [...d.skills, n].slice(0, 3) })} variant="chip" placement="bottom start" label="选技能" />}
            </div>
          </div>
          <div className="field-row">
            <label className="field grow"><span>工程</span>
              <select className="sched-sel" value={d.projectId} onChange={(e) => set({ projectId: e.target.value })}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field"><span>模式</span>
              <select className="sched-sel" value={d.mode} onChange={(e) => set({ mode: e.target.value === 'code' ? 'code' : 'task' })}>
                <option value="task">任务模式（文档和图）</option>
                <option value="code">代码模式（改代码）</option>
              </select>
            </label>
          </div>
          <div className="field-row sched-trig">
            <label className="field"><span>运行</span>
              <select className="sched-sel" value={d.trigger.freq} onChange={(e) => changeFreq(e.target.value as Freq)}>
                {(Object.keys(FREQ_NAMES) as Freq[]).map((f) => <option key={f} value={f}>{FREQ_NAMES[f]}</option>)}
              </select>
            </label>
            {timed && <label className="field"><span>时间</span><input type="time" value={d.trigger.time || '09:00'} onChange={(e) => setT({ time: e.target.value })} /></label>}
            {d.trigger.freq === 'hourly' && <label className="field"><span>每小时的第几分钟</span><input type="number" min={0} max={59} value={d.trigger.minute ?? 0} onChange={(e) => setT({ minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })} /></label>}
            {d.trigger.freq === 'once' && <label className="field"><span>日期和时间</span><input type="datetime-local" value={d.trigger.at ? localInput(d.trigger.at) : ''} onChange={(e) => setT({ at: e.target.value ? new Date(e.target.value).getTime() : undefined })} /></label>}
          </div>
          {d.trigger.freq === 'weekly' && (
            <div className="sched-days" role="group" aria-label="每周哪几天">
              {WEEK_ORDER.map((day) => {
                const on = (d.trigger.days || []).includes(day)
                return <button key={day} type="button" aria-pressed={on} className={`cat-chip ${on ? 'on' : ''}`} onClick={() => setT({ days: on ? (d.trigger.days || []).filter((x) => x !== day) : [...(d.trigger.days || []), day] })}>{DAY_NAMES[day]}</button>
              })}
            </div>
          )}
          <div className="sched-preview small">
            <Icon name="clock" size={13} stroke={1.8} />
            {d.trigger.freq === 'manual' ? '不会自己运行，只在点“立即运行”时运行' : next ? `${describeTrigger(d.trigger)} · 下次运行：${whenText(next)}` : '这个时间已经过了'}
          </div>
          <div className="modal-foot sched-foot-row">
            <Toggle isSelected={d.enabled !== false} onChange={(v) => set({ enabled: v })}>启用</Toggle>
            <span className="grow" />
            <Key onPress={onClose}>取消</Key>
            <Key variant="primary" onPress={() => void save()} isDisabled={saving || !d.name.trim() || !d.prompt.trim() || !d.projectId}>{saving ? '保存中…' : d.id ? '保存' : '创建'}</Key>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
