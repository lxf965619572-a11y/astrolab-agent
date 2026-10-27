// 在真实 DSH 上验证引擎桥和任务控制器（模型换成本机的假服务 fake-llm.mjs，不花模型调用、不读任何项目代码）。
// 用法（仓库根目录）：node app/test/real-dsh.mjs
//   DSH 默认用 runtime/dsh 里装的；ASTROLAB_DSH 可指定 dsh 的 lib/bin.js
//   结果打印出来，并写到 runtime/real-dsh-check.log
// 验证项：
//   A 运行中插话（steer）在本轮的下一步之前送到        B 停止（cancel）只中止当前轮，引擎进程不退出；继续接着做
//   C 等回答时停止，问题失效；停止后在输入框回答能接上  D 空闲时 session/prompt 照常
//   E 任务控制器全流程：预热引擎、发起、插话、停止、继续、完成，只启动一次引擎

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, EngineBridge, writeEnginePatch } from '../engine/engine.mjs'
import { TaskController } from '../main/task.mjs'
import { startFakeLlm } from './fake-llm.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DSH = process.env.ASTROLAB_DSH || join(ROOT, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const OUT = join(ROOT, 'runtime', 'real-dsh-check.log')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `=== ${new Date().toISOString()} ${process.platform} node ${process.version}\nDSH ${DSH}\n`)
const say = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(s); appendFileSync(OUT, s + '\n') }
if (!existsSync(DSH)) { say(`找不到 DSH：${DSH}`); process.exit(2) }

const llm = await startFakeLlm({ delay: 1200, steps: 6 })
const home = mkdtempSync(join(tmpdir(), 'astrolab-dshhome-'))
writeFileSync(join(home, 'cordis.patch.yml'), `- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      dept-llm:
        displayName: fake
        api: openai-completions
        baseURL: 'http://127.0.0.1:${llm.port}'
        apiKeyEnv: DEPT_LLM_API_KEY
        compat:
          thinkingFormat: deepseek
        models:
          - id: deepseek-flash
            name: deepseek-flash
            contextWindow: 131072
            maxTokens: 8192
            reasoningEfforts:
              'off':
              high: high
`)
const ws = mkdtempSync(join(tmpdir(), 'astrolab-ws-'))
const bridge = new EngineBridge()
await bridge.listen()
const patch = writeEnginePatch(join(home, 'engine'))
const env = {
  ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DEPT_LLM_API_KEY: 'fake', ASTROLAB_BRIDGE: bridge.path,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}
delete env.ELECTRON_RUN_AS_NODE
const newEngine = (logName) => new Engine({
  dshBin: DSH, nodePath: process.execPath, cwd: ws, provider: 'dept-llm', model: 'deepseek-flash', reasoningEffort: 'off',
  patches: [patch], env, logFile: join(home, `${logName}.jsonl`),
})

const until = (f, ms = 60000) => new Promise((res, rej) => { const s = Date.now(); const t = setInterval(() => { if (f()) { clearInterval(t); res() } else if (Date.now() - s > ms) { clearInterval(t); rej(new Error('等待超时')) } }, 50) })
const results = []
const check = (name, ok, info) => { results.push([name, ok]); say(ok ? '通过' : '不通过', name, info ?? '') }

