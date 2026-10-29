// 在真实 DSH 上验证读取围栏（read-fence.mjs）：模型换成本机的假服务，按脚本依次调用工具，看工具结果。
// 用法（仓库根目录）：node app/test/real-dsh-fence.mjs      DSH 默认用 runtime/dsh 里装的；ASTROLAB_DSH 可指定 lib/bin.js
// 验证项：
//   H1 工作区里的文件照常能读            H2 读别的目录的文件被拒绝，理由里告诉智能体请用户放进工作区
//   H3 命令行读别的目录被拒绝            H4 命令行读工作区里的文件照常
//   H5 working_directory 不能跳出工作区   H6 技能目录里的脚本可以用绝对路径运行
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, EngineBridge, writeEnginePatch } from '../engine/engine.mjs'
import { startFakeLlm } from './fake-llm.mjs'
import { prepareAcl } from '../main/projects.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const DSH = process.env.ASTROLAB_DSH || join(ROOT, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
if (!existsSync(DSH)) { console.error(`找不到 DSH：${DSH}`); process.exit(2) }
const win = process.platform === 'win32'
// 结果同时写到 runtime/real-dsh-fence.log（每项的工具结果全文、围栏的拒绝记录），便于远程查看
const LOG = join(ROOT, 'runtime', 'real-dsh-fence.log')
mkdirSync(dirname(LOG), { recursive: true })
writeFileSync(LOG, `=== ${new Date().toISOString()} ${process.platform} node ${process.version}\nDSH ${DSH}\n`)
const say = (t) => { console.log(t); appendFileSync(LOG, t + '\n') }

