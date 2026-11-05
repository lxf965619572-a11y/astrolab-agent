// 读取走查记录、静态分析记录等 Markdown 工作底稿的小工具：按标题切节、读表格、读“- 字段：值”。

import { readFileSync } from 'node:fs'

export const readText = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n')

/** 按标题切节：[{ level, title, num, start, end, body }]，num 是标题开头的章节号（如 "5.3"） */
export function sections(md) {
  const lines = md.split('\n')
  const heads = []
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (fence) return
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: i })
  })
  return heads.map((h, k) => {
    let e = lines.length
    for (let j = k + 1; j < heads.length; j++) if (heads[j].level <= h.level) { e = heads[j].line; break }
    const num = /^((?:附录)?[A-Z]?\d+(?:\.\d+)*|附录[A-Z])/.exec(h.title)?.[1] || ''
    return { level: h.level, title: h.title, num, start: h.line, end: e, body: lines.slice(h.line + 1, e).join('\n') }
  })
}

/** 找标题：编号精确匹配（如 "3"、"5.3"），或标题文字包含 name */
export function findSection(secs, num, name) {
  return secs.find((s) => num && s.num === num) || (name ? secs.find((s) => s.title.replace(/^[\d.\s]+/, '').includes(name)) : undefined)
}

const splitRow = (l) => {
  const s = l.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []; let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

/** 文本中的全部表格：[{ header:[], rows:[[...]], line }]（line 为表头在文本中的行号，0 起） */
export function tables(text) {
  const lines = text.split('\n')
  const out = []
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^\s*\|/.test(lines[i]) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitRow(lines[i])
      const rows = []
      let j = i + 2
      while (j < lines.length && /^\s*\|/.test(lines[j])) { rows.push(splitRow(lines[j])); j++ }
      out.push({ header, rows, line: i })
      i = j - 1
    }
  }
  return out
}

/** 按表头找第一个表；need 是必须包含的列名 */
export function findTable(text, need) {
  return tables(text).find((t) => need.every((n) => t.header.some((h) => h.replace(/\s/g, '') === n.replace(/\s/g, ''))))
}

/** 把表格行转成对象（按表头） */
export const rowsAsObjects = (t) => (t ? t.rows.map((r) => Object.fromEntries(t.header.map((h, i) => [h.replace(/\s/g, ''), (r[i] ?? '').trim()]))) : [])

/** “- 字段：值” */
export function fields(text) {
  const out = {}
  for (const l of text.split('\n')) {
    const m = /^\s*[-*]\s*([^：:]{1,20})[：:]\s*(.*)$/.exec(l)
    if (m) out[m[1].trim()] = m[2].trim()
  }
  return out
}

export const blank = (v) => !v || /^(—|-|–|无|空)?$/.test(v.trim())
export const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
export const TODO = '【待补充】'
