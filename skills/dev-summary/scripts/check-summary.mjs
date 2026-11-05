#!/usr/bin/env node
// 研制信息表（和研制总结报告）检查：按部门“软件研制总结报告评审要点”，核对事实的出处、版本、日期顺序、实测值、
// 更改和数据包、覆盖性、产保确认的合计、固化语气、结论等。只读。“必须处理”项要改正；“复核”项逐条判断。
//
// 用法：node check-summary.mjs <研制信息表.md> [--report <研制总结报告.md>]
// 退出码：0 = 没有“必须处理”项；1 = 有；2 = 用法或文件错误

import { existsSync } from 'node:fs'
import { readSheet, classOf, ELEMENTS, PROCESS_CHECKS, SHEET, TODO } from './sum-data.mjs'
import { readText, sections } from './md-lib.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const repP = opt('--report')
if (argv.length !== 1) { console.error('用法：node check-summary.mjs <研制信息表.md> [--report <研制总结报告.md>]'); process.exit(2) }
const sheetP = argv[0]
for (const p of [sheetP, repP].filter(Boolean)) if (!existsSync(p)) { console.error(`找不到：${p}`); process.exit(2) }

const out = []
const must = (id, msg) => out.push({ level: '必须处理', id, msg })
const review = (id, msg) => out.push({ level: '复核', id, msg })

const S = readSheet(sheetP)
const MARK = /〔(自动|来源|用户提供)[^〕]*〕/g
const clean = (v) => String(v ?? '').replace(MARK, '').trim()
const filled = (v) => { const c = clean(v); return !!c && !/待补充/.test(c) && !/^(—|-|–)$/.test(c) }
const isNoneV = (v) => /^(无|未参加|—|-|–)$/.test(clean(v))
const num = (v) => { const m = /-?\d+(\.\d+)?/.exec(clean(v)); return m ? Number(m[0]) : NaN }
const isNoneRow = (r) => Object.entries(r).filter(([k]) => k !== '序号').map(([, v]) => clean(v)).filter(Boolean).every((v) => isNoneV(v))
const realRows = (t) => S.t(t).filter((r) => !isNoneRow(r) && Object.entries(r).some(([k, v]) => k !== '序号' && filled(v)))
const cls = classOf(clean(S.basic['研制类型']))
const B = (k) => clean(S.basic[k])

// ---- K1 研制类型和基本信息
if (!['I', 'III', 'IV'].includes(cls)) must('K1', `研制类型“${B('研制类型')}”无法识别：只支持Ⅰ类、Ⅲ类、Ⅳ类`)
for (const k of ['软件名称', '软件代号', '安全关键等级', '验收版本', '软件版本列表', '固化状态', ...(cls === 'I' ? ['被沿用软件名称', '被沿用软件代号和版本'] : ['继承基线'].filter(() => cls === 'III'))]) {
  if (!filled(S.basic[k])) must('K1', `基本信息“${k}”还没有填写`)
}
if (cls === 'IV' && filled(S.basic['继承基线']) && !/^无/.test(B('继承基线'))) review('K1', `Ⅳ类是全新研制，继承基线写的是“${B('继承基线')}”：确认研制类型`)

// ---- K2 出处：表中填了事实的行要有出处标记（模板预置的名称列不算事实）
const PRESET = new Set(['序号', '要素类型', '要素名称', '检查内容', '关键质量控制点', '研制过程关键点', '执行情况', '名称', '完成标志', '类别', '项目', '测试项目', '功能要求', '性能要求', '需求标识', '可靠性安全性要求', '飞行阶段', '测试方法'])
const SKIP_PROV = new Set(['基本信息', '其他文字', '第三方评测结论'])
let noProv = 0
const noProvAt = []
for (const [secNum, title] of SHEET) {
  const s = { num: secNum }
  for (const r of S.t(title)) {
    const facts = Object.entries(r).filter(([k, v]) => !PRESET.has(k) && filled(v) && !isNoneV(v))
    if (!facts.length || Object.values(r).some((v) => /〔(自动|来源|用户提供)/.test(v || ''))) continue
    if (SKIP_PROV.has(title)) continue
    noProv++; if (noProvAt.length < 8) noProvAt.push(`${s.num || ''} ${title} 第 ${r['序号'] || '?'} 行`)
  }
}
for (const k of [...Object.keys(S.basic), ...Object.keys(S.text), ...Object.keys(S.third)]) {
  const v = S.basic[k] ?? S.text[k] ?? S.third[k]
  if (['研制类型', '编程语言', '需求规格说明'].includes(k) || !filled(v) || isNoneV(v)) continue
  if (!/〔(自动|来源|用户提供)/.test(v)) { noProv++; if (noProvAt.length < 8) noProvAt.push(`“${k}”`) }
}
if (noProv) must('K2', `有 ${noProv} 处填了内容但没有出处标记（${noProvAt.join('、')}${noProv > noProvAt.length ? ' 等' : ''}）：从数据包文件摘录的标“〔来源：文件名 章节/页〕”，用户给出的标“〔用户提供〕”；没有出处的改回【待补充】问用户`)

