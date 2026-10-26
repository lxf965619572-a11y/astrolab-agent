#!/usr/bin/env node
// 引擎启动慢的诊断（阶段 0）：同一台电脑上，按不同条件各启动 DSH sdk 引擎两次，比较 initialize 用时，找出慢在哪一部分。
//   A 完整配置（4 个工具服务 + 部门技能 + 部门模型路由），示例工作区
//   B 去掉 4 个工具服务
//   C 只留部门模型路由（工具服务、部门技能都去掉）
//   D 完整配置，空工作区
// 每个条件用一个新的 DSH 数据目录；同一条件的第 2 次启动复用第 1 次的目录，用来区分“首次”开销。
// 用法：开发电脑上 node packaging\diag-startup.mjs；安装包里由 diag.cmd 调用。结果写到数据目录（或 runtime\diag）下的 startup-diag-*.md

import { spawnSync } from 'node:child_process'
import { cpus, totalmem } from 'node:os'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from '../spike/sdk/engine.mjs'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = process.env.ASTROLAB_DATA || join(APP, 'runtime')
const OUT = join(DATA, 'diag')
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
const DSH_BIN = join(APP, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
mkdirSync(OUT, { recursive: true })

// 把模板按顶层条目（行首的 "- "）切开：insert（工具服务）、skill-filesystem、llm-pi-ai
const tpl = readFileSync(join(APP, 'config', 'cordis.patch.yml.template'), 'utf8').replace(/__STARTER_DIR__/g, APP.replace(/\\/g, '/'))
const entries = tpl.split(/\r?\n(?=- )/).filter((e) => /^- /.test(e))
const pick = (pred) => entries.filter(pred).join('\n') + '\n'
const PATCH = {
  full: pick(() => true),
  noMcp: pick((e) => !/^- insert:/.test(e)),
  modelOnly: pick((e) => /id: llm-pi-ai/.test(e)),
}

function workspace(kind) {
  const ws = join(OUT, `${STAMP}-ws-${kind}`)
  if (kind === 'sample') cpSync(join(APP, 'sample'), ws, { recursive: true })
  else mkdirSync(ws, { recursive: true })
  if (process.platform === 'win32') spawnSync('icacls', [ws, '/grant', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`, '/Q'], { windowsHide: true })
  return ws
}
const WS = { sample: workspace('sample'), empty: workspace('empty') }

const t0 = Date.now()
const ver = spawnSync(process.execPath, [DSH_BIN, '--version'], { encoding: 'utf8', windowsHide: true })
const verMs = Date.now() - t0

const cases = [
  ['A', '完整配置，示例工作区', 'full', 'sample'],
  ['B', '去掉 4 个工具服务', 'noMcp', 'sample'],
  ['C', '只留部门模型路由', 'modelOnly', 'sample'],
  ['D', '完整配置，空工作区', 'full', 'empty'],
]
const rows = []
for (const [id, title, patch, ws] of cases) {
  const home = join(OUT, `${STAMP}-home-${id}`)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'cordis.patch.yml'), PATCH[patch])
  for (const round of [1, 2]) {
    const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
    const eng = new Engine({ dshBin: DSH_BIN, cwd: WS[ws], env, logFile: join(OUT, `${STAMP}-${id}${round}.jsonl`), provider: 'dept-llm', model: process.env.DEPT_LLM_MODEL || 'deepseek-flash', reasoningEffort: 'high' })
    let ms = null, err = ''
    try { ms = (await Promise.race([eng.start(), new Promise((_, rej) => setTimeout(() => rej(new Error('超过 180 秒')), 180000))])).ms }
    catch (e) { err = `${e.message}；${eng.stderrTail.slice(-200)}` }
    await eng.shutdown()
    rows.push({ id, title, round, ms, err })
    console.log(`${id}${round} ${title}：${ms ?? '失败'} ms ${err}`)
  }
}

const lines = [
  '# 引擎启动诊断', '',
  `- 时间：${new Date().toISOString()}；计算机：${process.env.COMPUTERNAME || ''}；用户：${process.env.USERNAME || ''}`,
  `- CPU ${cpus().length} 核，内存 ${Math.round(totalmem() / 2 ** 30)} GB；Node ${process.version}`,
  `- 程序目录：${APP}`,
  `- dsh --version：${(ver.stdout || '').trim()}，${verMs} ms`, '',
  '| 条件 | 说明 | 第 1 次（ms） | 第 2 次（ms） |', '|---|---|---|---|',
  ...cases.map(([id, title]) => {
    const r = rows.filter((x) => x.id === id)
    const f = (x) => (x ? (x.ms ?? `失败：${x.err.slice(0, 80)}`) : '')
    return `| ${id} | ${title} | ${f(r[0])} | ${f(r[1])} |`
  }), '',
]
const file = join(OUT, `startup-diag-${STAMP}.md`)
writeFileSync(file, lines.join('\n'))
const res = join(process.env.USERPROFILE || '', 'Desktop', 'results')
if (existsSync(res)) cpSync(file, join(res, `startup-diag-${STAMP}.md`))
console.log(`\n报告：${file}`)
