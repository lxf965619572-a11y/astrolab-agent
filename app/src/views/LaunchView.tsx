// 发起任务（和 Claude 一样的输入框）：说清楚要做什么，按需选技能，带上相关文件，按发送（Ctrl Enter）。
// 输入框下面是工作区（在哪个项目文件夹里做，可以切换）和提醒开关。
// 选技能有三种方式：点下面的常用技能；输入框里打“/”；点左下角“+”。
// 不选也行：工作台按描述在本地推荐（不靠模型），智能体做到一半需要别的技能也会自己加载。

import { useEffect, useMemo, useRef, useState } from 'react'
import { Autocomplete, Button, Dialog, DialogTrigger, Header, Input, Menu, MenuItem, MenuSection, MenuTrigger, Popover, SearchField, Separator, SubmenuTrigger, ToggleButton, useFilter } from 'react-aria-components'
import { motion } from 'motion/react'
import { useStore } from '../store'
import { AppIcon, Icon } from '../components/Icon'
import { projectAction, visibleProjects } from '../components/Shell'
import { Key, Kbd } from '../components/Keys'
import { play } from '../sound'
import type { Mention, Project, SkillCard } from '../api'
import { elapsed } from '../format'
import { useNow } from './TaskView'
import { categoryOf, skillIcon, suggestSkills } from '../skills'
import { FilePanel, FilePicker, MAX_SKILLS, SkillPanel, SkillPickerButton, filterSkills } from '../components/Pickers'
import { categoryMode, modeOf } from '../modes'


function greeting() {
  const h = new Date().getHours()
  return h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
}

/** 两种模式各有一个新任务页：常用技能只列这个模式的；compact 是代码模式（右边有代码面板），窄一点。
 *  inProject：嵌在工程主页上半部分（没有问候语和背景，工程固定，不显示切换工作区） */