// ---- K3 版本
const versions = B('软件版本列表').split(/[、,，\s]+/).filter((v) => /\d/.test(v))
const ver = B('验收版本')
if (versions.length && filled(S.basic['验收版本'])) {
  if (!versions.includes(ver)) must('K3', `验收版本 ${ver} 不在软件版本列表（${versions.join('、')}）中`)
  else if (versions.at(-1) !== ver) review('K3', `验收版本 ${ver} 不是版本列表中的最后一个（${versions.at(-1)}）：验收版本一般为最终版本`)
}
if (versions.length) {
  const vcols = [['走查情况', '软件版本'], ['静态分析情况', '软件版本'], ['单元测试情况', '版本号'], ['组装测试情况', '版本号'], ['配置项测试情况', '版本号'], ['单机测试情况', '软件版本'], ['分系统测试情况', '软件版本'], ['分系统间联试情况', '软件版本'], ['第三方评测过程', '版本号'], ['第三方评测问题', '发现问题的软件版本'], ['版本更改', '更改前版本号'], ['版本更改', '更改后版本号']]
  const bad = new Set()
  for (const [t, c] of vcols) for (const r of realRows(t)) { const v = clean(r[c]); if (filled(r[c]) && /\d/.test(v) && !versions.some((x) => v.includes(x))) bad.add(`${t}：${v}`) }
  if (bad.size) must('K3', `以下版本不在软件版本列表中：${[...bad].join('；')}`)
  if (cls !== 'I') for (const [t, what] of [['配置项测试情况', '配置项（确认）测试']]) {
    const tested = new Set(realRows(t).map((r) => clean(r['版本号'])))
    if (tested.size && !tested.has(ver)) must('K3', `验收版本 ${ver} 没有${what}记录`)
  }
}

// ---- K4 日期顺序
const toDate = (v) => {
  const c = clean(v); let m
  if ((m = /(\d{4})\s*[-./年]\s*(\d{1,2})\s*[-./月]\s*(\d{1,2})/.exec(c))) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])
  if ((m = /\b(\d{4})(\d{2})(\d{2})\b/.exec(c))) return Number(m[0])
  if ((m = /(\d{4})\s*[-./年]\s*(\d{1,2})/.exec(c))) return Number(m[1]) * 10000 + Number(m[2]) * 100
  return NaN
}
for (const [t, c, what] of [['技术流程关键点', '时间', '技术流程'], ['出入库情况', '审批日期', '出入库'], ['关键质量控制点评审', '日期', '评审']]) {
  const ds = realRows(t).map((r) => ({ r, d: toDate(r[c]) })).filter((x) => Number.isFinite(x.d))
  for (let i = 1; i < ds.length; i++) if (ds[i].d < ds[i - 1].d) { review('K4', `${what}的日期不是按时间顺序：第 ${ds[i - 1].r['序号']} 行 ${clean(ds[i - 1].r[c])}，第 ${ds[i].r['序号']} 行 ${clean(ds[i].r[c])}（按时间排，或核对日期）`); break }
}
const allDates = [...realRows('技术流程关键点').map((r) => r['时间']), ...realRows('关键质量控制点评审').map((r) => r['日期']), ...realRows('出入库情况').map((r) => r['审批日期'])].map(toDate).filter(Number.isFinite)
const sumReview = realRows('关键质量控制点评审').find((r) => /研制总结/.test(r['关键质量控制点']))
if (sumReview && Number.isFinite(toDate(sumReview['日期'])) && allDates.some((d) => d > toDate(sumReview['日期']))) review('K4', '研制总结报告评审日期早于其他节点的日期：核对')

