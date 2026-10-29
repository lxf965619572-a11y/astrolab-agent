#!/usr/bin/env node
// 代码走查评测运行器：对每个用例用 DSH headless 模式跑一次走查，然后自动打分
//
// 用法（在 astrolab-agent 目录下）：
//   node evals/run.mjs                         跑全部用例
//   node evals/run.mjs --cases sparc-01-uart-ringbuf,d2000-01-tm-udp
//   node evals/run.mjs --repeat 3 --parallel 2 --label "改了检查表"
// 选项：
//   --cases <id,...>   只跑指定用例（默认全部）
//   --repeat <n>       每个用例重复次数，用来看结果是否稳定（默认 1）
//   --parallel <n>     同时运行的用例数（默认 1；API 有并发限制时不要开太大）
//   --timeout-min <n>  单个用例超时分钟数（默认 20）
//   --label <文字>     给本次评测加备注，会写进结果目录名和报告
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { ROOT, EVAL_DIR, loadLocalEnv, sha1, sessionStats } from './lib.mjs'
import { scoreAll } from './score.mjs'

function parseArgs(argv) {
  const o = { cases: null, repeat: 1, parallel: 1, timeoutMin: 20, label: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const v = () => argv[++i]
    if (a === '--cases') o.cases = v().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--repeat') o.repeat = Math.max(1, Number(v()) || 1)
    else if (a === '--parallel') o.parallel = Math.max(1, Number(v()) || 1)
    else if (a === '--timeout-min') o.timeoutMin = Math.max(1, Number(v()) || 20)
    else if (a === '--label') o.label = v() || ''
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0) }
    else { console.error(`未知参数：${a}`); process.exit(2) }
  }
  return o
}

const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function killTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else { try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} } }
}

function runOne(job, opt) {
  return new Promise((resolve) => {
    const started = Date.now()
    const out = fs.openSync(path.join(job.runDir, 'dsh.stdout.txt'), 'w')
    const err = fs.openSync(path.join(job.runDir, 'dsh.stderr.txt'), 'w')
    const child = spawn(process.execPath, [opt.dshBin, '--profile', 'headless', job.prompt], {
      cwd: job.workDir, env: process.env, stdio: ['ignore', out, err],
      detached: process.platform !== 'win32', windowsHide: true,
    })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; killTree(child) }, opt.timeoutMin * 60_000)
    child.on('close', (code) => {
      clearTimeout(timer)
      fs.closeSync(out)
      fs.closeSync(err)
      const durationMs = Date.now() - started
      const session = sessionStats(process.env.DSH_HOME, job.workDir, started)
      // 把模型产出（review 目录）和被检代码拷回结果目录，便于事后查看
      const review = path.join(job.workDir, 'review')
      if (fs.existsSync(review)) fs.cpSync(review, path.join(job.runDir, 'review'), { recursive: true })
      fs.cpSync(path.join(job.workDir, 'src'), path.join(job.runDir, 'src'), { recursive: true })
      const meta = { case: job.caseId, repeat: job.repeat, workDir: job.workDir, exitCode: code, timedOut, durationMs, session }
      fs.writeFileSync(path.join(job.runDir, 'run.json'), JSON.stringify(meta, null, 2))
      resolve(meta)
    })
  })
}

