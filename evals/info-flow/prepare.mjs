#!/usr/bin/env node
// 准备信息流评测：AstroLab 示例工程（位置见 ../sample-ws.mjs）
//   - 上一次的 diagrams/ 整个移到 evals/info-flow/results/<时间>-<用例>-上次输出/，免得智能体读到并沿用；
//   - 输入文件和仓库的种子不一样时（被改过），改过的版本存一份，再恢复原样；
//   - 记下现在工作区里的文件（results/prepared-<用例>.json），score.mjs 用它找出这次任务新增和改动的文件。
// 用法：node evals/info-flow/prepare.mjs [用例名，默认 pcu]
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERE, ROOT, loadCase, sampleWorkspace, sha1, walk } from './lib.mjs'

const name = process.argv[2] || 'pcu'
const cs = await loadCase(name)
if (!cs) { console.error(`没有这个用例：${name}（evals/info-flow/${name}/case.mjs）`); process.exit(2) }
const sw = sampleWorkspace()
const ws = sw.dir
console.log(`示例工程：${ws}（${sw.from}）`)
if (sw.from.startsWith('仓库')) console.log('注意：还没有运行过 AstroLab，用的是仓库里的 sample。先启动一次工作台，让它建好示例工程。')

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const res = join(HERE, 'results')
const dst = join(res, `${stamp}-${name}-上次输出`)
mkdirSync(res, { recursive: true })

function move(from, to) {
  mkdirSync(join(to, '..'), { recursive: true })
  try { renameSync(from, to) } catch (e) {
    if (e.code === 'EXDEV') { cpSync(from, to, { recursive: true }); rmSync(from, { recursive: true, force: true }) }
    else if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
      console.error(`无法移动 ${from}：里面有文件正被其他程序打开（浏览器打开着交互版、编辑器或资源管理器预览）。关闭后重新运行。`)
      process.exit(1)
    } else throw e
  }
}

// 1 上一次的输出
const diag = join(ws, 'diagrams')
if (existsSync(diag) && walk(diag).length) {
  move(diag, join(dst, 'diagrams'))
  console.log(`上一次的 diagrams/ 已移到 ${join(dst, 'diagrams')}`)
} else if (existsSync(diag)) rmSync(diag, { recursive: true, force: true })

// 2 输入文件
const seeds = join(ROOT, cs.seedDir) // 仓库里的种子（不是示例工程里的副本）
for (const rel of cs.inputs) {
  const p = join(ws, rel)
  const seed = join(seeds, rel.split('/').pop())
  if (!existsSync(seed)) { console.error(`仓库里没有种子文件：${seed}`); process.exit(2) }
  if (existsSync(p) && sha1(p) === sha1(seed)) continue
  if (existsSync(p)) { move(p, join(dst, rel)); console.log(`输入 ${rel} 被改过：改过的版本存到 ${join(dst, rel)}`) }
  mkdirSync(join(p, '..'), { recursive: true })
  cpSync(seed, p)
  console.log(`输入 ${rel} 已恢复为仓库里的原样`)
}

// 3 记下工作区现状
const files = Object.fromEntries(walk(ws).map((f) => [f.rel, { size: f.size, mtimeMs: f.mtimeMs }]))
writeFileSync(join(res, `prepared-${name}.json`), JSON.stringify({ case: name, at: Date.now(), ws, files }, null, 1))

console.log(`\n工作区已就绪：${join(ws, 'docs')} 下有 ${cs.inputs.map((r) => r.split('/').pop()).join('、')}，没有 diagrams/。`)
console.log('在 AstroLab 中打开“示例工程”，选“信息流梳理”技能，新建任务，输入：\n')
console.log(cs.prompt)
console.log(`\n智能体提问时按 evals/info-flow/${name}/答案表.md 第 0 节回答。完成后运行：node evals/info-flow/score.mjs ${name === 'pcu' ? '' : name}`.trimEnd())
