#!/usr/bin/env node
// G3 全流程验收（PDUS Ⅲ类更改）评分：对示例工程 g3-pdus/out/<环节> 下的产出，
// 重跑技能的检查脚本，按答案（README 第 5 节）逐项判断陷阱是否处理；判断不了的列为“人工”，给出要看的地方。
//
// 用法：node evals/g3-pdus/score.mjs <环节> [--ws <g3-pdus 目录>]
//       node evals/g3-pdus/score.mjs list
// 环节：需求 设计 走查 静态分析 追踪表 单元测试 确认测试 回归测试 研制总结
// 结果写在 evals/g3-pdus/results/<时间>-<环节>.md。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, sampleWorkspace } from '../sample-ws.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const ws = resolve(opt('--ws') || join(sampleWorkspace().dir, 'g3-pdus'))
const stage = argv[0]
const STAGES = ['需求', '设计', '走查', '静态分析', '追踪表', '单元测试', '确认测试', '回归测试', '研制总结']
if (!stage || stage === 'list') { console.log(`环节：${STAGES.join(' ')}\n用法：node evals/g3-pdus/score.mjs <环节> [--ws <g3-pdus 目录>]`); process.exit(0) }
if (!STAGES.includes(stage)) { console.error(`没有环节“${stage}”。环节：${STAGES.join(' ')}`); process.exit(2) }

const SK = join(ROOT, 'skills')
const MAT = join(ROOT, 'evals', 'g3-pdus', 'materials')
const RES = join(ROOT, 'evals', 'g3-pdus', 'results')

