// 评测公共函数：读环境、读 DSH 会话日志、解析模型输出
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(EVAL_DIR, '..')

// 读取 config/local.env（已存在的环境变量优先）
export function loadLocalEnv(file = path.join(ROOT, 'config', 'local.env')) {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 1) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim().replace(/^"|"$/g, '')
    if (v !== '' && process.env[k] === undefined) process.env[k] = v
  }
}

export const sha1 = (file) => fs.existsSync(file)
  ? crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10)
  : null

// DSH 会话日志是多个 zstd 帧首尾相接，逐帧解压
export function readZstdFrames(buf) {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const offs = []
  for (let i = buf.indexOf(MAGIC); i >= 0; i = buf.indexOf(MAGIC, i + 1)) offs.push(i)
  offs.push(buf.length)
  const out = []
  let s = 0
  while (s < offs.length - 1) {
    let e = s + 1
    let ok = false
    while (e < offs.length) {
      try { out.push(zlib.zstdDecompressSync(buf.subarray(offs[s], offs[e]))); ok = true; break } catch { e++ }
    }
    if (!ok) break
    s = e
  }
  return Buffer.concat(out).toString('utf8')
}

function listSessionFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) listSessionFiles(p, acc)
    else if (/^session\..*\.jsonl(\.zstd)?$/.test(ent.name)) acc.push(p)
  }
  return acc
}

const normPath = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase()

// 找到 cwd 为 workDir 的会话，统计步数与工具调用
export function sessionStats(dshHome, workDir, sinceMs) {
  const want = normPath(workDir)
  for (const f of listSessionFiles(path.join(dshHome, 'sessions'))) {
    if (fs.statSync(f).mtimeMs < sinceMs - 5000) continue
    let text
    try {
      const buf = fs.readFileSync(f)
      text = f.endsWith('.zstd') ? readZstdFrames(buf) : buf.toString('utf8')
    } catch { continue }
    const events = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const head = events.find((e) => e.type === 'session')
    if (!head || normPath(head.cwd || '') !== want) continue
    const callEvents = events.filter((e) => e.type === 'tool/call')
    const calls = callEvents.map((e) => e.data?.name)
    // 工具参数里出现答案文件或评测目录，说明模型可能看过标准答案
    const peeked = callEvents.some((e) => /case\.json|meta\.json|code-review[\\/](cases|templates)|dsh-evals[\\/][^"]*[\\/]\.\.|evals[\\/]results/i.test(String(e.data?.arguments ?? '')))
    const byTool = {}
    for (const n of calls) byTool[n] = (byTool[n] || 0) + 1
    const ctx = events.find((e) => e.type === 'request/context')?.data
    // 汇总各步的 token 用量（字段名以 DSH 0.2.1 会话日志为准）
    const tokens = {}
    const walk = (o) => {
      if (Array.isArray(o)) { o.forEach(walk); return }
      if (!o || typeof o !== 'object') return
      for (const [k, v] of Object.entries(o)) {
        if (k === 'usage' && v && typeof v === 'object') {
          for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'number') tokens[kk] = (tokens[kk] || 0) + vv
        } else walk(v)
      }
    }
    events.forEach((e) => walk(e.data))
    return {
      sessionFile: f,
      model: ctx ? `${ctx.provider}/${ctx.model}` : null,
      steps: events.filter((e) => e.type === 'step/end').length,
      toolCalls: calls.length,
      byTool,
      tokens,
      usedSkill: calls.includes('skill'),
      usedCppcheck: calls.some((n) => n?.startsWith('mcp__cppcheck__run')),
      peeked,
    }
  }
  return null
}

// 从模型写的 findings.json 中尽量解析出数组
export function parseFindings(text) {
  if (text == null) return { ok: false, error: '未生成 findings.json', items: [] }
  let t = text.replace(/^﻿/, '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const a = t.indexOf('[')
  const b = t.lastIndexOf(']')
  if (a < 0 || b < a) return { ok: false, error: '找不到 JSON 数组', items: [] }
  try {
    const arr = JSON.parse(t.slice(a, b + 1))
    if (!Array.isArray(arr)) return { ok: false, error: '不是数组', items: [] }
    return { ok: true, items: arr.filter((x) => x && typeof x === 'object') }
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${err.message}`, items: [] }
  }
}
