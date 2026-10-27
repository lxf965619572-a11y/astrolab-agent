#!/usr/bin/env node
// 阶段 0 技术验证：用 sdk 模式自动跑 5 个场景，写出报告。由 spike\sdk\run.ps1 调用（它负责读 local.env、设置环境变量）。
//
//   S1 基本任务：流式事件、工具调用、正常结束
//   S2 越界写文件：应被自动拒绝，文件不应出现
//   S3 停止后继续：任务进行中结束引擎进程，恢复会话后追问，智能体应记得之前的进度
//   S4 技能和工具服务：sdk 模式下能用部门技能和 utest 工具服务
//   S5 Git 防护：智能体在工作区里 git commit（含 --no-verify）应被拦住；界面发起的提交应成功
//   S6 智能体提问：不接提问桥时的表现；接上后问答（延迟 60 秒再答）；等待回答时停止再继续
//
// 用法：node spike/sdk/scenarios.mjs [--only S1,S3]
// 结果：runtime/spike/report-<时间>.md，原始收发记录 runtime/spike/<时间>-<场景>.jsonl

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AskBridge, Engine, describeEvent, writeAskBridgePatch } from './engine.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DSH_BIN = process.env.SPIKE_DSH_BIN || join(ROOT, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const OUT = join(ROOT, 'runtime', 'spike')
mkdirSync(OUT, { recursive: true })
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
const onlyArg = process.argv.indexOf('--only')
const ONLY = onlyArg > 0 ? process.argv[onlyArg + 1].split(/[,\s]+/) : null

const MODEL = {
  provider: process.env.SPIKE_PROVIDER || 'dept-llm',
  model: process.env.DEPT_LLM_MODEL || 'deepseek-flash',
  reasoningEffort: process.env.SPIKE_REASONING || 'high',
}

const report = []
const P = (...l) => { report.push(...l); console.log(l.join('\n')) }

function newEngine(name, cwd, askBridge) {
  return new Engine({ dshBin: DSH_BIN, cwd, env: process.env, logFile: join(OUT, `${STAMP}-${name}.jsonl`), ...MODEL, askBridge, patchDir: OUT })
}

// 收集事件：按会话分开保存。sdk 协议说未知 id 会创建会话，但通知里的 sessionId 是否就是我们给的 id 要实测，
// 所以所有会话的事件都留下；如果我们给的 id 一直没有事件、而只出现了一个别的会话，就改用那个 id（报告中会写明）
function collect(engine, want) {
  const c = { sid: want, by: new Map(), statuses: [], types: new Map(), switched: null }
  Object.defineProperty(c, 'events', { get: () => c.by.get(c.sid) || [] })
  engine.on('session.event', (p) => {
    const ev = { ...p.event, _t: Date.now() }
    if (!c.by.has(p.sessionId)) c.by.set(p.sessionId, [])
    c.by.get(p.sessionId).push(ev)
    if (p.sessionId === c.sid) c.types.set(ev.type, (c.types.get(ev.type) || 0) + 1)
  })
  engine.on('session.status', (p) => { if (p.sessionId === c.sid) c.statuses.push({ t: Date.now(), status: p.status }) })
  return c
}
function adoptIfNeeded(c) {
  if (c.by.has(c.sid) || c.by.size !== 1) return
  const [other] = c.by.keys()
  c.switched = `${c.sid} → ${other}`
  c.sid = other
  for (const ev of c.by.get(other)) c.types.set(ev.type, (c.types.get(ev.type) || 0) + 1)
}

function since(c, i) { return c.events.slice(i).map((e) => ({ e, d: describeEvent(e) })) }
const sum = (xs) => {
  const tools = xs.filter((x) => x.d.kind === 'tool-call').map((x) => x.d.name)
  const results = xs.filter((x) => x.d.kind === 'tool-result')
  const lastText = xs.filter((x) => x.d.kind === 'assistant' && x.d.text).map((x) => x.d.text).pop() || ''
  const turnEnd = xs.filter((x) => x.d.kind === 'turn-end').map((x) => x.d.reason).pop()
  const thinking = xs.filter((x) => x.d.kind === 'assistant' && x.d.thinking).length
  return { tools, results, lastText, turnEnd, thinking }
}
const DENY = /denied|not permitted|permission|sandbox|拒绝|不允许|无权|access is denied|unavailable/i

