#!/usr/bin/env node
// 阶段 0 最小界面：本机网页（只监听 127.0.0.1），通过引擎适配层原型驱动 DSH sdk 模式。
// 验证：事件实时显示、停止（结束引擎进程）、恢复会话后继续、越界操作被拒绝时的提示。
// 用法：由 spike\sdk\run.ps1 -Mode ui 启动，浏览器打开 http://127.0.0.1:3090

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { Engine, describeEvent } from './engine.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DSH_BIN = process.env.SPIKE_DSH_BIN || join(ROOT, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const WORKSPACE = resolve(process.env.SPIKE_WORKSPACE || join(ROOT, 'sample'))
const PORT = Number(process.env.SPIKE_PORT || 3090)
const LOGDIR = process.env.SPIKE_LOGDIR || join(ROOT, 'runtime', 'spike')
mkdirSync(LOGDIR, { recursive: true })
const DENY = /denied|not permitted|sandbox|拒绝|不允许|无权|access is denied/i

let engine = null
let state = 'stopped' // stopped | starting | idle | running
let sessionId = `ui-${Date.now()}`
const clients = new Set()
const history = []

function push(msg) {
  history.push(msg)
  if (history.length > 2000) history.shift()
  const data = `data: ${JSON.stringify(msg)}\n\n`
  for (const res of clients) res.write(data)
}
function setState(s, note) { state = s; push({ kind: 'state', state, sessionId, note }) }

async function ensureEngine(resume) {
  if (engine && engine.alive) return
  setState('starting')
  engine = new Engine({
    dshBin: DSH_BIN, cwd: WORKSPACE, env: process.env, logFile: join(LOGDIR, `ui-${sessionId}.jsonl`),
    provider: process.env.SPIKE_PROVIDER || 'dept-llm', model: process.env.DEPT_LLM_MODEL || 'deepseek-flash', reasoningEffort: process.env.SPIKE_REASONING || 'high',
  })
  engine.on('session.event', (p) => {
    const d = describeEvent(p.event)
    if (d.kind === 'other') return
    if (d.kind === 'tool-result' && (d.isError || DENY.test(d.text))) d.denied = DENY.test(d.text)
    push({ ...d, sessionId: p.sessionId, t: p.event.time })
  })
  engine.on('session.status', (p) => setState(p.status === 'running' ? 'running' : 'idle'))
  engine.on('exit', () => { if (state !== 'stopped') setState('stopped', '引擎进程已退出') })
  const r = await engine.start()
  push({ kind: 'note', text: `引擎就绪（${r.ms} ms）` })
  if (resume) {
    await engine.resume(sessionId)
    push({ kind: 'note', text: '已恢复会话，可以继续对话' })
  }
  setState('idle')
}

async function body(req) {
  let s = ''
  for await (const c of req) s += c
  return s ? JSON.parse(s) : {}
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(readFileSync(join(HERE, 'index.html')))
    }
    if (req.method === 'GET' && req.url === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      clients.add(res)
      res.write(`data: ${JSON.stringify({ kind: 'hello', workspace: WORKSPACE, state, sessionId, history })}\n\n`)
      req.on('close', () => clients.delete(res))
      return
    }
    if (req.method === 'POST' && req.url === '/api/prompt') {
      const { text } = await body(req)
      await ensureEngine(false)
      push({ kind: 'user', text })
      await engine.prompt(sessionId, text)
      return res.end('{}')
    }
    if (req.method === 'POST' && req.url === '/api/stop') {
      setState('stopped', '已停止')
      const ms = engine ? await engine.kill() : 0
      push({ kind: 'note', text: `已停止（结束引擎进程 ${ms} ms）。对话和已写的文件都保留，点“继续”恢复会话。` })
      return res.end('{}')
    }
    if (req.method === 'POST' && req.url === '/api/resume') {
      await ensureEngine(true)
      return res.end('{}')
    }
    if (req.method === 'POST' && req.url === '/api/new') {
      if (engine && engine.alive) await engine.shutdown()
      sessionId = `ui-${Date.now()}`
      history.length = 0
      setState('stopped', '新会话')
      return res.end('{}')
    }
    res.writeHead(404); res.end()
  } catch (e) {
    push({ kind: 'error', text: e.message })
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }))
  }
})
server.listen(PORT, '127.0.0.1', () => console.log(`打开 http://127.0.0.1:${PORT} （工作区：${WORKSPACE}；按 Ctrl+C 退出）`))
process.on('SIGINT', async () => { if (engine) await engine.kill(); process.exit(0) })