// ---- K5 评审节点
const NODES = { I: ['沿用状态复核'], III: ['任务书', '状态复核', '需求', '回归测试', '第三方'], IV: ['任务书', '需求', '配置项测试', '第三方'] }[cls] || []
const rv = S.t('关键质量控制点评审').map((r) => clean(r['关键质量控制点']))
for (const n of NODES) if (!rv.some((x) => x.includes(n))) must('K5', `关键质量控制点评审中没有“${n}”相关的评审（${cls === 'III' ? 'Ⅲ类' : cls === 'IV' ? 'Ⅳ类' : 'Ⅰ类'}的评审节点见 summary-format.md）`)
if (cls === 'III' && rv.some((x) => /配置项测试评审/.test(x))) review('K5', 'Ⅲ类的评审节点是“软件回归测试评审”，不是“配置项测试评审”：核对')
for (const r of realRows('关键质量控制点评审')) if (/《XX》/.test(r['完成标志'] || '')) must('K5', `“${clean(r['关键质量控制点'])}”的完成标志还是模板示例《XX》：写评审的文件名称、版本和编号`)

// ---- K6 功能性能符合情况
if (cls !== 'I') {
  const fn = realRows('功能符合情况'), pf = realRows('性能符合情况')
  if (!fn.length) must('K6', '功能符合情况（12.1）没有内容')
  for (const r of fn) if (!/^(符合|不符合|部分符合)$/.test(clean(r['符合情况']))) must('K6', `功能“${clean(r['功能要求'])}”的符合情况未确定（填 符合 / 不符合）`)
  for (const r of pf) {
    const a = clean(r['实测情况'])
    if (!filled(r['实测情况'])) must('K6', `性能“${clean(r['性能要求'])}”没有实测数据`)
    else if (!/\d/.test(a) || a === clean(r['性能要求']) || /^(满足|符合|满足要求)/.test(a)) must('K6', `性能“${clean(r['性能要求'])}”的实测情况“${a}”不是实测值：写测出的数值（要求小于 1 s 的，写测出是多少 ms）`)
    if (!/^(符合|不符合|部分符合)$/.test(clean(r['符合情况']))) must('K6', `性能“${clean(r['性能要求'])}”的符合情况未确定`)
  }
  const bad = [...fn, ...pf].filter((r) => /不符合/.test(clean(r['符合情况'])))
  if (bad.length) review('K6', `有 ${bad.length} 项功能或性能“不符合”：验收版本仍不符合的，结论不能写“满足任务书要求”；中间版本不符合、后来改好的应以验收版本的结果为准`)

  // ---- K7 版本更改
  const ch = realRows('版本更改')
  if (versions.length > 1 && ch.length < versions.length - 1) must('K7', `版本列表有 ${versions.length} 个版本，版本更改只有 ${ch.length} 行：每次更改写一行`)
  if (versions.length === 1 && ch.length) review('K7', '只有 1 个版本，却有版本更改记录：核对版本列表')
  for (const r of ch) {
    if (/^(无|无影响)。?$/.test(clean(r['更改影响']))) must('K7', `${clean(r['更改前版本号'])}→${clean(r['更改后版本号'])} 的更改影响只写了“${clean(r['更改影响'])}”：写影响了哪些功能、模块，为什么没有其他影响`)
    if (!filled(r['测试验证情况'])) must('K7', `${clean(r['更改前版本号'])}→${clean(r['更改后版本号'])} 没有写测试验证情况（经过了哪些测试）`)
  }
}