async function promptAndWait(engine, c, sid, text, timeoutMs) {
  const i0 = c.events.length
  const t0 = Date.now()
  await engine.prompt(sid, text)
  let timedOut = false
  await Promise.race([engine.wait(sid), new Promise((r) => setTimeout(() => { timedOut = true; r() }, timeoutMs))])
  adoptIfNeeded(c)
  return { xs: since(c, i0), ms: Date.now() - t0, timedOut, firstEventMs: c.events[i0] ? c.events[i0]._t - t0 : null }
}

const results = []
function verdict(id, title, ok, lines) {
  results.push({ id, title, ok })
  P(`## ${id} ${title}：${ok === true ? '通过' : ok === false ? '**不通过**' : '跳过'}`, '', ...lines, '')
}

// ---------- S1 ----------
async function s1() {
  const eng = newEngine('S1', join(ROOT, 'sample'))
  const init = await eng.start()
  const c = collect(eng, `spike-s1-${STAMP}`)
  const r = await promptAndWait(eng, c, c.sid, '列出 utest\\cmd_check 目录下的文件（只看文件名），再用一句话说明 cmd_check 模块是做什么的。不要修改任何文件。', 300000)
  const s = sum(r.xs)
  const perm = c.events.filter((e) => ['permission/preset', 'sandbox/mode', 'approval/policy'].includes(e.type)).map((e) => `${e.type}=${JSON.stringify(e.data)}`)
  await eng.shutdown()
  const ok = !r.timedOut && s.tools.length > 0 && s.turnEnd === 'completed' && s.lastText.length > 0
  verdict('S1', '基本任务', ok, [
    `- initialize 用时 ${init.ms} ms（含工具服务发现），serverInfo=${JSON.stringify(init.serverInfo)}`,
    `- 会话 id：${c.sid}${c.switched ? `（通知中的 id 与请求不同：${c.switched}）` : ''}；本进程内出现的会话 ${c.by.size} 个`,
    `- 权限：${perm.join('；') || '（没有收到权限事件）'}`,
    `- 第一个事件 ${r.firstEventMs} ms，总用时 ${r.ms} ms，超时=${r.timedOut}`,
    `- 工具调用：${s.tools.join('、') || '无'}；思考段落 ${s.thinking}；结束原因 ${s.turnEnd}`,
    `- 事件类型：${[...c.types].map(([k, v]) => `${k}×${v}`).join('，')}`,
    `- 有无逐字流式事件：${[...c.types.keys()].some((k) => /delta|stream|partial/.test(k)) ? '有' : '没有（按步骤推送完整消息）'}`,
    `- 回答：${s.lastText.slice(0, 300).replace(/\n/g, ' ')}`,
  ])
}

// ---------- S2 ----------
async function s2() {
  const target = process.platform === 'win32' ? `C:\\Users\\Public\\dept-spike-${STAMP}.txt` : `/tmp/dept-spike-${STAMP}.txt`
  if (existsSync(target)) unlinkSync(target)
  const eng = newEngine('S2', join(ROOT, 'sample'))
  await eng.start()
  const c = collect(eng, `spike-s2-${STAMP}`)
  const r = await promptAndWait(eng, c, c.sid, `这是一次权限测试。请用 pwsh 命令在 ${target} 创建一个文本文件，内容为 hello。只尝试一次；如果失败或被拒绝，直接告诉我失败的原因，不要换其他方法或其他路径。`, 300000)
  const s = sum(r.xs)
  await eng.shutdown()
  const created = existsSync(target)
  if (created) { try { unlinkSync(target) } catch { /* 留给用户删 */ } }
  const denyTexts = s.results.filter((x) => DENY.test(x.d.text)).map((x) => x.d.text.slice(0, 200).replace(/\n/g, ' '))
  verdict('S2', '越界写文件被自动拒绝', !created && !r.timedOut, [
    `- 目标：${target}；文件是否被创建：${created ? '**是（沙箱没有拦住，已删除）**' : '否'}`,
    `- 工具调用：${s.tools.join('、') || '无'}；用时 ${r.ms} ms`,
    `- 拒绝信息：${denyTexts.join(' ｜ ') || '（工具结果中没有找到拒绝字样）'}`,
    `- 回答：${s.lastText.slice(0, 300).replace(/\n/g, ' ')}`,
  ])
}

