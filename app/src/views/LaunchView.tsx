// 发起任务（和 Claude 一样的输入框）：说清楚要做什么，按需选技能，带上相关文件，按“开始”。
// 选技能有三种方式：点下面的常用技能卡片；输入框里打“/”；点“技能”按钮搜。
// 不选也行：工作台按描述在本地推荐（不靠模型），智能体做到一半需要别的技能也会自己加载。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'react-aria-components'
import { motion } from 'motion/react'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import { Key, Kbd, Toggle } from '../components/Keys'
import { play } from '../sound'
import type { Mention, SkillCard } from '../api'
import { elapsed } from '../format'
import { useNow } from './TaskView'
import { categoryOf, skillIcon, suggestSkills } from '../skills'
import { FilePicker, MAX_SKILLS, SOURCE, SkillPickerButton, filterSkills } from '../components/Pickers'
import { categoryMode, modeOf } from '../modes'


function greeting() {
  const h = new Date().getHours()
  return h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
}

/** 两种模式各有一个新任务页：常用技能只列这个模式的；compact 是代码模式（右边有代码面板），窄一点 */
export function LaunchView({ compact = false }: { compact?: boolean } = {}) {
  const mode = useStore((s) => s.mode)
  const app = useStore((s) => s.app)
  const ts = useStore((s) => s.ts)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const run = useStore((s) => s.run)
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
    // 在哪个模式发起就属于哪个模式；切到它的对话由“任务开始”的状态事件做（引擎冷启动时 start 要等几十秒才返回）
    const t = await run((api) => api.task.start({ skills: picked, prompt: prompt.trim(), files: [...files, ...auto], options: { report }, mode }), '任务没有启动')
    setStarting(false)
    if (t) setDraft({ prompt: '', files: [], dismissed: [], skills: [] })
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

  // 常用技能只列这个模式的（全部技能里两种都能选）；这个模式一个常用的都没有时列它的全部技能
  const ofMode = skills.filter((s) => categoryMode(categoryOf(s).name) === mode)
  const pinned = ofMode.some((s) => s.pinned) ? ofMode.filter((s) => s.pinned) : ofMode.slice(0, 7)
  const placeholder = first?.placeholder || (mode === 'code'
    ? '说说要改哪里，例如：给 rt_drv.c 的复位超时补单元测试。输入 / 选技能'
    : '说说要做什么，例如：根据任务书和 ICD 画 PCU 软件的信息流图。输入 / 选技能')

  return (
    <div className={`launch launch2 ${compact ? 'compact' : ''}`}>
      <div className="launch-bg" aria-hidden="true"><div className="launch-blob a" /><div className="launch-blob b" /></div>
      <motion.div className="launch-hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <h1>{mode === 'code' ? `在 ${project.name} 上写代码` : `${greeting()}，要做什么？`}</h1>
        <p>{mode === 'code' ? '编码、单元测试、代码走查。右边是项目文件和改动；看中的文件点“加到新任务”。' : '需求、设计、文档与图。说清楚要做什么，按需选一个技能；过程中随时可以插话或停止。'}</p>
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
          <span className="strong">{mode === 'code' ? '代码模式的常用技能' : '任务模式的常用技能'}</span>
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
      <Key size="sm" variant={asking ? 'primary' : undefined} onPress={() => setView(modeOf(ts?.task) === 'code' ? 'code' : 'task')}>{asking ? '去回答' : '回到任务'}<Icon name="arrow" size={14} stroke={2} /></Key>
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
      <Key size="sm" onPress={() => setView(modeOf(t) === 'code' ? 'code' : 'task')}>看改动<Icon name="arrow" size={14} stroke={2} /></Key>
    </div>
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
