// 读写文件：只在工作区（process.cwd() 或给定的 root）里。不删除文件、不联网。
//
// 覆盖规则（第一性原理：模型是唯一的权威来源，图是生成物）：
// - 模型文件 <名称>.flow.json：已存在且内容不同时不覆盖，除非 overwrite=true（它是人和智能体维护的源头）。
// - 生成的 .md / .svg：带生成标记的直接覆盖（改模型后重新出图是常态）；没有标记的（手写的同名文件）不覆盖，除非 overwrite=true。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { GENERATED_MARK } from './common.mjs'

const MAX_NAME = 60
export const SPEC_KEYS = ['title', 'source', 'direction', 'order', 'groups', 'flows']

export function workspace(root = process.cwd()) {
  const inside = (p) => {
    const abs = resolve(root, p)
    const rel = relative(root, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`路径不在工作区里：${p}`)
    return abs
  }
  const rel = (abs) => relative(root, abs).split(sep).join('/')
  return { root, inside, rel }
}

export function safeName(name, fallback = 'info-flow') {
  let base = String(name || fallback)
    .replace(/[\\/:*?"<>|\r\n]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (!base) base = fallback
  if (base.length > MAX_NAME) base = base.slice(0, MAX_NAME)
  return base
}

/**
 * 从工具参数取模型：要么直接给规格字段，要么给 specFile（工作区里的 .flow.json）。两者不能同时给。
 * 返回 { spec, base, dir, modelAbs, fromFile }
 */
export function resolveSpec(args, ws) {
  const inline = SPEC_KEYS.filter((k) => args[k] !== undefined)
  if (args.specFile !== undefined && args.specFile !== '') {
    if (inline.includes('groups') || inline.includes('flows')) throw new Error('specFile 和 groups/flows 只能给一种：要么从模型文件出图，要么直接给规格')
    const abs = ws.inside(String(args.specFile))
    if (!existsSync(abs)) throw new Error(`模型文件不存在：${args.specFile}`)
    let spec
    try { spec = JSON.parse(readFileSync(abs, 'utf8')) } catch (e) { throw new Error(`模型文件不是合法的 JSON：${args.specFile}（${e.message}）`) }
    // 视图文件名一律从模型文件名来（<模型名>-总图、-分图-…），这里不用 name：否则容易把视图名当文件名传进来，后缀叠两遍
    const base = basename(abs).replace(/\.flow\.json$|\.json$/i, '')
    const dir = args.outputDir ? ws.inside(String(args.outputDir)) : dirname(abs)
    return { spec, base, dir, modelAbs: abs, fromFile: true, nameIgnored: !!args.name && safeName(args.name) !== base }
  }
  const spec = {}
  for (const k of SPEC_KEYS) if (args[k] !== undefined) spec[k] = args[k]
  const base = safeName(args.name || spec.title)
  const dir = ws.inside(args.outputDir === undefined || args.outputDir === '' ? 'diagrams' : String(args.outputDir))
  return { spec, base, dir, modelAbs: join(dir, `${base}.flow.json`), fromFile: false }
}

export function modelText(spec) {
  const out = {}
  for (const k of SPEC_KEYS) if (spec[k] !== undefined) out[k] = spec[k]
  return JSON.stringify(out, null, 2) + '\n'
}

/** 写模型文件（直接给规格时）。返回 'created' | 'unchanged' | 'updated' */
export function saveModel(r, overwrite) {
  if (r.fromFile) return 'unchanged'
  const text = modelText(r.spec)
  if (existsSync(r.modelAbs)) {
    const old = readFileSync(r.modelAbs, 'utf8')
    let same = false
    try { same = JSON.stringify(JSON.parse(old)) === JSON.stringify(JSON.parse(text)) } catch { same = false }
    if (same) return 'unchanged'
    if (!overwrite) {
      throw new Error(`模型文件已存在且内容不同：${basename(r.modelAbs)}。如果这是新版模型，传 overwrite=true 覆盖（建议先提交 Git 留住旧版）；`
        + `如果只是换个视图出图，改用 specFile 指向这个文件。`)
    }
    mkdirSync(dirname(r.modelAbs), { recursive: true })
    writeFileSync(r.modelAbs, text, 'utf8')
    return 'updated'
  }
  mkdirSync(dirname(r.modelAbs), { recursive: true })
  writeFileSync(r.modelAbs, text, 'utf8')
  return 'created'
}

function isGenerated(abs) {
  try { return readFileSync(abs, 'utf8').slice(0, 600).includes(GENERATED_MARK) } catch { return false }
}

/** 写一组生成文件：先全部检查，再一起写，避免只写了一半 */
export function writeGenerated(files, overwrite, ws) {
  for (const f of files) {
    if (existsSync(f.abs) && !isGenerated(f.abs) && !overwrite) {
      throw new Error(`已有同名文件且不是本工具生成的：${ws.rel(f.abs)}；请换 name，或确认后传 overwrite=true 覆盖`)
    }
  }
  for (const f of files) {
    mkdirSync(dirname(f.abs), { recursive: true })
    writeFileSync(f.abs, f.text, 'utf8')
  }
  return files.map((f) => ws.rel(f.abs))
}
