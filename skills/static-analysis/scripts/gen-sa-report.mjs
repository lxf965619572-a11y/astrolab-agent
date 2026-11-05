#!/usr/bin/env node
// 由静态分析记录和度量数据生成部门模板 02-3《XX软件（VX.XX）静态分析报告》的 Markdown。
// 第 3 章统计、第 4 章表格全部来自数据；没有依据的内容写【待补充】。
//
// 用法：node gen-sa-report.mjs <静态分析记录.md> --out <报告.md> [--metrics <metrics.json|度量.csv>] [--force]
//   --metrics 不给时取记录第 1 节“度量结果”的路径。
// 退出码：0 = 生成；1 = 缺少必需内容；2 = 用法或文件错误

import { existsSync, writeFileSync } from 'node:fs'
import { readRecord, readMetrics, locate, overLimits, LIMIT, blank } from './sa-data.mjs'
import { cell, TODO } from './md-lib.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const out = opt('--out')
let metP = opt('--metrics')
const force = argv.includes('--force'); if (force) argv.splice(argv.indexOf('--force'), 1)
if (!out || argv.length !== 1) { console.error('用法：node gen-sa-report.mjs <静态分析记录.md> --out <报告.md> [--metrics <json|csv>] [--force]'); process.exit(2) }
const recP = argv[0]
if (!existsSync(recP)) { console.error(`找不到：${recP}`); process.exit(2) }
if (existsSync(out) && !force) { console.error(`${out} 已存在。报告应由记录重新生成：确认其中没有需要保留的手写内容后加 --force。`); process.exit(2) }

const R = readRecord(recP)
metP = metP || locate(recP, R.info['度量结果'])
if (!metP) { console.error('没有度量数据：记录第 1 节写明“度量结果”的路径，或加 --metrics。'); process.exit(1) }
let M
try { M = readMetrics(metP) } catch (e) { console.error(`读不了度量数据 ${metP}：${e.message}`); process.exit(1) }

const v = (k) => (blank(R.info[k]) || /待补充/.test(R.info[k] || '') ? TODO : R.info[k])
const name = v('软件名称'), ver = v('软件版本'), code = v('软件代号')
const script = M.source === 'script'
const srcText = script ? 'AstroLab metrics.mjs' : (v('度量数据来源') === TODO ? '部门工具' : v('度量数据来源'))
const viol = R.rules.filter((r) => /^(违反|特殊设计)$/.test(r['判定']))
const mand = viol.filter((r) => /强制/.test(r['规则类型'])), rec = viol.filter((r) => /推荐/.test(r['规则类型']))
const mods = M.modules
const linesOver = mods.filter((m) => m.lines != null && m.lines > LIMIT.lines)
const ccBoth = mods.filter((m) => m.cc != null && m.ev != null && m.cc > LIMIT.cc && m.ev > LIMIT.ev)
const ccOnly = mods.filter((m) => m.cc != null && m.cc > LIMIT.cc && m.ev == null)
const fanOver = mods.filter((m) => m.fanOut != null && m.fanOut > LIMIT.fanOut)
const cmtLow = mods.filter((m) => m.comment != null && m.comment < LIMIT.comment)
const totalLines = M.totalLines
const lineWord = script ? '有效代码行' : '规格化后的行数'
const toolNames = R.tools.map((t) => `${t['工具名称']}${t['版本'] && !/AstroLab/.test(t['版本']) ? ` ${t['版本']}` : ''}`).join('、') || TODO

