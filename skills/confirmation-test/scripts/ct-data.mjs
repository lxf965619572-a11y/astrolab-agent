// 确认测试记录、需求规格说明的读取，ct-results / gen-ct-report / check-ct 共用。

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { readText, sections, findSection, findTable, rowsAsObjects, fields, tables, blank } from './md-lib.mjs'

export const REQ_ID = /[A-Z][A-Z0-9]{1,9}-(?:FREQ\d{3}(?:-(?:KN|K|N))?|PREQ\d+\.\d+|RREQ\d+|SREQ\d+|IREQ\d+\.\d+)|[A-Z][A-Z0-9]{1,9}-[A-Z]{2,5}-\d{3}(?:-(?:KN|K|N))?/g
export const isK = (id, attr = '') => /-K(N)?$/.test(id) || /(^|[、,，\s])K([、,，\s]|$)/.test(attr)

/** 读确认测试记录 */
export function readRecord(path) {
  const md = readText(path)
  const S = sections(md)
  const sec = (num, name) => findSection(S, num, name)
  const info = fields(sec('1', '概述')?.body || '')
  const T = (num, name, cols) => rowsAsObjects(findTable(sec(num, name)?.body || '', cols))
  const ops = (sec('5', '公共操作说明')?.body || '').split('\n').map((l) => /^\s*[-*]\s*(.+?)[：:]\s*(.+)$/.exec(l)).filter(Boolean).map((m) => ({ name: m[1].trim(), text: m[2].trim() }))
  // 用例：第 6 节下的三级标题
  const s6 = sec('6', '测试用例')
  const cases = []
  if (s6) {
    const lines = md.split('\n').slice(s6.start + 1, s6.end)
    let cur = null
    const flush = () => { if (cur) cases.push(finishCase(cur)) }
    lines.forEach((l, k) => {
      const m = /^###\s+(\S+)\s*(.*)$/.exec(l)
      if (m) { flush(); cur = { id: m[1], title: m[2].trim(), lines: [], line: s6.start + 2 + k } }
      else if (cur) cur.lines.push(l)
    })
    flush()
  }
  return {
    md, S, sec, info, path,
    env: T('2', '测试环境', ['产品名称', '数量']),
    points: T('3', '测试要点', ['测试要点编号', '测试要点']),
    items: T('4', '测试项目', ['测试项目名称', '测试项目标识']),
    ops, cases,
    untestable: T('7', '不可测试项', ['编号', '不可测试项描述']),
    problems: T('8', '问题报告单', ['问题编号', '严重等级']),
    questions: T('9', '待确认问题', ['编号', '问题']),
    stats: Object.fromEntries(T('10', '统计', ['项目', '数量']).map((r) => [r['项目'], r['数量']])),
  }
}

function finishCase(c) {
  const body = c.lines.join('\n')
  const f = fields(body)
  const st = findTable(body, ['步骤序号', '操作步骤', '期望结果'])
  const steps = rowsAsObjects(st).map((r) => ({ no: r['步骤序号'], op: r['操作步骤'], expect: r['期望结果'], actual: r['实际结果'] || '' }))
  const reqs = [...new Set(((f['功能项'] || '').match(REQ_ID) || []))]
  return {
    id: c.id, title: c.title, line: c.line, f,
    item: f['测试项目'] || '', reqs, env: f['测试环境'] || '', type: f['测试类型'] || '', purpose: f['测试目的'] || c.title,
    robust: /^是/.test(f['健壮性测试'] || '') || /健壮/.test(f['测试类型'] || ''),
    points: (f['测试要点'] || '').split(/[、,，\s]+/).filter((x) => x && !/^(无|—)$/.test(x)),
    steps, result: (f['测试结论'] || '').trim(), problem: (f['问题报告单'] || '').trim(),
  }
}

/** 读需求规格说明：附录B.1 的需求（标识、名称、章节、属性），7.4 的测试要点，7.3 的不可测试项文字 */
export function readSRS(path) {
  const md = readText(path)
  const S = sections(md)
  const b1 = S.find((s) => /^附录\s*B\.1/.test(s.title) || /逆向跟踪矩阵/.test(s.title) && /B\.1/.test(s.title))
  const reqs = new Map()
  if (b1) {
    for (const r of rowsAsObjects(findTable(b1.body, ['需求标识']))) {
      const id = (r['需求标识'].match(REQ_ID) || [])[0]
      if (id) reqs.set(id, { id, name: r['需求名称'] || '', chapter: r['章节号'] || '', attr: r['属性'] || '' })
    }
  }
  // 没有附录B.1 时退而从全文收集标识
  if (!reqs.size) for (const m of md.matchAll(REQ_ID)) if (!reqs.has(m[0])) reqs.set(m[0], { id: m[0], name: '', chapter: '', attr: '' })
  const s74 = S.find((s) => s.num === '7.4' || /测试要点/.test(s.title) && /^7/.test(s.num))
  const tps = s74 ? rowsAsObjects(findTable(s74.body, ['测试要点'])).map((r, k) => ({ no: r['序号'] || String(k + 1), text: r['测试要点'], reqs: (r['对应的需求功能点'] || '').match(REQ_ID) || [] })) : []
  return { md, reqs, tps, hasB1: !!b1 }
}

/** 在记录所在目录、上级、当前目录找文件 */
export function locate(recPath, p) {
  if (!p || /待补充|^—$/.test(p)) return null
  p = p.replace(/[`]/g, '').replace(/[（(].*$/, '').trim()
  for (const c of [resolve(p), resolve(dirname(recPath), p), resolve(dirname(recPath), '..', p)]) if (existsSync(c)) return c
  return null
}

/** 第 10 节统计的应有值（SRS 为 null 时与需求有关的项为 null） */
export function computeStats(R, SRS) {
  const ntReq = (id) => R.untestable.filter((n) => (n['需求标识'] || '').includes(id))
  const executed = R.cases.filter((c) => /^(通过|不通过)$/.test(c.result))
  return {
    需求总数: SRS ? SRS.reqs.size : null,
    用例覆盖的需求数: SRS ? [...SRS.reqs.keys()].filter((id) => R.cases.some((c) => c.reqs.includes(id))).length : null,
    列为不可测试项的需求数: SRS ? [...SRS.reqs.keys()].filter((id) => !R.cases.some((c) => c.reqs.includes(id)) && ntReq(id).length).length : null,
    测试要点数: R.points.length,
    用例总数: R.cases.length,
    健壮性用例数: R.cases.filter((c) => c.robust).length,
    安全关键功能用例数: SRS ? R.cases.filter((c) => c.reqs.some((id) => isK(id, SRS.reqs.get(id)?.attr))).length : null,
    已执行用例数: executed.length,
    通过用例数: R.cases.filter((c) => c.result === '通过').length,
    不通过用例数: R.cases.filter((c) => c.result === '不通过').length,
    问题报告单数: R.problems.length,
    待确认问题数: R.questions.length,
  }
}

export const RESULT = /^(通过|不通过|未执行)$/
export const SEVERITY = /^(致命问题|严重问题|一般问题|轻微问题|改进建议)$/
export const CATEGORY = /^(文档问题|设计问题|程序问题|其他问题)$/
export { blank, tables }
