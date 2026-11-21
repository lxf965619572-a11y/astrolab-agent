#!/usr/bin/env node
// 安装前核对安装包是否完整：按包里的 manifest.json 逐个看文件在不在、大小对不对（不算 sha256，几秒钟）。
// 由 install.cmd 调用；也可以手动运行：tools\node\node.exe app\packaging\verify-package.mjs <安装包目录>
// 2026-11-21：压缩包拷到另一台电脑解压后只剩 2.8 万个文件（应为 8.5 万个），install.cmd 照样提示 Done，
// 打开时才发现缺 AstroLab.exe。所以装之前先核对，缺了就停下。
// 输出用英文：cmd 窗口的代码页不一定是 UTF-8。退出码：0 完整，1 缺文件或大小不对，2 没有清单
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] || '.')
let m
try { m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) } catch {
  console.log('No manifest.json in the package folder: cannot verify it (older package?). Continuing.')
  process.exit(2)
}
const files = Array.isArray(m.files) ? m.files : Object.entries(m.files || {}).map(([path, v]) => ({ path, ...v }))
const missing = [], wrong = []
for (const f of files) {
  try { const s = statSync(join(dir, f.path)); if (typeof f.size === 'number' && s.size !== f.size) wrong.push(f.path) } catch { missing.push(f.path) }
}
const total = files.reduce((a, f) => a + (f.size || 0), 0)
if (!missing.length && !wrong.length) {
  console.log(`Package OK: version ${m.version}, ${files.length} files, ${(total / 1073741824).toFixed(2)} GB`)
  process.exit(0)
}
console.log(`PACKAGE INCOMPLETE: version ${m.version} should have ${files.length} files (${(total / 1073741824).toFixed(2)} GB).`)
if (missing.length) console.log(`  ${missing.length} files missing, e.g.:\n    ${missing.slice(0, 5).join('\n    ')}`)
if (wrong.length) console.log(`  ${wrong.length} files have the wrong size (copy cut short?), e.g.:\n    ${wrong.slice(0, 5).join('\n    ')}`)
process.exit(1)