// ---- K8 数据包
const pkg = S.t('软件数据包').filter((r) => filled(r['名称']) && !isNoneRow(r))
const pkgNames = pkg.map((r) => clean(r['名称']))
const NEED = { I: ['研制总结报告', '产品履历书', '质量证明书'], III: ['配置管理计划', '产品保证计划', '任务书', '需求规格说明', '研制总结报告', '产品履历书', '质量证明书', '更动影响域分析报告', '回归测试报告'], IV: ['开发计划', '配置管理计划', '产品保证计划', '任务书', '需求规格说明', '设计', '单元测试报告', '组装测试报告', '配置项测试报告', '研制总结报告', '产品履历书', '质量证明书'] }[cls] || []
for (const n of NEED) if (!pkgNames.some((x) => x.includes(n) || (n === '产品保证计划' && x.includes('质量保证计划')))) must('K8', `软件数据包中没有“${n}”`)
const pkgTodo = pkg.filter((r) => !filled(r['代号']) || !filled(r['版本'])).length
if (pkgTodo) review('K8', `软件数据包有 ${pkgTodo} 份文档的代号或版本未填：实际没有的文档删去该行并在备注说明原因`)
if (cls === 'III') {
  const chg = realRows('版本更改'), n = chg.length, imp = pkgNames.filter((x) => /更动影响域/.test(x)).length
  // 第一行就是从继承基线改出第一个版本（更改前是基线或版本列表的第一个），它的影响域分析已在 n 份里；否则第一个版本还要单独一份
  const before0 = chg.length ? clean(chg[0]['更改前版本号']) : ''
  const fromBase = !!before0 && (/基线/.test(before0) || (versions.length > 0 && before0.startsWith(versions[0])))
  const need = fromBase ? n : n + 1
  if (imp < need) review('K8', `Ⅲ类第一个版本和每次更动都有更动影响域分析报告和回归测试报告：版本更改 ${n} 次${fromBase ? '（第一次是从继承基线改出）' : ''}，数据包中更动影响域分析报告 ${imp} 份（应有 ${need} 份）`)
}

// ---- K19 评审日期不能早于被评审的文档：评审行里的文件编号在数据包里找，数据包那一行写的日期晚于评审日期就提示（不要自己改，问用户）
{
  const datesIn = (t) => (clean(t).match(/\d{4}\s*[-./年]\s*\d{1,2}\s*[-./月]\s*\d{1,2}/g) || []).map(toDate).filter(Number.isFinite)
  for (const r of realRows('关键质量控制点评审')) {
    const d = toDate(r['日期'])
    if (!Number.isFinite(d) || /计划/.test(clean(r['日期']))) continue
    const codes = new Set(Object.values(r).join(' ').match(/[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){2,}/g) || [])
    for (const code of codes) {
      const p = pkg.find((x) => clean(x['代号']) === code)
      if (!p) continue
      const later = datesIn(Object.values(p).join(' ')).filter((x) => x > d)
      if (later.length) review('K19', `“${clean(r['关键质量控制点'])}”评审日期 ${clean(r['日期'])} 早于被评审文档 ${code} 在软件数据包中的日期（${String(later[0]).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}）：评审不能早于文档完成，列入问用户的清单核对，不要自己改日期`)
    }
  }
}

// ---- K9 开发方测试
if (cls !== 'I') {
  const ut = realRows('单元测试情况')
  const lv = B('安全关键等级')
  if (/^[AB]/.test(lv) && ut.length) {
    const low = realRows('单元测试未达覆盖率模块')
    for (const r of low) if (!filled(r['原因分析'])) must('K9', `单元测试未达覆盖率模块 ${clean(r['模块名称'])} 没有原因分析（A、B 级软件三覆盖应达 100%，没达到的逐个分析）`)
  }
  if (cls === 'III') for (const t of ['单元测试情况', '组装测试情况', '配置项测试情况']) for (const r of realRows(t)) if (filled(r['测试类型']) && !/回归/.test(clean(r['测试类型'])) && versions.indexOf(clean(r['版本号'])) > 0) review('K9', `Ⅲ类 ${t.replace('情况', '')} ${clean(r['版本号'])} 的测试类型是“${clean(r['测试类型'])}”：更改后的版本一般为回归测试`)
  if (!realRows('组装测试情况').length && !S.t('组装测试情况').some(isNoneRow)) review('K9', '组装测试情况未填：组装测试合并到确认测试进行的，写一行并说明原因（章节不删）')
}

