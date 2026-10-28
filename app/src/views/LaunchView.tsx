// 发起任务（和 Claude 一样的输入框）：说清楚要做什么，按需选技能，带上相关文件，按“开始”。
// 选技能有三种方式：点下面的常用技能卡片；输入框里打“/”；点“技能”按钮搜。
// 不选也行：工作台按描述在本地推荐（不靠模型），智能体做到一半需要别的技能也会自己加载。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import { motion } from 'motion/react'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import { Key, Kbd, Toggle } from '../components/Keys'
import { play } from '../sound'
import type { Mention, SkillCard } from '../api'
import { elapsed } from '../format'
import { useNow } from './TaskView'
import { CATEGORIES, categoryOf, skillIcon, suggestSkills } from '../skills'

const SOURCE: Record<string, string> = { builtin: '内置', installed: '已安装', mine: '我做的' }
const MAX_SKILLS = 3

function greeting() {
  const h = new Date().getHours()
  return h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
}

/** compact：代码模式里没有任务时放在中间（右边是代码面板），窄一点 */
export function LaunchView({ compact = false }: { compact?: boolean } = {}) {
  const app = useStore((s) => s.app)
  const ts = useStore((s) => s.ts)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const run = useStore((s) => s.run)
  const setView = useStore((s) => s.setView)
  const toast = useStore((s) => s.toast)
  const draft = useStore((s) => s.draft)
  const setDraft = useStore((s) => s.setDraft)
  const { prompt, files, report, dismissed } = draft
  const picked = draft.skills || []
  const [starting, setStarting] = useState(false)
  const skills = useMemo(() => app?.skills || [], [app?.skills])
  const byName = useMemo(() => new Map(skills.map((s) => [s.name, s])), [skills])
  const chosen = picked.map((n) => byName.get(n)).filter(Boolean) as SkillCard[]
  const first = chosen[0]

  // 描述里直接写了文件名：唯一匹配的自动带上（可以去掉），同名多个的让用户选
  const [mentions, setMentions] = useState<Mention[]>([])
  useEffect(() => {
    if (!prompt.includes('.')) { setMentions([]); return }
    const t = setTimeout(() => { void run((api) => api.project.mentions(prompt)).then((m) => setMentions(m || [])) }, 300)
    return () => clearTimeout(t)
  }, [prompt, run])
  const auto = mentions.filter((m) => m.paths.length === 1 && !files.includes(m.paths[0]) && !dismissed.includes(m.paths[0])).map((m) => m.paths[0])
  const ambiguous = mentions.filter((m) => m.paths.length > 1 && !m.paths.some((p) => files.includes(p)))

  // “/”菜单：输入框以 / 开头时按后面的字筛技能
  const slash = prompt.startsWith('/') ? prompt.slice(1).split(/\s/)[0] : null
  const slashList = useMemo(() => (slash === null ? [] : filterSkills(skills, slash).filter((s) => !picked.includes(s.name))), [slash, skills, picked])
  const [slashSel, setSlashSel] = useState(0)
  useEffect(() => { setSlashSel(0) }, [slash])

  // 本地推荐：没选技能、描述写了几个字以后
  const suggestions = useMemo(() => (picked.length || slash !== null ? [] : suggestSkills(prompt, skills, 2)), [prompt, skills, picked.length, slash])

  const ta = useRef<HTMLTextAreaElement>(null)
  const project = ts?.project
  const busy = !!ts && ['starting', 'running', 'asking'].includes(ts.status)
  useEffect(() => { ta.current?.focus() }, [])

  const pick = (name: string) => {
    if (picked.includes(name)) return
    if (picked.length >= MAX_SKILLS) { toast({ text: `一次最多选 ${MAX_SKILLS} 个技能`, tone: 'info' }); return }
    setDraft({ skills: [...picked, name], prompt: prompt.startsWith('/') ? prompt.replace(/^\/\S*\s?/, '') : prompt })
    play('tick')
    setTimeout(() => ta.current?.focus(), 0)
  }
  const unpick = (name: string) => setDraft({ skills: picked.filter((n) => n !== name) })

  const start = async () => {
    if (busy) { toast({ text: '当前任务结束后才能开始新任务，写好的内容会保留', tone: 'info' }); return }
    if (!prompt.trim() || prompt.startsWith('/') || starting) return
    setStarting(true)
    play('send')
    const t = await run((api) => api.task.start({ skills: picked, prompt: prompt.trim(), files: [...files, ...auto], options: { report } }), '任务没有启动')
    setStarting(false)
    // 引擎冷启动时 start 要等几十秒才返回：用户这期间去了别的页面（比如代码模式），就不把人拉回来
    if (t) { setDraft({ prompt: '', files: [], dismissed: [], skills: [] }); if (useStore.getState().view === 'launch') setView('task') }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash !== null && slashList.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSel((i) => Math.min(slashList.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSel((i) => Math.max(0, i - 1)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(slashList[slashSel].name); return }
    }
    if (slash !== null && e.key === 'Escape') { e.preventDefault(); setDraft({ prompt: '' }); return }
    if (e.key === 'Tab' && !e.shiftKey && suggestions.length) { e.preventDefault(); pick(suggestions[0].skill.name); return }
    if (e.key === 'Backspace' && !prompt && picked.length) { e.preventDefault(); unpick(picked[picked.length - 1]) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); void start() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!project) return <NoProject />

  const pinned = skills.filter((s) => s.pinned)
  const placeholder = first?.placeholder || '说说要做什么，例如：根据任务书和 ICD 画 PCU 软件的信息流图。输入 / 选技能'

  return (
    <div className={`launch launch2 ${compact ? 'compact' : ''}`}>
      <div className="launch-bg" aria-hidden="true"><div className="launch-blob a" /><div className="launch-blob b" /></div>
      <motion.div className="launch-hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1>{greeting()}，要做什么？</h1>
        <p>{compact ? '右边看着项目文件，在这里说要做什么；“加到新任务”的文件会带上。' : '说清楚要做什么，按需选一个技能；过程中随时可以插话或停止。'}</p>
      </motion.div>

      {!!app?.notes?.length && <div className="notes">{app.notes.map((n) => <div key={n} className="note warn"><Icon name="warn" size={14} />{n}</div>)}</div>}
      {busy ? <RunningBanner /> : <UnreviewedNote />}

      <motion.section className="composer-card composer2" aria-label="新任务" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay: 0.04 }}>
        <div className="ask-box">
          {!!chosen.length && (
            <div className="skill-picked">
              {chosen.map((s) => (
                <span key={s.name} className="chip skill" title={s.description}>
                  <Icon name={skillIcon(s)} size={14} stroke={1.8} /><span>{s.title}</span>
                  <Button className="chip-x" aria-label={`不用 ${s.title}`} onPress={() => unpick(s.name)}><Icon name="x" size={11} stroke={2.4} /></Button>
                </span>
              ))}
            </div>
          )}
          <label className="sr-only" htmlFor="launch-prompt">要做什么</label>
          <textarea id="launch-prompt" ref={ta} rows={3} value={prompt} placeholder={placeholder} onKeyDown={onKeyDown} onChange={(e) => setDraft({ prompt: e.target.value })} />
          {slash !== null && (
            <div className="slash-menu" role="listbox" aria-label="选技能">
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
          <div className="chips">
            <SkillPickerButton skills={skills} picked={picked} onPick={pick} />
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
          {suggestions.length > 0 ? (
            <div className="ask-hint suggest">
              <Icon name="sparkle" size={14} className="accent" />推荐技能：
              {suggestions.map((x, i) => (
                <Button key={x.skill.name} className="suggest-chip" onPress={() => pick(x.skill.name)}>
                  <Icon name={skillIcon(x.skill)} size={13} stroke={1.8} />{x.skill.title}{i === 0 && <Kbd>Tab</Kbd>}
                </Button>
              ))}
            </div>
          ) : (
            <div className="ask-hint"><Icon name="sparkle" size={14} className="accent" />
              {first ? first.hint || first.description : '不选技能也可以：智能体会按描述自己判断用哪个技能'}
            </div>
          )}
        </div>

        <div className="launch-foot">
          {first?.report && <Toggle isSelected={report} onChange={(v) => setDraft({ report: v })}>{first.report}</Toggle>}
          <Toggle isSelected={settings.notify} onChange={(v) => setSettings({ notify: v })}>完成或需要我决定时提醒</Toggle>
          <span className="grow" />
          {busy
            ? <Key variant="primary" size="lg" isDisabled>等当前任务结束</Key>
            : <Key variant="primary" size="lg" isDisabled={!prompt.trim() || prompt.startsWith('/') || starting} onPress={() => void start()}>
                {starting ? '启动中…' : '开始'}<Kbd>Ctrl Enter</Kbd>
              </Key>}
        </div>
      </motion.section>

      <section className="skill-cards-wrap" aria-label="常用技能">
        <div className="skill-cards-head">
          <span className="strong">常用技能</span>
          <span className="muted small">点一下选用；在“技能与插件”里可以安装更多、设为常用</span>
        </div>
        <div className="skill-cards">
          {pinned.map((s) => (
            <Button key={s.name} className={`skill-card ${picked.includes(s.name) ? 'on' : ''}`} onPress={() => (picked.includes(s.name) ? unpick(s.name) : pick(s.name))}>
              <span className="skill-card-top">
                <span className="skill-ico"><Icon name={skillIcon(s)} size={18} stroke={1.7} /></span>
                <span className="skill-card-name">{s.title}</span>
                {picked.includes(s.name) && <Icon name="check" size={15} stroke={2.4} className="accent" />}
              </span>
              <span className="skill-card-desc">{s.summary || firstSentence(s.description)}</span>
              <span className="skill-card-meta">{categoryOf(s).name} · {SOURCE[s.source]}</span>
            </Button>
          ))}
          <SkillPickerButton skills={skills} picked={picked} onPick={pick} variant="card" />
        </div>
      </section>
    </div>
  )
}

function firstSentence(t: string) {
  const s = t.split(/[。；]/)[0]
  return s.length > 48 ? `${s.slice(0, 46)}…` : s
}

function filterSkills(skills: SkillCard[], q: string) {
  const k = q.trim().toLowerCase()
  if (!k) return skills
  return skills.filter((s) => `${s.title} ${s.name} ${(s.keywords || []).join(' ')} ${categoryOf(s).name}`.toLowerCase().includes(k))
}

/** “技能”按钮：搜全部技能，按类别分组 */
function SkillPickerButton({ skills, picked, onPick, variant = 'chip' }: { skills: SkillCard[]; picked: string[]; onPick: (n: string) => void; variant?: 'chip' | 'card' }) {
  const [q, setQ] = useState('')
  const list = filterSkills(skills, q)
  return (
    <DialogTrigger>
      {variant === 'card'
        ? <Button className="skill-card more">
            <span className="skill-card-top"><span className="skill-ico"><Icon name="skills" size={18} stroke={1.7} /></span><span className="skill-card-name">全部技能</span><Icon name="arrow" size={15} stroke={2} /></span>
            <span className="skill-card-desc">共 {skills.length} 个：内置、已安装和我做的，按类别浏览和搜索</span>
            <span className="skill-card-meta">也可以在输入框里打 /</span>
          </Button>
        : <Button className="chip add skill-add"><Icon name="skills" size={13} stroke={2} />技能<span className="muted"> /</span></Button>}
      <Popover className="pop skill-pop" placement={variant === 'card' ? 'top' : 'bottom start'}>
        <Dialog className="skill-dialog" aria-label="选技能">
          {({ close }) => (<>
            <input autoFocus className="file-search" placeholder="搜技能，例如 走查、信息流、单元测试" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="skill-pop-list">
              {CATEGORIES.map((c) => {
                const xs = list.filter((s) => categoryOf(s).id === c.id)
                if (!xs.length) return null
                return (
                  <div key={c.id} className="skill-pop-group">
                    <div className="skill-pop-cat"><Icon name={c.icon} size={13} stroke={1.8} />{c.name}</div>
                    {xs.map((s) => (
                      <Button key={s.name} className={`skill-opt ${picked.includes(s.name) ? 'on' : ''}`} isDisabled={picked.includes(s.name)} onPress={() => { onPick(s.name); close() }}>
                        <span className="skill-opt-name">{s.title}<span className="pill sm idle">{SOURCE[s.source]}</span>{picked.includes(s.name) && <Icon name="check" size={13} stroke={2.4} className="accent" />}</span>
                        <span className="skill-opt-desc">{s.description}</span>
                      </Button>
                    ))}
                  </div>
                )
              })}
              {!list.length && <div className="muted small pad">没有找到</div>}
            </div>
          </>)}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

/** 任务进行中：哪个任务、用了多久，一键回去 */
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
      <Key size="sm" onPress={() => setView('code')}>看改动<Icon name="arrow" size={14} stroke={2} /></Key>
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
