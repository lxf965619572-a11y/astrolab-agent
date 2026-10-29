#!/usr/bin/env node
// 准备概要设计评测的工作区：node evals/preliminary-design/prepare.mjs [用例名，默认 tcu]
// 把上一次的输出目录 doc/（以及 doc-<时间> 备份）移到 evals/preliminary-design/results/，
// 并删除工作区中的代码目录，避免智能体在新会话中读到并沿用。

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { announce } from '../sample-ws.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const name = process.argv[2] || 'tcu'
const ws = join(announce().dir, 'design', name) // AstroLab 示例工程里的副本，见 ../sample-ws.mjs
if (!existsSync(join(ws, 'docs'))) { console.error(`工作区 ${ws} 中没有 docs/（输入文件），检查用例名`); process.exit(2) }

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
console.log(`${ws} 中只有 docs/（需求规格说明、硬件接口说明、通信协议）。在 DSH 中新建会话后再测试。`)
