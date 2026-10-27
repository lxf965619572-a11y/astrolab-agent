// 知识库：一个库是一个目录（通常是 Git 仓库的克隆），条目放在 <库>/knowledge/<类别>/<日期>-<标题>.md。
// 条目是带头信息的 Markdown：
//   ---
//   title: 1553B RT 复位等待用“大于或等于”判就绪
//   kind: 经验            经验 / 设计 / 代码 / 问题
//   model: 型号A          可选；型号库里的条目
//   tags: [1553B, 复位, 超时]
//   author: lixf
//   date: 2026-10-27
//   source: 任务 t-20261027-… / utest/rt1553/src/rt_drv.c
//   status: 草稿          个人库里智能体记下、还没确认的条目
//   ---
//   正文（可以有代码块）
//
// 检索：中文按相邻两字切分、英文和标识符按词（下划线再拆开），BM25 打分，标题和标签加权。不需要向量模型，断网可用。
// 工作台（界面检索、编辑）和知识库工具服务（智能体检索、记草稿）共用本文件。只用 Node 内置模块。

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const KINDS = ['经验', '设计', '代码', '问题']

// ---------- 条目 ----------
export function parseEntry(text) {
  text = String(text || '').replace(/^﻿/, '')
  const meta = {}
  let body = text
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (m) {
    body = text.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line)
      if (!kv) continue
      let v = kv[2].trim()
      if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1)
      if (kv[1] === 'tags') v = v.replace(/^\[|\]$/g, '').split(/[,，]/).map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      meta[kv[1]] = v
    }
  }
  if (!Array.isArray(meta.tags)) meta.tags = meta.tags ? [String(meta.tags)] : []
  return { meta, body: body.replace(/^\s+/, '') }
}

const yamlValue = (v) => (/[:#\[\]{},"']|^\s|\s$/.test(v) ? JSON.stringify(v) : v)
export function serializeEntry(meta, body) {
  const order = ['title', 'kind', 'model', 'tags', 'author', 'date', 'source', 'status']
  const lines = ['---']
  for (const k of [...order, ...Object.keys(meta).filter((k) => !order.includes(k))]) {
    const v = meta[k]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    lines.push(`${k}: ${Array.isArray(v) ? `[${v.map((x) => yamlValue(String(x))).join(', ')}]` : yamlValue(String(v))}`)
  }
  lines.push('---', '', String(body || '').trim(), '')
  return lines.join('\n')
}

export function slugify(s) {
  return String(s || '条目').replace(/[\\/:*?"<>|\s，。、；：（）()【】[\]{}'`!！？?#%&+=~^$@]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || '条目'
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** 写一个条目到库里，返回相对库目录的路径。path 给出时覆盖该文件（编辑） */
export function writeEntry(libDir, meta, body, path) {
  const m = { ...meta, kind: KINDS.includes(meta.kind) ? meta.kind : '经验', date: meta.date || today() }
  let rel = path
  if (!rel) {
    const base = `${m.date}-${slugify(m.title)}`
    rel = `knowledge/${m.kind}/${base}.md`
    for (let k = 2; existsSync(join(libDir, rel)); k++) rel = `knowledge/${m.kind}/${base}-${k}.md`
  }
  const abs = join(libDir, rel)
  if (relative(libDir, abs).startsWith('..')) throw new Error('路径越出知识库')
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, serializeEntry(m, body))
  return rel.split(sep).join('/')
}

// ---------- 切词与检索 ----------
const CJK = /[㐀-鿿豈-﫿]/
export function tokens(s) {
  const out = []
  for (const m of String(s || '').toLowerCase().matchAll(/[a-z0-9_]+|[㐀-鿿豈-﫿]+/g)) {
    const w = m[0]
    if (CJK.test(w[0])) {
      if (w.length === 1) out.push(w)
      else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2))
    } else {
      out.push(w)
      if (w.includes('_')) for (const p of w.split('_')) if (p.length > 1) out.push(p)
    }
  }
  return out
}

function walkMd(dir, out = []) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walkMd(p, out)
    else if (e.name.endsWith('.md') && e.name.toLowerCase() !== 'readme.md') out.push(p)
  }
  return out
}

let cache = { key: '', index: null }

/**
 * 建索引（有缓存：文件没变就不重建）。libs: [{ id, name, dir, model?, writable? }]
 * 返回 { docs, df, avg }
 */
