// 发起页和对话页共用的选择器：“技能”按钮（按类别搜全部技能）、“添加文件”（搜项目文件）、“/”菜单的筛选

import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import { useStore } from '../store'
import { Icon } from './Icon'
import type { SkillCard } from '../api'
import { CATEGORIES, categoryOf } from '../skills'

export const SOURCE: Record<string, string> = { builtin: '内置', installed: '已安装', mine: '我做的' }
export const MAX_SKILLS = 3

export function filterSkills(skills: SkillCard[], q: string) {
  const k = q.trim().toLowerCase()
  if (!k) return skills
  return skills.filter((s) => `${s.title} ${s.name} ${(s.keywords || []).join(' ')} ${categoryOf(s).name}`.toLowerCase().includes(k))
}

/** “技能”按钮：搜全部技能，按类别分组 */
export function SkillPickerButton({ skills, picked, onPick, variant = 'chip', placement }: { skills: SkillCard[]; picked: string[]; onPick: (n: string) => void; variant?: 'chip' | 'card'; placement?: 'top' | 'top start' | 'bottom start' }) {
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
      <Popover className="pop skill-pop" placement={placement || (variant === 'card' ? 'top' : 'bottom start')}>
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

export function FilePicker({ onPick, label = '添加文件', className = 'chip add', initialQuery = '', placement = 'bottom start' }: { onPick: (f: string) => void; label?: string; className?: string; initialQuery?: string; placement?: 'top start' | 'bottom start' }) {
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
      <Popover className="pop file-pop" placement={placement}>
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
