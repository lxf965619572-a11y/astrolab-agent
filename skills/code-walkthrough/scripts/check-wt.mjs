#!/usr/bin/env node
// 走查记录（和走查报告）检查：工具告警是否逐条甄别、问题清单是否完整、逐函数走查是否覆盖全部文件和函数、统计数字是否一致。
// 只读。“必须处理”项要改正；“复核”项逐条判断。
//
// 用法：node check-wt.mjs <走查记录.md> [--scan <gjb-scan.json>] [--cppcheck <.cppcheck/last-run.json>] [--metrics <metrics.json>] [--report <走查报告.md>] [--root <代码根目录>]
//   --scan、--cppcheck、--metrics 不给时，取记录第 1 节“规则扫描结果”“Cppcheck 运行记录”“度量结果”中的路径（相对记录所在目录或当前目录）。
// 退出码：0 = 没有“必须处理”项；1 = 有；2 = 用法或文件错误

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { readText, sections, findSection, findTable, rowsAsObjects, fields, blank } from './md-lib.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
let scanP = opt('--scan'), ckP = opt('--cppcheck'), metP = opt('--metrics')
const repP = opt('--report'), root = opt('--root')
if (argv.length !== 1) { console.error('用法：node check-wt.mjs <走查记录.md> [--scan <json>] [--cppcheck <json>] [--metrics <json>] [--report <报告.md>] [--root <目录>]'); process.exit(2) }
const recP = argv[0]
if (!existsSync(recP)) { console.error(`找不到：${recP}`); process.exit(2) }

const out = []
const must = (id, msg) => out.push({ level: '必须处理', id, msg })
const review = (id, msg) => out.push({ level: '复核', id, msg })

