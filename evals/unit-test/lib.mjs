// 评测公用函数
export function applyPatches(src, patches) {
  let out = src
  for (const p of patches) {
    const n = out.split(p.find).length - 1
    if (n !== 1) throw new Error(`${p.id}：要替换的文本出现 ${n} 次（应为 1 次）：${p.find.slice(0, 60)}`)
    out = out.replace(p.find, p.replace)
  }
  return out
}

// 由参考版生成工作区中的样例源码：应用 inSample 不为 false 的缺陷，有 sampleReplace 时用它代替 replace
export function buildSample(reference, defects) {
  return applyPatches(reference, defects.filter((d) => d.inSample !== false).map((d) => ({ ...d, replace: d.sampleReplace ?? d.replace })))
}

// 读取 config/local.env 中的变量（只补充当前环境中没有的），使评分脚本直接在 PowerShell 中运行时也能找到 UTEST_CC 等设置
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
export function loadLocalEnv(root) {
  const f = join(root, 'config', 'local.env')
  if (!existsSync(f)) return []
  const set = []
  for (const line of readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^"|"$/g, '')
    if (v && !process.env[k] && /^UTEST_/.test(k)) { process.env[k] = v; set.push(k) }
  }
  return set
}