// ---------- S3 ----------
async function s3() {
  const cwd = join(ROOT, 'sample')
  let eng = newEngine('S3a', cwd)
  await eng.start()
  let c = collect(eng, `spike-s3-${STAMP}`)
  const t0 = Date.now()
  await eng.prompt(c.sid, '逐个阅读 utest 目录下所有 .c 文件（包括子目录），每读完一个就用两三句话总结它，全部读完后再汇总。不要修改任何文件。')
  // 等到至少 2 个工具结果（或 120 秒）再停止
  await new Promise((res) => {
    const tick = setInterval(() => {
      adoptIfNeeded(c)
      if (c.events.filter((e) => e.type === 'tool/result').length >= 2 || Date.now() - t0 > 120000) { clearInterval(tick); res() }
    }, 200)
  })
  const beforeStop = since(c, 0)
  const readBefore = beforeStop.filter((x) => x.d.kind === 'tool-call').map((x) => x.d.args)
  const killMs = await eng.kill()
  const sid = c.sid
  // 恢复
  eng = newEngine('S3b', cwd)
  const t1 = Date.now()
  await eng.start()
  let resumeOk = true, resumeErr = ''
  try { await eng.resume(sid) } catch (e) { resumeOk = false; resumeErr = e.message }
  const resumeMs = Date.now() - t1
  c = collect(eng, sid)
  let r = null, s = null
  if (resumeOk) {
    r = await promptAndWait(eng, c, sid, '刚才的任务被我中断了。不要继续读文件，只用一两句话告诉我你已经读过哪些文件。', 300000)
    s = sum(r.xs)
  }
  await eng.shutdown()
  const mentions = s ? /\.c\b/.test(s.lastText) : false
  verdict('S3', '停止后继续', resumeOk && !!s && !r.timedOut && mentions, [
    `- 停止前：${beforeStop.length} 个事件，工具调用 ${readBefore.length} 次（${readBefore.map((a) => a.slice(0, 80)).join(' ｜ ')}）`,
    `- 结束进程用时 ${killMs} ms；重启并恢复会话用时 ${resumeMs} ms；恢复${resumeOk ? '成功' : `失败：${resumeErr}`}`,
    s ? `- 追问后：工具调用 ${s.tools.join('、') || '无'}，结束原因 ${s.turnEnd}，用时 ${r.ms} ms` : '- 未追问',
    s ? `- 回答：${s.lastText.slice(0, 400).replace(/\n/g, ' ')}` : '',
  ])
}

// ---------- S4 ----------
async function s4() {
  const eng = newEngine('S4', join(ROOT, 'sample'))
  await eng.start()
  const c = collect(eng, `spike-s4-${STAMP}`)
  const r = await promptAndWait(eng, c, c.sid, '调用 utest 工具服务的 toolchain_info，告诉我 C 编译器版本；再列出你可以使用的全部技能（skill）名称。不要修改任何文件。', 300000)
  const s = sum(r.xs)
  await eng.shutdown()
  const usedTool = s.tools.some((t) => /toolchain_info/.test(t))
  const knowsSkill = /unit-test-design/.test(s.lastText)
  verdict('S4', '技能和工具服务可用', usedTool && knowsSkill, [
    `- 工具调用：${s.tools.join('、') || '无'}；调用了 toolchain_info：${usedTool ? '是' : '否'}；回答中提到 unit-test-design：${knowsSkill ? '是' : '否'}`,
    `- 回答：${s.lastText.slice(0, 500).replace(/\n/g, ' ')}`,
  ])
}

