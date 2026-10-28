// 任务模式右边的面板（和 Claude 一样）：进度（智能体列的步骤）、产出（这次任务新建和改过的文件，点开预览，满意就提交）、
// 用到的（技能、知识库、参考的文件、工具）。点产出或对话里的文件名，面板变宽成预览：Markdown 和 SVG 直接看渲染后的样子。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'react-aria-components'
import { motion } from 'motion/react'
import { useStore } from '../store'
import type { Change, Item } from '../api'
import { Icon } from '../components/Icon'
import { Key } from '../components/Keys'
import { CodeFile, Diff } from '../components/Diff'
import { FileRender, RENDERABLE } from '../components/FileRender'
import { baseName, callLabel } from '../format'
import { play } from '../sound'
import { RestoreButton } from './CodeView'

const LIVE = ['starting', 'running', 'asking']
const ST: Record<string, string> = { A: '新', M: '改', D: '删' }

/** 这次任务的改动（相对开始前的快照），智能体每写一个文件就刷新 */
export function useChanges() {
  const ts = useStore((s) => s.ts)
  const items = useStore((s) => s.items)
  const run = useStore((s) => s.run)
  const task = ts?.task
  const [changes, setChanges] = useState<Change[]>([])
  const toolCount = useMemo(() => items.filter((i) => i.kind === 'tools').length, [items])
  const load = useCallback(async () => {
    if (!task?.snapshot) { setChanges([]); return }
    const c = await run((api) => api.review.changes())
    setChanges(c || [])
  }, [run, task?.snapshot])
  const first = useRef(true)
  useEffect(() => {
    const t = setTimeout(() => { first.current = false; void load() }, first.current ? 0 : 700)
    return () => clearTimeout(t)
  }, [load, toolCount, ts?.status, task?.id, task?.restoredAt, task?.commit?.sha])
  return { changes, reload: load, toolCount }
}

export function TaskSide() {
  const ts = useStore((s) => s.ts)!
  const items = useStore((s) => s.items)
  const focus = useStore((s) => s.codeFocus)
  const task = ts.task!
  const { changes, reload, toolCount } = useChanges()
  const [preview, setPreview] = useState<string | null>(null)
  // 对话里点了文件名：在这里预览
  useEffect(() => { if (focus) { setPreview(focus); useStore.getState().setCodeFocus(null) } }, [focus])
  const used = useMemo(() => usedOf(items), [items])
  const outputs = changes.filter((c) => c.status !== 'D')

  return (
    <aside className={`task-side ${preview ? 'wide' : ''}`} aria-label={preview ? '预览' : '进度和产出'}>
      {preview
        ? <FilePreview path={preview} change={changes.find((c) => c.path === preview) || null} toolCount={toolCount} onClose={() => setPreview(null)} />
        : (
          <div className="ts-scroll">
            <Section title="进度" extra={ts.summary.todos.length ? `${ts.summary.todos.filter((t) => t.status === 'completed').length}/${ts.summary.todos.length}` : `第 ${ts.summary.steps} 步`}>
              {ts.summary.todos.length
                ? <ol className="ts-todos">
                    {ts.summary.todos.map((t, i) => (
                      <li key={i} className={`ts-todo ${t.status}`}>
                        <span className="ts-todo-ico">{t.status === 'completed' ? <Icon name="check" size={12} stroke={2.6} /> : t.status === 'in_progress' && LIVE.includes(ts.status) ? <span className="led" /> : null}</span>
                        <span>{t.content}</span>
                      </li>
                    ))}
                  </ol>
                : <div className="muted small">{LIVE.includes(ts.status) ? '智能体还没有列出步骤，列出后在这里打勾' : '这次没有列步骤'}</div>}
            </Section>

            <Section title="产出" extra={outputs.length ? `${outputs.length} 个文件` : ''}>
              {!task.snapshot && <div className="muted small">项目不是 Git 仓库，没有任务前快照，列不出这次改了什么。对话里的文件名可以点开看。</div>}
              {task.snapshot && !outputs.length && <div className="muted small">{LIVE.includes(ts.status) ? '还没有写文件。写好的报告、图、文档会出现在这里' : '这次没有新建或修改文件'}</div>}
              <div className="ts-outputs">
                {outputs.map((c) => (
                  <Button key={c.path} className="ts-out" onPress={() => setPreview(c.path)} aria-label={`预览 ${c.path}`}>
                    <span className={`ts-out-ico ${kindOf(c.path)}`}><Icon name={iconOf(c.path)} size={16} stroke={1.7} /></span>
                    <span className="ts-out-text">
                      <span className="ts-out-name">{baseName(c.path)}</span>
                      <span className="ts-out-dir mono">{c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : '项目根目录'}</span>
                    </span>
                    <span className={`fs fs-${c.status}`}>{ST[c.status]}</span>
                  </Button>
                ))}
              </div>
              {task.snapshot && !!changes.length && <CommitRow changes={changes} onDone={() => void reload()} />}
            </Section>

            <Section title="用到的">
              {!used.skills.length && !used.kb.length && !used.reads.length && !used.tools.length && <div className="muted small">还没有</div>}
              {!!used.skills.length && <UsedRow icon="skills" label="技能">{used.skills.map((s) => <span key={s} className="ts-chip">{titleOf(s)}</span>)}</UsedRow>}
              {!!used.kb.length && <UsedRow icon="book" label="知识库">{used.kb.slice(0, 4).map((q, i) => <span key={i} className="ts-chip" title={q}>{q}</span>)}{used.kb.length > 4 && <span className="muted small">等 {used.kb.length} 次</span>}</UsedRow>}
              {!!used.reads.length && (
                <UsedRow icon="file" label="参考的文件">
                  {used.reads.slice(0, 6).map((p) => <Button key={p} className="ts-chip link mono" onPress={() => setPreview(p)}>{baseName(p)}</Button>)}
                  {used.reads.length > 6 && <span className="muted small">等 {used.reads.length} 个</span>}
                </UsedRow>
              )}
              {!!used.tools.length && <UsedRow icon="terminal" label="工具">{used.tools.map(([l, n]) => <span key={l} className="ts-chip">{l}{n > 1 ? ` ×${n}` : ''}</span>)}</UsedRow>}
            </Section>
          </div>
        )}
    </aside>
  )
}

