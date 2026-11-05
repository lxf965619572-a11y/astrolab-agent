#!/usr/bin/env node
// 生成研制信息表（Markdown），并从工作区已有文档自动预填：
//   需求规格说明（1.1 基本信息、功能/性能/可靠性/安全性需求）、确认测试记录（功能符合、性能实测、配置项测试、覆盖性）、
//   单元测试报告、走查报告、静态分析报告（开发方测试各表）、metrics.json（代码行数）、工作区中的文档（数据包）。
// 自动填入的单元格后面带“〔自动：<来源文件>〕”，产品负责人核对后可删去标记；找不到的写【待补充】。
//
// 用法：node info-sheet.mjs --class <I|III|IV> --out <研制信息表.md> [--ws <工作区目录>] [--srs <需求规格说明.md>] [--force]
// 退出码：0 = 生成；2 = 用法或文件错误

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHEET, BASIC_ROWS, OTHER_TEXT_ROWS, ELEMENTS, PROCESS_CHECKS, TODO, classOf, findFiles, verOf, rel, readText, sections, tables, rowsAsObjects, basename } from './sum-data.mjs'
import { cell } from './md-lib.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const cls = classOf(opt('--class')), out = opt('--out'), ws = resolve(opt('--ws') || '.')
let srsP = opt('--srs')
const force = argv.includes('--force')
if (!cls || !out) { console.error('用法：node info-sheet.mjs --class <I|III|IV> --out <研制信息表.md> [--ws <工作区>] [--srs <需求规格说明.md>] [--force]'); process.exit(2) }
if (cls === 'II') { console.error('Ⅱ类软件没有对应的部门研制总结模板，请向用户确认按哪类模板写。'); process.exit(2) }
if (existsSync(out) && !force) { console.error(`${out} 已存在：信息表可能已有人填写。确认要重新生成（会覆盖已填内容）时加 --force。`); process.exit(2) }

