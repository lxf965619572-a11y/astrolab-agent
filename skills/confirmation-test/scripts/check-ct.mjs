#!/usr/bin/env node
// 确认测试记录（和报告）检查：需求、测试要点、安全关键功能是否全覆盖，用例是否可判定，执行结果是否来自执行记录，统计和结论是否一致。
// 只读。“必须处理”项要改正；“复核”项逐条判断。
//
// 用法：node check-ct.mjs <确认测试记录.md> [--srs <需求规格说明.md>] [--report <确认测试报告.md>]
// 退出码：0 = 没有“必须处理”项；1 = 有；2 = 用法或文件错误

import { existsSync } from 'node:fs'
import { readRecord, readSRS, locate, isK, computeStats, RESULT, SEVERITY, CATEGORY, REQ_ID, blank } from './ct-data.mjs'
import { readText, sections } from './md-lib.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
let srsP = opt('--srs')
const repP = opt('--report')
if (argv.length !== 1) { console.error('用法：node check-ct.mjs <确认测试记录.md> [--srs <需求规格说明.md>] [--report <报告.md>]'); process.exit(2) }
const recP = argv[0]
if (!existsSync(recP)) { console.error(`找不到：${recP}`); process.exit(2) }

const out = []
const must = (id, msg) => out.push({ level: '必须处理', id, msg })
const review = (id, msg) => out.push({ level: '复核', id, msg })
const R = readRecord(recP)
srsP = srsP || locate(recP, R.info['需求规格说明'])
const SRS = srsP ? readSRS(srsP) : null
if (!SRS) must('C0', '找不到需求规格说明：第 1 节写明“需求规格说明”的路径或加 --srs，否则无法核对需求覆盖')
else if (!SRS.hasB1) review('C0', '需求规格说明没有附录B.1 逆向跟踪矩阵，需求清单是从全文收集的标识，可能不全')

// C1 章节和概述
for (const [n, t] of [['1', '概述'], ['2', '测试环境'], ['3', '测试要点'], ['4', '测试项目'], ['5', '公共操作说明'], ['6', '测试用例'], ['7', '不可测试项'], ['8', '问题报告单'], ['9', '待确认问题'], ['10', '统计']]) {
  if (!R.S.some((s) => s.num === n && s.title.includes(t.slice(0, 2)))) must('C1', `缺少章节“${n} ${t}”（照抄 references/ct-format.md）`)
}
for (const k of ['软件名称', '被测版本', '软件安全关键等级', '需求规格说明', '测试环境类型']) if (blank(R.info[k])) review('C1', `第 1 节缺“${k}”（不知道的写“【待补充】”）`)
if (!R.env.length) review('C1', '第 2 节没有测试环境及工具')

// C2 需求覆盖
const caseIds = new Set()
const ntReq = (id) => R.untestable.filter((n) => (n['需求标识'] || '').includes(id))
if (SRS) {
  for (const r of SRS.reqs.values()) {
    const cs = R.cases.filter((c) => c.reqs.includes(r.id))
    const nt = ntReq(r.id)
    if (!cs.length && !nt.length) must('C2', `需求 ${r.id}${r.name ? ` ${r.name}` : ''} 没有用例覆盖，也没有列为不可测试项`)
    if (cs.length && nt.length) review('C2', `需求 ${r.id} 既有用例又列为不可测试项（${nt.map((n) => n['编号']).join('、')}）：说明哪部分不可测`)
    if (isK(r.id, r.attr) && !cs.length) must('C2', `安全关键需求 ${r.id} 没有测试用例（安全关键功能必须专项测试；确实不可测的说明替代验证方式）`)
    if (isK(r.id, r.attr) && cs.length && !cs.some((c) => /安全|KeySafety|Safety/i.test(c.type + c.item))) review('C2', `安全关键需求 ${r.id} 的用例中没有安全性/安全关键专项测试类型`)
  }
  for (const c of R.cases) for (const id of c.reqs) if (!SRS.reqs.has(id)) must('C2', `${c.id} 的功能项 ${id} 不在需求规格说明中`)
}
for (const n of R.untestable) {
  if (blank(n['测试时机'])) must('C2', `不可测试项 ${n['编号']} 没写测试时机（在什么阶段、用什么方式验证）`)
  if (!(n['需求标识'] || '').match(REQ_ID)) review('C2', `不可测试项 ${n['编号']} 没写需求标识`)
}

