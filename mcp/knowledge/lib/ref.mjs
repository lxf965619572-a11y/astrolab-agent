// 资料库：学习资料、标准的原文，按节切开（scripts/reference/ 导入），放在库的 reference/<资料>/ 下：
//   doc.json         { id, title, titleZh, edition, year, license: public|internal, lang, sections: [{ no, title, chapter, pages, file }] }
//   <节号>-<标题>.md  头信息（doc、section、title、chapter、pages、license）+ 正文
//   <节号>-<标题>.zh.md  审核过的中文译文（可选，逐段对应原文），也进检索
// 和知识条目分开：条目是部门提炼的结论（照着做），资料是出处（引用时写资料名、节号和页码）。
//
// 检索：英文按词（轻量词干：复数、-ing、-ed），中文按两字；中文问题里的术语按术语表扩展成英文
// （内置 config/glossary-zh-en.json，库里的 reference/glossary.json 合并进来）。BM25，标题加权。
// 许可：scope 为 public 时只检索公版资料（用公网模型时，有版权的资料不发出去）。
// 只用 Node 内置模块。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEntry } from './kb.mjs'

const BUILTIN_GLOSSARY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'config', 'glossary-zh-en.json')
const STOP = new Set('the a an and or of to in on for by with as at from is are be been was were this that these those it its which can may will shall should into than then there their such also not no but if any all each other more most some'.split(' '))
const PART = 12000 // 一节太长时分几部分读（字符）
const TITLE_BONUS = 1.5

