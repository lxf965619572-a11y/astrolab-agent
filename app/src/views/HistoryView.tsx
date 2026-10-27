// 任务历史：本项目做过的任务，点开查看；停止的任务可以继续。

import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from '../store'
import type { Task } from '../api'
import { Icon, STAGE_ICON } from '../components/Icon'
import { ViewTabs } from '../components/Shell'
import { elapsed } from '../format'

const S: Record<string, string> = { done: '待审核', stopped: '已停止', error: '出错', running: '进行中', asking: '等你决定', starting: '启动中', idle: '' }

export function HistoryView() {
  const run = useStore((s) => s.run)
  const ts = useStore((s) => s.ts)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const [list, setList] = useState<Task[]>([])
  useEffect(() => { void run((api) => api.task.history()).then((h) => setList(h || [])) }, [run, ts?.task?.id, ts?.status])
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false
  const open = async (id: string) => {
    if (ts?.task?.id === id) { setView('task'); return }
    const s = await run(async (api) => { await api.task.open(id); return api.getState() }, '打不开这个任务')
    if (s) { useStore.getState().applyAppState(s); setView('task') }
  }
  return (
    <div className="history-layout">
      <div className="page-head pad-x">
        <div><h1>任务历史</h1><div className="sub">{ts?.project?.name} · 共 {list.length} 个任务</div></div>
        {ts?.task && <ViewTabs value={view} onChange={setView} />}
      </div>
      {busy && <div className="note-line muted small pad-x"><span className="led" />任务进行中，可以查看它；其他任务要等它结束后才能打开</div>}
      <div className="history-list card">
        {list.map((t) => (
          <Button key={t.id} className="hist-row" isDisabled={busy && ts?.task?.id !== t.id} onPress={() => void open(t.id)}>
            <Icon name={STAGE_ICON[t.stage] || 'file'} size={18} stroke={1.7} />
            <span className="hist-stage">{t.stageName}</span>
            <span className="hist-title">{t.title}</span>
            <span className="muted small">{new Date(t.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="muted small mono">{t.endedAt ? elapsed(t.endedAt - t.startedAt) : ''}</span>
            <span className={`pill sm ${t.commit ? 'ok' : t.status === 'done' ? 'ok' : t.status === 'error' ? 'err' : 'idle'}`}>{t.commit ? '已提交' : S[t.status] || t.status}</span>
          </Button>
        ))}
        {!list.length && <div className="pad muted">还没有任务。</div>}
      </div>
    </div>
  )
}
