// 静态分析记录和度量数据的读取，gen-sa-report.mjs 和 check-sa.mjs 共用。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { readText, sections, findSection, findTable, rowsAsObjects, fields, blank } from './md-lib.mjs'

export const LIMIT = { lines: 200, cc: 10, ev: 4, fanOut: 5, comment: 30 }

/** 读取记录，返回各节内容 */
export function readRecord(path) {
  const md = readText(path)
  const S = sections(md)
  const sec = (num, name) => findSection(S, num, name)
  const info = fields(sec('1', '概述')?.body || '')
  const T = (num, name, cols) => rowsAsObjects(findTable(sec(num, name)?.body || '', cols))
  return {
    md, S, sec, info,
    tools: T('2', '分析工具', ['工具名称', '版本']),
    over: T('3', '度量超标分析', ['模块名', '超标项']),
    rules: T('4', '规则违反甄别', ['告警编号', '判定']),
    review: T('5', '代码审查', ['问题描述', '处理更改']).filter((r) => !/^无$/.test(r['问题描述'] || '')),
    questions: T('6', '待确认问题', ['编号', '问题']),
    stats: Object.fromEntries(T('7', '统计', ['项目', '数量']).map((r) => [r['项目'], r['数量']])),
  }
}

/** 在记录所在目录、其上级、当前目录中找文件 */
export function locate(recPath, p) {
  if (!p || /待补充|^—$/.test(p)) return null
  p = p.replace(/[`]/g, '').replace(/[（(].*$/, '').trim()
  for (const c of [resolve(p), resolve(dirname(recPath), p), resolve(dirname(recPath), '..', p)]) if (existsSync(c)) return c
  return null
}

const num = (v) => { if (v === undefined || v === null) return null; const s = String(v).replace(/[%（(].*$/, '').replace(/[^\d.\-]/g, ''); return s === '' ? null : Number(s) }

/** 读取度量数据：metrics.mjs 的 JSON 或部门工具整理的 CSV。返回 { source, tool, modules:[{name,file,lines,cc,ev,fanIn,fanOut,comment}], totalLines } */
export function readMetrics(path) {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
  if (/\.json$/i.test(path)) {
    const j = JSON.parse(text)
    const modules = (j.modules || []).map((m) => ({ name: m.name, file: m.file, lines: m.code ?? m.lines, cc: m.cc, ev: m.ev ?? null, fanIn: m.fanIn, fanOut: m.fanOut, comment: m.commentRate }))
    return { source: 'script', tool: j.tool || 'AstroLab metrics.mjs', modules, totalLines: j.totals?.code ?? modules.reduce((s, m) => s + (m.lines || 0), 0), files: (j.files || []).length }
  }
  const rows = text.split(/\r?\n/).filter((l) => l.trim())
  const head = rows.shift().split(',').map((s) => s.trim())
  const idx = (n) => head.indexOf(n)
  for (const n of ['模块名', '规格化行数', '圈复杂度']) if (idx(n) < 0) throw new Error(`CSV 缺少列“${n}”（列名：模块名,文件,规格化行数,圈复杂度,基本复杂度,扇入,扇出,注释率）`)
  const modules = rows.map((l) => {
    const c = l.split(',').map((s) => s.trim())
    const g = (n) => (idx(n) >= 0 ? c[idx(n)] : '')
    return { name: g('模块名'), file: g('文件'), lines: num(g('规格化行数')), cc: num(g('圈复杂度')), ev: num(g('基本复杂度')), fanIn: num(g('扇入')), fanOut: num(g('扇出')), comment: num(g('注释率')) }
  })
  return { source: 'tool', tool: '部门工具', modules, totalLines: modules.reduce((s, m) => s + (m.lines || 0), 0), files: new Set(modules.map((m) => m.file)).size }
}

/** 超过门限的项目：[{ name, item, value }] */
export function overLimits(m) {
  const out = []
  if (m.lines != null && m.lines > LIMIT.lines) out.push({ item: '行数超过 200', value: m.lines })
  if (m.cc != null && m.cc > LIMIT.cc && (m.ev == null || m.ev > LIMIT.ev)) out.push({ item: m.ev == null ? '圈复杂度超过 10（基本复杂度未知）' : '圈复杂度超过 10 且基本复杂度超过 4', value: m.ev == null ? m.cc : `${m.cc}/${m.ev}` })
  if (m.fanOut != null && m.fanOut > LIMIT.fanOut) out.push({ item: '扇出超过 5', value: m.fanOut })
  if (m.comment != null && m.comment < LIMIT.comment) out.push({ item: '注释率低于 30%', value: `${m.comment}%` })
  return out
}

export { blank }
