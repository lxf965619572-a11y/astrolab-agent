#!/usr/bin/env node
// 准备编码评测的工作区：AstroLab 示例工程里的 coding/<用例名>（示例工程的位置见 lib.mjs 的 sampleWorkspace）：
//   - 详细设计和头文件恢复为 evals/coding/<用例名>/inputs/ 中的原样（上一次如果被改过，也恢复）；
//   - 其余文件（上一次写的代码、编码说明、.utest 等）移到 evals/coding/results/<时间>-<用例名>-上次输出/，
//     避免智能体在新会话中读到并沿用。
// 用法：node evals/coding/prepare.mjs [用例名，默认 thm_ctrl]
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { caseDir, HERE, readText, sampleWorkspace, walk } from './lib.mjs'

const name = process.argv[2] || 'thm_ctrl'
const inputs = join(caseDir(name), 'inputs')
if (!existsSync(inputs)) { console.error(`没有这个用例：${name}`); process.exit(2) }
const sw = sampleWorkspace()
const ws = join(sw.dir, 'coding', name)
console.log(`示例工程：${sw.dir}（${sw.from}）`)
mkdirSync(ws, { recursive: true })

const keep = new Set(walk(inputs).map((f) => relative(inputs, f)))
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const dst = join(HERE, 'results', `${stamp}-${name}-上次输出`)
let moved = 0
for (const e of readdirSync(ws, { withFileTypes: false })) {
  const p = join(ws, e)
  const isDir = statSync(p).isDirectory()
  // 输入目录（doc、include）里只移走不是输入的文件；其他目录整个移走
  const files = isDir && [...keep].some((k) => k.startsWith(e + '/') || k.startsWith(e + '\\')) ? walk(p) : [p]
  for (const f of files) {
    const rel = relative(ws, f)
    if (keep.has(rel)) continue
    mkdirSync(join(dst, rel, '..'), { recursive: true })
    try { renameSync(f, join(dst, rel)) } catch (err) {
      if (err.code === 'EXDEV') { cpSync(f, join(dst, rel), { recursive: true }); rmSync(f, { recursive: true, force: true }) }
      else if (['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        console.error(`无法移动 ${f}：文件正被其他程序打开（编辑器、资源管理器预览等）。关闭后重新运行。`)
        process.exit(1)
      } else throw err
    }
    moved++
  }
}
// 移走后留下的空目录（.utest 等）
for (const e of readdirSync(ws)) {
  const p = join(ws, e)
  if (statSync(p).isDirectory() && !walk(p).length && ![...keep].some((k) => k.startsWith(e))) rmSync(p, { recursive: true, force: true })
}
// 输入文件被改过的，先把改过的版本存一份再恢复
for (const r of keep) {
  const p = join(ws, r)
  if (existsSync(p) && readText(p) !== readText(join(inputs, r))) {
    mkdirSync(join(dst, r, '..'), { recursive: true })
    cpSync(p, join(dst, r))
    console.log(`输入文件 ${r} 被改过：改过的版本存到 ${join(dst, r)}，已恢复原样`)
    moved++
  }
}
cpSync(inputs, ws, { recursive: true, force: true })
if (moved) console.log(`上一次的输出 ${moved} 个文件已移到 ${dst}`)
console.log(`工作区 ${ws} 已就绪：只有 doc\\${name}-详细设计.md 和 include\\ 下的头文件。`)
console.log('在 AstroLab 中打开 sample 工作区，切到“编码”模式，新建任务后再测试（提示词见 evals\\coding\\README.md）。')
