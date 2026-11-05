#!/usr/bin/env node
// 由走查记录生成部门模板 11《软件走查报告》的 Markdown（之后用 docgen render_docx 套 Word 模板）。
// 表格、问题报告单、统计数字全部取自走查记录；没有依据的内容写【待补充】，由智能体或用户补。
//
// 用法：node gen-wt-report.mjs <走查记录.md> --out <走查报告.md> [--force]
// 退出码：0 = 生成；1 = 记录缺少必需内容；2 = 用法或文件错误

import { existsSync, writeFileSync } from 'node:fs'
import { readText, sections, findSection, findTable, rowsAsObjects, fields, blank, cell, TODO } from './md-lib.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const out = opt('--out')
const force = argv.includes('--force'); if (force) argv.splice(argv.indexOf('--force'), 1)
if (!out || argv.length !== 1) { console.error('用法：node gen-wt-report.mjs <走查记录.md> --out <走查报告.md> [--force]'); process.exit(2) }
if (!existsSync(argv[0])) { console.error(`找不到：${argv[0]}`); process.exit(2) }
if (existsSync(out) && !force) { console.error(`${out} 已存在。报告应由记录重新生成：确认其中没有需要保留的手写内容后加 --force。`); process.exit(2) }

const md = readText(argv[0])
const S = sections(md)
const sec = (num, name) => findSection(S, num, name)
const info = fields(sec('1', '概述')?.body || '')
const v = (k) => (blank(info[k]) || /待补充/.test(info[k] || '') ? TODO : info[k])
const name = v('软件名称'), ver = v('软件版本')
const tools = rowsAsObjects(findTable(sec('2', '走查工具')?.body || '', ['走查工具名称', '版本']))
const alarms = rowsAsObjects(findTable(sec('3', '工具告警甄别')?.body || '', ['告警编号', '判定']))
const modules = rowsAsObjects(findTable(sec('4', '逐函数走查')?.body || '', ['模块/头文件名称', '是否通过审查']))
const problems = rowsAsObjects(findTable(sec('6', '问题清单')?.body || '', ['问题编号', '问题描述', '严重等级']))
const advices = rowsAsObjects(findTable(sec('7', '走查建议')?.body || '', ['建议编号', '建议描述']))
const stats = Object.fromEntries(rowsAsObjects(findTable(sec('9', '统计')?.body || '', ['项目', '数量'])).map((r) => [r['项目'], r['数量']]))

const missing = []
if (!sec('1', '概述')) missing.push('1 概述')
if (!modules.length) missing.push('4 逐函数走查的表格')
if (!sec('5', '专项检查')) missing.push('5 专项检查')
if (missing.length) { console.error(`走查记录缺少：${missing.join('、')}。先按 references/walkthrough-format.md 补全记录。`); process.exit(1) }

const toolAlarm = (src) => alarms.filter((a) => (a['来源'] || '').toLowerCase().startsWith(src))
const confirmed = alarms.filter((a) => /违反|问题/.test(a['判定']))
const manual = problems.filter((p) => /人工/.test(p['来源']))
const toolProblems = problems.filter((p) => !/人工/.test(p['来源']))
const lev = (k) => problems.filter((p) => p['严重等级'].replace(/\s/g, '').startsWith(k)).length
const codeLines = stats['代码行数'] || TODO
const date = v('走查时间')