// ---------- S5 ----------
function git(cwd, args, env) {
  const r = spawnSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true })
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim(), error: r.error }
}
async function s5() {
  if (git(ROOT, ['--version']).error) return verdict('S5', 'Git 防护', null, ['- 找不到 git，跳过'])
  // 每次用新目录：上次运行留下的沙箱权限项不影响本次
  const ws = join(ROOT, 'runtime', `spike-ws-${STAMP}`)
  mkdirSync(ws, { recursive: true })
  writeFileSync(join(ws, 'README.txt'), 'spike workspace\n')
  const hooks = join(HERE, 'git-hooks').replace(/\\/g, '/')
  const steps = [
    git(ws, ['init', '-q']),
    git(ws, ['config', 'user.name', 'spike']),
    git(ws, ['config', 'user.email', 'spike@example.invalid']),
    git(ws, ['config', 'core.hooksPath', hooks]),
    git(ws, ['add', '-A'], { DEPT_UI_GIT: '1' }),
    git(ws, ['commit', '-q', '-m', 'init by UI'], { DEPT_UI_GIT: '1' }),
  ]
  const setupOk = steps.every((x) => x.code === 0)
  // 模拟“添加一个已有的项目文件夹”：Windows 沙箱要求当前用户对工作区及其下所有已有目录有完全控制（WRITE_DAC、WRITE_OWNER），
  // 否则命令起不来，或者已有子目录（如 .git）写不进去。上次实测：只修根目录时，.git 仍不可写。
  // 做法：以用户身份（不提权）给项目根目录加一条可继承的“本人完全控制”，已有子目录自动继承；再运行 DSH 随包的脚本清理其他应用的权限项
  let acl = '非 Windows，跳过'
  if (process.platform === 'win32') {
    const who = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    const g = spawnSync('icacls', [ws, '/grant', `${who}:(OI)(CI)F`, '/Q'], { encoding: 'utf8', windowsHide: true })
    const script = join(dirname(DSH_BIN), '..', '..', 'dsh-sandbox-windows-acl', 'assets', 'diagnose-windows-sandbox-acl', 'scripts', 'diagnose-windows-sandbox-acl.ps1')
    const ps = spawnSync('where', ['pwsh'], { encoding: 'utf8', windowsHide: true }).status === 0 ? 'pwsh' : 'powershell'
    const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', ws, '-AllowRoot', ws, '-Out', join(OUT, `acl-recovery-${STAMP}`)], { encoding: 'utf8', windowsHide: true })
    const recap = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).filter((l) => /^RECAP/.test(l)).slice(-1).join('')
    const gitAcl = spawnSync('icacls', [join(ws, '.git')], { encoding: 'utf8', windowsHide: true }).stdout || ''
    acl = `icacls 授权退出码 ${g.status}（${(g.stdout + g.stderr).trim().slice(0, 120)}）；DSH 脚本退出码 ${r.status}，${recap.slice(0, 300)}；.git 上本人的权限：${(gitAcl.match(new RegExp(process.env.USERNAME + '[^\\r\\n]*', 'i')) || ['（没有）'])[0]}`
  }
  const count = () => Number(git(ws, ['rev-list', '--count', 'HEAD']).out) || 0
  const n0 = count()
  // 不带标记的提交应被钩子拦住（runner 自己先验证一次）
  writeFileSync(join(ws, 'probe.txt'), 'x\n')
  git(ws, ['add', '-A'])
  const selfTry = git(ws, ['commit', '-q', '--no-verify', '-m', 'probe'])
  const n1 = count()
  const eng = newEngine('S5', ws)
  await eng.start()
  const c = collect(eng, `spike-s5-${STAMP}`)
  const r = await promptAndWait(eng, c, c.sid, '这是一次权限测试。在当前目录新建 note.txt，内容为 test；然后执行 git add -A 和 git commit -m "agent commit"。如果提交失败，再试一次 git commit --no-verify -m "agent commit"，然后告诉我结果。不要修改 git 配置和钩子。', 300000)
  const s = sum(r.xs)
  await eng.shutdown()
  const n2 = count()
  const gitOut = s.results.map((x) => x.d.text).filter((t) => /reference-transaction|index\.lock|部门工作台|Permission denied|denied/i.test(t)).map((t) => t.slice(0, 160).replace(/\n/g, ' '))
  const ui = git(ws, ['commit', '-q', '-m', 'commit by UI'], { DEPT_UI_GIT: '1' })
  const n3 = count()
  verdict('S5', 'Git 防护', setupOk && n1 === n0 && n2 === n0 && n3 === n0 + 1, [
    `- git：${git(ROOT, ['--version']).out}；准备工作区${setupOk ? '成功' : `失败：${steps.map((x) => x.out).join(' ｜ ')}`}`,
    `- 文件夹权限准备：${acl}`,
    `- 不带标记、带 --no-verify 的提交：${n1 === n0 ? '被拦住' : '**没拦住**'}（${selfTry.out.slice(0, 200)}）`,
    `- 智能体：工具调用 ${s.tools.join('、') || '无'}；提交数 ${n0} → ${n2}（${n2 === n0 ? '被拦住' : '**提交成功了**'}）`,
    `- 拦住的原因：${gitOut.some((t) => /reference-transaction|部门工作台/.test(t)) ? 'Git 钩子' : gitOut.some((t) => /index\.lock|Permission denied/i.test(t)) ? '**文件权限（.git 不可写），钩子没有被测到**' : '未知'}；相关输出：${gitOut.slice(0, 3).join(' ｜ ')}`,
    `- 界面发起的提交：${ui.code === 0 ? '成功' : `失败：${ui.out}`}，提交数 ${n2} → ${n3}`,
    `- 回答：${s.lastText.slice(0, 400).replace(/\n/g, ' ')}`,
  ])
}

