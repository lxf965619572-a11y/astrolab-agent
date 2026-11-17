// 在真实 DSH 上验证“局域网 vLLM + Qwen3.8-27B”这条路：用仓库里的部门补丁模板（config/cordis.patch.yml.template）和
// 麒麟场景的设置（config/scenarios/kylin-lan-qwen.env），模型换成本机的假 vLLM（fake-vllm.mjs），不调用任何真实模型。
// 用法（仓库根目录）：node app/test/real-dsh-qwen.mjs
// 验证项：
//   Q1 引擎按模板和场景设置启动（模板里新加的 input 等字段被 DSH 接受）
//   Q2 发给模型的请求：模型名、max_tokens、chat_template_kwargs.enable_thinking + preserve_thinking、带工具定义
//   Q3 服务端的结构化 tool_calls 被执行，思考内容（vLLM 的 reasoning 字段）记进会话
//   Q4 下一步的请求把上一步的思考带回去（preserve_thinking 才有意义）
//   Q5 思考关掉（reasoningEffort off）时 enable_thinking=false

import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from '../engine/engine.mjs'
import { readLocalEnv } from '../main/paths.mjs'
import { startFakeVllm } from './fake-vllm.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DSH = process.env.ASTROLAB_DSH || join(ROOT, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const OUT = join(ROOT, 'runtime', 'real-dsh-qwen.log')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `=== ${new Date().toISOString()} ${process.platform}-${process.arch} node ${process.version}\n`)
const say = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(s); appendFileSync(OUT, s + '\n') }
const results = []
const check = (name, ok, info) => { results.push(ok); say(ok ? '通过' : '不通过', name, info ?? '') }
const until = (f, ms = 60000) => new Promise((res, rej) => { const s = Date.now(); const t = setInterval(() => { if (f()) { clearInterval(t); res() } else if (Date.now() - s > ms) { clearInterval(t); rej(new Error('等待超时')) } }, 50) })

const vllm = await startFakeVllm({ preferTool: 'todo_write', doneText: 'QWEN-DONE' })
const home = mkdtempSync(join(tmpdir(), 'astrolab-qwen-'))
const ws = mkdtempSync(join(tmpdir(), 'astrolab-qwen-ws-'))
const tpl = readFileSync(join(ROOT, 'config', 'cordis.patch.yml.template'), 'utf8')
writeFileSync(join(home, 'cordis.patch.yml'), tpl.replaceAll('__STARTER_DIR__', ROOT.replace(/\\/g, '/')))
const scene = readLocalEnv(join(ROOT, 'config', 'scenarios', 'kylin-lan-qwen.env'))
const env = {
  ...process.env, ...scene, DEPT_LLM_BASE_URL: vllm.baseURL, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED',
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}
delete env.ELECTRON_RUN_AS_NODE
say(`场景设置：模型 ${scene.DEPT_LLM_MODEL}，上下文 ${scene.DEPT_LLM_CONTEXT_WINDOW}，输出 ${scene.DEPT_LLM_MAX_TOKENS}，思考 ${scene.DEPT_LLM_THINKING_FORMAT}`)

async function run(effort, sid) {
  const eng = new Engine({ dshBin: DSH, nodePath: process.execPath, cwd: ws, env, provider: 'dept-llm', model: scene.DEPT_LLM_MODEL, reasoningEffort: effort, logFile: join(home, `${sid}.jsonl`) })
  const events = []
  const idle = []
  eng.on('session.event', (p) => events.push(p.event))
  eng.on('session.status', (p) => { if (p.status === 'idle') idle.push(p) })
  try {
    const init = await eng.start()
    const n0 = vllm.requests.length
    await eng.prompt(sid, '列一下单元测试的步骤')
    await until(() => idle.length >= 1)
    return { init, events, reqs: vllm.requests.slice(n0), stderr: eng.stderrTail }
  } finally { await eng.shutdown() }
}

try {
  const a = await run('high', 'Q')
  check('Q1 引擎按模板和场景设置启动', !!a.init, `${a.init.ms} ms`)
  const r0 = a.reqs[0] || {}
  check('Q2 请求参数：模型名、max_tokens、思考开关、工具', r0.model === scene.DEPT_LLM_MODEL && (r0.max_tokens === Number(scene.DEPT_LLM_MAX_TOKENS) || r0.max_completion_tokens === Number(scene.DEPT_LLM_MAX_TOKENS))
    && r0.chat_template_kwargs?.enable_thinking === true && r0.chat_template_kwargs?.preserve_thinking === true && Array.isArray(r0.tools) && r0.tools.length > 5,
  { model: r0.model, max_tokens: r0.max_tokens ?? r0.max_completion_tokens, chat_template_kwargs: r0.chat_template_kwargs, 工具数: (r0.tools || []).length, stream: r0.stream })
  const toolDone = a.events.filter((e) => e.type === 'tool/result').length
  const thinking = a.events.filter((e) => e.type === 'assistant/message').flatMap((e) => e.data.message.content).filter((b) => b.type === 'thinking' || b.type === 'reasoning')
  const text = a.events.filter((e) => e.type === 'assistant/message').flatMap((e) => e.data.message.content).filter((b) => b.type === 'text').map((b) => b.text).join('')
  check('Q3 结构化工具调用被执行，思考内容记进会话，最后回复', toolDone >= 1 && thinking.length >= 1 && text.includes('QWEN-DONE'), { 工具结果: toolDone, 思考块: thinking.length, 请求数: a.reqs.length })
  const r1 = a.reqs[1] || {}
  const back = (r1.messages || []).filter((m) => m.role === 'assistant').some((m) => m.reasoning || m.reasoning_content)
  check('Q4 下一步把上一步的思考带回去', back, { 第二个请求的助手消息: (r1.messages || []).filter((m) => m.role === 'assistant').map((m) => Object.keys(m)) })
  const b = await run('off', 'R')
  const k = (b.reqs[0] || {}).chat_template_kwargs
  check('Q5 关掉思考时 enable_thinking=false', k && k.enable_thinking === false, k)
} catch (e) {
  check('运行', false, e.stack)
} finally {
  await vllm.close()
}
const bad = results.filter((x) => !x).length
say(bad ? `有 ${bad} 项不通过` : `全部通过（${results.length} 项）`)
process.exit(bad ? 1 : 0)