try {
  const eng = newEngine('bridge')
  const events = []
  const statuses = []
  eng.on('session.event', (p) => events.push({ t: Date.now(), sid: p.sessionId, type: p.event.type, data: p.event.data }))
  eng.on('session.status', (p) => statuses.push({ t: Date.now(), ...p }))
  const init = await eng.start()
  const hello = await bridge.waitFor(eng.pid, 5000)
  say(`引擎启动 ${init.ms} ms；引擎桥 ${hello ? '已连上' : '没连上'}`, bridge.byPid.get(eng.pid)?.features || [])
  const of = (sid, type) => events.filter((e) => e.sid === sid && e.type === type)
  const texts = (sid) => of(sid, 'assistant/message').flatMap((e) => e.data.message.content.filter((b) => b.type === 'text').map((b) => b.text))
  const idle = (sid) => statuses.filter((s) => s.sessionId === sid && s.status === 'idle').length

  {
    const sid = 'A'
    await eng.prompt(sid, '任务 A：做六步')
    await until(() => of(sid, 'tool/result').length >= 2)
    const r = await bridge.steer(eng.pid, sid, 'MARK-STEER 复位超时多测一个')
    const at = Date.now()
    await until(() => idle(sid) >= 1)
    const user = of(sid, 'user/message').find((e) => JSON.stringify(e.data).includes('MARK-STEER'))
    check('A 运行中插话在本轮送到', !!user && of(sid, 'turn/start').length === 1 && texts(sid).includes('STEER-SEEN') && user.data.id === r.messageId,
      { 送到用时ms: user ? user.t - at : null, 轮数: of(sid, 'turn/start').length })
  }
  {
    const sid = 'B'
    await eng.prompt(sid, '任务 B：做六步')
    await until(() => of(sid, 'tool/result').length >= 2)
    const c0 = Date.now()
    await bridge.cancel(eng.pid, sid)
    await until(() => of(sid, 'turn/end').length >= 1 && idle(sid) >= 1)
    const end = of(sid, 'turn/end')[0]
    check('B 停止只中止当前轮，进程不退出', end.data.reason.kind === 'aborted' && eng.alive, { 停止用时ms: Date.now() - c0 })
    const st = await bridge.state(eng.pid, sid)
    check('B 停止后空闲、没有待处理消息', st.status === 'idle' && st.pending === false, { status: st.status, pending: st.pending })
    await bridge.steer(eng.pid, sid, 'MARK-RESUME 继续')
    await until(() => idle(sid) >= 2)
    check('B 继续：新一轮接着做', texts(sid).includes('RESUMED') && of(sid, 'turn/start').length === 2)
  }
  {
    const sid = 'C'
    const asked = new Promise((r) => bridge.once('question', r))
    const aborted = new Promise((r) => bridge.once('abort', r))
    await eng.prompt(sid, 'MARK-ASK 先问我')
    const q = await asked
    await bridge.cancel(eng.pid, sid)
    const a = await Promise.race([aborted, new Promise((r) => setTimeout(() => r(null), 5000))])
    await until(() => idle(sid) >= 1)
    check('C 等回答时停止，问题失效', !!a && a.id === q.id && eng.alive)
    await bridge.steer(eng.pid, sid, '选甲 MARK-RESUME')
    await until(() => idle(sid) >= 2)
    check('C 停止后在输入框回答能接上', texts(sid).includes('RESUMED'))
  }
  {
    const sid = 'A'
    const n = idle(sid)
    await eng.prompt(sid, 'MARK-RESUME 再来')
    await until(() => idle(sid) > n)
    check('D 空闲时 session/prompt 照常', texts(sid).filter((t) => t === 'RESUMED').length === 1)
  }
  await eng.shutdown(5000)

  // E：任务控制器全流程
  {
    let made = 0
    const data = mkdtempSync(join(tmpdir(), 'astrolab-data-'))
    const ctl = new TaskController({ bridge, dataDir: data, logDir: home, makeEngine: () => { made++; return newEngine(`ctl-${made}`) } })
    const w0 = Date.now()
    await ctl.setProject({ id: 'p', name: '验证', path: ws })
    await until(() => ctl.engineState === 'ready')
    say(`E 打开项目后引擎预热 ${Date.now() - w0} ms`)
    await ctl.start({ stage: 'utest', prompt: '任务 E：做六步' })
    await until(() => ctl.activity.steps >= 2)
    await ctl.send('MARK-STEER 插一句')
    await until(() => ctl.queued.length === 0)
    await until(() => ctl.status === 'done')
    check('E 发起、插话、完成（同一轮）', ctl.activity.items.filter((i) => i.kind === 'turn-end').length === 1 && ctl.snapshotState().summary.lastAssistantText === 'STEER-SEEN')
    await ctl.send('任务 E2：再做六步')
    await until(() => ctl.activity.steps >= 8)
    const s0 = Date.now()
    const r = await ctl.stop()
    check('E 停止：已停止，引擎不退出', ctl.status === 'stopped' && ctl.engine && ctl.engine.alive, { 停止用时ms: Date.now() - s0, 返回: r })
    await ctl.resume('MARK-RESUME')
    await until(() => ctl.status === 'done')
    check('E 继续后完成，只启动过一次引擎', ctl.snapshotState().summary.lastAssistantText === 'RESUMED' && made === 1, { 引擎启动次数: made })
    await ctl.dispose()
  }
} catch (e) {
  check('运行出错', false, e.stack || String(e))
} finally {
  await bridge.close()
  await llm.close()
}
const ok = results.every(([, x]) => x)
say(ok ? `全部通过（${results.length} 项）` : `有 ${results.filter(([, x]) => !x).length} 项不通过`)
process.exit(ok ? 0 : 1)
