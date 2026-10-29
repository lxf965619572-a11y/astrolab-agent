// 量一量发给模型的第一个请求：有哪些工具、每个工具定义多大、系统提示多大、整个请求多少字节。
// 用真实 DSH 和工作台同样的配置（DSH 数据目录的补丁由 config/cordis.patch.yml.template 生成，引擎补丁由 writeEnginePatch 生成），
// 模型换成本机的假服务（fake-llm.mjs），不花模型调用、不读任何项目代码（工作区是空的临时目录）。
// 用法（仓库根目录）：node app/test/measure-request.mjs [标签]
//   结果打印出来，完整的工具定义写到 runtime/measure/<时间>-<标签>.json，便于前后对比（harness 精简前后各量一次）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, EngineBridge, writeEnginePatch } from '../engine/engine.mjs'
import { startFakeLlm } from './fake-llm.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DSH = process.env.ASTROLAB_DSH || join(ROOT, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const label = process.argv[2] || 'now'
if (!existsSync(DSH)) { console.error(`找不到 DSH：${DSH}`); process.exit(2) }

const llm = await startFakeLlm({ delay: 0, steps: 0 })
const home = mkdtempSync(join(tmpdir(), 'astrolab-measure-home-'))
const tpl = readFileSync(join(ROOT, 'config', 'cordis.patch.yml.template'), 'utf8')
writeFileSync(join(home, 'cordis.patch.yml'), tpl.replaceAll('__STARTER_DIR__', ROOT.replace(/\\/g, '/')))
const ws = mkdtempSync(join(tmpdir(), 'astrolab-measure-ws-'))
const libDir = mkdtempSync(join(tmpdir(), 'astrolab-measure-lib-'))
const bridge = new EngineBridge()
await bridge.listen()
// ASTROLAB_TRIM=0 量精简前的样子
const patch = writeEnginePatch(join(home, 'engine'), { skillDirs: [join(ROOT, 'skills')], trim: process.env.ASTROLAB_TRIM !== '0', readFence: { readRoots: [join(ROOT, 'skills')] } })
const env = {
  ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ASTROLAB_BRIDGE: bridge.path,
  DEPT_LLM_BASE_URL: `http://127.0.0.1:${llm.port}`, DEPT_LLM_API_KEY: 'fake', DEPT_LLM_MODEL: 'deepseek-flash',
  ASTROLAB_LIBRARIES: JSON.stringify([{ id: 'mine', name: '我的库', dir: libDir, writable: true }]),
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}
delete env.ELECTRON_RUN_AS_NODE
const eng = new Engine({ dshBin: DSH, nodePath: process.execPath, cwd: ws, provider: 'dept-llm', model: 'deepseek-flash', reasoningEffort: 'off', patches: [patch], env, logFile: join(home, 'measure.jsonl') })
const statuses = []
eng.on('session.status', (p) => statuses.push(p))
try {
  await eng.start()
  await eng.prompt('M', '量一下请求')
  const t0 = Date.now()
  while (!llm.requests.length || !statuses.some((s) => s.sessionId === 'M' && s.status === 'idle')) {
    if (Date.now() - t0 > 90000) throw new Error('等待超时')
    await new Promise((r) => setTimeout(r, 100))
  }
} finally {
  await eng.shutdown(5000).catch(() => {})
  await llm.close()
  await bridge.close?.()
}

const r = llm.requests[0]
const size = (x) => JSON.stringify(x).length
const tools = r.schemas.map((t) => {
  const f = t.function || t
  const props = f.parameters?.properties || {}
  return { name: f.name, chars: size(t), descChars: (f.description || '').length, params: Object.keys(props) }
}).sort((a, b) => b.chars - a.chars)
const toolChars = tools.reduce((s, t) => s + t.chars, 0)
console.log(`消息：${r.roles.join(' ')}`)
console.log(`请求 ${r.bytes} 字节；系统提示 ${r.system.length} 字；工具 ${tools.length} 个，定义共 ${toolChars} 字`)
console.log('\n| 工具 | 定义字数 | 说明字数 | 参数 |\n|---|---|---|---|')
for (const t of tools) console.log(`| ${t.name} | ${t.chars} | ${t.descChars} | ${t.params.join(', ')} |`)
const out = join(ROOT, 'runtime', 'measure', `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${label}.json`)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ label, bytes: r.bytes, systemChars: r.system.length, toolCount: tools.length, toolChars, tools, schemas: r.schemas, system: r.system }, null, 1))
console.log(`\n完整定义：${out}`)
process.exit(0)
