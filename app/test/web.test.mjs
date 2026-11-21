// 网页入口：要口令；接口要带 X-AstroLab 头且同源；事件经 SSE 推到浏览器；预览带沙箱；下载不许越出工程；接口表和 preload 一致
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebService, parsePreloadMap, sameNetwork } from '../main/web.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRELOAD = join(HERE, '..', 'main', 'preload.cjs')

function rig(t) {
  const root = mkdtempSync(join(tmpdir(), 'astro-web-'))
  const dist = join(root, 'dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!DOCTYPE html><title>AstroLab</title>')
  writeFileSync(join(dist, 'assets', 'a.js'), 'console.log(1)')
  const proj = join(root, 'proj')
  mkdirSync(join(proj, 'out'), { recursive: true })
  writeFileSync(join(proj, 'out', 'r.html'), '<script>fetch("/api/manifest")</script>')
  writeFileSync(join(proj, 'out', '报告.md'), '# 报告')
  writeFileSync(join(root, 'secret.txt'), 'x')
  const inProj = (rel) => { const abs = resolve(proj, rel); const r = relative(proj, abs); if (r.startsWith('..') || isAbsolute(r)) throw new Error('路径越出工程'); return abs }
  const handlers = new Map([
    ['task:start', async (input) => ({ id: 't1', prompt: input.prompt })],
    ['task:stop', async () => undefined],
    ['boom', async () => { throw new Error('出错了') }],
  ])
  const web = new WebService({ file: join(root, 'web.json'), distDir: dist, preloadFile: PRELOAD, handlers, previewFile: inProj, projectFile: (_pid, rel) => inProj(rel), platform: 'win32' })
  t.after(() => web.stop())
  return { web, root }
}
const PORT = () => 20000 + Math.floor(Math.random() * 20000)
async function login(base, token) {
  const r = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ token }), redirect: 'manual', headers: { origin: base } })
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }
}

