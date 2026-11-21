// 网页入口：工作台还在这台电脑上运行，代码留在本机；在浏览器里打开 http://IP:端口 用的是同一个工作台
// （同一套接口、同一份状态，桌面窗口和浏览器看到的一样）。只用 Node 自带模块。
//
// 安全：智能体能在这台电脑上读写文件、执行命令，所以网页入口一定要口令，默认只许本机访问（127.0.0.1），
// “允许局域网访问”要在设置里明确打开。
//   - 登录：/login 输口令，换一个会话 Cookie（HttpOnly、SameSite=Strict）；口令比较用定长比较；同一地址连错 10 次锁 10 分钟
//   - 接口：POST /api/invoke 要带 X-AstroLab 头（别的网站发不出这个头，挡跨站请求），Origin 要和 Host 一致
//   - 事件：GET /api/events（Server-Sent Events），主进程发给界面的事件都广播到这里
//   - 预览：/preview/<相对路径> 只给 HTML，带 CSP 沙箱（页面里的脚本是不透明来源，碰不到接口和 Cookie）
//   - 下载：/api/file?pid=&rel= 工程里的文件，路径不许越出工程（网页里“用默认程序打开”改为下载）
// 配置在 <数据目录>/web.json：{ enabled, port, lan, token }

import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'

export const DEFAULT_PORT = 8620
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' }
const PREVIEW_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'"
const SESSION_MS = 7 * 24 * 3600_000
const MAX_FAILS = 10
const LOCK_MS = 10 * 60_000

/**
 * 从 preload.cjs 读出界面接口表：{ 'task.start': 'task:start', getState: 'app:state', ... }。
 * 网页客户端按它把同名方法变成 HTTP 调用，桌面和网页永远是同一套接口（preload 加了接口，网页自动有）
 */
export function parsePreloadMap(src) {
  const map = {}
  let group = null
  for (const line of String(src).split(/\r?\n/)) {
    let m = /^ {2}(\w+): \{\s*$/.exec(line)
    if (m) { group = m[1]; continue }
    if (/^ {2}\},?\s*$/.test(line)) { group = null; continue }
    m = /^\s+(\w+): \([^)]*\) => invoke\('([^']+)'/.exec(line)
    if (m) map[group && /^ {4}/.test(line) ? `${group}.${m[1]}` : m[1]] = m[2]
  }
  return map
}

/** 本机的 IPv4 地址（局域网访问时显示给人看） */
export function lanAddresses() {
  const out = []
  for (const list of Object.values(networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address)
  return out
}

const sha = (s) => createHash('sha256').update(String(s)).digest()
const sameText = (a, b) => timingSafeEqual(sha(a), sha(b))
const newToken = () => randomBytes(9).toString('base64url') // 12 个字符，好抄
const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return ''
}