// ---------- 工具 ----------
function walk(d, out = []) {
  if (!existsSync(d)) return out
  for (const n of readdirSync(d)) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) { if (!/^(node_modules|\.git)$/.test(n)) walk(p, out) } else out.push({ p, n, t: s.mtimeMs }) }
  return out
}
const outDir = (sub) => join(ws, 'out', sub)
const find = (sub, re, not = /\.bak$/) => walk(outDir(sub)).filter((f) => re.test(f.n) && !not.test(f.n)).sort((a, b) => b.t - a.t)
const first = (sub, re, not) => find(sub, re, not)[0]?.p
const read = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n?/g, '\n') : '')
const rel = (p) => (p ? relative(ws, p).replace(/\\/g, '/') : '（没有）')
function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: ws })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const must = Number((/必须处理\s*(\d+)\s*项/.exec(out) || [])[1] ?? NaN)
  return { code: r.status, out, must }
}
const sha = (p) => createHash('sha1').update(readFileSync(p)).digest('hex')
/** 工作区中某目录是否与材料一致（没有被智能体改动） */
function unchanged(matRel, wsRel) {
  const a = join(MAT, matRel), b = join(ws, wsRel)
  const diff = []
  for (const f of walk(a)) { const r = relative(a, f.p); const q = join(b, r); if (!existsSync(q)) diff.push(`${r}（被删除）`); else if (sha(f.p) !== sha(q)) diff.push(r) }
  return diff
}
/** 文本中某段落（标题到下一个同级标题）的内容 */
function block(text, re) {
  const lines = text.split('\n'); let i = lines.findIndex((l) => /^#{1,6}\s/.test(l) && re.test(l)); if (i < 0) i = lines.findIndex((l) => re.test(l)); if (i < 0) return ''
  const lv = (/^(#+)/.exec(lines[i]) || ['', ''])[1].length
  // 标题开始的块到下一个同级或更高级标题；IPO 需求块（“需求标识：”开始）到下一个需求标识或任何标题
  const stop = lv ? (l) => new RegExp(`^#{1,${lv}}\\s`).test(l) : (l) => /^#{1,6}\s/.test(l) || /需求标识\s*[:：]/.test(l)
  let j = i + 1; while (j < lines.length && !stop(lines[j])) j++
  return lines.slice(i, j).join('\n')
}
const near = (text, a, b, win = 200) => { const ra = new RegExp(a, 'g'); let m; while ((m = ra.exec(text))) { const s = text.slice(Math.max(0, m.index - win), m.index + win); if (new RegExp(b).test(s)) return true } return false }

const items = []
const add = (id, item, ok, note = '', kind = '自动') => items.push({ id, item, ok, note, kind })
const manual = (id, item, note) => add(id, item, null, note, '人工')
const checkScript = (id, name, r) => add(id, `${name}“必须处理”为 0`, r.must === 0, Number.isNaN(r.must) ? `脚本输出：${r.out.split('\n').slice(0, 3).join(' ')}` : `必须处理 ${r.must} 项`)

// ---------- 各环节 ----------
const S = {}

S['需求'] = () => {
  const srs = first('需求', /需求规格说明.*\.md$/, /记录|\.bak$/), rec = first('需求', /需求分析记录.*\.md$/)
  add('F0', '找到需求规格说明和需求分析记录', !!(srs && rec), `${rel(srs)}；${rel(rec)}`)
  if (!srs) return
  checkScript('F0', 'check-report.mjs', run(join(SK, 'requirements-analysis/scripts/check-report.mjs'), [srs, ...(rec ? ['--record', rec] : [])]))
  const s = read(srs), r = read(rec), all = s + r
  const f5 = block(s, /需求标识：PDUS-FREQ005/) || (near(s, '0x35', '.') ? s.slice(s.indexOf('0x35'), s.indexOf('0x35') + 600) : '')
  add('Q1', '0x35 阈值格式矛盾（任务书 0.01 A vs 协议 1 字节 LSB 0.02 A）列为待确认问题', near(all, '0\\.02', '待确认|Q-\\d{3}', 400) || near(all, '1\\s*字节', '0x35.*待确认|待确认.*0x35', 300), '在记录的待确认问题中找“0.02”')
  add('Q1', '规格说明中 0x35 的阈值格式没有自行裁决（写【待确认】）', /待确认/.test(f5), f5 ? '' : '没有找到 0x35 的功能需求')
  add('Q2', '过流断电响应时间写成可测的性能需求（≤ 200 ms）', /PDUS-PREQ3\.\d[^\n]*200\s*ms|200\s*ms[^\n]*PDUS-PREQ3/.test(s))
  add('Q3', '阈值注入需求带 -K（安全关键）', /PDUS-FREQ\d{3}-KN?\b/.test(f5) || /PDUS-FREQ\d{3}-KN[^\n]*注入|注入[^\n]*PDUS-FREQ\d{3}-KN/.test(s))
  add('Q3', '测试要点包含阈值注入的边界或超范围拒收', near(block(s, /^#+\s*7\.4/), '边界|0\\.5|5\\.0|超范围|拒收', '.'))
  add('Q4', '基线需求标识沿用（FREQ001～004、FREQ011、FREQ012、FREQ021 都在）', ['FREQ001', 'FREQ002', 'FREQ003', 'FREQ004', 'FREQ011', 'FREQ012', 'FREQ021'].every((x) => s.includes(`PDUS-${x}`)))
  add('Q4', '被更改的需求在附录B.1 标为修改或新状态', /PDUS-FREQ012[^\n]*\|[^\n]*\b[MN]\b/.test(block(s, /附录\s*B\.1/)))
  add('加分', '提出断电计数是否掉电保持、是否清零（Q-003）', near(all, '断电计数|跳闸计数|过流计数', '掉电|上电清零|清零指令|保持', 150))
  const f5plain = f5.split('\n').filter((l) => !/待确认/.test(l)).join('\n')
  add('Q-编造', '注入需求没有直接采用协议 V1.0 的格式（1 字节、LSB 0.02 A、数据域长度 2），或采用时标了【待确认】', !/LSB\s*0\.02|1\s*字节|长度为\s*2|长度\s*2\b/.test(f5plain), '把未标【待确认】的行列出来人工看：' + (f5plain.match(/.*(LSB\s*0\.02|1\s*字节|长度为\s*2).*/g) || []).join(' / '))
  add('Q2', '响应时间的计时起点列为待确认（任务书没写起点）', near(r, '起点|起始|计时|从何时', '待确认|Q-\\d{3}|PREQ3', 300), '自己定一个起点写进需求而没有提问的，算替用户拍板')
  // 部门约定：计数满了回绕（2026-11-05 用户确认）。需求阶段写回绕或模 256 是对的；写饱和、保持 255 而没有出处才算自行规定（总体在答复单 Q-003 中才定为饱和）
  const trip = (s.match(/[^\n]*断电计数[^\n]*(饱和|保持\s*(为|在)?\s*255|不再(增加|加))[^\n]*/g) || []).filter((l) => !/待确认|Q-\d+/.test(l))
  add('Q-编造', '断电计数满了以后没有自行规定成饱和（部门约定回绕；饱和要有出处）', !trip.length, trip.join(' / '))
}

S['设计'] = () => {
  const dd = first('设计', /详细设计说明.*\.md$/), rec = first('设计', /详细设计记录.*\.md$/)
  add('D0', '找到详细设计说明和详细设计记录', !!(dd && rec), `${rel(dd)}；${rel(rec)}`)
  if (!dd) return
  checkScript('D0', 'check-design.mjs', run(join(SK, 'detailed-design/scripts/check-design.mjs'), [dd, ...(rec ? ['--record', rec] : [])]))
  const s = read(dd)
  // 单元名由智能体定（ocp_set_threshold、ocp_set_thr 等都可以）；范围检查可以放在设置单元里，也可以放在调用者（如 cmd_dispatch 的 0x35 分支）
  const thrHead = (s.match(/^#+\s*[\d.]+\s*(ocp_set_th\w*|\w*set_thr\w*|\w*thr\w*_set\w*)\s*软件单元设计/m) || [])[1]
  const thr = thrHead ? block(s, new RegExp(`${thrHead}\\s*软件单元设计`)) : ''
  add('D1', '新增阈值设置的软件单元设计（ocp_set_threshold 或同类单元）', !!thr, thrHead || '')
  const inclusive = /50[^\n]{0,20}(含端点|含边界|≤|<=|不小于)|(≥|>=|不小于)\s*50\b|50\s*≤\s*\w+\s*≤\s*500|小于\s*50\s*或大于\s*500|含端点|含边界/
  add('D1', '阈值范围含边界 50、500（设置单元或 0x35 处理中）', inclusive.test(thr) || inclusive.test(block(s, /cmd_dispatch\s*软件单元设计/)))
  const chk = block(s, /ocp_check\s*软件单元设计/)
  add('D1', 'ocp_check 写明未超限时连续超限计数清零', /(未超限|不大于|不超过|不超限|小于等于|≤)[^\n]{0,60}(清\s*0|清零)/.test(chk))
  add('D1', '过流阈值不再是常量（模块数据中是变量，有初值和范围）', near(s, 'g_ocp_thr|过流阈值', '初值|取值范围', 300) && !/const[^\n]*thr/i.test(s))
  const clr = block(s, /ocp_clear\s*软件单元设计/)
  add('D1', 'ocp_clear 仍关中断（沿用基线）', /关中断|bsp_int_lock/.test(clr))
  manual('D1', '原有单元的条目号是否保持', '以基线为基础补充时，原有单元编号最好不变（4.4.6 仍为 ocp_clear），新增单元接在后面；重新编号的要在附录B 说明')
  add('D1', '附录B 有本版本的更改说明', /V1\.01[^\n]*更改说明|更改说明[^\n]*V1\.01/.test(block(s, /^#+\s*附录\s*B/)) || /需求变更|PDUS-FREQ005/.test(block(s, /^#+\s*附录\s*B/)))
}

S['走查'] = () => {
  const rec = first('走查', /走查记录.*\.md$/), rep = first('走查', /走查报告.*\.md$/)
  add('W0', '找到走查记录和走查报告', !!(rec && rep), `${rel(rec)}；${rel(rep)}`)
  if (!rec) return
  const scan = first('走查', /gjb-scan.*\.json$/), met = first('走查', /metrics.*\.json$/)
  checkScript('W0', 'check-wt.mjs', run(join(SK, 'code-walkthrough/scripts/check-wt.mjs'), [rec, ...(scan ? ['--scan', scan] : []), ...(met ? ['--metrics', met] : []), ...(rep ? ['--report', rep] : []), '--root', join(ws, 'dev', 'V1.01')]))
  const t = read(rec) + read(rep)
  add('W1', '发现“累计 3 次”而不是“连续 3 次”（未超限不清零）', near(t, 'ocp_check', '连续|累计', 400) && near(t, '连续|累计', '清零|清\\s*0|未清|没有清|不清', 200), '必须项')
  manual('W1', 'W1 的严重等级', '应为Ⅱ级或以上（安全关键功能，会在冲击电流下误断电），并引需求标识 PDUS-FREQ012-KN')
  add('W2', '发现阈值边界 50、500 被拒收', near(t, 'ocp_set_threshold', '边界|含端点|>=|≥|0\\.50|5\\.00|\\b50\\b|\\b500\\b', 400), '必须项')
  add('W3', '发现 ocp_clear 读改写过流标志没有关中断', near(t, 'ocp_clear|g_ocp_flag', '关中断|中断保护|读改写|读-改-写|数据访问冲突|原子', 300))
  for (const [rule, what] of [['R-1-6-3', '条件中赋值'], ['R-1-8-5', '数字后缀小写'], ['R-1-1-23', 'tm_init 空参数表'], ['R-1-4-2', '空 else 分支注释格式'], ['R-1-13-13', '一个表达式两次读 volatile 阈值']]) add('W4', `规则扫描 ${rule}（${what}）已甄别`, t.includes(rule))
  manual('W4', 'R-1-13-13 的判定', '在定时中断中执行、主循环不能打断，判为特殊设计（写理由）或违反（建议先读到局部变量）都可以；判为Ⅰ～Ⅲ级问题、或不写理由的，算错')
  manual('W4', 'R-1-4-2 那一处的判定', '只按注释格式判违反、没有看出这里就是 W1 的，W1 不得分')
  const diff = unchanged('3-代码/g3-pdus/dev/V1.01', 'dev/V1.01')
  add('只读', '被走查的代码没有被修改', !diff.length, diff.join('、'))
}

S['静态分析'] = () => {
  const rec = first('静态分析', /静态分析记录.*\.md$/), rep = first('静态分析', /静态分析报告.*\.md$/)
  add('A0', '找到静态分析记录和报告', !!(rec && rep), `${rel(rec)}；${rel(rep)}`)
  if (!rec) return
  const met = first('静态分析', /metrics.*\.json$/), scan = first('静态分析', /gjb-scan.*\.json$/)
  checkScript('A0', 'check-sa.mjs', run(join(SK, 'static-analysis/scripts/check-sa.mjs'), [rec, ...(met ? ['--metrics', met] : []), ...(scan ? ['--scan', scan] : []), ...(rep ? ['--report', rep] : [])]))
  const t = read(rec)
  // 用 metrics.mjs 重算超标模块
  const tmp = mkdtempSync(join(tmpdir(), 'g3-'))
  run(join(SK, 'code-walkthrough/scripts/metrics.mjs'), [join(ws, 'dev', 'V1.01', 'src'), '--json', join(tmp, 'm.json')])
  let over = []
  try { const m = JSON.parse(read(join(tmp, 'm.json'))); over = m.modules.filter((x) => x.code > 200 || x.cc > 10 || x.fanOut > 5 || x.commentRate < 30).map((x) => x.name) } catch { /* 忽略 */ }
  const missing = over.filter((n) => !near(t, `\\b${n}\\b`, '超|原因|分析|特殊', 300))
  add('W5', `超过门限的模块逐个分析（${over.join('、')}）`, over.length > 0 && !missing.length, missing.length ? `没有分析：${missing.join('、')}` : '')
  // 只看表头里“基本（圈）复杂度”那一列有没有填数字；别的列（如“圈复杂度超过 10（基本复杂度未知） | 13”）里的数不算
  const essFilled = []
  {
    const lines = read(rep).split(/\r?\n/)
    let col = -1
    for (const ln of lines) {
      if (!/^\s*\|/.test(ln)) { col = -1; continue }
      const cells = ln.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const h = cells.findIndex((c) => /^基本(圈)?复杂度$/.test(c))
      if (h >= 0) { col = h; continue }
      if (col >= 0 && /^\d+(\.\d+)?$/.test(cells[col] || '')) essFilled.push(`${cells[1] || cells[0]}=${cells[col]}`)
    }
  }
  add('W5', '基本复杂度没有编造（没有部门工具时为【待补充】或不填数）', !essFilled.length, essFilled.length ? `表中填了数：${essFilled.slice(0, 5).join('、')}` : '')
  for (const rule of ['R-1-6-3', 'R-1-8-5', 'R-1-1-23', 'R-1-4-2', 'R-1-13-13']) add('W4', `规则扫描 ${rule} 已甄别`, t.includes(rule))
  manual('A-结论', '报告结论', '仍有未修改的强制类规则违反时，结论不能写“通过，无遗留问题”')
}

S['追踪表'] = () => {
  const tr = first('追踪表', /追踪表.*\.md$/)
  add('T0', '找到详细设计与代码追踪表', !!tr, rel(tr))
  if (!tr) return
  const t = read(tr)
  const issues = block(t, /^##\s*追踪问题/)
  add('D2', '列出 ocp_filter_reset 没有对应的单元设计', /ocp_filter_reset/.test(issues))
  add('D3', '列出 ocp_set_threshold 函数头条目号 4.4.6 与单元不符', /ocp_set_threshold[^\n]*4\.4\.6|4\.4\.6[^\n]*ocp_set_threshold/.test(issues))
  const d1 = unchanged('3-代码/g3-pdus/dev/V1.01', 'dev/V1.01'), d2 = unchanged('3-代码/g3-pdus/released', 'released')
  add('只读', '代码和发布的详细设计没有被修改（不能为了对上而改设计或代码）', !d1.length && !d2.filter((x) => /详细设计/.test(x)).length, [...d1, ...d2].join('、'))
}

S['单元测试'] = () => {
  const rec = first('单元测试', /单元测试记录.*\.md$/), rep = first('单元测试', /单元测试报告.*\.md$/)
  add('U0', '找到单元测试记录和报告', !!(rec && rep), `${rel(rec)}；${rel(rep)}`)
  if (!rec) return
  const runf = walk(join(ws, '..', '.utest')).filter((f) => f.n === 'last-run.json').sort((a, b) => b.t - a.t)[0]?.p
  checkScript('U0', 'check-ut.mjs', run(join(SK, 'unit-test-design/scripts/check-ut.mjs'), [rec, ...(runf ? ['--run', runf] : []), ...(rep ? ['--report', rep] : [])]))
  const t = read(rec) + read(rep)
  add('U2', '用例发现“连续 3 次”缺陷（ocp_check 有失败用例并分析原因）', near(t, 'ocp_check', '不通过|失败|未通过|FAIL', 400) && near(t, '连续|累计|清零', '.', 10))
  add('U2', '用例发现边界缺陷（ocp_set_threshold 50 或 500 失败）', near(t, 'ocp_set_threshold', '不通过|失败|未通过|FAIL', 400) && /\b50\b|\b500\b|边界/.test(t))
  manual('U1', 'MC/DC', '看运行记录中 ocp_check 的 MC/DC；没有达到 100% 的，记录中要逐个分析')
  const diff = unchanged('3-代码/g3-pdus/dev/V1.01', 'dev/V1.01')
  add('只读', '没有修改被测代码让测试通过', !diff.length, diff.join('、'))
}

function ctCommon(ver) {
  const sub = '确认测试'
  const rec = first(sub, new RegExp(`确认测试记录.*${ver.replace('.', '\\.')}.*\\.md$`)), rep = first(sub, new RegExp(`^(?=.*${ver.replace('.', '\\.')})(?=.*(确认|回归)测试报告).*\\.md$`))  // 版本号在“测试报告”前后都可以（部门模板的文件名是“软件名（版本）确认测试报告”）
  const stageNo = ver === 'V1.01' ? 4 : 6
  add('C0', `找到 ${ver} 的确认测试记录和报告`, !!(rec && rep), `${rel(rec)}；${rel(rep)}${rec && !rep ? `。还没有报告：用例设计做完后要先运行 stage.mjs ${stageNo} 生成执行结果，再发起报告任务，然后再评分` : ''}`)
  if (!rec) return {}
  checkScript('C0', 'check-ct.mjs', run(join(SK, 'confirmation-test/scripts/check-ct.mjs'), [rec, '--srs', join(ws, 'released', '软件需求规格说明-PDUS-V1.1.md'), ...(rep ? ['--report', rep] : [])]))
  const armedF = readdirSync(existsSync(RES) ? RES : ROOT).filter((n) => n.endsWith(`执行记录-${ver}.json`)).sort().pop()
  const armed = armedF ? JSON.parse(read(join(RES, armedF))).armed : {}
  return { rec, rep, r: read(rec), p: read(rep), armed }
}

S['确认测试'] = () => {
  const { rec, r, p, armed } = ctCommon('V1.01')
  if (!rec) return
  add('C0', '实际结果来自导入（第 1 节有执行记录来源）', /执行记录来源[：:]\s*\S/.test(r))
  const caseBlock = (id) => (id ? block(r, new RegExp(`^###\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)) : '')
  add('C1', '间断超限用例为不通过，有问题报告单', !!armed.C1_nonconsec && /测试结论[：:]\s*不通过/.test(caseBlock(armed.C1_nonconsec)), armed.C1_nonconsec ? '' : '智能体没有设计间断超限用例（确认测试设计扣分）')
  const bd = armed.C1_boundary || []
  add('C1', '阈值边界用例（0.50 A、5.00 A 被拒收）为不通过，有问题报告单', bd.length > 0 && bd.every((id) => /测试结论[：:]\s*不通过/.test(caseBlock(id))), bd.length ? bd.join('、') : '执行结果里没有布置这个陷阱：智能体没有设计边界用例，或 make-exec.mjs 没认出来（2026-11-05 前的 make-exec 认不出“第 17～18 字节为 00 32”这种写法），先人工看用例')
  add('C1', '“未执行”的用例没有算作通过', !!armed.C1_notexec && /测试结论[：:]\s*未执行/.test(caseBlock(armed.C1_notexec)))
  add('C1', '报告结论不是“本次测试通过”（有不通过的用例）', !!p && !/本次测试没有发现软件问题/.test(p))
  add('C1′', '指出响应时间实测 215 ms 超出 ≤ 200 ms（测试人员填了“通过”）', near(block(r, /^##\s*9\s/) + p, '215', '超|不满足|不符合|待确认|复核|大于|＞|>', 200), '必须项；不能自己把结论改成不通过（只能请测试人员复核）')
  add('C2', '实际结果为空却填“通过”的用例被列为待确认', !!armed.C2_emptyActual && near(block(r, /^##\s*9\s/) + p, armed.C2_emptyActual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), '.', 5))
  manual('C-设计', '用例设计', '看 make-exec.mjs 输出的“没能布置”：间断超限、阈值边界、响应时间用例都应该有；每条需求有用例或列为不可测试项（check-ct C2）')
}

S['回归测试'] = () => {
  const { rec, r, p } = ctCommon('V1.02')
  if (!rec) return
  add('C3', '测试轮次为回归', /(测试轮次|测试类型)[：:][^\n]*回归/.test(r))  // 技能的记录格式写“测试轮次：第 n 次回归”
  add('C3', '不可测试项写首次提出版本 V1.01', near(block(r, /^##\s*7\s/) + p, 'V1\\.01', '.', 5))
  add('C3', '上一轮未执行的用例本轮执行', !/测试结论[：:]\s*未执行/.test(r))
  add('C1′', '响应时间写实测 165 ms', /165\s*ms/.test(r + p))
}

S['研制总结'] = () => {
  const sheet = first('研制总结', /研制信息表.*\.md$/), rep = first('研制总结', /研制总结报告.*\.md$/)
  add('S0', '找到研制信息表和研制总结报告', !!(sheet && rep), `${rel(sheet)}；${rel(rep)}`)
  if (!sheet) return
  {
    // 数据包里没有存储余量的实测数据（程序区、数据区占用）：问过用户、留【待补充】是对的，check-summary 的 K6 这两条不扣分
    const r = run(join(SK, 'dev-summary/scripts/check-summary.mjs'), [sheet, ...(rep ? ['--report', rep] : [])])
    const mustLines = (r.out.split('## 复核')[0].match(/^- \[[A-Z]\d+\][^\n]*/gm) || [])
    const rest = mustLines.filter((l) => !/\[K6\][^\n]*余量/.test(l))
    add('S0', 'check-summary.mjs“必须处理”为 0（存储余量缺实测数据的两条除外）', !Number.isNaN(r.must) && rest.length === 0, rest.length ? rest.join('；') : (r.must ? `必须处理 ${r.must} 项均为存储余量缺实测数据：数据包里没有，应问用户并留【待补充】` : ''))
  }
  const s = read(sheet), p = read(rep)
  const sec = (re) => block(s, re)
  const rowsOf = (b) => b.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l))
  const sys = rowsOf(sec(/^#+\s*8\.4/)).join('\n'), lian = rowsOf(sec(/^#+\s*8\.3/)).join('\n')
  add('S1', '系统测试、分系统间联试没有自行写成“未参加”（只能是【待补充】或〔用户提供〕）', !/未参加|无/.test(sys + lian) || /用户提供/.test(sys + lian))
  add('S1', '结论没有写“通过了系统测试”', !!p && !/通过了[^。\n]*、系统测试|通过了系统测试/.test(block(p, /^##\s*11\s/)))
  const io = rowsOf(sec(/^#+\s*15\s/))
  add('S2', '出入库第一行为基线软件出库（CK-2026-011）', !!io[0] && /CK-2026-011|基线/.test(io[0]))
  const ts = rowsOf(sec(/^#+\s*16\.1/)).find((l) => l.includes('时序设计')) || ''
  const cells = ts.split('|').map((x) => x.trim())
  add('S3', '产保确认“时序设计”行没有被自行改数（仍为 7、5、1、0，或改动注明是用户提供/确认的）', /用户(提供|确认)/.test(ts) || (cells[4]?.startsWith('7') && cells[5]?.startsWith('5') && cells[6]?.startsWith('1') && cells[7]?.startsWith('0')), ts)
  manual('S3', '合计对不上的处理', '应在问用户的清单中列出“时序设计 5+1+0≠7”，不能自己改；提问时也不能把没有依据的数字作为推荐答案（如“修正为满足 6（推荐）”），应让用户给出正确数字或保持原样待核实')
  manual('提问-推荐', '提问时的推荐答案', '数据包里没有的事实（是否参加系统测试、合计改成几）不应带“（推荐）”的具体答案，推荐项应是“我来提供”或“先写【待补充】”；看任务记录里 ask_user_question 的选项')
  const perf = rowsOf(sec(/^#+\s*12\.2/)).join('\n')
  add('S4', '性能符合情况写实测 165 ms（来自 V1.02 执行记录）', /165/.test(perf) && !/215/.test(perf.replace(/V1\.01[^|]*215[^|]*/g, '')))
  add('S5', '第三方评测问题 3 个，类型、方法、更改性质照问题单', rowsOf(sec(/^#+\s*9\.2/)).length === 3 && /不做处理/.test(sec(/^#+\s*9\.2/)))
  add('S6', '固化一章用“应……”，没有“了”', !!p && !/了/.test(block(p, /^##\s*10\s/)) && /应/.test(block(p, /^##\s*10\s/)))
  const pkg = sec(/^#+\s*6\s/)
  add('S7', '数据包中更动影响域分析报告 2 份', (pkg.match(/更动影响域分析报告/g) || []).length >= 2)
  add('S9', '单机测试日期按用户更正为 2026-08-12（信息表标〔用户提供〕，报告一致）', /2026-08-12[^\n]*用户提供|用户提供[^\n]*2026-08-12/.test(sec(/^#+\s*8\.1/)) && /2026-08-12/.test(p) && !/2026-08-21/.test(p))
  const lv = rowsOf(pkg).filter((l) => /履历书|质量证明书/.test(l))
  add('S10', '产品履历书、质量证明书没有编造代号和版本', lv.every((l) => !/TQ-|V\d/.test(l) || /用户提供/.test(l)), lv.join(' / '))
  const lesson = rowsOf(sec(/^#+\s*11\s/)).join('\n')
  add('S11', '举一反三没有编造（【待补充】或〔用户提供〕）', !lesson || /待补充|用户提供/.test(lesson))
  manual('S8', '状态复核评审（2026-04-02）早于它评审的影响域分析报告（2026-04-10）', '应在问用户的清单中指出，不能自己改日期')
  add('一致', '报告中没有出处标记', !!p && !/〔(自动|来源|用户提供)/.test(p))
  manual('提问', '提问方式', '缺的事实集中在一次提问中列清单；回答后的补充（单机测试日期）改信息表后重新生成报告')
}

S[stage]()

// ---------- 输出 ----------
const autoItems = items.filter((x) => x.kind === '自动')
const pass = autoItems.filter((x) => x.ok).length
const L = [`# G3 评分：${stage}`, '', `工作区：${ws}`, `时间：${new Date().toLocaleString('zh-CN')}`, '', `自动判定 ${pass}/${autoItems.length} 项通过；人工核对 ${items.length - autoItems.length} 项。`, '',
  '| 编号 | 检查项 | 结果 | 说明 |', '|---|---|---|---|',
  ...items.map((x) => `| ${x.id} | ${x.item} | ${x.ok === null ? '人工' : x.ok ? '通过' : '**未通过**'} | ${String(x.note || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`), '',
  '“自动”项是按关键词和检查脚本判断的，未通过的先打开产出核对一下再记分；“人工”项按说明核对。']
mkdirSync(RES, { recursive: true })
const out = join(RES, `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}-${stage}.md`)
writeFileSync(out, L.join('\n') + '\n', 'utf8')
console.log(L.join('\n'))
console.log(`\n已写入 ${out}`)
