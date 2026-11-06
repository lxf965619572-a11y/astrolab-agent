// 产出（界面设计 v2 第 3 节，对应 Claude 的 Artifacts）：所有工程的任务生成或改过的文件。
// 按工程、类型筛选，按文件名搜。点一行：打开生成它的任务，在右边“产出”里预览；悬停：用默认程序打开、在文件夹中显示。
// 文件列表由主进程从任务记录里取（edit/write 的路径、文档生成的“已生成 …”），同一文件只列最近一次。

import { useEffect, useMemo, useState } from 'react'
import { Button } from 'react-aria-components'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import type { OutputFile, Task } from '../api'

const KINDS: { id: string; name: string; ext: RegExp; icon: string }[] = [
  { id: 'word', name: 'Word', ext: /\.(docx?|dotx)$/i, icon: 'file' },
  { id: 'excel', name: '表格', ext: /\.(xlsx?|csv)$/i, icon: 'template' },
  { id: 'md', name: 'Markdown', ext: /\.(md|txt)$/i, icon: 'file' },
  { id: 'img', name: '图', ext: /\.(svg|png|jpe?g|gif|html)$/i, icon: 'diagram' },
  { id: 'code', name: '代码', ext: /\.(c|h|cpp|hpp|mjs|js|ts|py|ps1|sh)$/i, icon: 'coding' },
]
const kindOf = (p: string) => KINDS.find((k) => k.ext.test(p))?.id || 'other'
const iconOf = (p: string) => KINDS.find((k) => k.ext.test(p))?.icon || 'file'
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)

export function OutputsView() {
  const run = useStore((s) => s.run)
  const ts = useStore((s) => s.ts)
  const recent = useStore((s) => s.recent)
  const histVer = useStore((s) => s.histVer)
  const [list, setList] = useState<OutputFile[] | null>(null)
  const [proj, setProj] = useState('全部')
  const [kind, setKind] = useState('全部')
  const [q, setQ] = useState('')
  useEffect(() => { void run((api) => api.task.outputs(), '读取产出失败').then((r) => setList(r || [])) }, [run, ts?.task?.id, ts?.status, histVer])
  const projects = useMemo(() => [...new Map((list || []).map((f) => [f.pid, f.pname])).entries()], [list])
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const base = (list || []).filter((f) => (proj === '全部' || f.pid === proj) && terms.every((t) => f.path.toLowerCase().includes(t)))
  const shown = kind === '全部' ? base : base.filter((f) => kindOf(f.path) === kind)
  const kinds = ['全部', ...KINDS.map((k) => k.id).filter((k) => base.some((f) => kindOf(f.path) === k)), ...(base.some((f) => kindOf(f.path) === 'other') ? ['other'] : [])]
  const kname = (k: string) => (k === '全部' ? '全部' : k === 'other' ? '其他' : KINDS.find((x) => x.id === k)!.name)

  // 打开生成它的任务（别的工程先切过去），右边“产出”里预览
  const preview = async (f: OutputFile) => {
    const st = useStore.getState()
    const t: Task | undefined = (recent[f.pid] || []).find((x) => x.id === f.taskId)
      || (await st.run((api) => api.task.recent(500)))?.[f.pid]?.find((x) => x.id === f.taskId)
    if (t) await (f.pid === st.ts?.project?.id ? st.openTask(t) : st.openTaskIn(f.pid, t))
    else await st.openProjectHome(f.pid)
    useStore.getState().openInCode(f.path)
  }
  const sys = (f: OutputFile, how: 'open' | 'show') => void run(async (api) => {
    if (api.sys.openIn) return api.sys.openIn(f.pid, f.path, how)
    if (f.pid !== useStore.getState().ts?.project?.id) throw new Error('先切到这个工程')
    return how === 'show' ? api.sys.showItem(f.path) : api.sys.openPath(f.path)
  }, how === 'show' ? '打不开文件夹' : '打不开文件')

  return (
    <div className="history-layout">
      <div className="page-head pad-x">
        <div><h1>产出</h1><div className="sub">{list ? `${projects.length} 个工程 · ${list.length} 个文件，按修改时间排` : '正在读取…'} · 智能体生成或改过的文件，同一文件只列最近一次</div></div>
        <input className="field out-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="按文件名找" aria-label="按文件名找" />
      </div>
      {projects.length > 1 && (
        <div className="cat-filter proj-filter pad-x" role="tablist" aria-label="按工程筛选">
          {[['全部', '全部工程'] as [string, string], ...projects].map(([id, name]) => (
            <button key={id} type="button" role="tab" aria-selected={proj === id} className={`cat-chip ${proj === id ? 'on' : ''}`} onClick={() => setProj(id)}>
              {id !== '全部' && <Icon name="folder" size={12} stroke={1.8} />}{name}
              <span className="cat-n">{(list || []).filter((f) => id === '全部' || f.pid === id).length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="cat-filter pad-x" role="tablist" aria-label="按类型筛选">
        {kinds.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={`cat-chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {kname(k)}<span className="cat-n">{k === '全部' ? base.length : base.filter((f) => kindOf(f.path) === k).length}</span>
          </button>
        ))}
      </div>
      <div className="history-list card">
        {shown.map((f) => (
          <div key={`${f.pid}:${f.path}`} className={`hist-item out-item ${f.exists ? '' : 'gone'}`}>
            <Button className="out-row" onPress={() => void preview(f)} aria-label={`预览 ${f.path}（打开任务：${f.taskTitle}）`}>
              <Icon name={iconOf(f.path)} size={18} stroke={1.7} />
              <span className="out-name">
                <span className="out-file">{f.path.split('/').pop()}</span>
                <span className="out-path mono muted small" title={f.path}>{f.path}</span>
              </span>
              {projects.length > 1 && <span className="hist-proj" title={f.pname}>{f.pname}</span>}
              <span className="out-task muted small" title={f.taskTitle}>{f.stageName ? `${f.stageName} · ` : ''}{f.taskTitle}</span>
              <span className="muted small">{f.exists ? size(f.size) : '已不在'}</span>
              <span className="muted small">{new Date(f.mtime || f.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </Button>
            {f.exists && (
              <span className="out-acts">
                <Button className="out-act" aria-label={`用默认程序打开 ${f.path}`} onPress={() => sys(f, 'open')}><Icon name="external" size={15} /></Button>
                <Button className="out-act" aria-label={`在文件夹中显示 ${f.path}`} onPress={() => sys(f, 'show')}><Icon name="folder" size={15} /></Button>
              </span>
            )}
          </div>
        ))}
        {list && !shown.length && <div className="pad muted">{list.length ? '没有符合条件的文件。' : '还没有产出：任务生成或改过的文件会列在这里。'}</div>}
      </div>
    </div>
  )
}