const md = readText(recP)
const S = sections(md)
const sec = (num, name) => findSection(S, num, name)
const info = fields(sec('1', '概述')?.body || '')
const locate = (p) => {
  if (!p || /待补充|—/.test(p)) return null
  p = p.replace(/[`（(].*$/, '').trim()
  for (const c of [resolve(p), resolve(dirname(recP), p), resolve(dirname(recP), '..', p)]) if (existsSync(c)) return c
  return null
}
scanP = scanP || locate(info['规则扫描结果'])
ckP = ckP || locate(info['Cppcheck 运行记录'] || info['Cppcheck运行记录'])
metP = metP || locate(info['度量结果'])
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { console.error(`读不了 ${p}：${e.message}`); process.exit(2) } }
const scan = scanP ? json(scanP) : null
const ck = ckP ? json(ckP) : null
const met = metP ? json(metP) : null

// W1 章节
const REQ = [['1', '概述'], ['2', '走查工具'], ['3', '工具告警甄别'], ['4', '逐函数走查'], ['5', '专项检查'], ['5.1', '新状态复核'], ['5.2', '安全关键功能'], ['5.3', '数据访问冲突'], ['5.4', '数据有效性'], ['5.5', '单粒子'], ['5.6', '时序'], ['5.7', '时间系统'], ['5.8', '编程、编译'], ['6', '问题清单'], ['7', '走查建议'], ['8', '待确认问题'], ['9', '统计']]
for (const [n, t] of REQ) {
  const s = S.find((x) => x.num === n)
  if (!s) must('W1', `缺少章节“${n} ${t}”（标题、章节号照抄 references/walkthrough-format.md）`)
  else if (!s.title.includes(t.slice(0, 3))) review('W1', `章节 ${n} 的标题是“${s.title}”，格式规定为“${t}…”`)
}
for (const k of ['软件名称', '软件版本', '安全关键等级', '目标平台', '走查范围', '走查依据']) if (blank(info[k])) review('W1', `第 1 节缺“${k}”（不知道的写“【待补充】”）`)
if (!scanP) review('W2', '没有规则扫描结果（gjb-scan.mjs --json）：第 1 节写明路径或加 --scan，否则无法核对 GS 告警是否逐条甄别')
if (!ckP) review('W2', '没有 Cppcheck 运行记录：第 1 节写明 .cppcheck/last-run.json 的路径或加 --cppcheck')

// W2 告警甄别
const alarms = rowsAsObjects(findTable(sec('3', '工具告警甄别')?.body || '', ['告警编号', '判定']))
const problems = rowsAsObjects(findTable(sec('6', '问题清单')?.body || '', ['问题编号', '问题描述', '严重等级']))
const pIds = new Set(problems.map((p) => p['问题编号']))
const aIds = new Map(alarms.map((a) => [a['告警编号'], a]))
if (scan) for (const f of scan.findings) if (!aIds.has(f.id)) must('W2', `gjb-scan 的 ${f.id}（${f.file}:${f.line} ${f.rule}）没有在第 3 节甄别`)
if (ck) {
  const n = (ck.findings || []).length, rows = alarms.filter((a) => /^CK-/.test(a['告警编号'])).length
  if (rows !== n) must('W2', `Cppcheck 运行记录有 ${n} 条告警，第 3 节 CK- 行有 ${rows} 条：每条告警都要甄别（编号按运行记录顺序 CK-001…）`)
  ;(ck.findings || []).forEach((f, k) => {
    const id = `CK-${String(k + 1).padStart(3, '0')}`, a = aIds.get(id)
    if (a && f.line && !String(a['文件:行号'] || '').endsWith(`:${f.line}`)) review('W2', `${id} 的行号与运行记录不一致（运行记录 ${f.file}:${f.line}）`)
  })
}
for (const a of alarms) {
  const id = a['告警编号'], j = a['判定']
  if (!/^(违反|问题|误报|特殊设计)$/.test(j)) must('W2', `${id} 的判定是“${j}”，只能是 违反 / 问题 / 误报 / 特殊设计`)
  if (/^(误报|特殊设计)$/.test(j) && (blank(a['理由']) || a['理由'].length < 6)) must('W2', `${id} 判定为${j}，理由没写清（写明为什么不成立或设计依据）`)
  if (/^(违反|问题)$/.test(j)) {
    const refs = (a['对应问题'] || '').match(/WT-\d+/g) || []
    if (!refs.length) must('W2', `${id} 判定为${j}，“对应问题”没写问题编号`)
    for (const r of refs) if (!pIds.has(r)) must('W2', `${id} 对应的 ${r} 不在第 6 节问题清单中`)
  }
  if (j === '特殊设计' && !/\d+(\.\d+)+|D-\d+|设计/.test(a['理由'] || '')) review('W2', `${id} 判定为特殊设计，理由中没有设计依据（详细设计条目号）`)
}

// W3 问题清单
const RULE = /^R-1-\d+-\d+$|^[A-E]\d+$|^5\.\d$/
const VAGUE = /^(建议修改|修改|按规范修改|进行相应修改|完善|优化)。?$/
for (const p of problems) {
  const id = p['问题编号']
  if (!/^WT-\d{3,}$/.test(id)) must('W3', `问题编号“${id}”格式应为 WT-001`)
  if (!/^[^\s:]+:\d+$/.test(p['文件:行号'] || '')) must('W3', `${id} 的“文件:行号”写成了“${p['文件:行号']}”，应为 src/a.c:57`)
  if (!/^(Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ)级$/.test((p['严重等级'] || '').replace(/\s/g, ''))) must('W3', `${id} 的严重等级是“${p['严重等级']}”，只能是 Ⅰ级～Ⅴ级（纯建议写进第 7 节）`)
  if (!/^(程序问题|文档问题|设计问题|其它问题)$/.test(p['问题类别'] || '')) must('W3', `${id} 的问题类别是“${p['问题类别']}”，只能是 程序问题 / 文档问题 / 设计问题 / 其它问题`)
  if (blank(p['修改建议']) || VAGUE.test(p['修改建议'])) must('W3', `${id} 的修改建议没写具体改法`)
  const items = (p['检查项'] || '').split(/[、,，\s]+/).filter(Boolean)
  if (!items.length || !items.some((x) => RULE.test(x) || /^Cppcheck/.test(x))) review('W3', `${id} 的检查项“${p['检查项']}”不是规则编号（R-1-x-x）、检查表编号（A1～E4）或专项节号（5.x）`)
  if (!/^(人工|gjb-scan|编译|Cppcheck:\S+)$/.test(p['来源'] || '')) review('W3', `${id} 的来源是“${p['来源']}”，应为 人工 / gjb-scan / 编译 / Cppcheck:<规则ID>`)
  if (root) {
    const [f, l] = (p['文件:行号'] || '').split(/:(?=\d+$)/)
    const fp = resolve(root, f || '')
    if (f && !existsSync(fp)) must('W3', `${id} 的文件 ${f} 在 ${root} 下不存在`)
    else if (f && Number(l) > readFileSync(fp, 'utf8').split('\n').length) must('W3', `${id} 的行号 ${l} 超出 ${f} 的行数`)
  }
}
const dup = problems.map((p) => p['问题编号']).filter((x, i, a) => a.indexOf(x) !== i)
if (dup.length) must('W3', `问题编号重复：${[...new Set(dup)].join('、')}`)

// W4 逐函数走查覆盖
const mods = rowsAsObjects(findTable(sec('4', '逐函数走查')?.body || '', ['模块/头文件名称', '是否通过审查']))
if (!mods.length) must('W4', '第 4 节没有逐函数走查表')
const modText = mods.map((m) => `${m['模块/头文件名称']} ${m['走查的函数'] || ''}`).join(' ')
for (const m of mods) {
  if (!/^(是|否)$/.test(m['是否通过审查'])) must('W4', `模块“${m['模块/头文件名称']}”的“是否通过审查”只能写 是 / 否`)
  if (m['是否通过审查'] === '否' && !/WT-\d+/.test(m['说明'] || '')) must('W4', `模块“${m['模块/头文件名称']}”未通过审查，说明中没写问题编号`)
  if (blank(m['对应需求规格说明章节号'])) must('W4', `模块“${m['模块/头文件名称']}”没写对应需求规格说明章节号（没有对应需求的写“无对应需求”并说明）`)
}
const failedMods = new Set()
for (const p of problems) { const f = (p['文件:行号'] || '').split(':')[0].split('/').pop(); if (f) failedMods.add(f) }
if (met) {
  for (const f of met.files) { const b = f.file.split('/').pop(); if (!modText.includes(b) && !modText.includes(b.replace(/\.[ch]$/, ''))) must('W4', `文件 ${f.file} 没有出现在第 4 节逐函数走查表中`) }
  for (const m of met.modules) if (!new RegExp(`(^|[^\\w])${m.name}([^\\w]|$)`).test(modText)) must('W4', `函数 ${m.name}（${m.file}:${m.line}）没有出现在第 4 节“走查的函数”中`)
} else review('W4', '没有度量结果（metrics.mjs --json），无法核对逐函数走查是否覆盖全部函数')
for (const m of mods) {
  const b = (m['模块/头文件名称'].match(/[\w.]+\.[ch]\b/) || [])[0]
  if (b && failedMods.has(b) && m['是否通过审查'] === '是') review('W4', `${b} 有问题（第 6 节），但第 4 节写“通过审查”`)
}

// W5 专项检查
for (const n of ['5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7', '5.8']) {
  const s = S.find((x) => x.num === n)
  if (s && s.body.replace(/\|[\s|:-]*\|/g, '').replace(/<!--[\s\S]*?-->/g, '').trim().length < 4) must('W5', `专项检查 ${s.title} 没有内容（不涉及的写“不适用：<理由>”）`)
}
const conflict = findTable(sec('5.3', '数据访问冲突')?.body || '', ['共享资源名称', '是否存在冲突'])
if (!conflict && !/不适用/.test(sec('5.3', '数据访问冲突')?.body || '')) must('W5', '5.3 数据访问冲突检查没有检查表（没有中断的写“不适用：<理由>”）')
if (conflict) for (const r of rowsAsObjects(conflict)) {
  if (/是|存在/.test(r['是否存在冲突'] || '') && !/WT-\d+/.test(Object.values(r).join(' ')) && !/WT-\d+/.test(sec('5.3')?.body || '')) review('W5', `共享资源 ${r['共享资源名称']} 存在冲突，但没有对应问题编号`)
}

// W6 统计
const stat = Object.fromEntries(rowsAsObjects(findTable(sec('9', '统计')?.body || '', ['项目', '数量'])).map((r) => [r['项目'], r['数量']]))
const expect = {
  问题总数: problems.length,
  Ⅰ级问题: problems.filter((p) => p['严重等级'].startsWith('Ⅰ')).length,
  Ⅱ级问题: problems.filter((p) => p['严重等级'].startsWith('Ⅱ')).length,
  Ⅲ级问题: problems.filter((p) => p['严重等级'].startsWith('Ⅲ')).length,
  Ⅳ级问题: problems.filter((p) => p['严重等级'].startsWith('Ⅳ')).length,
  Ⅴ级问题: problems.filter((p) => p['严重等级'].startsWith('Ⅴ')).length,
  建议数: rowsAsObjects(findTable(sec('7', '走查建议')?.body || '', ['建议编号', '建议描述'])).length,
  工具告警总数: alarms.length,
  工具告警判定为违反或问题: alarms.filter((a) => /^(违反|问题)$/.test(a['判定'])).length,
  工具告警判定为误报: alarms.filter((a) => a['判定'] === '误报').length,
  工具告警判定为特殊设计: alarms.filter((a) => a['判定'] === '特殊设计').length,
  待确认问题数: rowsAsObjects(findTable(sec('8', '待确认问题')?.body || '', ['编号', '问题'])).length,
}
if (met) { expect['走查文件数'] = met.files.length; expect['走查函数数'] = met.modules.length; expect['代码行数'] = met.totals.code }
for (const [k, n] of Object.entries(expect)) {
  if (!(k in stat)) { must('W6', `第 9 节统计缺“${k}”一行`); continue }
  const got = Number(String(stat[k]).replace(/[^\d]/g, ''))
  if (got !== n) must('W6', `第 9 节“${k}”写 ${stat[k]}，按记录${k === '代码行数' ? '（metrics.mjs 的含代码的行）' : ''}应为 ${n}`)
}

// W7 措辞
const pqText = md
for (const m of pqText.matchAll(/(基本符合|基本满足|大致|可能存在一定|进行相应处理)/g)) review('W7', `出现含糊的说法“${m[1]}”：写清是什么、在哪里`)

// W8 报告
if (repP) {
  if (!existsSync(repP)) must('W8', `找不到报告 ${repP}`)
  else {
    const r = readText(repP)
    const RS = sections(r)
    for (const [n, t] of [['1', '范围'], ['1.1', '标识'], ['1.2', '文档概述'], ['1.3', '软件开发环境'], ['1.4', '软件运行环境'], ['2', '引用文件'], ['3', '走查过程'], ['3.1', '走查工具'], ['3.2', '走查结果'], ['4', '走查结果说明'], ['4.1', '功能需求审查结果说明'], ['4.2', '专项检查结果'], ['4.2.1', '新状态复核结果'], ['4.2.2', '安全关键功能检查结果'], ['4.2.3', '数据访问冲突检查结果'], ['4.2.4', '数据有效性判断设计检查结果'], ['4.2.5', '单粒子防护设计检查结果'], ['4.2.6', '时序检查结果'], ['4.2.7', '时间系统设计检查结果'], ['4.2.8', '编程、编译规范性检查结果'], ['5', '发现问题说明'], ['6', '测试总结']]) {
      if (!RS.some((s) => s.num === n && s.title.includes(t))) must('W8', `报告缺少“${n} ${t}”（报告应由 gen-wt-report.mjs 生成）`)
    }
    if (!RS.some((s) => /^附录A/.test(s.title))) must('W8', '报告缺少“附录A 走查问题及建议”')
    for (const p of problems) if (!r.includes(`软件问题报告单 ${p['问题编号']}`)) must('W8', `报告附录A 没有 ${p['问题编号']} 的问题报告单：记录改过后要重新生成报告`)
    const todo = r.split('\n').filter((l) => !l.trim().startsWith('<!--')).join('\n').split('【待补充】').length - 1
    if (todo) review('W8', `报告中还有 ${todo} 处【待补充】：有依据的填上，没有的告诉用户`)
    const m = /共 (\d+) 个问题/.exec(r)
    if (m && Number(m[1]) !== problems.length) must('W8', `报告第 5 章写 ${m[1]} 个问题，记录中有 ${problems.length} 个：重新生成报告`)
  }
}

// 输出
const n = out.filter((x) => x.level === '必须处理').length
console.log(`# 走查记录检查：${recP}\n`)
console.log(`工具告警 ${alarms.length} 条，问题 ${problems.length} 个，模块 ${mods.length} 个${scan ? `；gjb-scan ${scan.findings.length} 处` : ''}${ck ? `；Cppcheck ${(ck.findings || []).length} 条` : ''}${met ? `；函数 ${met.modules.length} 个` : ''}。`)
console.log(`必须处理 ${n} 项，复核 ${out.length - n} 项。\n`)
for (const lv of ['必须处理', '复核']) {
  const l = out.filter((x) => x.level === lv)
  if (!l.length) continue
  console.log(`## ${lv}\n`)
  for (const x of l) console.log(`- [${x.id}] ${x.msg}`)
  console.log('')
}
process.exit(n ? 1 : 0)