function loginPage(msg = '') {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AstroLab 登录</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F3F1F9;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:#1C1B22}
form{width:320px;padding:28px;border-radius:18px;background:#fff;box-shadow:0 8px 30px rgba(60,50,120,.12)}h1{margin:0 0 6px;font-size:20px}p{margin:0 0 16px;color:#5F5D6B;font-size:13px;line-height:1.6}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #DDD8EE;border-radius:10px;font-size:15px;outline:none}input:focus{border-color:#8B7CF6}
button{margin-top:14px;width:100%;padding:10px;border:0;border-radius:10px;background:#8B7CF6;color:#fff;font-size:14px;cursor:pointer}.err{color:#A61B1B;margin-top:10px;font-size:13px}</style></head>
<body><form method="post" action="/login"><h1>AstroLab</h1><p>输入访问口令。口令在工作台的“设置 → 网页访问”里。</p>
<input name="token" type="password" autocomplete="current-password" autofocus required placeholder="访问口令"><button type="submit">进入工作台</button>${msg ? `<div class="err">${msg}</div>` : ''}</form></body></html>`
}

export class WebService {
  /**
   * @param {object} o
   * @param {string} o.file            web.json
   * @param {string} o.distDir         界面的构建产物（index.html、assets/）
   * @param {Record<string, string>} [o.map]  接口表（main/api-map.json，由 scripts/gen-api-map.mjs 从 preload.cjs 生成）
   * @param {string} [o.preloadFile]   没给 map 时从 preload.cjs 现读（开发、测试用）
   * @param {Map<string, Function>} o.handlers  接口：通道名 → 处理函数（和桌面的 ipcMain.handle 是同一批）
   * @param {(rel: string) => string} o.previewFile     当前工程里要预览的 HTML 的绝对路径（越界抛出）
   * @param {(pid: string|undefined, rel: string) => string} o.projectFile  工程里要下载的文件的绝对路径（越界抛出）
   * @param {string} [o.platform]
   * @param {(...a: any[]) => void} [o.log]
   * @param {(s: object) => void} [o.onState]
   */
  constructor(o) {
    this.o = o
    this.server = null
    this.clients = new Set()
    this.sessions = new Map() // 会话 id → 到期时间
    this.fails = new Map() // 地址 → { n, until }
    this.error = null
    this.cfg = { enabled: false, port: DEFAULT_PORT, lan: false, token: '' }
    try { Object.assign(this.cfg, JSON.parse(readFileSync(o.file, 'utf8'))) } catch { /* 还没配置 */ }
    if (!this.cfg.token) { this.cfg.token = newToken(); this.save() }
    this.map = o.map || parsePreloadMap(readFileSync(o.preloadFile, 'utf8'))
  }

  save() { mkdirSync(dirname(this.o.file), { recursive: true }); writeFileSync(this.o.file, JSON.stringify(this.cfg, null, 1)) }
  get running() { return !!(this.server && this.server.listening) }

  state() {
    const hosts = this.cfg.lan ? lanAddresses() : ['127.0.0.1']
    return {
      enabled: !!this.cfg.enabled, running: this.running, port: this.cfg.port, lan: !!this.cfg.lan, token: this.cfg.token,
      urls: hosts.map((h) => `http://${h}:${this.cfg.port}`), clients: this.clients.size, error: this.error,
    }
  }

  /** 改设置：{ enabled?, port?, lan?, newToken? }；改了就按新设置重启服务。换口令会让已登录的浏览器都要重新登录 */
  async set(patch = {}) {
    if (patch.port !== undefined) {
      const p = Number(patch.port)
      if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('端口要在 1024～65535 之间')
      this.cfg.port = p
    }
    if (patch.lan !== undefined) this.cfg.lan = !!patch.lan
    if (patch.enabled !== undefined) this.cfg.enabled = !!patch.enabled
    if (patch.newToken) { this.cfg.token = newToken(); this.sessions.clear(); for (const c of this.clients) c.end(); this.clients.clear() }
    this.save()
    await this.stop()
    if (this.cfg.enabled) await this.start()
    return this.state()
  }

  start() {
    if (this.running) return Promise.resolve()
    this.error = null
    const host = this.cfg.lan ? '0.0.0.0' : '127.0.0.1'
    const server = createServer((req, res) => { this.route(req, res).catch((e) => this.fail(res, 500, e.message)) })
    server.keepAliveTimeout = 5000
    return new Promise((resolveP) => {
      server.once('error', (e) => {
        this.error = e.code === 'EADDRINUSE' ? `端口 ${this.cfg.port} 被别的程序占用了，换一个端口` : e.message
        if (this.o.log) this.o.log('网页服务启动失败', this.error)
        this.server = null
        this.emitState()
        resolveP()
      })
      server.listen(this.cfg.port, host, () => {
        this.server = server
        if (this.o.log) this.o.log(`网页服务：http://${host}:${this.cfg.port}`)
        this.emitState()
        resolveP()
      })
    })
  }

  stop() {
    const s = this.server
    this.server = null
    for (const c of this.clients) { try { c.end() } catch { /* 已断开 */ } }
    this.clients.clear()
    if (!s) return Promise.resolve()
    return new Promise((r) => { s.close(() => r()); if (s.closeAllConnections) s.closeAllConnections() }).then(() => this.emitState())
  }

  emitState() { if (this.o.onState) this.o.onState(this.state()) }

  /** 主进程发给界面的事件：同样推给所有打开的网页 */
  broadcast(msg) {
    if (!this.clients.size) return
    const line = `data: ${JSON.stringify(msg)}\n\n`
    for (const c of this.clients) { try { c.write(line) } catch { this.clients.delete(c) } }
  }

  fail(res, code, text) {
    if (res.headersSent) { try { res.end() } catch { /* 已断开 */ } return }
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  }

  authed(req) {
    const id = cookieOf(req, 'astrolab_session')
    const until = id && this.sessions.get(id)
    if (!until) return false
    if (until < Date.now()) { this.sessions.delete(id); return false }
    return true
  }

  /** 跨站检查：带 Origin 的请求，Origin 的主机要和 Host 一样 */
  sameOrigin(req) {
    const origin = req.headers.origin
    if (!origin) return true
    try { return new URL(origin).host === req.headers.host } catch { return false }
  }

  async body(req, limit = 32 * 1024 * 1024) {
    const chunks = []
    let n = 0
    for await (const c of req) { n += c.length; if (n > limit) throw new Error('请求太大'); chunks.push(c) }
    return Buffer.concat(chunks).toString('utf8')
  }

  async route(req, res) {
    const u = new URL(req.url, 'http://x')
    const path = decodeURIComponent(u.pathname)
    const ip = req.socket.remoteAddress || ''
    // 安全相关的响应头
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'same-origin') // 不能用 no-referrer：那样浏览器同源 POST 的 Origin 会变成 null，过不了同源检查

    if (path === '/login') {
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'cache-control': 'no-store' }); return res.end(loginPage()) }
      if (req.method !== 'POST' || !this.sameOrigin(req)) return this.fail(res, 403, '不允许')
      const f = this.fails.get(ip)
      if (f && f.until > Date.now()) { res.writeHead(429, { 'content-type': 'text/html; charset=utf-8' }); return res.end(loginPage('连错太多次，10 分钟后再试')) }
      const form = new URLSearchParams(await this.body(req, 4096))
      if (!sameText(form.get('token') || '', this.cfg.token)) {
        // 锁定过期了才从头数；没锁定时一直累加
        const expired = f && f.until && f.until <= Date.now()
        const n = (f && !expired ? f.n : 0) + 1
        this.fails.set(ip, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 })
        if (this.o.log) this.o.log(`网页登录失败：${ip}（第 ${n} 次）`)
        await new Promise((r) => setTimeout(r, 400))
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(loginPage('口令不对'))
      }
      this.fails.delete(ip)
      const id = randomBytes(24).toString('base64url')
      this.sessions.set(id, Date.now() + SESSION_MS)
      if (this.o.log) this.o.log(`网页登录：${ip}`)
      res.writeHead(303, { location: '/', 'set-cookie': `astrolab_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`, 'cache-control': 'no-store' })
      return res.end()
    }

    if (!this.authed(req)) {
      if (path.startsWith('/api/') || path.startsWith('/preview/')) return this.fail(res, 401, '要先登录')
      res.writeHead(303, { location: '/login' })
      return res.end()
    }

    if (path === '/logout') {
      this.sessions.delete(cookieOf(req, 'astrolab_session'))
      res.writeHead(303, { location: '/login', 'set-cookie': 'astrolab_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' })
      return res.end()
    }

    if (path === '/api/manifest') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(JSON.stringify({ map: this.map, platform: this.o.platform || process.platform }))
    }

    if (path === '/api/invoke') {
      if (req.method !== 'POST' || req.headers['x-astrolab'] !== '1' || !this.sameOrigin(req)) return this.fail(res, 403, '不允许')
      let msg
      try { msg = JSON.parse(await this.body(req)) } catch { return this.fail(res, 400, '请求不对') }
      const fn = this.o.handlers.get(String(msg.channel))
      let out
      if (!fn) out = { ok: false, error: `没有这个接口：${msg.channel}` }
      else {
        try { out = { ok: true, data: await fn(...(Array.isArray(msg.args) ? msg.args : [])) } } catch (e) { out = { ok: false, error: e && e.message ? e.message : String(e) } }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(JSON.stringify(out === undefined ? { ok: true } : out, (_k, v) => (v === undefined ? null : v)))
    }

    if (path === '/api/events') {
      if (!this.sameOrigin(req)) return this.fail(res, 403, '不允许')
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
      res.write(': ok\n\n')
      this.clients.add(res)
      const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* 已断开 */ } }, 25_000)
      req.on('close', () => { clearInterval(ping); this.clients.delete(res); this.emitState() })
      this.emitState()
      return
    }

    if (path === '/api/file') {
      let abs
      try { abs = this.o.projectFile(u.searchParams.get('pid') || undefined, u.searchParams.get('rel') || '') } catch (e) { return this.fail(res, 403, e.message) }
      if (!existsSync(abs) || !statSync(abs).isFile()) return this.fail(res, 404, '文件已经不在了')
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(abs).size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(abs))}`, 'cache-control': 'no-store' })
      return createReadStream(abs).pipe(res)
    }

    if (path.startsWith('/preview/')) {
      let abs
      try { abs = this.o.previewFile(path.slice('/preview/'.length)) } catch (e) { return this.fail(res, 403, e.message) }
      if (!/\.html?$/i.test(abs)) return this.fail(res, 403, '只预览 HTML')
      if (!existsSync(abs) || statSync(abs).size > 30 * 1024 * 1024) return this.fail(res, 404, '文件不存在或太大')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PREVIEW_CSP, 'cache-control': 'no-store' })
      return res.end(readFileSync(abs))
    }

    // 界面：dist 里的静态文件；其他路径都给 index.html
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.fail(res, 405, '不支持')
    const dist = resolve(this.o.distDir)
    let file = resolve(dist, normalize(path).replace(/^[\\/]+/, ''))
    const r = relative(dist, file)
    if (r.startsWith('..') || isAbsolute(r)) return this.fail(res, 403, '不允许')
    if (!existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html')
    if (!existsSync(file)) return this.fail(res, 500, '界面还没构建（app\\dev.ps1 会构建）')
    const isIndex = basename(file) === 'index.html'
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': isIndex ? 'no-store' : 'public, max-age=31536000, immutable',
      ...(isIndex ? { 'x-frame-options': 'DENY' } : {}),
    })
    if (req.method === 'HEAD') return res.end()
    return createReadStream(file).pipe(res)
  }
}
