// 智能体提问（UX-AGT-07，L3）：浮在任务区上方的玻璃卡片。数字键选项，Enter 确定，Esc 稍后再答（任务保持暂停）。

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import type { Answer, Question } from '../api'
import { useStore } from '../store'
import { Key, Kbd } from './Keys'
import { play } from '../sound'

export function QuestionCard({ q, onLater }: { q: Question; onLater: () => void }) {
  const run = useStore((s) => s.run)
  const [sel, setSel] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [focusQ, setFocusQ] = useState(0)
  const [busy, setBusy] = useState(false)

  const answers: Answer[] = useMemo(() => q.questions.map((it) => {
    const c = (custom[it.id] || '').trim()
    const s = sel[it.id] || []
    return { id: it.id, selected: it.multiSelect || !c ? s : [], ...(c ? { custom: c } : {}) }
  }), [q, sel, custom])
  const complete = answers.every((a) => a.selected.length || a.custom)

  const choose = (qid: string, label: string, multi?: boolean) => {
    setSel((m) => {
      const cur = m[qid] || []
      if (multi) return { ...m, [qid]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] }
      return { ...m, [qid]: [label] }
    })
    setCustom((m) => ({ ...m, [qid]: '' }))
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    play('send')
    await run((api) => api.task.answer(q.id, answers), '回答没有送达')
    setBusy(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
      if (e.key === 'Escape') { e.preventDefault(); onLater(); return }
      if (e.key === 'Enter' && !e.shiftKey && (!typing || e.ctrlKey)) { e.preventDefault(); if (complete) void submit(); return }
      if (!typing && /^[1-9]$/.test(e.key)) {
        const it = q.questions[focusQ]
        const opt = it?.options?.[Number(e.key) - 1]
        if (opt) { choose(it.id, opt.label, it.multiSelect); if (!it.multiSelect && focusQ < q.questions.length - 1) setFocusQ(focusQ + 1) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <motion.div className="q-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section role="dialog" aria-label="智能体提问" className="q-card"
        initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}>
        <div className="q-head"><span className="led ask" />需要你决定 · 任务在等</div>
        {q.questions.map((it, qi) => (
          <div key={it.id} className={`q-item ${qi === focusQ ? 'focus' : ''}`} onFocus={() => setFocusQ(qi)}>
            <div className="q-title">{it.header && <span className="q-tag">{it.header}</span>}{it.question}</div>
            {!!it.options?.length && (
              <div className="q-opts">
                {it.options.map((o, oi) => {
                  const on = (sel[it.id] || []).includes(o.label)
                  return (
                    <Key key={o.label} variant="key" className={`q-opt ${on ? 'on' : ''}`} onPress={() => choose(it.id, o.label, it.multiSelect)} aria-pressed={on}>
                      <span className="q-num">{oi + 1}</span>
                      <span className="q-label">{o.label}{o.description && <small>{o.description}</small>}</span>
                      {on && <span className="q-check">已选</span>}
                    </Key>
                  )
                })}
              </div>
            )}
            <input className="q-input" placeholder={it.options?.length ? '或者自己说明…' : '请填写'} value={custom[it.id] || ''}
              onChange={(e) => { const v = e.target.value; setCustom((m) => ({ ...m, [it.id]: v })); if (v) setSel((m) => (it.multiSelect ? m : { ...m, [it.id]: [] })) }} />
          </div>
        ))}
        <div className="q-foot">
          <span className="q-hint"><Kbd>1</Kbd>～<Kbd>9</Kbd> 选择 · <Kbd>Enter</Kbd> 确定 · <Kbd>Esc</Kbd> 稍后再答（任务保持暂停）</span>
          <Key variant="primary" isDisabled={!complete || busy} onPress={() => void submit()}>确定</Key>
        </div>
      </motion.section>
    </motion.div>
  )
}