// C3 测试要点
if (SRS && SRS.tps.length && R.points.length < SRS.tps.length) must('C3', `需求规格说明 7.4 有 ${SRS.tps.length} 条测试要点，第 3 节只有 ${R.points.length} 条`)
for (const t of R.points) {
  const cs = R.cases.filter((c) => c.points.includes(t['测试要点编号']))
  if (!cs.length && !/不可测试|NT-|本次未测试/.test(t['对应需求'] || '')) must('C3', `测试要点 ${t['测试要点编号']} 没有用例（不可测试的在“对应需求”写“不可测试（见 NT-xx）”）`)
}
for (const c of R.cases) for (const p of c.points) if (!R.points.some((t) => t['测试要点编号'] === p)) review('C3', `${c.id} 引用的测试要点 ${p} 不在第 3 节`)

// C4 用例
const VAGUE = /^(正常|正确|符合要求|满足要求|功能正常|结果正确|与预期一致|成功)。?$/
const dup = R.cases.map((c) => c.id).filter((x, i, a) => a.indexOf(x) !== i)
if (dup.length) must('C4', `用例标识重复：${[...new Set(dup)].join('、')}`)
const items = new Set(R.items.map((i) => i['测试项目标识']))
for (const c of R.cases) {
  caseIds.add(c.id)
  if (!c.item) must('C4', `${c.id} 没写测试项目`)
  else {
    if (!items.has(c.item)) review('C4', `${c.id} 的测试项目 ${c.item} 不在第 4 节`)
    if (!c.id.startsWith(`${c.item}-`) || !/-\d{3}$/.test(c.id)) review('C4', `${c.id} 的标识应为“${c.item}-三位序号”`)
  }
  if (!c.reqs.length) must('C4', `${c.id} 的功能项没有需求标识`)
  if (blank(c.f['依据'])) must('C4', `${c.id} 没写依据（需求规格说明或协议的章节号）`)
  if (!c.steps.length) must('C4', `${c.id} 没有步骤表`)
  for (const s of c.steps) {
    if (blank(s.expect)) must('C4', `${c.id} 步骤 ${s.no} 没写期望结果`)
    else if (VAGUE.test(s.expect.trim())) must('C4', `${c.id} 步骤 ${s.no} 的期望结果“${s.expect}”无法判定：写可观察的现象和数值`)
    if (blank(s.op)) must('C4', `${c.id} 步骤 ${s.no} 没写操作步骤`)
  }
  if (!c.steps.some((s) => /\d/.test(s.expect))) review('C4', `${c.id} 的期望结果中没有任何数值，确认结果可以判定`)
}
// 健壮性和强度
const robust = R.cases.filter((c) => c.robust)
if (!robust.length) must('C5', '没有健壮性测试用例（部门模板 3.2 要求）')
const allText = R.cases.map((c) => `${c.title} ${c.purpose} ${c.type} ${c.steps.map((s) => s.op).join(' ')}`).join(' ') + ' ' + R.questions.map((q) => q['问题']).join(' ')
for (const [k, re] of [['剔野', /剔野/], ['限幅', /限幅|超限|超出范围/], ['注入数据（超长、格式非法）', /注入|超长|格式非法|长度错/], ['强度（长时间、乱序指令、频繁复位、高频通讯）', /强度|长时间|乱序|频繁|高频/], ['部件故障（无数据、无效、超差）', /故障|无数据|无效|超差/], ['部件切换', /切换|切机/], ['重要数据保存与恢复', /恢复|保存/], ['通讯有效性（帧头、累加和、状态字）', /帧头|累加和|校验|状态字/]]) {
  if (!re.test(allText)) review('C5', `没有看到“${k}”方面的健壮性用例：适用的补上，不适用的在第 9 节说明`)
}

// C6 执行结果
const anyActual = R.cases.some((c) => c.steps.some((s) => !blank(s.actual)) || c.result)
const src = R.info['执行记录来源']
if (anyActual && blank(src)) must('C6', '用例中已有实际结果或测试结论，但第 1 节没有“执行记录来源”：实际结果只能由 ct-results.mjs --import 从执行记录表导入，不能手写')
for (const c of R.cases) {
  if (!c.result) continue
  if (!RESULT.test(c.result)) must('C6', `${c.id} 的测试结论“${c.result}”只能是 通过 / 不通过 / 未执行`)
  if (c.result === '通过' && c.steps.some((s) => blank(s.actual))) must('C6', `${c.id} 结论为通过，但有步骤没有实际结果`)
  if (c.result === '不通过') {
    if (blank(c.problem)) must('C6', `${c.id} 不通过，没有问题报告单编号`)
    else if (!R.problems.some((p) => c.problem.includes(p['问题编号']))) must('C6', `${c.id} 的问题报告单 ${c.problem} 不在第 8 节`)
  }
  if (c.result === '未执行' && blank(c.f['备注'])) must('C6', `${c.id} 未执行，备注中没写原因`)
}
if (anyActual) { const nores = R.cases.filter((c) => !c.result); if (nores.length) review('C6', `${nores.length} 个用例还没有测试结论：${nores.slice(0, 10).map((c) => c.id).join('、')}`) }