const L = []
const P = (...x) => L.push(...x)
P(`# ${name}（${ver}）走查报告`, '')
const fieldsJson = JSON.stringify({ 内容提要: `本文档为${name}（${ver}）的走查报告，包括对走查工具、走查结果的描述，并对走查发现的问题进行说明及提出修改建议。`, 主题词: '走查报告', 型号代号: TODO })
P(`<!-- render_docx 时 fields 传入：${fieldsJson}；编号、密级、阶段标记、页数、编制单位、编写、校对、审核、标审、批准不填，由用户在 Word 中补。 -->`, '')
P('## 1 范围', '', '### 1.1 标识', '')
P(`软件名称：${name}`, '', `软件代号：${v('软件代号')}`, '', `交办方：${v('交办方')}`, '', `承制方：${v('承制方')}`, '', `安全关键等级：${v('安全关键等级')}`, '', `软件类型：${v('软件类型')}`, '')
P('### 1.2 文档概述', '', `本文件为${name}（${ver}）的走查报告，包括对走查过程的描述、发现问题的说明及修改建议。`, '')
P('### 1.3 软件开发环境', '', v('开发环境'), '')
P('### 1.4 软件运行环境', '', v('运行环境'), '')
P('## 2 引用文件', '')
P('| 文档号 | 标题 |', '|---|---|')
P('| GJB 8114-2013 | C/C++语言编程安全子集 |')
const basis = (info['走查依据'] || '').split(/[；;、\n]/).map((s) => s.trim()).filter((s) => s && !/待补充/.test(s))
if (basis.length) for (const b of basis) P(`| ${TODO} | ${cell(b)} |`)
else P(`| ${TODO} | ${TODO}研制任务书 |`, `| ${TODO} | ${TODO}需求规格说明 |`)
P('')
P('## 3 走查过程', '', '### 3.1 走查工具', '', '走查使用的工具及版本见表3-1，运行环境为' + (v('开发环境') === TODO ? TODO : v('开发环境')) + '。', '')
P('表3-1 走查工具表', '', '| 走查工具名称 | 版本 |', '|---|---|')
if (tools.length) for (const t of tools) P(`| ${cell(t['走查工具名称'])} | ${cell(t['版本'] || TODO)} |`)
else P(`| ${TODO} | ${TODO} |`)
P('', '### 3.2 走查结果', '', '表3-3 走查过程表', '', '| 工作内容 | 输出结果 | 时间 |', '|---|---|---|')
P(`| 静态分析 | 工具告警 ${alarms.length} 条，经甄别发现 ${toolProblems.length} 个问题（违反规则或缺陷 ${confirmed.length} 条，误报 ${alarms.filter((a) => /误报/.test(a['判定'])).length} 条，特殊设计 ${alarms.filter((a) => /特殊设计/.test(a['判定'])).length} 条） | ${date} |`)
P(`| 人工走查 | 发现 ${manual.length} 个问题 | ${date} |`)
P(`| 代码行数 | ${codeLines} | ${date} |`, '')
P('## 4 走查结果说明', '', '### 4.1 功能需求审查结果说明', '')
P(`依据引用文档《${basis.find((b) => /需求规格说明/.test(b)) || `${name}需求规格说明`}》，对软件的所有头文件和模块进行审查。代码审查结果记录表如下。`, '')
P('表4-1 代码审查结果记录表', '', '| 序号 | 模块/头文件名称 | 对应需求规格说明书节号 | 是否通过审查 |', '|---|---|---|---|')
modules.forEach((m, k) => P(`| ${k + 1} | ${cell(m['模块/头文件名称'] + (blank(m['走查的函数']) ? '' : `（${m['走查的函数']}）`))} | ${cell(m['对应需求规格说明章节号'])} | ${cell(m['是否通过审查'])} |`))
P('', '### 4.2 专项检查结果', '')
const special = [['5.1', '新状态复核', '4.2.1 新状态复核结果'], ['5.2', '安全关键功能', '4.2.2 安全关键功能检查结果'], ['5.3', '数据访问冲突', '4.2.3 数据访问冲突检查结果'], ['5.4', '数据有效性', '4.2.4 数据有效性判断设计检查结果'], ['5.5', '单粒子', '4.2.5 单粒子防护设计检查结果'], ['5.6', '时序', '4.2.6 时序检查结果'], ['5.7', '时间系统', '4.2.7 时间系统设计检查结果'], ['5.8', '编程、编译', '4.2.8 编程、编译规范性检查结果']]
for (const [num, key, title] of special) {
  const s = sec(num, key)
  P(`#### ${title}`, '')
  let body = (s?.body || '').trim()
  if (num === '5.3') body = body.replace(/^(\|.*\|\s*\n\|[\s:|-]+\|)/m, '表4-2 数据访问冲突检查表\n\n$1')
  P(body || TODO, '')
}
P('## 5 发现问题说明', '')
P(`本次走查过程中，测试人员提交的问题单及建议如附录A所示：共 ${problems.length} 个问题（Ⅰ级 ${lev('Ⅰ')} 个、Ⅱ级 ${lev('Ⅱ')} 个、Ⅲ级 ${lev('Ⅲ')} 个、Ⅳ级 ${lev('Ⅳ')} 个、Ⅴ级 ${lev('Ⅴ')} 个），${advices.length} 条建议。`, '')
P('## 6 测试总结', '')
const cat = (c) => problems.filter((p) => (p['问题类别'] || '').includes(c)).length
P(`<!-- 由智能体按记录改写：结论（是否通过）、有无遗留问题；问题数量统计、原因分析、修改建议；未执行的检查项对软件的影响及后续措施。数字不要改。 -->`, '')
P(`本次走查共走查 ${stats['走查文件数'] || TODO} 个文件、${stats['走查函数数'] || TODO} 个函数，代码 ${codeLines} 行，发现问题 ${problems.length} 个（程序问题 ${cat('程序')} 个、设计问题 ${cat('设计')} 个、文档问题 ${cat('文档')} 个、其它问题 ${cat('其它')} 个），提出建议 ${advices.length} 条。`, '')
P(problems.length ? `结论：${TODO}（存在未关闭的问题时为“不通过，问题修改后回归走查”）。` : '结论：走查通过，无遗留问题。', '')
P(`原因分析和修改建议：${TODO}`, '')
P(`未执行的检查项及影响：${TODO}`, '')
P('## 附录A 走查问题及建议', '')
for (const p of problems) {
  const [file, line] = (p['文件:行号'] || '').split(/:(?=\d+$)/)
  const lv = p['严重等级'].replace(/\s/g, '')
  const box = (k) => (lv.startsWith(k) ? '☑' : '□')
  const cb = (k) => ((p['问题类别'] || '').includes(k) ? '☑' : '□')
  P(`### 软件问题报告单 ${p['问题编号']}`, '')
  P('| 项目 | 内容 |', '|---|---|')
  P(`| 报告单标识 | ${cell(p['问题编号'])} |`, `| 问题编号 | ${cell(p['问题编号'])} |`, `| 报告人 | ${TODO} |`, `| 提交日期 | ${date} |`)
  P(`| 测试方法 | ${/人工/.test(p['来源']) ? '代码走查' : `静态分析（${cell(p['来源'])}）`}；检查项 ${cell(p['检查项'])} |`)
  P(`| 子程序名 | ${cell(p['函数'] || '—')} |`, `| 文件名 | ${cell(file)}${line ? `（第 ${line} 行）` : ''} |`)
  P(`| 严重等级 | Ⅰ级${box('Ⅰ')} Ⅱ级${box('Ⅱ')} Ⅲ级${box('Ⅲ')} Ⅳ级${box('Ⅳ')} Ⅴ级${box('Ⅴ')} |`)
  P(`| 问题类别 | 程序问题${cb('程序')} 文档问题${cb('文档')} 设计问题${cb('设计')} 其它问题${cb('其它')} |`)
  P(`| 问题描述 | ${cell(p['问题描述'])} |`, `| 处理建议 | ${cell(p['修改建议'])} |`)
  P('| 开发人员反馈意见 | 修改程序□ 修改文档□ 修改程序和文档□ 不做修改□　签名：　日期： |')
  P('| 上级设计者确认意见 | 签名：　日期： |')
  P('| 测试人员确认意见 | 版本号：　问题处理方式：　确认结果：　确认时间： |', '')
}
P('### 走查建议列表', '', '| 序号 | 建议项标识号 | 建议描述 | 软件版本 | 提出时间 | 提出人 | 反馈情况 |', '|---|---|---|---|---|---|---|')
if (advices.length) advices.forEach((a, k) => P(`| ${k + 1} | ${cell(a['建议编号'])} | ${cell(`${a['文件:行号'] ? a['文件:行号'] + '：' : ''}${a['建议描述']}`)} | ${ver} | ${date} | ${TODO} | |`))
else P('| — | — | 无 | | | | |')
P('', '| 反馈人 | | 反馈日期 | |', '|---|---|---|---|', '')

writeFileSync(out, L.join('\n'), 'utf8')
const todo = L.filter((l) => !l.startsWith('<!--')).join('\n').split(TODO).length - 1
console.log(`已生成 ${out}：问题报告单 ${problems.length} 张，建议 ${advices.length} 条，模块 ${modules.length} 个。【待补充】${todo} 处。`)
