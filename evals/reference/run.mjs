#!/usr/bin/env node
// 资料检索评测：node evals/reference/run.mjs [资料库目录，默认 runtime/资料库]
// 每题看应该命中的节有没有排进前 3（中文问题，按术语表扩展）。
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRefIndex, loadGlossary, searchRef } from '../../mcp/knowledge/lib/ref.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')
export function evaluate(dir, { k = 3, log = console.log } = {}) {
  const libs = [{ id: 'ref', name: '资料库', dir }]
  const idx = buildRefIndex(libs)
  const g = loadGlossary(libs)
  const { questions } = JSON.parse(readFileSync(join(ROOT, 'evals', 'reference', 'questions.json'), 'utf8'))
  let hit = 0, mrr = 0
  for (const x of questions) {
    const r = searchRef(idx, x.q, { glossary: g, limit: 10 })
    const got = r.hits.map((h) => `${h.doc} ${h.no}`)
    const rank = got.findIndex((g2) => x.want.includes(g2))
    if (rank >= 0 && rank < k) hit++
    if (rank >= 0) mrr += 1 / (rank + 1)
    log(`${rank >= 0 && rank < k ? '✓' : '✗'} ${rank >= 0 ? rank + 1 : '-'}  ${x.q}　→ ${got.slice(0, 3).join(' | ')}`)
  }
  const res = { n: questions.length, hit, rate: hit / questions.length, mrr: mrr / questions.length }
  log(`前 ${k} 命中 ${hit}/${questions.length}（${Math.round(res.rate * 100)}%），MRR ${res.mrr.toFixed(2)}`)
  return res
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) evaluate(resolve(process.argv[2] || join(ROOT, 'runtime', '资料库')))
