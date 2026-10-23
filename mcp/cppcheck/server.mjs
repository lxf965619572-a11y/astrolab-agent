#!/usr/bin/env node
// Cppcheck MCP 服务：把 Cppcheck 封装成智能体可调用的工具。
// 传输方式：stdio（由 DSH 的 dsh-mcp-client 插件拉起）。
//
// 环境变量：
//   CPPCHECK_PATH         cppcheck 可执行文件路径（默认在 PATH 中查找，Windows 下再探测默认安装目录）
//   CPPCHECK_SUPPRESSIONS 部门抑制清单文件路径（可选）
//   CPPCHECK_TIMEOUT_MS   单次分析超时，默认 600000（10 分钟）

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const TIMEOUT_MS = Number(process.env.CPPCHECK_TIMEOUT_MS) || 600_000
const MAX_FINDINGS = 300

// 目标平台 → Cppcheck 平台参数。SPARC（BM3803/3823/3883）为 32 位大端；
// Cppcheck 的 --platform 只影响类型长度，不模拟字节序，字节序问题靠走查检查表。
const PLATFORMS = {
  sparc: { platform: 'unix32', std: 'c99', note: 'SPARC V8，32 位，大端' },
  d2000: { platform: 'unix64', std: 'c11', note: 'ARMv8 Linux，64 位，小端' },
  host: { platform: 'native', std: 'c11', note: '本机' },
}

function findCppcheck() {
  if (process.env.CPPCHECK_PATH) return process.env.CPPCHECK_PATH
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (!base) continue
      const p = join(base, 'Cppcheck', 'cppcheck.exe')
      if (existsSync(p)) return p
    }
  }
  return 'cppcheck'
}
const CPPCHECK = findCppcheck()

function run(args, cwd) {
  return new Promise((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(CPPCHECK, args, { cwd, windowsHide: true })
    } catch (err) {
      resolvePromise({ code: -1, stdout, stderr: String(err) })
      return
    }
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolvePromise({ code: -1, stdout, stderr: `${stderr}\n${err.message}` })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolvePromise({ code: signal ? -1 : code, stdout, stderr, timedOut: signal != null })
    })
  })
}

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&')

function attrs(tag) {
  const out = {}
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2])
  return out
}

// 解析 cppcheck --xml-version=2 输出（写在 stderr 中）
function parseXml(xml) {
  const findings = []
  for (const m of xml.matchAll(/<error\b([^>]*?)(\/>|>([\s\S]*?)<\/error>)/g)) {
    const a = attrs(m[1])
    const body = m[3] || ''
    const locs = [...body.matchAll(/<location\b([^>]*?)\/?>/g)].map((l) => attrs(l[1]))
    const first = locs[0] || {}
    findings.push({
      id: a.id,
      severity: a.severity,
      message: a.msg,
      cwe: a.cwe ? Number(a.cwe) : undefined,
      file: first.file,
      line: first.line ? Number(first.line) : undefined,
      column: first.column ? Number(first.column) : undefined,
      inconclusive: a.inconclusive === 'true' || undefined,
      related: locs.length > 1 ? locs.slice(1).map((l) => `${l.file}:${l.line}`) : undefined,
    })
  }
  return findings
}

const server = new McpServer({ name: 'dept-cppcheck', version: '0.1.0' }, {
  instructions:
    '部门 Cppcheck 静态分析服务。调用 run_cppcheck 前先确认目标平台（sparc 或 d2000）；' +
    '告警需逐条阅读源码判定真伪，误报写明理由。',
})

server.registerTool('cppcheck_version', {
  description: '返回本机 Cppcheck 的版本，用于确认工具可用。',
  inputSchema: {},
}, async () => {
  const r = await run(['--version'])
  if (r.code !== 0) {
    return { isError: true, content: [{ type: 'text', text: `无法运行 cppcheck（${CPPCHECK}）：${r.stderr.trim()}。请安装 Cppcheck 或设置 CPPCHECK_PATH。` }] }
  }
  return { content: [{ type: 'text', text: r.stdout.trim() }] }
})