const base = mkdtempSync(join(tmpdir(), 'astrolab-fence-'))
// 工作区和“别处”都不放在系统临时目录下面（临时目录本身允许读），所以建在用户目录的一个临时文件夹里
const place = mkdtempSync(join(process.env.ASTROLAB_FENCE_DIR || process.cwd(), '.fence-test-'))
const ws = join(place, 'ws')
const other = join(place, 'other')
const skills = join(place, 'skills')
for (const d of [ws, other, join(skills, 'demo', 'scripts')]) mkdirSync(d, { recursive: true })
writeFileSync(join(ws, 'inside.txt'), 'INSIDE-OK\n')
writeFileSync(join(other, 'secret.txt'), 'SECRET-LEAKED\n')
writeFileSync(join(skills, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: 测试用\n---\n# demo\n')
writeFileSync(join(skills, 'demo', 'scripts', 'hello.mjs'), "console.log('SKILL-SCRIPT-OK')\n")
// Windows：和工作台加入项目时一样准备文件夹权限，否则 DSH 的命令行沙箱给工作区授写权限会失败（SetNamedSecurityInfoW … Win32 5）
{
  const acl = prepareAcl(ws, join(ROOT, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'assets', 'diagnose-windows-sandbox-acl', 'scripts', 'diagnose-windows-sandbox-acl.ps1'), join(base, 'acl-recovery'))
  if (!acl.ok) console.log(`文件夹权限没有准备好：${acl.reason}`)
}

const shell = win ? 'pwsh' : 'bash'
const cat = (p) => (win ? `Get-Content -LiteralPath '${p}'` : `cat '${p}'`)
const node = (p) => `${win ? '& ' : ''}"${process.execPath}" "${p}"`
const steps = [
  { name: 'read', args: { file_path: join(ws, 'inside.txt') } },
  { name: 'read', args: { file_path: join(other, 'secret.txt') } },
  { name: shell, args: { command: cat(join(other, 'secret.txt')), description: '读别处' } },
  { name: shell, args: { command: cat('inside.txt'), description: '读工作区' } },
  { name: 'working_directory', args: { cd: '..' } },
  { name: shell, args: { command: node(join(skills, 'demo', 'scripts', 'hello.mjs')), description: '运行技能脚本' } },
]
let results = []
const llm = await startFakeLlm({
  delay: 0, steps: 0,
  script: (last, res) => {
    if (!last.includes('MARK-FENCE')) return null
    results = res
    return res.length < steps.length ? { tool: steps[res.length] } : { text: 'FENCE-DONE' }
  },
})
const home = join(base, 'home')
mkdirSync(home, { recursive: true })
writeFileSync(join(home, 'cordis.patch.yml'), readFileSync(join(ROOT, 'config', 'cordis.patch.yml.template'), 'utf8').replaceAll('__STARTER_DIR__', ROOT.replace(/\\/g, '/')))
const bridge = new EngineBridge()
await bridge.listen()
const patch = writeEnginePatch(join(home, 'engine'), { skillDirs: [skills], readFence: { readRoots: [skills], toolRoots: [dirname(process.execPath), dirname(DSH)], log: true } })
const env = {
  ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ASTROLAB_BRIDGE: bridge.path,
  DEPT_LLM_BASE_URL: `http://127.0.0.1:${llm.port}`, DEPT_LLM_API_KEY: 'fake', DEPT_LLM_MODEL: 'deepseek-flash',
  ASTROLAB_LIBRARIES: '[]', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}
delete env.ELECTRON_RUN_AS_NODE
const eng = new Engine({ dshBin: DSH, nodePath: process.execPath, cwd: ws, provider: 'dept-llm', model: 'deepseek-flash', reasoningEffort: 'off', patches: [patch], env, logFile: join(base, 'fence.jsonl') })
const statuses = []
eng.on('session.status', (p) => statuses.push(p))
let failed = 0
const check = (n, ok, info = '') => { if (!ok) failed++; say(`${ok ? '通过' : '不通过'} ${n}${info ? `  ${info}` : ''}`) }
try {
  await eng.start()
  await eng.prompt('F', 'MARK-FENCE 读文件')
  const t0 = Date.now()
  while (!statuses.some((s) => s.sessionId === 'F' && s.status === 'idle')) {
    if (Date.now() - t0 > 120000) throw new Error('等待超时')
    await new Promise((r) => setTimeout(r, 100))
  }
  const fenced = (r) => /不允许读取工作区外的文件/.test(r) && /ask_user_question/.test(r)
  const short = (r) => String(r).replace(/\s+/g, ' ').slice(0, 120)
  check('H1 工作区里的文件照常能读', /INSIDE-OK/.test(results[0]), short(results[0]))
  check('H2 读别的目录被拒绝', fenced(results[1]) && !/SECRET-LEAKED/.test(results[1]), short(results[1]))
  check('H3 命令行读别的目录被拒绝', fenced(results[2]) && !/SECRET-LEAKED/.test(results[2]), short(results[2]))
  check('H4 命令行读工作区里的文件照常', /INSIDE-OK/.test(results[3]), short(results[3]))
  check('H5 working_directory 不能跳出工作区', fenced(results[4]), short(results[4]))
  check('H6 技能目录里的脚本可以运行', /SKILL-SCRIPT-OK/.test(results[5]), short(results[5]))
  check('没有任何结果带出别处的内容', !results.some((r) => /SECRET-LEAKED/.test(r)))
  say('\n--- 每一步的调用和结果全文')
  steps.forEach((st, i) => say(`[${i + 1}] ${st.name} ${JSON.stringify(st.args)}\n    → ${String(results[i] ?? '（没有结果）').slice(0, 1500)}`))
} catch (e) {
  failed++
  say(`出错：${e.message}`)
} finally {
  await eng.shutdown(5000).catch(() => {})
  await llm.close()
  try {
    const frames = readFileSync(join(base, 'fence.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter((f) => f && f.dir === 'stderr').map((f) => String(f.frame))
    const fence = frames.filter((t) => t.includes('[read-fence]'))
    const errs = frames.filter((t) => /error/i.test(t) && !t.includes('[read-fence]') && !/UNDICI|trace-warnings/.test(t))
    say(`\n--- 围栏的拒绝记录（${fence.length} 条）\n${fence.join('')}`)
    say(`--- 引擎 stderr 里的其他错误（${errs.length} 条）\n${errs.join('').slice(0, 4000)}`)
  } catch { /* 没有日志 */ }
  try { rmSync(place, { recursive: true, force: true }) } catch { /* 留着也无妨 */ }
}
say(failed ? `${failed} 项不通过（详细见 ${LOG}）` : '全部通过')
process.exit(failed ? 1 : 0)