async function main() {
  const opt = parseArgs(process.argv.slice(2))
  loadLocalEnv()
  process.env.DSH_HOME = process.env.DSH_HOME || path.join(ROOT, 'runtime', 'dsh-home')
  process.env.DSH_TELEMETRY_DISABLED = '1'
  process.env.DSH_TELEMETRY_MODE = 'DISABLED' // DSH 0.2.1 的会话遥测认这个
  opt.dshBin = process.env.DSH_BIN || path.join(ROOT, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!fs.existsSync(opt.dshBin)) { console.error(`找不到 DSH：${opt.dshBin}，请先运行 scripts\\setup.ps1`); process.exit(1) }
  if (!process.env.DEEPSEEK_API_KEY) { console.error('config\\local.env 中没有 DEEPSEEK_API_KEY'); process.exit(1) }

  const suiteDir = path.join(EVAL_DIR, 'code-review')
  const allCases = fs.readdirSync(path.join(suiteDir, 'cases')).sort()
  const cases = opt.cases ?? allCases
  const unknown = cases.filter((c) => !allCases.includes(c))
  if (unknown.length) { console.error(`没有这些用例：${unknown.join(', ')}\n可选：${allCases.join(', ')}`); process.exit(2) }
  const promptTpl = fs.readFileSync(path.join(suiteDir, 'prompt.txt'), 'utf8')

  const outDir = path.join(EVAL_DIR, 'results', stamp() + (opt.label ? '-' + opt.label.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) : ''))
  fs.mkdirSync(path.join(outDir, 'runs'), { recursive: true })
  const dshVersion = spawnSync(process.execPath, [opt.dshBin, '--version'], { encoding: 'utf8' }).stdout.trim()
  const skillDir = path.join(process.env.DSH_HOME, 'skills', 'code-walkthrough')
  const info = {
    startedAt: new Date().toISOString(), label: opt.label, dshVersion,
    baseUrl: process.env.DEEPSEEK_BASE_URL || null,
    skillHash: sha1(path.join(skillDir, 'SKILL.md')),
    checklistHash: sha1(path.join(skillDir, 'references', 'checklist.md')),
    promptHash: sha1(path.join(suiteDir, 'prompt.txt')),
    cases, repeat: opt.repeat, timeoutMin: opt.timeoutMin,
  }
  fs.writeFileSync(path.join(outDir, 'info.json'), JSON.stringify(info, null, 2))

  const jobs = []
  for (const caseId of cases) {
    const caseDir = path.join(suiteDir, 'cases', caseId)
    const c = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf8'))
    for (let r = 1; r <= opt.repeat; r++) {
      const runName = opt.repeat > 1 ? `${caseId}-r${r}` : caseId
      const runDir = path.join(outDir, 'runs', runName)
      // 工作区放在系统临时目录，远离 evals 目录，避免模型顺着目录翻到标准答案
      const workDir = path.join(os.tmpdir(), 'dsh-evals', path.basename(outDir), runName)
      fs.mkdirSync(runDir, { recursive: true })
      fs.mkdirSync(workDir, { recursive: true })
      fs.cpSync(path.join(caseDir, 'src'), path.join(workDir, 'src'), { recursive: true })
      fs.copyFileSync(path.join(caseDir, 'case.json'), path.join(runDir, 'case.json'))
      const prompt = promptTpl.replaceAll('{{targetText}}', c.targetText)
      fs.writeFileSync(path.join(runDir, 'prompt.txt'), prompt)
      jobs.push({ caseId, repeat: r, runDir, workDir, prompt })
    }
  }

  console.log(`DSH ${dshVersion}，${cases.length} 个用例 × ${opt.repeat} 次，并发 ${opt.parallel}，结果目录：${outDir}`)
  console.log(`模型：${process.env.DEEPSEEK_BASE_URL || 'DeepSeek 官方 API'}\n`)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      const name = `${job.caseId}${opt.repeat > 1 ? ' #' + job.repeat : ''}`
      console.log(`[开始] ${name}`)
      const m = await runOne(job, opt)
      done++
      const found = fs.existsSync(path.join(job.runDir, 'review', 'findings.json'))
      console.log(`[完成 ${done}/${jobs.length}] ${name}  ${Math.round(m.durationMs / 1000)}s  工具调用 ${m.session?.toolCalls ?? '?'}  ${m.timedOut ? '超时  ' : ''}${found ? '' : '未生成 findings.json  '}${m.session?.peeked ? '⚠ 读取过答案文件' : ''}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(opt.parallel, jobs.length) }, worker))

  const s = scoreAll(outDir)
  const t = s.totals
  console.log(`\n检出率 ${(100 * t.recall).toFixed(1)}%（${t.detected}/${t.expected}），Cppcheck 单独 ${t.cppcheckBaseline}/${t.expected}，干净代码误报 ${t.falsePositives}，额外发现 ${t.extras}（需人工判断）`)
  console.log(`详细结果：${path.join(outDir, 'summary.md')}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