// ---- K10 系统级测试
const sys = realRows('系统测试情况')
if (sys.length && sys.every((r) => ['电性综合测试', 'EMC试验', '力学试验', '振后总检查', '热试验', '热试验后总检查', '磁试验', '老练试验'].every((k) => !filled(r[k]) || isNoneV(r[k])))) review('K10', '系统测试情况每项都是空或“—”：整体没参加的写一行“未参加”')
for (const t of ['单机测试情况', '分系统测试情况', '分系统间联试情况']) for (const r of realRows(t)) if (!filled(r['测试时间']) || !filled(r['软件版本'])) must('K10', `${t.replace('情况', '')}“${clean(r['测试名称'])}”缺测试时间或软件版本（跟产品负责人要）`)

// ---- K11 第三方评测
if (cls !== 'I') {
  const tq = realRows('第三方评测问题')
  const ENUM = { 问题类型: /^(设计问题|程序问题|文档问题|其它问题|其他问题)$/, 测试方法: /^(静态分析|人工走查|动态测试)$/, 更改性质: /^(修改程序|修改文档|修改程序和文档|不做处理)$/ }
  for (const r of tq) for (const [k, re] of Object.entries(ENUM)) if (!re.test(clean(r[k]))) must('K11', `第三方评测问题 ${clean(r['问题单号']) || r['序号']} 的${k}“${clean(r[k])}”不在规定取值中（报告的统计表按它计算）`)
  if (realRows('第三方评测过程').length && !filled(S.third['评测结论原文'])) must('K11', '有第三方评测，但没有评测结论原文（照抄评测方给出的结论）')
  for (const r of tq) if (/修改/.test(clean(r['更改性质'])) && !filled(r['确认结果'])) review('K11', `第三方评测问题 ${clean(r['问题单号'])} 已修改但没有确认结果`)
}

// ---- K12 覆盖性
if (cls !== 'I') {
  const cov = realRows('测试覆盖性'), nFP = realRows('功能符合情况').length + realRows('性能符合情况').length
  if (cov.length && nFP && cov.length !== nFP) must('K12', `测试覆盖性有 ${cov.length} 项，功能和性能符合情况共 ${nFP} 项：个数应相同`)
  const sysCols = ['单机/分系统测试', '分系统间联试', '系统测试']
  if (cov.length > 2 && cov.every((r) => sysCols.every((k) => clean(r[k]) === '√'))) review('K12', '测试覆盖性在单机/分系统、分系统间联试、系统测试列全部打“√”：分系统和整星上很多项目测不了，逐项核对')
  for (const r of cov) if (!/^(√|—|-)$/.test(clean(r['配置项测试']))) review('K12', `测试项目“${clean(r['测试项目'])}”的配置项测试一列未确定`)
}

// ---- K13 举一反三、归零
if (!realRows('举一反三').length) review('K13', '举一反三没有内容：一般都应该有，与本型号其他软件一致，措施要针对本软件')
for (const r of realRows('质量问题归零')) if (!/已归零|已完成/.test(clean(r['归零状态']))) review('K13', `质量问题“${clean(r['质量问题名称'])}”的归零状态是“${clean(r['归零状态'])}”`)

// ---- K14 可靠性安全性措施
if (cls !== 'I') {
  const rs = realRows('可靠性安全性设计与验证')
  if (!rs.length) must('K14', '可靠性安全性设计与验证没有内容')
  for (const r of rs) {
    const m = clean(r['可靠性安全性措施'])
    if (!filled(r['可靠性安全性措施'])) must('K14', `“${clean(r['可靠性安全性要求'])}”没有写措施`)
    else if (/结构化设计|满足要求|严格按照|按照.*要求设计|充分考虑/.test(m) || m.length < 8) review('K14', `措施“${m}”过于笼统：写实际可落实的措施（如“对 XX、XX 等重要数据进行三取二处理”）`)
  }
}

// ---- K15 出入库
const io = realRows('出入库情况')
if (!io.length) must('K15', '出入库情况没有内容')
else {
  const first = clean(io[0]['出入库说明'])
  if (cls === 'III' && !/基线.*出库|出库.*基线/.test(first)) must('K15', `Ⅲ类出入库第一行应是基线软件出库，现在是“${first}”`)
  if (cls === 'I' && !/被沿用|沿用/.test(first)) review('K15', `Ⅰ类出入库第一行一般是被沿用软件出产品库，现在是“${first}”`)
  for (const r of io) if (filled(r['出入库对象']) && !/工程包|编程文件|可执行|源代码|文档|\.(hex|bin|srec|mcs)/i.test(clean(r['出入库对象']))) review('K15', `出入库对象“${clean(r['出入库对象'])}”没写清是工程包、编程文件还是文档`)
  if (!io.some((r) => /产品库/.test(clean(r['出入库说明'])))) review('K15', '出入库情况中没有入产品库的记录')
}