server.registerTool('run_cppcheck', {
  description:
    '对 C 源文件或目录运行 Cppcheck 静态分析，返回结构化告警列表（规则 ID、严重程度、文件、行号、消息）。' +
    '路径相对于当前工作区。',
  inputSchema: {
    paths: z.array(z.string()).min(1).describe('要分析的源文件或目录（相对工作区或绝对路径）'),
    target: z.enum(['sparc', 'd2000', 'host']).describe('目标平台：sparc=BM3803/3823/3883，d2000=飞腾 D2000 Linux，host=本机'),
    includeDirs: z.array(z.string()).optional().describe('头文件目录（-I）'),
    defines: z.array(z.string()).optional().describe('预定义宏，如 "BM3803" 或 "DEBUG=0"（-D）'),
    enable: z.string().optional().describe('检查类别，默认 "warning,style,performance,portability"'),
    inconclusive: z.boolean().optional().describe('是否报告不确定的告警，默认 true'),
    misra: z.boolean().optional().describe('是否启用 MISRA 插件（需 Cppcheck 自带 misra 插件；规则原文需另行配置）'),
  },
}, async ({ paths, target, includeDirs = [], defines = [], enable, inconclusive = true, misra = false }) => {
  const cwd = process.cwd()
  const missing = paths.filter((p) => !existsSync(isAbsolute(p) ? p : resolve(cwd, p)))
  if (missing.length) {
    return { isError: true, content: [{ type: 'text', text: `路径不存在：${missing.join(', ')}（工作区：${cwd}）` }] }
  }
  const plat = PLATFORMS[target]
  const args = [
    `--enable=${enable || 'warning,style,performance,portability'}`,
    `--platform=${plat.platform}`,
    `--std=${plat.std}`,
    '--language=c',
    '--xml', '--xml-version=2',
    '--quiet',
  ]
  if (inconclusive) args.push('--inconclusive')
  for (const d of includeDirs) args.push(`-I${d}`)
  for (const d of defines) args.push(`-D${d}`)
  if (process.env.CPPCHECK_SUPPRESSIONS && existsSync(process.env.CPPCHECK_SUPPRESSIONS)) {
    args.push(`--suppressions-list=${process.env.CPPCHECK_SUPPRESSIONS}`)
  }
  if (misra) args.push('--addon=misra')
  args.push(...paths)

  const r = await run(args, cwd)
  if (r.timedOut) {
    return { isError: true, content: [{ type: 'text', text: `Cppcheck 超时（${TIMEOUT_MS / 1000} 秒）。请缩小分析范围。` }] }
  }
  if (!r.stderr.includes('<results')) {
    return { isError: true, content: [{ type: 'text', text: `Cppcheck 运行失败（${CPPCHECK}，退出码 ${r.code}）：${(r.stderr || r.stdout).slice(0, 2000)}` }] }
  }
  const all = parseXml(r.stderr)
  const bySeverity = {}
  for (const f of all) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1
  const result = {
    target: `${target}（${plat.note}）`,
    command: `cppcheck ${args.join(' ')}`,
    total: all.length,
    bySeverity,
    truncated: all.length > MAX_FINDINGS,
    findings: all.slice(0, MAX_FINDINGS),
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  }
})

server.registerTool('explain_check', {
  description: '查询某个 Cppcheck 规则 ID（如 arrayIndexOutOfBounds）的说明，用于告警甄别。',
  inputSchema: { id: z.string().describe('Cppcheck 规则 ID') },
}, async ({ id }) => {
  const r = await run(['--errorlist'])
  if (r.code !== 0) return { isError: true, content: [{ type: 'text', text: r.stderr || '无法获取规则列表' }] }
  const hit = parseXml(r.stdout).find((f) => f.id === id)
  if (!hit) return { content: [{ type: 'text', text: `未找到规则 ${id}。` }] }
  return { content: [{ type: 'text', text: `${id}（${hit.severity}${hit.cwe ? `，CWE-${hit.cwe}` : ''}）：${hit.message}` }] }
})

await server.connect(new StdioServerTransport())