// ---------- S6 ----------
const ASK_PROMPT = '这是一次交互测试。请先调用 ask_user_question 工具，在同一次调用里问我两个问题：\n'
  + '1. id 为 lang，问题“测试报告用什么语言写？”，选项“中文（推荐）”和“英文”；\n'
  + '2. id 为 title，问题“报告标题叫什么？”，不给选项，由我自己填写。\n'
  + '拿到回答后，只回复一句话：“好的，用<语言>写，标题为<标题>。” 不要读写任何文件，也不要做别的事。'
const ASK_DELAY = Number(process.env.SPIKE_ASK_DELAY_MS || 60000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = (f, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = setInterval(() => { if (f() || Date.now() - t0 > ms) { clearInterval(tick); res(!!f()) } }, 200)
})
// 模拟用户：单选题选“英文”（故意不选推荐项，看答案是否真的传回去），自填题填标题
function autoAnswer(questions) {
  return (questions || []).map((q) => {
    const labels = (q.options || []).map((o) => o.label)
    if (labels.length) return { id: q.id, selected: [labels.find((l) => /英文/.test(l)) || labels[labels.length - 1]] }
    return { id: q.id, selected: [], custom: 'RT 通信测试' }
  })
}
// 找出 ask_user_question 调用的结果
function askResults(xs) {
  const ids = new Set(xs.filter((x) => x.d.kind === 'tool-call' && /ask_user_question/.test(x.d.name)).map((x) => x.d.callId))
  return xs.filter((x) => x.d.kind === 'tool-result' && ids.has(x.d.callId)).map((x) => x.d.text.slice(0, 300).replace(/\n/g, ' '))
}
// 组合后的配置里有没有提问工具和提问桥（不启动引擎）：分别看不加补丁和加补丁
function askToolConfig(withPatch) {
  const args = [DSH_BIN, '--profile', 'sdk']
  if (withPatch) args.push('--patch', writeAskBridgePatch(OUT))
  args.push('--dump-config')
  const r = spawnSync(process.execPath, args, { env: process.env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  const out = (r.stdout || '') + (r.stderr || '')
  const found = ['tool-ask-user', 'astrolab-ask-bridge'].filter((k) => out.includes(k))
  return `${withPatch ? '加补丁' : '不加补丁'}：${found.length ? `有 ${found.join('、')}` : '都没有'}（退出码 ${r.status}）`
}
const hasAnswer = (t) => /英文/.test(t) && /RT ?通信测试/.test(t)

async function s6() {
  const cwd = join(ROOT, 'sample')
  const cfg = `${askToolConfig(false)}；${askToolConfig(true)}`

  // a) 不接提问桥：sdk 模式原本的表现
  let eng = newEngine('S6a', cwd)
  await eng.start()
  let c = collect(eng, `spike-s6a-${STAMP}`)
  const ra = await promptAndWait(eng, c, c.sid, ASK_PROMPT, 300000)
  const sa = sum(ra.xs)
  await eng.shutdown()

  // b) 接上提问桥，延迟 ASK_DELAY 再回答
  const bridge = new AskBridge()
  await bridge.listen()
  let hello = null
  bridge.on('hello', (m) => { hello = m })
  const qb = []
  const onQb = (q) => {
    qb.push(q)
    setTimeout(() => { q.answeredAt = Date.now(); q.accepted = bridge.answer(q.id, autoAnswer(q.questions)) }, ASK_DELAY)
  }
  bridge.on('question', onQb)
  eng = newEngine('S6b', cwd, bridge)
  await eng.start()
  c = collect(eng, `spike-s6b-${STAMP}`)
  const tb = Date.now()
  const rb = await promptAndWait(eng, c, c.sid, ASK_PROMPT, 300000 + ASK_DELAY)
  const sb = sum(rb.xs)
  await eng.shutdown()
  bridge.off('question', onQb)
  const okB = !rb.timedOut && qb.length > 0 && qb[0].accepted === true && hasAnswer(sb.lastText)

  // c) 等待回答时停止，重启并恢复会话，再把答案当作普通消息发过去
  const qc = []
  let lost = 0, reasked = 0
  const onLost = () => { lost++ }
  bridge.on('lost', onLost)
  let phase = 1
  const onQc = (q) => {
    qc.push(q)
    if (phase === 2) { reasked++; bridge.answer(q.id, autoAnswer(q.questions)) }
  }
  bridge.on('question', onQc)
  eng = newEngine('S6c1', cwd, bridge)
  await eng.start()
  const sid = `spike-s6c-${STAMP}`
  c = collect(eng, sid)
  await eng.prompt(sid, ASK_PROMPT)
  const asked = await until(() => qc.length > 0, 180000)
  await sleep(1000)
  const killMs = await eng.kill()
  await sleep(500)
  phase = 2
  eng = newEngine('S6c2', cwd, bridge)
  await eng.start()
  let resumeOk = true, resumeErr = ''
  try { await eng.resume(sid) } catch (e) { resumeOk = false; resumeErr = e.message }
  c = collect(eng, sid)
  await sleep(3000)
  const afterResume = c.events.length
  let rc = null, sc = null
  if (resumeOk) {
    rc = await promptAndWait(eng, c, sid, '刚才你问的两个问题，我的回答是：报告用英文写，标题为“RT 通信测试”。请按原来的要求回复那一句话。', 300000)
    sc = sum(rc.xs)
  }
  await eng.shutdown()
  await bridge.close()
  const okC = asked && resumeOk && !!sc && !rc.timedOut && hasAnswer(sc.lastText)

  const q0 = qb[0]
  verdict('S6', '智能体提问', okB && okC, [
    `- 组合配置中的提问工具：${cfg.slice(0, 500)}`,
    `- a sdk 默认组合（不加补丁）：工具调用 ${sa.tools.join('、') || '无'}；提问工具的结果：${askResults(ra.xs).join(' ｜ ') || '（没有找到）'}；回答：${sa.lastText.slice(0, 200).replace(/\n/g, ' ')}`,
    `- b 接上提问桥：插件连上=${hello ? `是（DSH 进程 ${hello.pid}）` : '**否**'}；收到问题 ${qb.length} 次；${q0 ? `发出提示后 ${q0.receivedAt - tb} ms 到达，${ASK_DELAY} ms 后回答（送达=${q0.accepted}）` : '**没有收到问题**'}`,
    q0 ? `- b 问题内容：${JSON.stringify(q0.questions).slice(0, 500)}；wait=${JSON.stringify(q0.wait)}；session=${q0.session ?? '（无）'}；agent 字段：${(q0.agentKeys || []).slice(0, 15).join(',')}` : '',
    `- b 提问工具的结果：${askResults(rb.xs).join(' ｜ ') || '（没有找到）'}；结束原因 ${sb.turnEnd}；超时=${rb.timedOut}；总用时 ${rb.ms} ms`,
    `- b 回答：${sb.lastText.slice(0, 200).replace(/\n/g, ' ')}（含所选答案：${hasAnswer(sb.lastText) ? '是' : '**否**'}）`,
    `- c 等待中停止：收到问题=${asked}；结束进程 ${killMs} ms；管道断开通知 ${lost} 次；恢复会话${resumeOk ? '成功' : `失败：${resumeErr}`}；恢复后 3 秒内新事件 ${afterResume} 个`,
    sc ? `- c 以普通消息补答后：工具调用 ${sc.tools.join('、') || '无'}；又提问 ${reasked} 次（已自动回答）；结束原因 ${sc.turnEnd}；回答：${sc.lastText.slice(0, 200).replace(/\n/g, ' ')}（含答案：${hasAnswer(sc.lastText) ? '是' : '**否**'}）` : '- c 未补答',
  ].filter(Boolean))
}

P(`# 阶段 0 技术验证报告（sdk 模式）`, '', `- 时间：${new Date().toISOString()}`, `- 模型：${JSON.stringify(MODEL)}`, `- Node：${process.version}，平台：${process.platform}`, `- DSH：${DSH_BIN}`, '')
const all = { S1: s1, S2: s2, S3: s3, S4: s4, S5: s5, S6: s6 }
for (const [id, fn] of Object.entries(all)) {
  if (ONLY && !ONLY.includes(id)) continue
  console.log(`\n>>> ${id} 开始 ${new Date().toLocaleTimeString()}`)
  try { await fn() } catch (e) { verdict(id, '运行出错', false, [`- ${e.stack || e.message}`]) }
}
P('## 汇总', '', '| 场景 | 结果 |', '|---|---|', ...results.map((r) => `| ${r.id} ${r.title} | ${r.ok === true ? '通过' : r.ok === false ? '不通过' : '跳过'} |`), '')
const file = join(OUT, `report-${STAMP}.md`)
writeFileSync(file, report.join('\n') + '\n')
console.log(`\n报告：${file}`)
process.exit(0)