const L = []
const P = (...x) => L.push(...x)
P(`# ${name}（${ver}）静态分析报告`, '')
const fieldsJson = JSON.stringify({ 内容提要: `本文描述了对${name}（${code}）进行静态分析的过程，并对发现的问题进行了分析与总结。`, 主题词: `${name} 静态分析`, 型号代号: TODO })
P(`<!-- render_docx 时 fields 传入：${fieldsJson}；编号、密级、阶段标记、页数、编制单位、编写、校对、审核、标审、批准不填，由用户在 Word 中补。 -->`, '')
P('## 1 范围', '', '### 1.1 标识', '')
P(`软件名称：${name}`, '', `软件代号：${code}`, '', `交办方：${v('交办方')}`, '', `承制方：${v('承制方')}`, '', `安全关键等级：${v('安全关键等级')}`, '', `软件类型：${v('软件类型')}`, '')
P('### 1.2 系统概述', '', `${TODO}（软件的用途、在系统中承担的工作、运行环境，与需求规格说明一致）`, '')
P('### 1.3 文档概述', '', '本文档对软件静态分析的结果进行说明，为软件验收交付提供依据，也为改进软件提供参考。', '')
P('### 1.4 术语和缩略语', '', '术语和定义遵从 GB/T 11457-2006《信息技术 软件工程术语》的规定。', '')
P('## 2 引用文件', '', '| 文档号 | 标题 |', '|---|---|', '| GJB 8114-2013 | C/C++语言编程安全子集 |', `| ${TODO} | ${name}需求规格说明 |`, `| ${TODO} | ${name}详细设计说明 |`, '')
P('## 3 测试结果概述', '', '### 3.1 被测试软件说明', '', `${TODO}（被测软件的功能、性能和特点）`, '')
P(`表4-1 ${name}情况表`, '', '| 项目 | 内容 |', '|---|---|')
P(`| 安全关键等级 | ${v('安全关键等级')} |`, `| 编程语言 | ${v('编程语言') === TODO ? 'C语言' : v('编程语言')} |`, `| 开发环境 | ${v('开发环境')} |`, `| 代码行数 | ${totalLines}行${script ? '（有效代码行）' : ''} |`, `| 软件规模 | ${v('软件规模')} |`, '')
P('### 3.2 测试工作概述', '')
P(`${v('分析时间')}，依据 GJB 8114-2013《C/C++语言编程安全子集》对${name}（${v('测试版本')}）进行了静态分析。`, '')
P('静态分析内容包括与 GJB 8114-2013 强制准则的一致性检查和其他缺陷检查。对代码违反编程规则情况进行检查分析，使用工具进行控制流分析、数据流分析、接口分析、表达式分析等，通过这些分析提供代码潜在缺陷信息。编程规则的检查方式为工具扫描（gjb-scan.mjs、Cppcheck、编译告警）加人工确认；GJB 8114 中只能人工检查的规则在代码走查中检查。', '')
P('### 3.3 测试数据及质量', '')
P(`通过对被测软件使用${toolNames}进行分析，并经人工确认，测试结果如下：`, '')
P(`a) 被测软件${mand.length ? `违反了 ${new Set(mand.map((r) => r['规则编号'])).size} 种强制类编程规则，共 ${mand.length} 处` : '未违反强制类编程规则'}；`)
P(`b) 被测软件${rec.length ? `违反了 ${new Set(rec.map((r) => r['规则编号'])).size} 种推荐类编程规则，共 ${rec.length} 处` : '未违反推荐类编程规则'}${script || !rec.length ? '（规则表未收录推荐类规则，未检查）' : ''}；`)
P(`c) ${ccBoth.length ? `存在 ${ccBoth.length} 个圈复杂度超过 10 并且基本复杂度超过 4 的软件模块` : ccOnly.length ? `存在 ${ccOnly.length} 个圈复杂度超过 10 的软件模块，其基本复杂度${TODO}` : '不存在圈复杂度超过 10 的软件模块'}；`)
P(`d) ${linesOver.length ? `存在 ${linesOver.length} 个模块的${lineWord}超过 200 行` : `不存在${lineWord}超过 200 行的模块`}；`)
P(`e) ${cmtLow.length ? `存在 ${cmtLow.length} 个软件模块的注释率低于 30%` : '软件模块的注释率均不低于 30%'}；`)
P(`f) ${fanOver.length ? `存在 ${fanOver.length} 个软件模块的扇出数超过 5` : '不存在扇出数超过 5 的软件模块'}。`, '')
P('### 3.4 测试结论', '')
P('<!-- 由智能体按记录改写：结论（是否通过）、有无遗留问题。数字不要改。 -->', '')
P(`对${name}中所有模块均进行了静态分析，并进行确认后，结论如下：被测软件共存在违反强制类编程规则 ${mand.length} 处，违反推荐类编程规则 ${rec.length} 处；代码审查发现问题 ${R.review.length} 个。${TODO}（超标情况和违反规则对软件功能、性能的影响分析，是否可以进入动态测试阶段）`, '')
P(`本次测试${TODO}（通过 / 不通过），${TODO}（无遗留问题 / 遗留问题见 4.5、4.6）。`, '')
P('### 3.5 产品质量的评价和建议', '', `${TODO}（应在较短时期内改正的问题的改进建议、对整体被测对象的改进建议，及这些建议对软件的影响）`, '')
P('## 4 详细测试结果', '', '### 4.1 软件规模统计分析', '')
P(`${name}（${ver}）共有 ${mods.length} 个软件模块，${lineWord} ${totalLines} 行，软件单元的规模统计分析见下表。${script ? '本章数据由 AstroLab metrics.mjs 统计：行数为有效代码行（未经 TESTBED 规格化），圈复杂度不计 &&、||，基本复杂度未计算。' : `本章数据取自${srcText}。`}`, '')
P(`表5-1 ${name}规模统计分析表`, '', `| 序号 | 模块名 | 规格化后的行数 | 是否超过200 |`, '|---|---|---|---|')
mods.forEach((m, k) => P(`| ${k + 1} | ${cell(m.name)} | ${m.lines ?? TODO} | ${m.lines == null ? TODO : m.lines > LIMIT.lines ? '是' : '否'} |`))
P('', '### 4.2 软件单元圈复杂度统计分析', '', `${name}（${ver}）圈复杂度统计分析见下表。`, '')
P(`表5-2 ${name}（${ver}）单元圈复杂度统计分析表`, '', '| 序号 | 模块名 | 圈复杂度数 | 基本圈复杂度 | 圈复杂度超过10同时基本复杂度超过4 |', '|---|---|---|---|---|')
mods.forEach((m, k) => P(`| ${k + 1} | ${cell(m.name)} | ${m.cc ?? TODO} | ${m.ev ?? TODO} | ${m.cc == null ? TODO : m.cc <= LIMIT.cc ? '否' : m.ev == null ? TODO : m.ev > LIMIT.ev ? '是' : '否'} |`))
P('', '### 4.3 软件单元的扇入、扇出数统计', '', `${name}（${ver}）的扇入、扇出数统计见下表。`, '')
P(`表5-3 ${name}（${ver}）单元扇入、扇出数统计表`, '', '| 序号 | 模块名 | 扇入数 | 扇出数 |', '|---|---|---|---|')
mods.forEach((m, k) => P(`| ${k + 1} | ${cell(m.name)} | ${m.fanIn ?? TODO} | ${m.fanOut ?? TODO} |`))
P('', '### 4.4 软件单元源代码注释率统计', '', `软件单元源代码注释率指有效注释行与源代码总行的比率，${name}（${ver}）软件模块的注释率详见下表。`, '')
P(`表5-4 ${name}（${ver}）单元源代码注释率统计表`, '', '| 序号 | 模块名 | 注释率（%） | 是否小于30% |', '|---|---|---|---|')
mods.forEach((m, k) => P(`| ${k + 1} | ${cell(m.name)} | ${m.comment == null ? TODO : `${Number(m.comment).toFixed(2)}%`} | ${m.comment == null ? TODO : m.comment < LIMIT.comment ? '是' : '否'} |`))
const overRows = R.over
if (overRows.length) {
  P('', '超过门限的模块分析如下：', '', '| 序号 | 模块名 | 超标项 | 数值 | 分析说明 | 处理 |', '|---|---|---|---|---|---|')
  overRows.forEach((r, k) => P(`| ${k + 1} | ${cell(r['模块名'])} | ${cell(r['超标项'])} | ${cell(r['数值'])} | ${cell(r['分析说明'])} | ${cell(r['处理'])} |`))
}
P('', '### 4.5 对编程约定执行情况统计分析', '')
P(`使用${toolNames}进行分析，并经人工确认，共违反 GJB 8114-2013 强制类规则 ${mand.length} 处，推荐类规则 ${rec.length} 处${viol.some((r) => r['判定'] === '特殊设计') ? `，其中属于特殊设计的 ${viol.filter((r) => r['判定'] === '特殊设计').length} 处` : ''}；工具告警中经确认为误报的 ${R.rules.filter((r) => r['判定'] === '误报').length} 条。`, '')
P('表5-5 违反编程规则情况', '', '| 序号 | 违反规则情况 | 对违反规则的分析说明 | 规则类型 |', '|---|---|---|---|')
if (viol.length) viol.forEach((r, k) => P(`| ${k + 1} | ${cell(`${r['文件:行号']} 违反 GJB 8114 ${r['规则编号']}`)} | ${cell(`${r['分析说明']}${r['处理'] ? `（${r['处理']}）` : ''}`)} | ${cell(r['规则类型'] || '强制')}类 |`))
else P('| — | 无 | — | — |')
P('', '### 4.6 代码审查', '', '审查代码和设计的一致性和代码逻辑的正确性。', '')
P(`表5-6 ${name}代码审查问题`, '', '| 序号 | 问题描述 | 处理更改 |', '|---|---|---|')
if (R.review.length) R.review.forEach((r, k) => P(`| ${k + 1} | ${cell(`${r['文件:行号'] ? r['文件:行号'] + '：' : ''}${r['问题描述']}`)} | ${cell(r['处理更改'])} |`))
else P('| — | 无 | — |')
P('', '## 5 测试工作总结', '')
P('<!-- 由智能体按记录改写：总结测试过程、教训和对后续测试的改进建议。数字不要改。 -->', '')
P(`通过对${name}（${ver}）使用${toolNames}以及人工分析方法进行静态分析，总结如下：`, '')
P(`a) 被测软件共存在违反强制类编程规则 ${mand.length} 处，违反推荐类编程规则 ${rec.length} 处；代码审查发现问题 ${R.review.length} 个；`)
P(`b) ${TODO}（违反规则和超标情况是否影响软件功能、性能，是否需要更改，后续编码应注意的事项）。`, '')

writeFileSync(out, L.join('\n'), 'utf8')
const todo = L.filter((l) => !l.startsWith('<!--')).join('\n').split(TODO).length - 1
console.log(`已生成 ${out}：模块 ${mods.length} 个（度量来源：${srcText}），违反规则 ${viol.length} 处，代码审查问题 ${R.review.length} 个。【待补充】${todo} 处。`)