export function LaunchView({ compact = false, inProject = false }: { compact?: boolean; inProject?: boolean } = {}) {
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
  const placeholder = first?.placeholder || (inProject
    ? `在 ${project.name} 里新建${mode === 'code' ? '代码' : ''}任务：说说要做什么。输入 / 选技能`
    : mode === 'code'
      ? '说说要改哪里，例如：给 rt_drv.c 的复位超时补单元测试。输入 / 选技能'
      : '说说要做什么，例如：根据任务书和 ICD 画 PCU 软件的信息流图。输入 / 选技能')

  const addFile = (f: string) => { if (!files.includes(f)) setDraft({ files: [...files, f] }) }
  const hasChips = !!(chosen.length || files.length || auto.length || ambiguous.length)
  const canStart = !busy && !!prompt.trim() && !prompt.startsWith('/') && !starting

  return (
    <div className={`launch launch3 ${compact ? 'compact' : ''} ${inProject ? 'in-project' : ''}`}>
      {!inProject && <div className="launch-bg" aria-hidden="true"><div className="launch-blob a" /><div className="launch-blob b" /></div>}
      {!inProject && (
        <motion.div className="launch-hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <h1><AppIcon size={compact ? 28 : 34} /><span>{mode === 'code' ? `在 ${project.name} 上写代码` : `${greeting()}，要做什么？`}</span></h1>
          {mode === 'code' && <p>右边是项目文件和改动；看中的文件点“加到新任务”。</p>}
        </motion.div>
      )}

      {!!app?.notes?.length && <div className="notes">{app.notes.map((n) => <div key={n} className="note warn"><Icon name="warn" size={14} />{n}</div>)}</div>}
      {busy ? <RunningBanner /> : <UnreviewedNote />}

      <motion.section className="cmp" aria-label="新任务" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay: 0.04 }}>
        <div className="cmp-box" onClick={(e) => { if (e.target === e.currentTarget) ta.current?.focus() }}>
          {hasChips && (
            <div className="cmp-chips">
              {chosen.map((s) => (
                <span key={s.name} className="chip skill" title={s.description}>
                  <Icon name={skillIcon(s)} size={14} stroke={1.8} /><span>{s.title}</span>
                  <Button className="chip-x" aria-label={`不用 ${s.title}`} onPress={() => unpick(s.name)}><Icon name="x" size={11} stroke={2.4} /></Button>
                </span>
              ))}
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
                <FilePicker key={m.name} label={`${m.name} 有 ${m.paths.length} 个同名文件，选一个`} className="chip warn" initialQuery={m.name} onPick={addFile} />
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
          {first && (first.hint || first.description) && <div className="cmp-hint"><Icon name="sparkle" size={13} className="accent" />{first.hint || firstSentence(first.description)}</div>}
          <div className="cmp-bar">
            <PlusMenu skills={skills} common={pinned} picked={picked} onPick={pick} onFile={addFile} />
            {suggestions.length > 0 && (
              <div className="cmp-suggest" aria-label="推荐技能">
                <span className="muted small">推荐</span>
                {suggestions.map((x, i) => (
                  <Button key={x.skill.name} className="suggest-chip" onPress={() => pick(x.skill.name)}>
                    <Icon name={skillIcon(x.skill)} size={13} stroke={1.8} />{x.skill.title}{i === 0 && <Kbd>Tab</Kbd>}
                  </Button>
                ))}
              </div>
            )}
            <span className="grow" />
            <Button className="cmp-send" isDisabled={!canStart} onPress={() => void start()}
              aria-label={busy ? '等当前任务结束后才能开始' : '开始（Ctrl Enter）'}>
              {starting ? <span className="cmp-spin" aria-hidden="true" /> : <Icon name="arrowUp" size={18} stroke={2.2} />}
              <span className="rail-tip cmp-tip" aria-hidden="true">{busy ? '等当前任务结束' : '开始 · Ctrl Enter'}</span>
            </Button>
          </div>
        </div>

        <div className="cmp-under">
          {!inProject && <WorkspacePicker />}
          <span className="grow" />
          {first?.report && (
            <ToggleButton className="cmp-opt" isSelected={report} onChange={(v) => setDraft({ report: v })} aria-label={first.report}>
              <Icon name={report ? 'check' : 'file'} size={13} stroke={2} />{first.report}
            </ToggleButton>
          )}
          <ToggleButton className="cmp-opt" isSelected={settings.notify} onChange={(v) => setSettings({ notify: v })}
            aria-label="完成或需要我决定时提醒">
            <Icon name={settings.notify ? 'bell' : 'bellOff'} size={14} stroke={1.8} />{settings.notify ? '完成时提醒' : '不提醒'}
          </ToggleButton>
        </div>
      </motion.section>

      <section className="cmp-skills" aria-label="常用技能">
        {pinned.map((s) => (
          <Button key={s.name} className={`cmp-skill ${picked.includes(s.name) ? 'on' : ''}`} aria-pressed={picked.includes(s.name)}
            onPress={() => (picked.includes(s.name) ? unpick(s.name) : pick(s.name))}>
            <Icon name={picked.includes(s.name) ? 'check' : skillIcon(s)} size={14} stroke={1.8} /><span>{s.title}</span>
            <span className="cmp-skill-tip" aria-hidden="true">{s.summary || firstSentence(s.description)}</span>
          </Button>
        ))}
        <SkillPickerButton skills={skills} picked={picked} onPick={pick} variant="chip" placement="bottom start" label="全部技能" />
      </section>
      {!inProject && <div className="cmp-foot muted small">不选技能也可以：智能体会按描述自己判断用哪个；在“技能与插件”里可以安装更多、设为常用</div>}
    </div>
  )
}