const A = (src) => `〔自动：${rel(ws, src)}〕`
const found = []
// ---- 需求规格说明
if (!srsP) srsP = findFiles(ws, /(需求规格说明.*|^srs)\.md$/i).filter((f) => !/记录|报告/.test(f)).pop()
const srs = srsP && existsSync(srsP) ? readText(srsP) : ''
if (srsP) found.push(`需求规格说明：${rel(ws, srsP)}`)
const srsField = (k) => { const m = new RegExp(`${k}[：:]\\s*([^\\n。]+)`).exec(srs); return m && !/待补充|^\*|^\/\*/.test(m[1].trim()) ? m[1].trim().replace(/[。.]$/, '').replace(/\s*[（(]简称[^）)]*[）)]/, '') : '' }
const reqs = new Map()
for (const t of tables(srs)) {
  const objs = rowsAsObjects(t)
  for (const r of objs) {
    const id = (r['需求标识'] || '').match(/[A-Z][A-Z0-9]{1,9}-(?:FREQ\d{3}(?:-(?:KN|K|N))?|PREQ\d+\.\d+|RREQ\d+|SREQ\d+|IREQ\d+\.\d+)/)?.[0]
    if (!id) continue
    const cur = reqs.get(id) || { id, name: '', desc: '' }
    cur.name = cur.name || r['需求名称'] || ''
    cur.desc = cur.desc || r['描述'] || r['可靠性要求'] || r['安全性要求'] || r['定义'] || ''
    reqs.set(id, cur)
  }
}
// ---- 确认测试记录
let ct = []
try {
  const { readRecord } = await import('../../confirmation-test/scripts/ct-data.mjs')
  for (const p of findFiles(ws, /^确认测试记录-.*\.md$/)) { try { ct.push({ p, R: readRecord(p) }) } catch { /* 格式不对的跳过 */ } }
} catch { /* 没有确认测试 Skill */ }
for (const c of ct) found.push(`确认测试记录：${rel(ws, c.p)}`)
const latestCT = ct.at(-1)
const ctCases = (id) => (latestCT ? latestCT.R.cases.filter((c) => c.reqs.includes(id)) : [])
// ---- 各类报告
const reports = (re) => findFiles(ws, re).map((p) => ({ p, md: readText(p) }))
const ut = reports(/单元测试报告.*\.md$/), wt = reports(/走查报告.*\.md$/), sa = reports(/静态分析报告.*\.md$/), ctr = reports(/确认测试报告.*\.md$/)
for (const x of [...ut, ...wt, ...sa, ...ctr]) found.push(`报告：${rel(ws, x.p)}`)
const title = (md) => (/^#\s+(.+)$/m.exec(md) || [])[1] || ''
const num = (md, re) => (re.exec(md) || [])[1] || ''
const metrics = findFiles(ws, /^metrics\.json$/).pop()
let codeLines = ''
if (metrics) { try { codeLines = String(JSON.parse(readFileSync(metrics, 'utf8')).totals?.code ?? '') } catch { /* 忽略 */ } }

// ---- 输出
const L = []
const P = (...x) => L.push(...x)
const T = (id) => SHEET.find((s) => s[0] === id)
const PARENT = { 7: '开发方测试', 8: '单机、分系统及系统测试', 9: '第三方评测', 12: '功能性能符合情况', 16: '产品保证技术要素确认', 17: '研制过程确认', 18: '其他' }
const opened = new Set()
const head = (id) => {
  const [n, t, cols] = T(id), top = n.split('.')[0]
  if (n.includes('.') && !opened.has(top)) { opened.add(top); P(`## ${top} ${PARENT[top]}`, '') }
  P(`${n.includes('.') ? '###' : '##'} ${n} ${t}`, ''); return cols
}
const table = (cols, rows) => { P(`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`); for (const r of rows) P(`| ${r.map((x) => cell(x ?? '')).join(' | ')} |`); P('') }
const blankRows = (cols, n = 1) => Array.from({ length: n }, (_, k) => cols.map((c, i) => (i === 0 ? k + 1 : TODO)))
const clsName = { I: 'Ⅰ类', III: 'Ⅲ类', IV: 'Ⅳ类' }[cls]

P(`# ${srsField('软件名称') || (latestCT?.R.info?.['软件名称'] || '').replace(/待补充/, '') || TODO} 研制信息表`, '')
P(`研制类型：${clsName}。本表由 info-sheet.mjs 生成，是生成软件研制总结报告的工作底稿。每个事实都要有出处：“〔自动：文件〕”是脚本从工作区文档填入的；智能体从数据包文件中摘录的写“〔来源：文件名 章节或页码〕”；用户直接给出的写“〔用户提供〕”。【待补充】是还没找到出处的，问用户；没有发生的事项写“无”或“未参加”，不要留空。出处标记不会进入报告。导出 Excel 时用 export_xlsx 并设 merge: false。`, '')
P(`自动收集到的文档：${found.length ? found.join('；') : '无'}。`, '')
let cols = head('1')
// SRS 没有的，从最新的确认测试记录 1 概述取（标记为该记录）
const ctInfo = (k) => { const v = latestCT?.R.info?.[k]; return v && !/待补充/.test(v) ? `${v}${A(latestCT.p)}` : '' }
const basic = { 软件名称: srsField('软件名称') || ctInfo('软件名称'), 软件代号: srsField('软件代号') || ctInfo('软件代号'), 验收版本: ctInfo('被测版本'), 研制类型: clsName, 安全关键等级: srsField('软件安全关键等级') || srsField('安全关键等级'), 继承基线: srsField('继承基线'), 软件交办方: srsField('软件交办方'), 软件承制方: srsField('软件承制方'), 编程语言: 'C语言', 代码行数: codeLines ? `${codeLines}（有效代码行）${A(metrics)}` : '', 需求规格说明: srsP ? rel(ws, srsP) : '' }
table(cols, BASIC_ROWS.filter((k) => cls === 'I' || !/^被沿用/.test(k)).map((k) => [k, basic[k] ? `${basic[k]}${['研制类型', '编程语言', '需求规格说明'].includes(k) || /自动/.test(basic[k]) ? '' : srsP ? A(srsP) : ''}` : TODO]))
P('说明：软件版本列表按时间顺序写全部版本（如 V1.00、V1.01、V1.02），验收版本一般为最终版本；固化状态写“未固化”或“已固化”。', '')

cols = head('2'); table(cols, cls === 'I'
  ? [[1, TODO, '功能基线发布', '《XX软件任务书》等输入文件入受控库，发布功能基线', TODO], [2, TODO, '产品基线发布', '从被沿用软件产品库转入本软件产品库，发布产品基线', TODO]]
  : [[1, TODO, '功能基线发布', '《XX软件任务书》等输入文件入受控库，发布功能基线', TODO], [2, TODO, '分配基线发布', '《XX软件需求规格说明》入受控库，发布分配基线', TODO], [3, TODO, '产品基线发布', cls === 'III' ? '根据功能基线、分配基线进行软件更改、调试、回归测试并入受控库；完成配置项测试，《XX软件配置项测试报告》入受控库，发布产品基线' : '根据功能基线、分配基线进行软件设计编码、调试、单元测试和组装测试并入受控库；完成配置项测试，《XX软件配置项测试报告》入受控库，发布产品基线', TODO]])
P('说明：每次更改发布产品基线时再加一行（需求变更、更动影响域分析报告入受控库……）。', '')

cols = head('3')
const reviews = cls === 'I' ? ['软件沿用状态复核评审', '研制总结报告评审'] : cls === 'III' ? ['软件任务书评审', '软件状态复核及影响域分析评审', '软件需求评审', '软件回归测试评审', '第三方评测评审', '研制总结报告评审'] : ['软件任务书评审', '软件需求评审', '配置项测试评审', '第三方评测评审', '研制总结报告评审']
table(cols, reviews.map((r, k) => [k + 1, r, `《XX》（版本）文件编号：${TODO}`, TODO, TODO]))
P('说明：每次更动加一行“更动影响域分析评审”；有用户级评审的要写；研制总结报告评审写到所级。', '')

cols = head('4'); table(cols, [[1, TODO, `${TODO}（任务书的正式名称，如《${(basic['软件名称'] || 'XX软件').replace(/〔[^〕]*〕/g, '')}研制任务书》）`, TODO, '交办方输入'], [2, TODO, TODO, TODO, '交办方输入']])
P('说明：类别写“交办方输入”（任务书、通信协议、数据约定、接口数据单等，进 4.1）、“型号标准”（进 4.1 和 2.2）、“本单位研制文件”（需求、设计、测试报告，进 2.2）或“规范性”（标准规范，进 2.1）。', '')

if (cls !== 'I') { cols = head('5'); table(cols, [[1, TODO, TODO, TODO, TODO, TODO, TODO, TODO, '']]); P('说明：没有更改的整表删去数据行，写一行“无”。更改影响不能只写“无影响”；测试验证情况写经过了哪些测试。', '') }

cols = head('6')
const std = cls === 'I' ? ['软件沿用可行性分析报告', '软件研制总结报告', '软件产品履历书', '软件质量证明书', '软件需求规格说明（借用）', '软件设计报告（借用）', '软件确认测试报告（借用）']
  : ['软件任务书', '软件用户需求', '软件开发计划', '软件配置管理计划', '软件产品保证计划', '软件需求规格说明', '软件概要设计说明', '软件详细设计说明', '单元测试计划', '单元测试报告', '组装测试计划', '组装测试报告', '配置项测试计划', '配置项测试说明', '配置项测试报告', '软件使用说明', ...(cls === 'III' ? ['更动影响域分析报告', '回归测试报告'] : []), '第三方配置项测试需求', '第三方动态测试说明', '第三方静态分析报告', '第三方人工走查报告', '第三方动态测试报告', '第三方回归测试报告', '软件研制总结报告', '软件产品履历书', '软件质量证明书']
const wsDocs = findFiles(ws, /(需求规格说明|概要设计说明|详细设计说明|单元测试报告|走查报告|静态分析报告|确认测试报告|追踪表).*\.(md|docx|xlsx)$/).filter((p) => !/记录/.test(basename(p)))
table(cols, std.map((n, k) => { const hit = wsDocs.find((p) => basename(p).includes(n.replace(/^软件/, '').replace(/（借用）$/, '').replace('配置项测试报告', '确认测试报告'))); return [k + 1, n, TODO, hit ? `${verOf(basename(hit)) || TODO}${A(hit)}` : TODO, hit ? '' : ''] }))
P('说明：所有文档的所有版本都要列出（有几次更动就有几份更动影响域分析报告和回归测试报告）；组装测试合并到确认测试的在备注说明；没有的文档删去该行并在备注说明原因。', '')

if (cls !== 'I') {
  cols = head('7.1'); table(cols, wt.length ? wt.map((x, k) => [k + 1, verOf(title(x.md)) || TODO, `${num(x.md, /\|\s*人工走查\s*\|[^|]*\|\s*([^|]+?)\s*\|/) || TODO}`, TODO, `发现问题 ${num(x.md, /共 (\d+) 个问题/) || TODO} 个${A(x.p)}`]) : blankRows(cols))
  cols = head('7.2'); table(cols, sa.length ? sa.map((x, k) => [k + 1, verOf(title(x.md)) || TODO, `${num(x.md, /使用(.+?)进行分析/) || TODO}`, `违反强制类规则 ${num(x.md, /违反强制类编程规则 (\d+) 处/) || '?'} 处，推荐类 ${num(x.md, /违反推荐类编程规则 (\d+) 处/) || '?'} 处${A(x.p)}`]) : blankRows(cols))
  cols = head('7.3'); table(cols, ut.length ? ut.map((x, k) => {
    const g = (label) => num(x.md, new RegExp(`\\|\\s*${label}\\s*\\|\\s*([^|]+?)\\s*\\|`))
    return [k + 1, verOf(title(x.md)) || TODO, g('测试用例个数') || TODO, g('已测函数个数') || TODO, cls === 'III' ? '回归' : '全面', `${num(x.md, /疑似缺陷 (\d+) 个/) || '0'}`, `语句 ${g('语句覆盖率') || '?'}，分支 ${g('分支覆盖率') || '?'}，MC/DC ${g('MC/DC覆盖率') || g('MC/DC 覆盖率') || '?'}`, `${TODO}（结论写明三覆盖情况、功能实现正确、与详细设计一致、测试通过）${A(x.p)}`]
  }) : blankRows(cols))
  cols = head('7.4'); table(cols, blankRows(cols)); P('说明：语句、分支、MC/DC 未达到 100% 的模块逐个列出并分析原因；全部达到的写一行“无”。', '')
  cols = head('7.5'); table(cols, [[1, TODO, '针对每个模块单元进行白盒测试，满足语句、分支和MC/DC覆盖要求']])
  cols = head('7.6'); table(cols, blankRows(cols)); P('说明：组装测试合并到确认测试进行的，写一行并在测试结果/结论中说明原因。', '')
  cols = head('7.7'); table(cols, blankRows(cols))
  cols = head('7.8'); table(cols, ct.length ? ct.map(({ p, R }, k) => {
    const exec = R.cases.filter((c) => /^(通过|不通过)$/.test(c.result))
    const rep = ctr.find((x) => verOf(title(x.md)) === R.info['被测版本'])
    return [k + 1, R.info['被测版本'] || TODO, exec.length || R.cases.length, /回归/.test(R.info['测试轮次'] || '') ? '回归' : '全面', R.problems.length, `${exec.length ? `执行 ${exec.length} 个，未通过 ${exec.filter((c) => c.result === '不通过').length} 个；` : '尚未执行；'}${TODO}（结论）${A(rep ? rep.p : p)}`]
  }) : blankRows(cols))
  cols = head('7.9'); table(cols, latestCT && latestCT.R.env.length ? latestCT.R.env.map((e, k) => [k + 1, e['产品名称'], e['产品编号'] || TODO, e['产品状态'] || TODO, e['数量'] ? `${e['数量']}${A(latestCT.p)}` : TODO]) : blankRows(cols))
}
for (const id of ['8.1', '8.2', '8.3']) { cols = head(id); table(cols, blankRows(cols)) }
P('说明：未参加的写一行“未参加”（或“与 XX 测试合并进行”），测试时间、报告名称跟产品负责人要。', '')
cols = head('8.4'); table(cols, [[1, basic['软件名称'] || TODO, TODO, TODO, TODO, TODO, TODO, TODO, TODO, TODO]]); P('说明：每项填参加时的软件版本，未参加的填“—”；整体未参加系统测试的写“未参加”。', '')
if (cls !== 'I') {
  cols = head('9.1'); table(cols, blankRows(cols))
  cols = head('9.2'); table(cols, blankRows(cols)); P('说明：问题类型填 设计问题/程序问题/文档问题/其它问题；测试方法填 静态分析/人工走查/动态测试；更改性质填 修改程序/修改文档/修改程序和文档/不做处理。报告中的问题统计表由这张表计算。', '')
  cols = head('9.3'); table(cols, [['评测单位', TODO], ['评测结论原文', `${TODO}（照抄评测方给出的结论，没有的先要到原件）`]])
}
cols = head('10'); table(cols, blankRows(cols)); P('说明：没有发生需要归零的质量问题的，删去数据行，写一行“无”（问过用户再写）。', '')
cols = head('11'); table(cols, blankRows(cols)); P('说明：举一反三一般都有，与本型号其他软件一致；措施要针对本软件。', '')
if (cls !== 'I') {
  const F = [...reqs.values()].filter((r) => /FREQ/.test(r.id)), Pf = [...reqs.values()].filter((r) => /PREQ/.test(r.id))
  const res = (id) => { const cs = ctCases(id); if (!cs.length) return TODO; if (cs.some((c) => c.result === '不通过')) return `不符合${A(latestCT.p)}`; if (cs.every((c) => c.result === '通过')) return `符合${A(latestCT.p)}`; return TODO }
  cols = head('12.1'); table(cols, F.length ? F.map((r, k) => [k + 1, r.name || r.desc || TODO, r.id, res(r.id), ctCases(r.id).map((c) => c.id).join('、') || TODO]) : blankRows(cols))
  cols = head('12.2'); table(cols, Pf.length ? Pf.map((r, k) => { const cs = ctCases(r.id).filter((c) => c.steps.some((s) => s.actual)); return [k + 1, r.desc || r.name || TODO, r.id, cs.length ? `${cs.map((c) => c.steps.map((s) => s.actual).filter(Boolean).join('；')).join('；')}${A(latestCT.p)}` : TODO, res(r.id), cs.map((c) => c.id).join('、') || TODO] }) : blankRows(cols))
  P('说明：性能要写实测数据（如“实测 8.2 ms”），不能照抄要求的范围。', '')
  cols = head('13')
  const items = [...F.map((r) => [r.name || r.id, '功能', r.id]), ...Pf.map((r) => [r.name || r.desc || r.id, '性能', r.id])]
  table(cols, items.length ? items.map(([n, c, id], k) => { const cs = ctCases(id); const ctMark = cs.some((x) => /^(通过|不通过)$/.test(x.result)) ? `√${A(latestCT.p)}` : cs.length ? TODO : latestCT ? `—${A(latestCT.p)}` : TODO; return [k + 1, n, c, TODO, TODO, ctMark, TODO, TODO, TODO, TODO] }) : blankRows(cols))
  P('说明：测过的填“√”，没测的填“—”；分系统和整星上很多项目测不了，全部打“√”一般不对。功能和性能的个数与 12.1、12.2 相同。', '')
  cols = head('14')
  const RS = [...reqs.values()].filter((r) => /RREQ|SREQ/.test(r.id))
  table(cols, RS.length ? RS.map((r, k) => [k + 1, `${r.desc || r.name}（${r.id}）`, TODO, ctCases(r.id).length ? `√${latestCT ? A(latestCT.p) : ''}` : TODO, TODO, TODO]) : blankRows(cols))
  P('说明：措施写实际可落实的（如“对 XX、XX 等重要数据进行三取二处理”），不写“按结构化设计”之类。', '')
}
cols = head('15'); table(cols, blankRows(cols, 3)); P(`说明：写软件工程包和可执行文件所有版本的出入库，按时间顺序：${cls === 'III' ? '基线软件出库、' : cls === 'I' ? '被沿用软件出产品库、' : ''}初始入受控库、出库配置项测试、出库单机测试、出库第三方评测、入产品库、更动出库/入库（没有更动的不写）。出入库对象写清是工程包还是编程文件。`, '')
if (cls !== 'I') {
  cols = head('16.1'); table(cols, ELEMENTS.map(([t, n], k) => [k + 1, t, n || TODO, TODO, TODO, TODO, TODO, TODO, TODO, TODO, TODO]))
  P('说明：满足+不满足+不适用=检查项数量；全部满足一般不对；没有待办的填 0。', '')
  cols = head('16.2'); table(cols, blankRows(cols)); P('说明：没有不满足项的写一行“无”。', '')
  cols = head('17.1'); table(cols, PROCESS_CHECKS.map((n, k) => [k + 1, n, TODO, TODO, TODO, TODO, TODO, TODO, TODO, TODO]))
  cols = head('17.2'); table(cols, blankRows(cols)); P('说明：没有不满足项的写一行“无”。', '')
}
cols = head('18.1'); table(cols, blankRows(cols))
cols = head('18.2'); table(cols, OTHER_TEXT_ROWS.filter((k) => (cls === 'I' ? !['与基线版本的差异点', '研制概况'].includes(k) : k !== '沿用背景') && !(cls === 'IV' && k === '与基线版本的差异点')).map((k) => [k, TODO]))

writeFileSync(out, L.join('\n'), 'utf8')
const auto = (L.join('\n').match(/〔自动：/g) || []).length
console.log(`已生成 ${out}（${clsName}）：自动预填 ${auto} 处，【待补充】${(L.join('\n').match(/【待补充】/g) || []).length} 处。`)
for (const f of found) console.log(`- ${f}`)
