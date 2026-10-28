// 任务历史：本项目做过的任务，按研制环节类别筛选；点开查看，停止的任务可以继续。

import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from '../store'
import { modeOf } from '../modes'
import type { Task } from '../api'
import { Icon, STAGE_ICON } from '../components/Icon'
import { CATEGORIES } from '../skills'
import { elapsed } from '../format'

const S: Record<string, string> = { done: '待审核', stopped: '已停止', error: '出错', running: '进行中', asking: '等你决定', starting: '启动中', interrupted: '已中断', idle: '' }

export function HistoryView() {
  const run = useStore((s) => s.run)
  const ts = useStore((s) => s.ts)
  const setView = useStore((s) => s.setView)
  const app = useStore((s) => s.app)
  const [list, setList] = useState<Task[]>([])
  const [cat, setCat] = useState('全部')
  // 类别：新任务记在 task.category；旧任务按环节换算
  const OLD: Record<string, string> = { requirements: '需求', hld: '设计', dd: '设计', coding: '编码', utest: '测试', review: '走查', skill: '创作', plugin: '创作' }
  const catOf = (t: Task) => t.category || OLD[t.stage] || (app?.skills || []).find((x) => x.name === t.skill)?.category || '其他'
  const iconOf = (t: Task) => STAGE_ICON[t.stage] || CATEGORIES.find((c) => c.id === catOf(t))?.icon || 'file'
  const cats = ['全部', ...CATEGORIES.map((c) => c.id).filter((c) => list.some((t) => catOf(t) === c))]
  const shown = cat === '全部' ? list : list.filter((t) => catOf(t) === cat)
  useEffect(() => { void run((api) => api.task.history()).then((h) => setList(h || [])) }, [run, ts?.task?.id, ts?.status])
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  // 打开到任务所属的模式（代码任务在代码模式里看对话和改动）
  const open = async (t: Task) => {
    const target = modeOf(t) === 'code' ? 'code' : 'task'
    if (ts?.task?.id === t.id) { setView(target); return }
    const s = await run(async (api) => { await api.task.open(t.id); return api.getState() }, '打不开这个任务')
    if (s) { useStore.getState().applyAppState(s); setView(target) }
  }
  return (
    <div className="history-layout">
      <div className="page-head pad-x">
        <div><h1>任务历史</h1><div className="sub">{ts?.project?.name} · 共 {list.length} 个任务</div></div>
      </div>
      {busy && <div className="note-line muted small pad-x"><span className="led" />任务进行中，可以查看它；其他任务要等它结束后才能打开</div>}
      <div className="cat-filter pad-x" role="tablist" aria-label="按类别筛选">
        {cats.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} className={`cat-chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>
            {c}<span className="cat-n">{c === '全部' ? list.length : list.filter((t) => catOf(t) === c).length}</span>
          </button>
        ))}
      </div>
      <div className="history-list card">
        {shown.map((t) => (
          <Button key={t.id} className="hist-row" isDisabled={busy && ts?.task?.id !== t.id} onPress={() => void open(t)}>
            <Icon name={iconOf(t)} size={18} stroke={1.7} />
            <span className="hist-stage">{t.stageName}</span>
            <span className={`hist-mode ${modeOf(t)}`}>{modeOf(t) === 'code' ? '代码' : '任务'}</span>
            <span className="hist-title">{t.title}</span>
            <span className="muted small">{new Date(t.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="muted small mono">{t.endedAt ? elapsed(t.endedAt - t.startedAt) : ''}</span>
            <span className={`pill sm ${t.commit ? 'ok' : t.status === 'done' ? 'ok' : t.status === 'error' ? 'err' : 'idle'}`}>{t.commit ? '已提交' : S[t.id !== ts?.task?.id && ['starting', 'running', 'asking'].includes(t.status) ? 'interrupted' : t.status] || t.status}</span>
          </Button>
        ))}
        {!shown.length && <div className="pad muted">{list.length ? '这个类别还没有任务。' : '还没有任务。'}</div>}
      </div>
    </div>
  )
}