test('接口表：preload 里每个 invoke 都有；分组和方法名照 preload', () => {
  const src = readFileSync(PRELOAD, 'utf8')
  const map = parsePreloadMap(src)
  assert.equal(Object.keys(map).length, (src.match(/invoke\('/g) || []).length)
  assert.equal(map.getState, 'app:state')
  assert.equal(map['task.reset'], 'task:new')
  assert.equal(map['schedule.runNow'], 'schedule:runNow')
  // 主进程用的 api-map.json 要和 preload 同步（preload 加了接口后运行 node app/scripts/gen-api-map.mjs）
  const saved = JSON.parse(readFileSync(join(HERE, '..', 'main', 'api-map.json'), 'utf8'))
  assert.deepEqual(saved, map, 'main/api-map.json 和 preload.cjs 不一致：运行 node app/scripts/gen-api-map.mjs')
})

test('默认不开；开了只听本机；口令错不让进，对了给会话；没登录的接口 401、页面跳登录', async (t) => {
  const { web, root } = rig(t)
  assert.equal(web.running, false)
  assert.ok(web.state().token.length >= 12)
  const port = PORT()
  const st = await web.set({ enabled: true, port })
  assert.equal(st.running, true)
  assert.deepEqual(st.urls, [`http://127.0.0.1:${port}`])
  assert.equal(JSON.parse(readFileSync(join(root, 'web.json'), 'utf8')).enabled, true)
  const base = `http://127.0.0.1:${port}`
  assert.equal((await fetch(`${base}/api/manifest`)).status, 401)
  // 不能是 no-referrer：浏览器同源 POST 的 Origin 会变成 null，登录和接口都过不了同源检查（浏览器里实测发现的）
  assert.equal((await fetch(`${base}/login`)).headers.get('referrer-policy'), 'same-origin')
  const home = await fetch(`${base}/`, { redirect: 'manual' })
  assert.equal(home.status, 303)
  assert.equal(home.headers.get('location'), '/login')
  assert.equal((await login(base, 'wrong')).status, 401)
  const ok = await login(base, web.state().token)
  assert.equal(ok.status, 303)
  assert.match(ok.cookie, /^astrolab_session=/)
  const idx = await fetch(`${base}/`, { headers: { cookie: ok.cookie } })
  assert.equal(idx.status, 200)
  assert.match(await idx.text(), /AstroLab/)
  const js = await fetch(`${base}/assets/a.js`, { headers: { cookie: ok.cookie } })
  assert.match(js.headers.get('content-type'), /javascript/)
  // 路径穿越拿不到 dist 外面的文件（落回 index.html）
  const trav = await fetch(`${base}/..%2Fsecret.txt`, { headers: { cookie: ok.cookie } })
  assert.notEqual(await trav.text(), 'x')
})

test('接口：带头、同源才调；错误原样带回；跨站和不带头的拒绝', async (t) => {
  const { web } = rig(t)
  const port = PORT()
  await web.set({ enabled: true, port })
  const base = `http://127.0.0.1:${port}`
  const { cookie } = await login(base, web.state().token)
  const call = (channel, args, headers = {}) => fetch(`${base}/api/invoke`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-astrolab': '1', ...headers }, body: JSON.stringify({ channel, args }) })
  assert.deepEqual(await (await call('task:start', [{ prompt: '巡检' }])).json(), { ok: true, data: { id: 't1', prompt: '巡检' } })
  assert.deepEqual(await (await call('task:stop', [])).json(), { ok: true, data: null })
  assert.deepEqual(await (await call('boom', [])).json(), { ok: false, error: '出错了' })
  assert.match((await (await call('nope', [])).json()).error, /没有这个接口/)
  assert.equal((await call('task:start', [], { 'x-astrolab': '' })).status, 403)
  assert.equal((await call('task:start', [], { origin: 'http://evil.example' })).status, 403)
  const man = await (await fetch(`${base}/api/manifest`, { headers: { cookie } })).json()
  assert.equal(man.map['task.start'], 'task:start')
})

test('事件：主进程广播的消息推到浏览器（SSE）', async (t) => {
  const { web } = rig(t)
  const port = PORT()
  await web.set({ enabled: true, port })
  const base = `http://127.0.0.1:${port}`
  const { cookie } = await login(base, web.state().token)
  const ac = new AbortController()
  const r = await fetch(`${base}/api/events`, { headers: { cookie }, signal: ac.signal })
  assert.match(r.headers.get('content-type'), /event-stream/)
  const reader = r.body.getReader()
  await new Promise((res) => setTimeout(res, 50))
  assert.equal(web.state().clients, 1)
  web.broadcast({ type: 'state', payload: { status: 'running' } })
  let text = ''
  while (!text.includes('running')) text += new TextDecoder().decode((await reader.read()).value)
  assert.match(text, /data: \{"type":"state","payload":\{"status":"running"\}\}/)
  ac.abort()
})

test('预览：只给 HTML，带 CSP 沙箱；下载：工程里的文件可以，越出工程不行', async (t) => {
  const { web } = rig(t)
  const port = PORT()
  await web.set({ enabled: true, port })
  const base = `http://127.0.0.1:${port}`
  const { cookie } = await login(base, web.state().token)
  const pv = await fetch(`${base}/preview/out/r.html`, { headers: { cookie } })
  assert.equal(pv.status, 200)
  assert.match(pv.headers.get('content-security-policy'), /^sandbox allow-scripts;/)
  assert.equal((await fetch(`${base}/preview/out/报告.md`, { headers: { cookie } })).status, 403)
  const dl = await fetch(`${base}/api/file?rel=${encodeURIComponent('out/报告.md')}`, { headers: { cookie } })
  assert.equal(dl.status, 200)
  assert.match(dl.headers.get('content-disposition'), /attachment/)
  assert.equal(await dl.text(), '# 报告')
  assert.equal((await fetch(`${base}/api/file?rel=${encodeURIComponent('../secret.txt')}`, { headers: { cookie } })).status, 403)
})

test('换口令：已登录的会话失效；局域网开关改监听地址；端口被占用时说明原因', async (t) => {
  const { web } = rig(t)
  const port = PORT()
  await web.set({ enabled: true, port })
  const base = `http://127.0.0.1:${port}`
  const old = web.state().token
  const { cookie } = await login(base, old)
  await web.set({ newToken: true })
  assert.notEqual(web.state().token, old)
  assert.equal((await fetch(`${base}/api/manifest`, { headers: { cookie } })).status, 401)
  const st = await web.set({ lan: true })
  assert.equal(st.lan, true)
  assert.ok(!st.urls.includes(`http://127.0.0.1:${port}`))
  // 另一个服务占着同一个端口
  const other = rig(t).web
  const st2 = await other.set({ enabled: true, port })
  assert.equal(st2.running, false)
  assert.match(st2.error, /被别的程序占用/)
  await assert.rejects(web.set({ port: 80 }), /1024/)
})

test('连错 10 次锁 10 分钟', async (t) => {
  const { web } = rig(t)
  const port = PORT()
  await web.set({ enabled: true, port })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 10; i++) await login(base, 'wrong')
  assert.equal((await login(base, web.state().token)).status, 429)
})

test('网段限制：本机和同一网段可以（单位内网用公网段地址也行），别的网段不行', () => {
  const nets = [{ address: '119.80.252.59', netmask: '255.255.255.0' }, { address: '192.168.233.1', netmask: '255.255.255.0' }]
  assert.equal(sameNetwork('119.80.252.55', nets), true)
  assert.equal(sameNetwork('::ffff:119.80.252.55', nets), true)
  assert.equal(sameNetwork('192.168.233.7', nets), true)
  assert.equal(sameNetwork('127.0.0.1', nets), true)
  assert.equal(sameNetwork('::1', nets), true)
  assert.equal(sameNetwork('119.80.253.55', nets), false)
  assert.equal(sameNetwork('8.8.8.8', nets), false)
  assert.equal(sameNetwork('fe80::1', nets), false)
  assert.equal(sameNetwork('', nets), false)
})

test('登录记录和全部下线：记成功和失败；下线后会话失效、口令不变', async (t) => {
  const { web } = rig(t)
  const port = PORT()
  await web.set({ enabled: true, port })
  const base = `http://127.0.0.1:${port}`
  await login(base, 'wrong')
  const { cookie } = await login(base, web.state().token)
  const st = web.state()
  assert.deepEqual(st.logins.map((l) => [l.ip, l.ok]), [['127.0.0.1', true], ['127.0.0.1', false]])
  assert.equal(st.sessions, 1)
  const token = st.token
  const after = await web.set({ kickAll: true })
  assert.equal(after.sessions, 0)
  assert.equal(after.token, token)
  assert.equal((await fetch(`${base}/api/manifest`, { headers: { cookie } })).status, 401)
})