// ---- K16 产保要素确认、研制过程确认
const sumCheck = (title, nameCol, label) => {
  const rs = S.t(title).filter((r) => filled(r[nameCol]) || filled(r['要素类型']))
  let all = 0, ok = 0, badRows = []
  for (const r of rs) {
    const [n, a, b, c] = ['检查项数量', '满足', '不满足', '不适用'].map((k) => num(r[k]))
    if (![n, a, b, c].every(Number.isFinite)) continue
    all++
    if (a + b + c !== n) badRows.push(`${clean(r[nameCol]) || clean(r['要素类型'])}（${a}+${b}+${c}≠${n}）`)
    else ok++
    const [t, o, cl] = ['待办事项数量', '未闭环', '已闭环'].map((k) => num(r[k]))
    if ([t, o, cl].every(Number.isFinite) && o + cl !== t) badRows.push(`${clean(r[nameCol])} 待办（${o}+${cl}≠${t}）`)
    if (Number.isFinite(b) && b > 0 && !(Number.isFinite(t) && t > 0)) review('K16', `${label}“${clean(r[nameCol])}”有 ${b} 项不满足但没有待办事项：说明不满足的处理`)
  }
  if (badRows.length) must('K16', `${label}合计对不上：${badRows.join('；')}`)
  if (all < rs.length) must('K16', `${label}还有 ${rs.length - all} 行的检查项数量、满足、不满足、不适用没有填（数据从产保要素确认表、研制过程确认表摘录）`)
  if (all && all === rs.length && rs.every((r) => num(r['不满足']) === 0 && num(r['不适用']) === 0)) review('K16', `${label}全部满足、没有不适用项：一般不对，核对确认表`)
  if (rs.some((r) => num(r['未闭环']) > 0)) review('K16', `${label}有未闭环的待办事项：验收前应闭环，或说明处理计划`)
}
if (cls !== 'I') {
  sumCheck('产保技术要素确认', '要素名称', '产保技术要素确认')
  sumCheck('研制过程确认', '检查内容', '研制过程确认')
  const names = S.t('产保技术要素确认').map((r) => clean(r['要素名称']))
  for (const [, n] of ELEMENTS.filter(([, n]) => n)) if (!names.includes(n)) must('K16', `产保技术要素确认缺少通用要素“${n}”`)
  const pc = S.t('研制过程确认').map((r) => clean(r['检查内容']))
  for (const n of PROCESS_CHECKS) if (!pc.includes(n)) must('K16', `研制过程确认缺少检查内容“${n}”`)
}

// ---- K17 固化
const fx = B('固化状态')
if (filled(S.basic['固化状态'])) {
  if (!/^(未固化|已固化)$/.test(fx)) must('K17', `固化状态写“未固化”或“已固化”，现在是“${fx}”`)
  if (fx === '已固化') for (const k of ['固化日期', '装机后测试日期', '装机后测试结论']) if (!filled(S.basic[k])) must('K17', `已固化，但“${k}”未填`)
}

// ---- K18 模板示例残留、待补充
const sheetText = S.md.split('\n').filter((l) => !/^说明：/.test(l) && !/^研制类型：/.test(l)).join('\n')
const xx = (sheetText.match(/XX/g) || []).length
if (xx) review('K18', `信息表中还有 ${xx} 处模板示例“XX”：换成实际名称`)
const todo = sheetText.split(TODO).length - 1
if (todo) review('K18', `信息表中还有 ${todo} 处【待补充】：从数据包文件中找；找不到的列清单问用户`)

