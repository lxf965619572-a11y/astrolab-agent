#!/usr/bin/env node
// 准备详细设计评测的工作区：
//   node evals/detailed-design/prepare.mjs forward   正向模式：工作区中只有文档（删除代码）
//   node evals/detailed-design/prepare.mjs reverse   逆向模式：把代码复制到工作区
// 两种模式都会把上一次的输出目录 doc/ 移到 evals/detailed-design/results/，避免智能体在新会话中读到并沿用。

import { cpSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { announce } from '../sample-ws.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const mode = process.argv[2]
const name = process.argv[3] || 'oc_ctrl'
if (!['forward', 'reverse'].includes(mode)) { console.error('用法：node evals/detailed-design/prepare.mjs forward|reverse [用例名，默认 oc_ctrl]'); process.exit(2) }

const ws = join(announce().dir, 'design', name) // AstroLab 示例工程里的副本，见 ../sample-ws.mjs
const code = join(HERE, name, 'src')
const out = join(ws, 'doc')
// 上一次的输出（doc，以及旧版本脚本留下的 doc-<时间> 备份）移出工作区，放到 evals/detailed-design/results/，
// 避免智能体在新会话中读到并沿用上一次的设计
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const olds = readdirSync(ws).filter((d) => d === 'doc' || /^doc-\d{8}T\d+$/.test(d))
const resDir = join(HERE, 'results')
for (const d of olds) {
  const dst = join(resDir, `${stamp}-${name}-${d}`)
  mkdirSync(resDir, { recursive: true })
  try {
    renameSync(join(ws, d), dst)
  } catch (e) {
    if (e.code === 'EXDEV') { cpSync(join(ws, d), dst, { recursive: true }); rmSync(join(ws, d), { recursive: true, force: true }) }
    else if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
      // Windows：目录中有文件被打开（常见是 Word 正打开着生成的文档）时不能移动
      console.error(`无法移动 ${join(ws, d)}：其中有文件正被其他程序打开（常见是 Word/WPS 正打开着生成的文档，或资源管理器正在预览）。`)
      console.error('请关闭这些文件后重新运行本命令。')
      process.exit(1)
    } else throw e
  }
  console.log(`上一次的输出 ${d} 已移到 ${dst}`)
}
for (const d of ['src', 'include']) rmSync(join(ws, d), { recursive: true, force: true })
if (mode === 'reverse') {
  for (const d of ['src', 'include']) cpSync(join(code, d), join(ws, d), { recursive: true })
  console.log(`逆向模式：已把代码复制到 ${join(ws, 'src')}、${join(ws, 'include')}`)
} else {
  console.log(`正向模式：${ws} 中只有 docs/（需求规格说明、概要设计说明、控制器接口说明）`)
}
console.log('在 DSH 中新建会话后再测试。')