export function buildIndex(libs) {
  const files = []
  for (const lib of libs) for (const f of walkMd(join(lib.dir, 'knowledge'))) files.push({ lib, f })
  const key = files.map(({ f }) => { try { const st = statSync(f); return `${f}:${st.mtimeMs}:${st.size}` } catch { return f } }).join('|')
  if (cache.index && cache.key === key) return cache.index
  const docs = []
  const df = new Map()
  for (const { lib, f } of files) {
    let text
    try { text = readFileSync(f, 'utf8') } catch { continue }
    const { meta, body } = parseEntry(text)
    const rel = relative(lib.dir, f).split(sep).join('/')
    const title = meta.title || rel.split('/').pop().replace(/\.md$/, '')
    const tf = new Map()
    const addTokens = (s, w) => { for (const t of tokens(s)) tf.set(t, (tf.get(t) || 0) + w) }
    addTokens(title, 3)
    addTokens(meta.tags.join(' '), 2)
    addTokens(body, 1)
    let len = 0
    for (const v of tf.values()) len += v
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1)
    docs.push({
      id: `${lib.id}:${rel}`, lib: lib.id, libName: lib.name, writable: !!lib.writable, path: rel, abs: f,
      title, kind: KINDS.includes(meta.kind) ? meta.kind : '经验', model: meta.model || lib.model || '', tags: meta.tags,
      author: meta.author || '', date: meta.date || '', source: meta.source || '', status: meta.status || '', body, tf, len,
    })
  }
  const avg = docs.length ? docs.reduce((a, d) => a + d.len, 0) / docs.length : 1
  cache = { key, index: { docs, df, avg } }
  return cache.index
}

function snippet(body, qt) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() && !/^```/.test(l.trim()))
  let best = 0, bi = 0
  lines.forEach((l, i) => {
    const lt = new Set(tokens(l))
    const s = qt.reduce((a, t) => a + (lt.has(t) ? 1 : 0), 0)
    if (s > best) { best = s; bi = i }
  })
  return plain(lines[bi] || '')
}
// 摘要去掉 Markdown 记号
const plain = (l) => l.trim().replace(/^#+\s*|^[-*>]\s+|^\d+\.\s+/, '').replace(/\*\*|__|`/g, '').slice(0, 160)

/** 检索：返回 [{ id, title, kind, model, tags, lib, libName, path, date, author, status, score, snippet }] */
export function search(index, query, { kind, model, lib, limit = 20 } = {}) {
  const qt = [...new Set(tokens(query))]
  const N = index.docs.length
  const k1 = 1.2, b = 0.75
  const res = []
  for (const d of index.docs) {
    if (kind && d.kind !== kind) continue
    if (model && d.model && d.model !== model) continue
    if (lib && d.lib !== lib) continue
    let score = 0
    for (const t of qt) {
      const f = d.tf.get(t)
      if (!f) continue
      const n = index.df.get(t) || 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / index.avg))
    }
    if (qt.length && score <= 0) continue
    res.push({ d, score })
  }
  res.sort((a, b2) => b2.score - a.score || String(b2.d.date).localeCompare(String(a.d.date)))
  return res.slice(0, limit).map(({ d, score }) => ({
    id: d.id, title: d.title, kind: d.kind, model: d.model, tags: d.tags, lib: d.lib, libName: d.libName, writable: d.writable,
    path: d.path, date: d.date, author: d.author, status: d.status, source: d.source, score: Math.round(score * 100) / 100,
    snippet: qt.length ? snippet(d.body, qt) : plain(d.body.split(/\r?\n/).find((l) => l.trim() && !/^```|^#/.test(l.trim())) || ''),
  }))
}

/** 按 id（<库>:<相对路径>）取条目全文 */
export function readEntry(libs, id) {
  const i = String(id).indexOf(':')
  const lib = libs.find((l) => l.id === String(id).slice(0, i))
  if (!lib) throw new Error(`没有这个库：${String(id).slice(0, i)}`)
  const rel = String(id).slice(i + 1)
  const abs = join(lib.dir, rel)
  if (relative(lib.dir, abs).startsWith('..') || !existsSync(abs)) throw new Error(`没有这个条目：${id}`)
  const { meta, body } = parseEntry(readFileSync(abs, 'utf8'))
  return { id, lib: lib.id, libName: lib.name, writable: !!lib.writable, path: rel, meta, body }
}

/** 从环境变量 ASTROLAB_LIBRARIES（工作台启动引擎时设置）读库列表 */
export function librariesFromEnv(env = process.env) {
  try {
    const v = JSON.parse(env.ASTROLAB_LIBRARIES || '[]')
    return Array.isArray(v) ? v.filter((l) => l && l.id && l.dir) : []
  } catch { return [] }
}