/** 英文词干（很轻）：requirements → requirement，testing → test，verified → verifi */
export function stem(w) {
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`
  if (w.endsWith('sses')) return w.slice(0, -2)
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1)
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3)
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2)
  return w
}

const CJK = /[㐀-鿿豈-﫿]/
export function refTokens(s) {
  const out = []
  for (const m of String(s || '').toLowerCase().matchAll(/[a-z0-9]+(?:[-&][a-z0-9]+)*|[㐀-鿿豈-﫿]+/g)) {
    const w = m[0]
    if (CJK.test(w[0])) { if (w.length === 1) out.push(w); else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); continue }
    for (const p of w.split(/[-&]/)) if (p && !STOP.has(p)) out.push(stem(p))
    if (/[-&]/.test(w)) out.push(w.replace(/[-&]/g, '')) // 1553b、tt&c → ttc
  }
  return out
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) } catch { return null } }

/** 术语表：内置的 + 各库的 reference/glossary.json；{ 中文: [英文…] } */
export function loadGlossary(libs, builtin = BUILTIN_GLOSSARY) {
  const g = new Map()
  for (const f of [builtin, ...libs.map((l) => join(l.dir, 'reference', 'glossary.json'))]) {
    const j = existsSync(f) ? readJson(f) : null
    if (!j) continue
    for (const [k, v] of Object.entries(j)) if (!k.startsWith('_') && Array.isArray(v)) g.set(k, v.map(String))
  }
  return g
}

/** 中文问题里出现的术语换成英文，加在后面（长的术语优先，“单粒子翻转”不再拆成“单粒子”） */
export function expandQuery(q, glossary) {
  const keys = [...glossary.keys()].sort((a, b) => b.length - a.length)
  let rest = String(q || '')
  const add = []
  for (const k of keys) {
    if (!rest.includes(k)) continue
    add.push(...glossary.get(k))
    rest = rest.split(k).join(' ')
  }
  const terms = [...new Set(add)]
  return { text: [q, ...terms].join(' '), terms }
}

/** 资料清单：[{ lib, libName, id, title, titleZh, license, year, sections, dir }] */
export function listDocs(libs) {
  const out = []
  for (const lib of libs) {
    const root = join(lib.dir, 'reference')
    let ds = []
    try { ds = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { continue }
    for (const d of ds) {
      const j = readJson(join(root, d.name, 'doc.json'))
      if (j && j.id) out.push({ ...j, lib: lib.id, libName: lib.name, dir: join(root, d.name) })
    }
  }
  return out.sort((a, b) => String(a.title).localeCompare(String(b.title)))
}

const allowed = (doc, scope) => scope !== 'public' || doc.license === 'public'

let cache = { key: '', index: null }
export function buildRefIndex(libs, { scope = 'all' } = {}) {
  const docs = listDocs(libs).filter((d) => allowed(d, scope))
  const key = `${scope}|${docs.map((d) => { try { return `${d.dir}:${statSync(join(d.dir, 'doc.json')).mtimeMs}` } catch { return d.dir } }).join('|')}`
  if (cache.index && cache.key === key) return cache.index
  const secs = []
  const df = new Map()
  for (const d of docs) {
    for (const s of d.sections || []) {
      let text = ''
      try { text = readFileSync(join(d.dir, s.file), 'utf8') } catch { continue }
      const { body } = parseEntry(text)
      const tf = new Map()
      const add = (str, w) => { for (const t of refTokens(str)) tf.set(t, (tf.get(t) || 0) + w) }
      add(`${s.no} ${s.title}`, 2)
      add(s.chapter || '', 1)
      add(body, 1)
      // 资料库里审核过的中文译文（<节>.zh.md）也进索引：中文问题直接命中
      const zh = join(d.dir, s.file.replace(/\.md$/, '.zh.md'))
      if (existsSync(zh)) { try { const z = parseEntry(readFileSync(zh, 'utf8')); add(`${z.meta.title || ''} ${z.body}`, 1) } catch { /* 读不了就算了 */ } }
      let len = 0
      for (const v of tf.values()) len += v
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1)
      const titleT = new Set(refTokens(`${s.title} ${s.chapter || ''}`))
      secs.push({ titleT, id: `${d.lib}:${d.id}/${s.file}`, doc: d.id, docTitle: d.title, docTitleZh: d.titleZh || '', license: d.license, no: s.no, title: s.title, chapter: s.chapter || '', pages: s.pages, body, tf, len })
    }
  }
  const avg = secs.length ? secs.reduce((a, x) => a + x.len, 0) / secs.length : 1
  cache = { key, index: { secs, df, avg } }
  return cache.index
}

function snippet(body, qt) {
  const sents = body.replace(/^#+ .*$/gm, '').split(/(?<=[.!?])\s+|\n+/).filter((x) => x.trim().length > 20)
  let best = 0, bi = 0
  sents.forEach((x, i) => { const t = new Set(refTokens(x)); const n = qt.reduce((a, q) => a + (t.has(q) ? 1 : 0), 0); if (n > best) { best = n; bi = i } })
  return (sents[bi] || '').replace(/\*/g, '').trim().slice(0, 220)
}

export const citation = (s) => `${s.docTitle} §${s.no.replace(/^App\./, 'Appendix ')} ${s.title}，第 ${s.pages} 页`

/** 检索：[{ id, doc, docTitle, no, title, chapter, pages, license, score, snippet, cite }]；expanded 是术语表补上的英文 */
export function searchRef(index, query, { doc, limit = 8, glossary = new Map() } = {}) {
  const { text, terms } = expandQuery(query, glossary)
  const qt = [...new Set(refTokens(text))]
  const N = index.secs.length
  const k1 = 1.2, b = 0.75
  const res = []
  for (const s of index.secs) {
    if (doc && s.doc !== doc) continue
    let score = 0
    for (const t of qt) {
      const f = s.tf.get(t)
      if (!f) continue
      const n = index.df.get(t) || 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * s.len / index.avg))
      if (s.titleT.has(t)) score += TITLE_BONUS * idf // 节标题（和章名）里有这个词：这一节就是讲它的
    }
    if (score > 0) res.push({ s, score })
  }
  res.sort((a, b2) => b2.score - a.score)
  return {
    expanded: terms,
    hits: res.slice(0, limit).map(({ s, score }) => ({ id: s.id, doc: s.doc, docTitle: s.docTitle, no: s.no, title: s.title, chapter: s.chapter, pages: s.pages, license: s.license, score: Math.round(score * 100) / 100, snippet: snippet(s.body, qt), cite: citation(s) })),
  }
}

/** 读一节（太长时分部分）：{ id, meta, cite, part, parts, text, prev, next } */
export function readRef(libs, id, { part = 1, scope = 'all' } = {}) {
  const m = /^([^:]+):([^/]+)\/(.+\.md)$/.exec(String(id || ''))
  if (!m) throw new Error(`资料的 id 不对：${id}（用 search_reference 或 list_references 返回的 id）`)
  const d = listDocs(libs).find((x) => x.lib === m[1] && x.id === m[2])
  if (!d) throw new Error(`没有这份资料：${m[1]}:${m[2]}`)
  if (!allowed(d, scope)) throw new Error('这份资料有版权，只在部门模型（内网）下可以读')
  const i = (d.sections || []).findIndex((s) => s.file === m[3])
  if (i < 0) throw new Error(`没有这一节：${m[3]}`)
  const s = d.sections[i]
  const { body } = parseEntry(readFileSync(join(d.dir, s.file), 'utf8'))
  // 按段落分部分
  const parts = []
  let cur = ''
  for (const p of body.split(/\n{2,}/)) { if (cur && cur.length + p.length > PART) { parts.push(cur); cur = '' } cur += (cur ? '\n\n' : '') + p }
  if (cur) parts.push(cur)
  const n = Math.min(Math.max(1, Number(part) || 1), parts.length || 1)
  const sib = (j) => d.sections[j] ? { id: `${d.lib}:${d.id}/${d.sections[j].file}`, no: d.sections[j].no, title: d.sections[j].title } : null
  const meta = { doc: d.id, docTitle: d.title, docTitleZh: d.titleZh || '', no: s.no, title: s.title, chapter: s.chapter || '', pages: s.pages, license: d.license, lang: d.lang || 'en' }
  return { id, meta, cite: citation({ ...meta, docTitle: d.title }), part: n, parts: parts.length || 1, text: parts[n - 1] || '', prev: sib(i - 1), next: sib(i + 1) }
}