function titleOf(name: string) {
  return useStore.getState().app?.skills?.find((s) => s.name === name)?.title || name
}

function Section({ title, extra, children }: { title: string; extra?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="ts-sec">
      <Button className="ts-sec-head" onPress={() => setOpen(!open)} aria-expanded={open}>
        <span className="strong">{title}</span>
        {extra && <span className="muted small">{extra}</span>}
        <span className="grow" />
        <Icon name="chevron" size={14} stroke={2} className={`chev ${open ? 'up' : ''}`} />
      </Button>
      {open && <div className="ts-sec-body">{children}</div>}
    </section>
  )
}

function UsedRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="ts-used">
      <span className="ts-used-label"><Icon name={icon} size={13} stroke={1.8} />{label}</span>
      <div className="ts-used-items">{children}</div>
    </div>
  )
}

/** 从对话记录里汇总用到的技能、知识库检索、读过的文件、工具 */
function usedOf(items: Item[]) {
  const ts = useStore.getState().ts
  const project = (ts?.project?.path || '').replace(/\\/g, '/').replace(/\/$/, '')
  const rel = (p: string) => {
    const a = p.replace(/\\/g, '/')
    return project && a.toLowerCase().startsWith(`${project.toLowerCase()}/`) ? a.slice(project.length + 1) : a.replace(/^\.\//, '')
  }
  const skills = new Set<string>(ts?.task?.skills || [])
  const kb: string[] = []
  const reads = new Set<string>()
  const tools = new Map<string, number>()
  for (const it of items) {
    if (it.kind !== 'tools') continue
    for (const c of it.calls) {
      if (c.hidden) continue
      if (it.group === 'skill' && (c.skill || c.summary)) skills.add(c.skill || c.summary)
      else if (/knowledge/.test(c.name)) { if (/search/.test(c.name)) kb.push(c.summary || '检索') }
      else if (it.group === 'read' && c.path) { const p = rel(c.path); if (!/^([a-z]:|\/)/i.test(p)) reads.add(p) }
      else if (c.name.startsWith('mcp__')) { const l = callLabel(c); tools.set(l, (tools.get(l) || 0) + 1) }
    }
  }
  return { skills: [...skills], kb, reads: [...reads], tools: [...tools.entries()] }
}

const kindOf = (p: string) => (/\.md$/i.test(p) ? 'md' : /\.(svg|png|jpe?g|html?)$/i.test(p) ? 'img' : /\.(docx?|xlsx?|pdf)$/i.test(p) ? 'office' : /\.(c|h|cpp|hpp|py|mjs|js|ts)$/i.test(p) ? 'code' : 'other')
const iconOf = (p: string) => ({ md: 'file', img: 'diagram', office: 'book', code: 'coding', other: 'file' } as Record<string, string>)[kindOf(p)]

/** 接受并提交 / 恢复快照（和代码模式的提交栏同一套接口） */
function CommitRow({ changes, onDone }: { changes: Change[]; onDone: () => void }) {
  const ts = useStore((s) => s.ts)!
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const [committing, setCommitting] = useState(false)
  const task = ts.task!
  const busy = LIVE.includes(ts.status)
  if (task.commit) {
    return (
      <div className="ts-commit done">
        <Icon name="check" size={14} className="ok-ink" /><span className="grow ellipsis">已提交 <span className="mono">{task.commit.sha.slice(0, 7)}</span></span>
        <Key size="sm" onPress={() => void run((api) => api.review.undo(), '撤销失败')}>撤销提交</Key>
      </div>
    )
  }
  const commit = async () => {
    if (busy || committing) return
    setCommitting(true)
    const sha = await run((api) => api.review.commit(`${task.stageName}：${task.title}`, changes.map((c) => c.path)), '提交失败')
    setCommitting(false)
    if (!sha) { onDone(); return }
    play('commit')
    toast({ text: `已提交 · ${sha.slice(0, 7)}`, tone: 'ok' })
  }
  return (
    <div className="ts-commit">
      <RestoreButton disabled={busy} onDone={onDone} />
      <Key variant="primary" size="sm" isDisabled={busy || committing} onPress={() => void commit()}>
        {busy ? '做完再提交' : committing ? '提交中…' : `接受并提交 ${changes.length} 个文件`}
      </Key>
    </div>
  )
}

/** 预览一个文件：Markdown 和 SVG 看渲染后的样子，也能看源码；改过的文件能看改动 */
function FilePreview({ path, change, toolCount, onClose }: { path: string; change: Change | null; toolCount: number; onClose: () => void }) {
  const ts = useStore((s) => s.ts)!
  const run = useStore((s) => s.run)
  const [f, setF] = useState<{ binary: boolean; before: string | null; after: string | null; tooLarge?: boolean } | null>(null)
  const renderable = RENDERABLE.test(path)
  const [mode, setMode] = useState<'view' | 'source' | 'diff'>(renderable ? 'view' : change?.status === 'M' ? 'diff' : 'source')
  useEffect(() => { setMode(renderable ? 'view' : change?.status === 'M' ? 'diff' : 'source') }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true
    void (async () => {
      if (ts.task?.snapshot) {
        const r = await run((api) => api.review.file(path))
        if (alive && r) setF({ binary: r.binary, before: r.before, after: r.after })
      } else {
        const r = await run((api) => api.project.read(path))
        if (alive && r) setF({ binary: r.binary, before: r.text, after: r.text, tooLarge: r.tooLarge })
      }
    })()
    return () => { alive = false }
  }, [path, run, ts.task?.snapshot, toolCount])
  const text = f?.after ?? f?.before ?? ''
  return (
    <div className="fp">
      <div className="fp-head">
        <Key size="sm" onPress={onClose} aria-label="返回进度和产出"><Icon name="arrow" size={14} stroke={2} className="flip" /></Key>
        <span className="fp-title">
          <span className="strong ellipsis">{baseName(path)}</span>
          <span className="mono muted small ellipsis">{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</span>
        </span>
        {change && <span className={`fs fs-${change.status}`}>{ST[change.status]}</span>}
        <span className="grow" />
        {f && !f.binary && !f.tooLarge && (renderable || change?.status === 'M') && (
          <div className="segmented small" role="tablist" aria-label="显示方式">
            {renderable && <button type="button" role="tab" aria-selected={mode === 'view'} className={`seg-btn ${mode === 'view' ? 'on' : ''}`} onClick={() => setMode('view')}>预览</button>}
            <button type="button" role="tab" aria-selected={mode === 'source'} className={`seg-btn ${mode === 'source' ? 'on' : ''}`} onClick={() => setMode('source')}>源码</button>
            {change?.status === 'M' && <button type="button" role="tab" aria-selected={mode === 'diff'} className={`seg-btn ${mode === 'diff' ? 'on' : ''}`} onClick={() => setMode('diff')}>改动</button>}
          </div>
        )}
        <Key size="sm" onPress={() => void run((api) => api.sys.openPath(path), '打开失败')} aria-label={/\.(docx?|xlsx?)$/i.test(path) ? '用 Office 打开' : '用对应程序打开'}><Icon name="external" size={13} />打开</Key>
      </div>
      <motion.div key={`${path}|${mode}`} className="fp-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}>
        {!f && <div className="pad muted">读取中…</div>}
        {f?.binary && <div className="pad muted">这是 Word、Excel 这类文件，这里看不了内容。点右上角“打开”用 Office 看。</div>}
        {f?.tooLarge && <div className="pad muted">文件太大（超过 2 MB），点右上角“打开”。</div>}
        {f && !f.binary && !f.tooLarge && (
          mode === 'view' ? <FileRender path={path} text={text} version={toolCount} />
              : mode === 'diff' ? <Diff path={path} before={f.before ?? ''} after={f.after ?? ''} />
                : <CodeFile path={path} text={text} />
        )}
      </motion.div>
    </div>
  )
}