// ---- 报告
if (repP) {
  const r = readText(repP)
  const body = r.split('\n').filter((l) => !l.trim().startsWith('<!--')).join('\n')
  const RS = sections(r)
  if (/〔(自动|来源|用户提供)/.test(body)) must('R1', '报告中有出处标记〔…〕：报告应由 gen-summary.mjs 生成，不手抄信息表')
  const need = cls === 'I'
    ? [['1', '概述'], ['2', '引用文件'], ['3', '技术流程执行情况'], ['4', '软件测试情况'], ['5', '质量问题归零'], ['6', '配置管理'], ['7', '软件固化落焊'], ['8', '结论']]
    : [['1', '概述'], ['2', '引用文件'], ['3', '技术流程执行情况'], ['4', '软件技术状态'], ['5', '软件测试情况'], ['5.1.1', '走查'], ['5.1.2', '静态分析'], ['5.1.3', '单元测试'], ['5.1.4', '组装测试'], ['5.1.5', '确认测试'], ['5.6', '测试覆盖性'], ['6', '质量问题归零'], ['7', '可靠性安全性'], ['8', '配置管理'], ['9', '软件产品保证总结'], ['10', '软件固化落焊'], ['11', '结论']]
  for (const [n, t] of need) if (!RS.some((s) => s.num === n && s.title.includes(t))) must('R2', `报告缺少“${n} ${t}”（报告应由 gen-summary.mjs 生成；不适用的章节也保留，写明原因）`)
  if (cls !== 'I') for (const a of ['附录A', '附录B', '附录C', '附录D', '附录E']) if (!RS.some((s) => s.title.startsWith(a))) must('R2', `报告缺少${a}`)
  const sec = (t) => { const s = RS.find((x) => x.title.includes(t) && /^\d+$/.test(x.num)); return s ? s.body : '' }
  const fix = sec('软件固化落焊')
  if (/未/.test(fx)) {
    if (/了/.test(fix)) must('R3', '软件未固化，固化落焊一章中出现“了”：未固化的按计划写，语气为“应……”')
    if (!/应/.test(fix)) must('R3', '软件未固化，固化落焊一章没有用“应……”的语气')
  } else if (fx === '已固化' && /应采用/.test(fix)) must('R3', '软件已固化，固化落焊一章还是计划语气：写具体时间和过程')
  const concl = sec('结论').split('\n').filter((l) => !l.trim().startsWith('<!--')).join('\n')
  if (concl) {
    if (filled(S.basic['软件代号']) && !concl.includes(B('软件代号'))) must('R4', `结论中没有软件代号 ${B('软件代号')}：软件名称后带标识和版本号“XX软件（代号-版本）”`)
    if (filled(S.basic['验收版本']) && !concl.includes(ver)) must('R4', `结论中没有验收版本 ${ver}`)
    for (const [t, w] of [['系统测试情况', '系统测试'], ['第三方评测过程', '第三方评测'], ['分系统测试情况', '分系统测试'], ['单机测试情况', '单机测试']]) if (concl.includes(`${w}`) && !realRows(t).length && !(w === '系统测试' && /分系统测试/.test(concl) && !/[、，]系统测试/.test(concl))) must('R4', `结论写了通过“${w}”，但信息表中没有${w}记录：通过的测试按实际经过的写`)
  }
  const todoR = body.split(TODO).length - 1
  if (todoR) review('R5', `报告中还有 ${todoR} 处【待补充】：先补信息表再重新生成；属于文字说明的（结论、测试结论）在报告中写，写完再检查`)
  if (/【此处插入图/.test(body)) review('R5', '报告中有待插入的图（研制流程图、装机质量跟踪卡）：在 Word 中插入')
  if (/XX/.test(body.replace(/“XX软件（[^”]*”/g, ''))) review('R5', '报告中有模板示例“XX”：换成实际名称')
}

const n = out.filter((x) => x.level === '必须处理').length
console.log(`# 研制信息表检查：${sheetP}${repP ? `\n报告：${repP}` : ''}\n`)
console.log(`研制类型：${{ I: 'Ⅰ类', III: 'Ⅲ类', IV: 'Ⅳ类' }[cls] || '未知'}；版本 ${versions.join('、') || '未填'}，验收版本 ${ver || '未填'}。`)
console.log(`必须处理 ${n} 项，复核 ${out.length - n} 项。\n`)
for (const lv of ['必须处理', '复核']) {
  const l = out.filter((x) => x.level === lv)
  if (!l.length) continue
  console.log(`## ${lv}\n`)
  for (const x of l) console.log(`- [${x.id}] ${x.msg}`)
  console.log('')
}
process.exit(n ? 1 : 0)
