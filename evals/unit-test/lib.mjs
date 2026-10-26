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

// 读取用例配置，统一为多文件格式：
//   files：被测文件 [{ name, reference（相对用例目录）, sample（相对工程根目录） }]
//   programs：测试程序 [{ name, sources: [文件名], testSubdir }]；testSubdir 为 null 表示整个测试目录是一个测试程序
// 旧格式（reference、sampleSource、sourceName 单个文件）转换为一个文件、一个测试程序
import { dirname as _dirname } from 'node:path'
export function loadCase(caseDir) {
  const cfg = JSON.parse(readFileSync(join(caseDir, 'case.json'), 'utf8'))
  if (!cfg.files) {
    cfg.files = [{ name: cfg.sourceName, reference: cfg.reference, sample: cfg.sampleSource }]
    cfg.sampleSrcDir = cfg.sampleSrcDir || _dirname(cfg.sampleSource)
  }
  if (!cfg.programs) cfg.programs = [{ name: cfg.files[0].name.replace(/\.c$/, ''), sources: cfg.files.map((f) => f.name), testSubdir: null }]
  for (const f of cfg.files) f.text = readFileSync(join(caseDir, f.reference), 'utf8')
  return cfg
}

// 缺陷、变异体的 file 字段（省略时为唯一的被测文件）
export const patchFile = (cfg, p) => p.file || cfg.files[0].name

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