/** 输入框左下角的“+”：添加文件、选技能（常用的直接列出来，其余在“全部技能”里搜） */
function PlusMenu({ skills, common, picked, onPick, onFile }: { skills: SkillCard[]; common: SkillCard[]; picked: string[]; onPick: (n: string) => void; onFile: (f: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [panel, setPanel] = useState<null | 'file' | 'skill'>(null)
  return (
    <>
      <MenuTrigger>
        <Button ref={ref} className="cmp-plus" aria-label="添加文件或技能"><Icon name="plus" size={18} stroke={2} /></Button>
        <Popover className="menu-pop cmp-menu" placement="bottom start" offset={6}>
          <Menu className="menu" aria-label="添加" onAction={(k) => { if (k === 'file' || k === 'skill') setPanel(k) }}>
            <MenuItem id="file" className="menu-item" textValue="添加项目文件"><Icon name="file" size={15} /><span className="menu-text">添加项目文件…</span></MenuItem>
            <Separator className="menu-sep" />
            <SubmenuTrigger>
              <MenuItem id="skills" className="menu-item" textValue="技能"><Icon name="skills" size={15} /><span className="menu-text">技能</span><Icon name="chevron" size={13} stroke={2} className="menu-sub" /></MenuItem>
              <Popover className="menu-pop cmp-menu" offset={-2}>
                <Menu className="menu" aria-label="常用技能" onAction={(k) => onPick(String(k))} disabledKeys={picked}>
                  {common.map((s) => (
                    <MenuItem key={s.name} id={s.name} className="menu-item" textValue={s.title}>
                      <Icon name={skillIcon(s)} size={15} /><span className="menu-text">{s.title}<small>{s.summary || firstSentence(s.description)}</small></span>
                      {picked.includes(s.name) && <Icon name="check" size={14} stroke={2.4} className="accent" />}
                    </MenuItem>
                  ))}
                </Menu>
              </Popover>
            </SubmenuTrigger>
            <MenuItem id="skill" className="menu-item" textValue="全部技能"><Icon name="search" size={15} /><span className="menu-text">全部技能…</span><span className="menu-kbd">/</span></MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <Popover triggerRef={ref} isOpen={panel !== null} onOpenChange={(o) => { if (!o) setPanel(null) }} placement="bottom start" offset={6}
        className={`pop ${panel === 'skill' ? 'skill-pop' : 'file-pop'}`}>
        <Dialog className={panel === 'skill' ? 'skill-dialog' : 'file-dialog'} aria-label={panel === 'skill' ? '选技能' : '选择文件'}>
          {panel === 'skill'
            ? <SkillPanel skills={skills} picked={picked} onPick={onPick} close={() => setPanel(null)} />
            : <FilePanel onPick={onFile} close={() => setPanel(null)} />}
        </Dialog>
      </Popover>
    </>
  )
}

/** 输入框下面的工作区（和 Claude 的“Project or folder”一样）：任务在哪个项目文件夹里做。
 *  点开是一个可以搜的列表：置顶的在前，下面是其他工作区，最下面“打开项目文件夹…” */
function WorkspacePicker() {
  const app = useStore((s) => s.app)
  const project = useStore((s) => s.ts?.project)
  const { contains } = useFilter({ sensitivity: 'base' })
  if (!project) return null
  const list = visibleProjects(app?.projects || [], project.id)
  const top = list.filter((p) => p.pinned)
  const rest = list.filter((p) => !p.pinned)
  const live = new Set((app?.background || []).filter((b) => ['starting', 'running', 'asking'].includes(b.status) || b.asking).map((b) => b.projectId))
  const item = (p: Project) => (
    <MenuItem key={p.id} id={p.id} className="menu-item ws-item" textValue={`${p.name} ${p.path}`}>
      <Icon name="folder" size={15} />
      <span className="menu-text">{p.name}<small>{p.path}</small></span>
      {live.has(p.id) && <span className="led" aria-label="有任务在进行" />}
      {p.id === project.id && <Icon name="check" size={14} stroke={2.4} className="accent menu-check" />}
    </MenuItem>
  )
  return (
    <DialogTrigger>
      <Button className="cmp-ws" aria-label={`工作区：${project.name}，点击切换`}>
        <Icon name="folder" size={14} stroke={1.8} />
        <span className="cmp-ws-name">{project.name}</span>
        {project.git && <span className="cmp-ws-branch"><Icon name="branch" size={11} stroke={2} />{project.branch || 'Git'}</span>}
        <Icon name="chevron" size={12} stroke={2} />
        <span className="rail-tip cmp-tip up" aria-hidden="true">{project.path}</span>
      </Button>
      <Popover className="menu-pop ws-pop" placement="bottom start" offset={6}>
        <Dialog className="ws-dialog" aria-label="选择工作区">
          {({ close }) => (
            <>
              <Autocomplete filter={contains}>
                <SearchField className="ws-search" aria-label="搜索工作区" autoFocus>
                  <Icon name="search" size={14} stroke={1.8} />
                  <Input className="ws-input" placeholder="搜索工作区" />
                </SearchField>
                <Menu className="menu ws-menu" aria-label="工作区" onAction={(k) => { close(); void projectAction(String(k)) }}
                  renderEmptyState={() => <div className="ws-empty muted small">没有找到；可以打开一个新的项目文件夹</div>}>
                  {top.length > 0 && <MenuSection><Header className="menu-head">置顶</Header>{top.map(item)}</MenuSection>}
                  {rest.length > 0 && <MenuSection><Header className="menu-head">{top.length ? '其他工作区' : '工作区'}</Header>{rest.map(item)}</MenuSection>}
                </Menu>
              </Autocomplete>
              <div className="menu-sep" />
              <Button className="ws-add" onPress={() => { close(); void projectAction('__add') }}>
                <Icon name="folderPlus" size={15} /><span>打开项目文件夹…</span>
              </Button>
              <div className="ws-note muted small">智能体只在选中的文件夹里读写</div>
            </>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
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