// C7 问题报告单
for (const p of R.problems) {
  const id = p['问题编号']
  if (!/^[A-Z0-9]+-V\d+\.\d+BUG-\d{3}$/i.test(id)) review('C7', `问题编号 ${id} 的格式应为“型号-版本BUG-编号”，如 TCUS-V1.00BUG-001`)
  if (!SEVERITY.test(p['严重等级'] || '')) must('C7', `${id} 的严重等级“${p['严重等级']}”只能是 致命问题/严重问题/一般问题/轻微问题/改进建议`)
  if (!CATEGORY.test(p['问题类别'] || '')) must('C7', `${id} 的问题类别“${p['问题类别']}”只能是 文档问题/设计问题/程序问题/其他问题`)
  if (blank(p['现象描述'])) must('C7', `${id} 没有现象描述`)
  if (!/^(下一版本更改|经认可不更改|待定)$/.test(p['处理方式'] || '')) must('C7', `${id} 的处理方式只能是 下一版本更改 / 经认可不更改 / 待定`)
  if (!caseIds.has(p['用例标识'])) review('C7', `${id} 的用例标识 ${p['用例标识']} 不在第 6 节`)
}

// C8 统计
const executed = R.cases.filter((c) => /^(通过|不通过)$/.test(c.result))
const expect = computeStats(R, SRS)
for (const [k, n] of Object.entries(expect)) {
  if (n === null) continue
  if (!(k in R.stats)) { must('C8', `第 10 节统计缺“${k}”一行`); continue }
  const got = Number(String(R.stats[k]).replace(/[^\d]/g, ''))
  if (got !== n) must('C8', `第 10 节“${k}”写 ${R.stats[k]}，按记录应为 ${n}（运行 ct-results.mjs --stats 自动更新）`)
}

// C9 报告
if (repP) {
  if (!existsSync(repP)) must('C9', `找不到报告 ${repP}`)
  else {
    const r = readText(repP), RS = sections(r)
    for (const [n, t] of [['1.1', '文档概述'], ['1.2', '软件配置项基本信息'], ['1.3', '缩略语定义'], ['2.1', '规范性引用文件'], ['2.2', '研制依据引用文件'], ['3.1', '测试环境及工具'], ['3.2', '测试说明'], ['3.3', '测试用例统计'], ['3.4', '测试要点跟踪'], ['3.5', '不可测试项跟踪'], ['3.6', '安全关键功能'], ['4.1', '测试结果分析'], ['4.2', '测试结论']]) {
      if (!RS.some((s) => s.num === n && s.title.includes(t))) must('C9', `报告缺少“${n} ${t}”（报告应由 gen-ct-report.mjs 生成）`)
    }
    for (const a of ['附录A', '附录B', '附录C', '附录D', '附录E', '附录F']) if (!RS.some((s) => s.title.startsWith(a))) must('C9', `报告缺少${a}`)
    for (const c of R.cases) if (!r.includes(`${c.id} 测试记录表`)) { must('C9', `报告附录B 没有 ${c.id}：记录改过后要重新生成报告`); break }
    const m = /共执行了 (\d+) 个用例/.exec(r)
    if (m && Number(m[1]) !== executed.length) must('C9', `报告 3.3 写执行 ${m[1]} 个用例，记录中是 ${executed.length} 个：重新生成报告`)
    if (/本次测试通过/.test(r) && (R.cases.some((c) => c.result === '不通过' && R.problems.some((p) => c.problem.includes(p['问题编号']) && p['处理方式'] === '待定')) || R.cases.some((c) => !c.result || c.result === '未执行'))) must('C9', '报告结论写“本次测试通过”，但仍有未执行的用例或处理方式待定的问题')
    const todo = r.split('\n').filter((l) => !l.trim().startsWith('<!--')).join('\n').split('【待补充】').length - 1
    if (todo) review('C9', `报告中还有 ${todo} 处【待补充】：有依据的填上，没有的告诉用户`)
  }
}

const n = out.filter((x) => x.level === '必须处理').length
console.log(`# 确认测试记录检查：${recP}\n`)
console.log(`需求 ${SRS ? SRS.reqs.size : '?'} 条，测试要点 ${R.points.length} 条，用例 ${R.cases.length} 个（健壮性 ${robust.length}，已执行 ${executed.length}），不可测试项 ${R.untestable.length} 项，问题报告单 ${R.problems.length} 张。`)
console.log(`必须处理 ${n} 项，复核 ${out.length - n} 项。\n`)
for (const lv of ['必须处理', '复核']) {
  const l = out.filter((x) => x.level === lv)
  if (!l.length) continue
  console.log(`## ${lv}\n`)
  for (const x of l) console.log(`- [${x.id}] ${x.msg}`)
  console.log('')
}
process.exit(n ? 1 : 0)
