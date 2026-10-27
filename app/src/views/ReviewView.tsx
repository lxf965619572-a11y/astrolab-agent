// 审核：相对任务前快照的改动、逐个文件看差异、智能体的总结；接受并提交（只提交这些文件），或恢复快照。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { motion } from 'motion/react'
import { useStore } from '../store'
import type { Change, FileVersions } from '../api'
import { Icon } from '../components/Icon'
import { Key, Kbd } from '../components/Keys'
import { Diff } from '../components/Diff'
import { Markdown } from '../components/Markdown'
import { ViewTabs } from '../components/Shell'
import { baseName, elapsed } from '../format'
import { play } from '../sound'

export function ReviewView() {
  const ts = useStore((s) => s.ts)
  const items = useStore((s) => s.items)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  const [changes, setChanges] = useState<Change[] | null>(null)
  const [sel, setSel] = useState(0)
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  const [file, setFile] = useState<FileVersions | null>(null)
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const task = ts?.task
  const busy = ts ? ['starting', 'running', 'asking'].includes(ts.status) : false

  const load = useCallback(async () => {
    const c = await run((api) => api.review.changes(), '读取改动失败')
    setChanges(c || [])
  }, [run])
  useEffect(() => { void load() }, [load, task?.id, ts?.status, task?.restoredAt])
  useEffect(() => { if (task) setMessage(`${task.stageName}：${task.title}`) }, [task?.id])

  const cur = changes && changes[sel]
  useEffect(() => {
    if (!cur) { setFile(null); return }
    setViewed((v) => new Set(v).add(cur.path))
    void run((api) => api.review.file(cur.path)).then((f) => setFile(f || null))
  }, [cur?.path, run])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (!changes?.length) return
      if (!typing && (e.key === 'j' || e.key === 'ArrowDown')) { e.preventDefault(); setSel((i) => Math.min(changes.length - 1, i + 1)) }
      if (!typing && (e.key === 'k' || e.key === 'ArrowUp')) { e.preventDefault(); setSel((i) => Math.max(0, i - 1)) }
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void commit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const summaryText = useMemo(() => [...items].reverse().find((i) => i.kind === 'assistant')?.text || '', [items])
  const added = (changes || []).reduce((s, c) => s + (c.added || 0), 0)
  const removed = (changes || []).reduce((s, c) => s + (c.removed || 0), 0)
  const srcTouched = (changes || []).some((c) => /(^|\/)(src|include)\//.test(c.path) && c.status !== 'A')

  const commit = async () => {
    if (!changes?.length || committing || busy || task?.commit) return
    setCommitting(true)
    const sha = await run((api) => api.review.commit(message.trim() || `${task?.stageName}：${task?.title}`, changes.map((c) => c.path)), '提交失败')
    setCommitting(false)
    if (sha) {
      play('commit')
      toast({ text: `已提交 · ${sha.slice(0, 7)}`, tone: 'ok', action: { label: '撤销', run: () => void run((api) => api.review.undo(), '撤销失败').then(() => toast({ text: '已撤销提交，改动仍在工作区', tone: 'info' })) } }, 8000)
    }
  }

  if (!task) return null
  return (
    <div className="review-layout">
      <div className="page-head pad-x">
        <div>
          <h1>{task.stageName} · 审核</h1>
          <div className="sub">看过改动，再一次提交到 Git。审核相对任务开始前的快照</div>
        </div>
        <ViewTabs value={view} onChange={setView} review={changes?.length} />
      </div>

      <section className="review-summary card">
        <span className={`pill ${task.commit ? 'ok' : busy ? 'run' : ts?.status === 'done' ? 'ok' : 'idle'}`}>
          {task.commit ? <><Icon name="check" size={12} stroke={2.6} />已提交</> : busy ? <><span className="dot breathe" />任务进行中</> : <><Icon name="check" size={12} stroke={2.6} />任务完成</>}
        </span>
        <Stat n={changes?.length ?? 0} label="个文件改动" />
        <Stat n={`+${added}`} label="行" tone="ok" />
        {!!removed && <Stat n={`−${removed}`} label="行" tone="err" />}
        <Stat n={elapsed((task.endedAt || Date.now()) - task.startedAt)} label="用时" />
        <span className="grow" />
        {!srcTouched && !!changes?.length && <span className="badge-safe"><Icon name="shield" size={14} />原有源代码未改动</span>}
        {srcTouched && <span className="badge-warn"><Icon name="warn" size={14} />改动了原有源代码，请重点看</span>}
      </section>

      {!task.snapshot ? (
        <div className="card pad review-empty">这个项目不是 Git 仓库，没有任务前快照：看不到改动对比，也不能在这里提交。智能体写了哪些文件可以在“任务”页的活动里看到。</div>
      ) : changes && !changes.length ? (
        <div className="card pad review-empty">{task.restoredAt ? '已恢复到任务开始前的样子。' : '相对任务开始前没有改动。'}</div>
      ) : (
        <div className="review-grid">
          <section className="file-list" aria-label="改动的文件">
            <div className="file-list-head"><span>改动的文件 · 已看 {viewed.size}/{changes?.length || 0}</span><span className="mono">J K 切换</span></div>
            {(changes || []).map((c, i) => (
              <Button key={c.path} className={`file-row ${i === sel ? 'on' : ''}`} onPress={() => setSel(i)}>
                <span className={`fs fs-${c.status}`}>{c.status === 'A' ? '新' : c.status === 'D' ? '删' : '改'}</span>
                <span className="file-names"><span className="mono file-name">{baseName(c.path)}</span><span className="file-dir">{c.path.slice(0, c.path.length - baseName(c.path).length) || './'}</span></span>
                <span className="mono small"><span className="add">{c.binary ? '' : `+${c.added ?? 0}`}</span>{c.removed ? <span className="rem"> −{c.removed}</span> : null}</span>
                <span className={`viewed ${viewed.has(c.path) ? 'yes' : ''}`} aria-label={viewed.has(c.path) ? '已看' : '未看'} />
              </Button>
            ))}
            <div className="snap-note"><Icon name="undo" size={14} />开始前已自动保存快照。不满意可以一键恢复，提交后也能撤销。</div>
          </section>

          <section className="diff-panel card" aria-label="文件内容">
            <div className="diff-head">
              <span className="mono strong">{cur?.path}</span>
              {cur && <span className={`tag fs-${cur.status}`}>{cur.status === 'A' ? '新文件' : cur.status === 'D' ? '已删除' : '修改'}</span>}
              <span className="grow" />
              {cur && cur.status !== 'D' && <Key size="sm" onPress={() => void run((api) => api.sys.openPath(cur.path), '打开失败')}><Icon name="external" size={13} />{/\.(docx?|xlsx?)$/i.test(cur.path) ? '用 Office 打开' : '用默认程序打开'}</Key>}
            </div>
            <motion.div key={cur?.path} className="diff-body" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
              {file && !file.binary && <Diff path={file.path} before={file.before ?? ''} after={file.after ?? ''} />}
              {file && file.binary && <div className="pad muted">这是二进制文件（如 Word、Excel），不能逐行对比。点右上角用对应程序打开查看。</div>}
            </motion.div>
          </section>

          <aside className="summary-panel card" aria-label="智能体的总结">
            <div className="strong">智能体的总结</div>
            <div className="muted small">任务最后一条回复。有疑问可以回到“任务”页追问</div>
            {summaryText ? <Markdown text={summaryText} className="summary-md" /> : <div className="muted small">（还没有回复）</div>}
          </aside>
        </div>
      )}

      {!!changes?.length && task.snapshot && (
        <div className="commit-bar">
          {task.commit ? (<>
            <Icon name="check" size={16} className="ok-ink" />
            <span>已提交 <span className="mono">{task.commit.sha.slice(0, 7)}</span> · {task.commit.message}</span>
            <span className="grow" />
            <Key size="sm" onPress={() => void run((api) => api.review.undo(), '撤销失败')}>撤销提交</Key>
            <Key size="sm" variant="primary" onPress={() => void run((api) => api.task.reset()).then(() => setView('launch'))}>新任务</Key>
          </>) : (<>
            <Icon name="branch" size={18} className="muted" />
            <label htmlFor="commit-msg" className="muted small">提交说明</label>
            <input id="commit-msg" className="commit-input" value={message} onChange={(e) => setMessage(e.target.value)} />
            <RestoreButton disabled={busy} onDone={() => void load()} />
            <Key variant="primary" isDisabled={busy || committing} onPress={() => void commit()}>
              {committing ? '提交中…' : `接受并提交 ${changes.length} 个文件`}<Kbd>Ctrl S</Kbd>
            </Key>
          </>)}
        </div>
      )}
    </div>
  )
}

function Stat({ n, label, tone }: { n: number | string; label: string; tone?: 'ok' | 'err' }) {
  return <div className="stat"><span className={`stat-n ${tone || ''}`}>{n}</span><span className="stat-l">{label}</span></div>
}

function RestoreButton({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const run = useStore((s) => s.run)
  const toast = useStore((s) => s.toast)
  return (
    <DialogTrigger>
      <Key isDisabled={disabled}>恢复快照</Key>
      <ModalOverlay className="modal-scrim" isDismissable>
        <Modal className="modal">
          <Dialog className="modal-dialog">
            {({ close }) => (<>
              <Heading slot="title" className="modal-title">恢复到任务开始前？</Heading>
              <p className="muted">这次任务改动、新建的文件都会撤掉，工作区回到开始前的样子。对话记录保留，之后还可以让智能体重做。</p>
              <div className="modal-foot">
                <Key onPress={close}>取消</Key>
                <Key variant="primary" onPress={async () => { const n = await run((api) => api.review.restore(), '恢复失败'); close(); if (n !== undefined) { toast({ text: `已恢复 ${n} 个文件`, tone: 'ok' }); onDone() } }}>恢复</Key>
              </div>
            </>)}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  )
}
