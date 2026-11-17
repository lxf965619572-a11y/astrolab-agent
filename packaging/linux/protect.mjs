// 源码保护：把一个已经打好的安装目录里的 JavaScript 换成 V8 字节码(.jsc)和压缩代码，去掉所有可读的原始源码。
// 装到麒麟（或别的）电脑上的包里，看不到工作台的实现；能挡住常规查看、复制和普通开发者，挡不住有 root 的人刻意逆向
// （本地程序没法做到绝对不可破——运行时总要把代码交给引擎执行）。
//
// 用法：NODE_PATH=<含 esbuild、bytenode 的 node_modules> node packaging/linux/protect.mjs <安装目录>
//   由 build-offline-linux.sh --protect 调用；也可以单独对一个已构建目录运行。
// 做法：
//   主进程（app/app/main、app/app/engine）：整体用 esbuild 打成一个压缩的 CJS，再用安装包自带的 Electron
//     （ELECTRON_RUN_AS_NODE，和界面同一套 V8）编成 main.jsc，只留三行的加载桩。原始 .mjs 全删。
//   预加载 preload.cjs：界面窗口开了 sandbox，沙箱预加载载不了字节码，改为压缩单文件（只是 IPC 通道清单）。
//   工具服务（app/mcp/<服务>）：每个 server.mjs 连同 tools、common、依赖打成一个 CJS，用安装包自带的 node 编成 server.jsc。
//     热更新(hot.mjs)和顶层 await 在打包时去掉（装好的包不需要热更新）。
//   引擎桥 bridge.mjs、读取围栏 read-fence.mjs：DSH 以 ESM 方式按文件加载，不能换成字节码（换了可能悄悄让读取围栏失效，
//     这是安全功能，不冒险）。改为压缩代码，放到主进程桩旁边（引擎按 import.meta.url 同目录找它们）。
//   更新器 updater.mjs（独立小程序）：压缩代码（它要把自己复制到 runner 目录再跑，保持可独立运行）。
//   界面 app/dist：本来就是 Vite 压缩过的打包产物，原样保留。
//   技能 skills、配置 config：按本次范围不处理（技能是 Markdown，引擎运行时要读原文）。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, basename } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const BN = require.resolve('bytenode')               // 传给编译子进程用的绝对路径
const BN_LIB = require.resolve('bytenode')            // 打进包里当加载桩的 bytenode 实现（无第三方依赖）

const DIST = process.argv[2]
if (!DIST || !existsSync(DIST)) { console.error('用法：node protect.mjs <安装目录>'); process.exit(2) }
const APP = join(DIST, 'app', 'app')                  // 工作台程序（main、engine、dist…）
const MAIN = join(APP, 'main')
const ENGINE = join(APP, 'engine')
const MCP = join(DIST, 'app', 'mcp')
const ELECTRON = join(DIST, 'workbench', 'AstroLab')
const NODE = join(DIST, 'tools', 'node', 'bin', 'node')
for (const [n, p] of [['Electron', ELECTRON], ['node', NODE], ['main.mjs', join(MAIN, 'main.mjs')]]) {
  if (!existsSync(p)) { console.error(`找不到 ${n}：${p}（先用 build-offline-linux.sh 构建）`); process.exit(2) }
}
const say = (...a) => console.log(...a)

// 编译 helper：用指定的二进制（Electron 或 node）把一个 CJS 文件编成 .jsc
const HELPER = join(DIST, '.protect-compile.cjs')
writeFileSync(HELPER, `const bn=require(process.env.BN);(async()=>{await bn.compileFile({filename:process.env.SRC,output:process.env.OUT,compileAsModule:true})})().catch(e=>{console.error(e&&e.stack||e);process.exit(1)})\n`)
function compileJsc(bin, electron, srcCjs, outJsc) {
  const env = { ...process.env, BN, SRC: srcCjs, OUT: outJsc }
  if (electron) env.ELECTRON_RUN_AS_NODE = '1'
  const r = spawnSync(bin, [HELPER], { env, encoding: 'utf8' })
  if (r.status !== 0 || !existsSync(outJsc)) throw new Error(`编译 ${basename(srcCjs)} 失败（退出 ${r.status}）：${r.stderr || r.stdout || r.error || '无输出'}`)
}

// bytenode 加载桩：放到每个 .jsc 旁边，加载桩 require 它注册 .jsc 扩展
function putBytenode(dir) {
  const dst = join(dir, '_bn.cjs')
  copyFileSync(BN_LIB, dst)
  return dst
}
const loaderFor = (jscName) => `// 自动生成：加载字节码\nrequire('./_bn.cjs')\nmodule.exports = require('./${jscName}')\n`

// esbuild 插件：加载工作台自己的 .mjs/.cjs 时，截掉末尾“单独用 node 跑”的命令行块（含顶层 await，CJS 打包不支持；
// 打进字节码时这段是死代码）。node_modules 不动。
const stripCli = {
  name: 'strip-cli',
  setup(b) {
    b.onLoad({ filter: /\.(mjs|cjs)$/ }, (args) => {
      if (args.path.includes('/node_modules/')) return null
      const lines = readFileSync(args.path, 'utf8').split('\n')
      const i = lines.findIndex((l) => /^if \((?=.*import\.meta\.url)(?=.*process\.argv\[1\])/.test(l) || /^if \(import\.meta\.url === /.test(l))
      return { contents: (i >= 0 ? lines.slice(0, i) : lines).join('\n'), loader: 'js' }
    })
  },
}

async function bundle(entry, outfile, { format = 'cjs', minify = true, external = [], strip = false, plugins = [] }) {
  // CJS 输出里 esbuild 会把 import.meta.url 变成空对象（它只在 ESM 下有效）；字节码按 CJS 模块加载，
  // 用 banner 定义一个指向当前文件的常量，再把所有 import.meta.url 替换成它，这样 dirname(fileURLToPath(import.meta.url))
  // 仍指向 .jsc 所在目录（引擎据此在同目录找 bridge/read-fence）。
  const cjs = format === 'cjs'
  await esbuild.build({
    entryPoints: [entry], outfile, bundle: true, platform: 'node', format, target: 'node20',
    minify, legalComments: 'none', external, logLevel: 'silent', treeShaking: true,
    plugins: [...(strip ? [stripCli] : []), ...plugins],
    ...(cjs ? {
      define: { 'import.meta.url': '__IMPORT_META_URL__' },
      banner: { js: "const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;" },
    } : {}),
  })
}

const rmSrc = (dir, keep) => {
  for (const f of readdirSync(dir)) {
    if (keep.includes(f)) continue
    if (/\.(mjs|cjs|js|ts|map)$/.test(f)) rmSync(join(dir, f), { force: true })
  }
}

// ── 1 主进程：main.mjs（连同 paths、models、probe、git、library、task、update、updater、engine、activity…）→ 字节码 ──
say('1/5 主进程 → 字节码')
{
  const tmp = join(DIST, '.main.bundle.cjs')
  await bundle(join(MAIN, 'main.mjs'), tmp, { external: ['electron'], strip: true })
  compileJsc(ELECTRON, true, tmp, join(MAIN, 'main.jsc'))
  rmSync(tmp, { force: true })
  // 需要单独跑的模块：probe（install.sh --llm、自检）、updater（更新 runner）→ 压缩 ESM 单文件，命令行块保留
  for (const f of ['probe.mjs', 'updater.mjs']) await bundle(join(MAIN, f), join(DIST, `.${f}`), { format: 'esm' })
  // 预加载：界面窗口是 sandbox: true，沙箱里的预加载只能 require('electron') 等少数内置模块，
  // 加载不了 _bn.cjs / .jsc（会悄悄失败，界面退回“模拟引擎”）。所以预加载不编字节码，压缩成单文件；
  // 它只是界面能调用的 IPC 通道清单，没有业务逻辑。不加 import.meta 的 banner（它会 require('url')）。
  const ptmp = join(DIST, '.preload.min.cjs')
  await esbuild.build({
    entryPoints: [join(MAIN, 'preload.cjs')], outfile: ptmp, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    minify: true, legalComments: 'none', external: ['electron'], logLevel: 'silent',
  })
  // 引擎桥、读取围栏：压缩的 ESM，放到主进程桩旁边（打包后 engine.mjs 的 import.meta.url 指向这里）
  for (const f of ['bridge.mjs', 'read-fence.mjs']) {
    await bundle(join(ENGINE, f), join(MAIN, f), { format: 'esm', external: [] })
  }
  // 删原始源码，写加载桩，放回压缩版的 probe/updater
  rmSrc(MAIN, ['main.jsc', 'bridge.mjs', 'read-fence.mjs'])
  putBytenode(MAIN)
  writeFileSync(join(MAIN, 'main.cjs'), loaderFor('main.jsc'))
  copyFileSync(ptmp, join(MAIN, 'preload.cjs')); rmSync(ptmp, { force: true })
  for (const f of ['probe.mjs', 'updater.mjs']) { copyFileSync(join(DIST, `.${f}`), join(MAIN, f)); rmSync(join(DIST, `.${f}`)) }
  rmSync(ENGINE, { recursive: true, force: true })   // engine 已打进 main.jsc；bridge/read-fence 已移到 main/
  say('   main.jsc；preload/bridge/read-fence/probe/updater 压缩；engine 源码删除')
}

// ── 2 工具服务：每个 server.mjs → 字节码（用安装包自带的 node 编）──
say('2/5 工具服务 → 字节码')
const SERVICES = readdirSync(MCP).filter((d) => existsSync(join(MCP, d, 'server.mjs')))
// 去掉热更新的 esbuild 插件：把 common/hot.mjs 换成无副作用的桩
const hotStub = {
  name: 'hot-stub',
  setup(b) {
    b.onResolve({ filter: /(^|\/)hot\.mjs$/ }, (a) => ({ path: 'hot-stub', namespace: 'hot' }))
    b.onLoad({ filter: /.*/, namespace: 'hot' }, () => ({
      contents: 'export const hotHandler = (load, name) => async (...a) => (await load())[name](...a)\nexport const hotModule = () => { throw new Error("hot disabled") }\n',
      loader: 'js',
    }))
  },
}
for (const svc of SERVICES) {
  const dir = join(MCP, svc)
  let src = readFileSync(join(dir, 'server.mjs'), 'utf8').replace(/^#![^\n]*\n/, '')   // 去掉 shebang（打包后用不到）
  // 热更新：把 hotModule(import.meta.url, 'tools.mjs') 换成静态命名空间导入
  const m = src.match(/hotModule\(\s*import\.meta\.url\s*,\s*['"]([^'"]+)['"]\s*\)/)
  if (m) {
    src = `import * as __hotns from './${m[1]}'\n` + src.replace(m[0], '(async () => __hotns)')
  }
  // 顶层 await（结尾的 server.connect）：包进立即执行的 async，避免 CJS 不支持顶层 await
  src = src.replace(/(^|\n)await\s+(server\.connect\([^\n]*\))\s*;?\s*$/, '$1;(async () => { await $2 })()\n')
  if (/(^|\n)await\s/.test(src)) throw new Error(`${svc}/server.mjs 还有未处理的顶层 await`)
  const entry = join(dir, '.server.entry.mjs')
  writeFileSync(entry, src)
  const tmp = join(dir, '.server.bundle.cjs')
  await bundle(entry, tmp, { plugins: [hotStub] })
  compileJsc(NODE, false, tmp, join(dir, 'server.jsc'))
  rmSync(entry, { force: true }); rmSync(tmp, { force: true })
  // 删源码、依赖、热更新；留 server.jsc + 桩 + package.json
  for (const f of readdirSync(dir)) {
    if (['server.jsc', 'package.json'].includes(f)) continue
    rmSync(join(dir, f), { recursive: true, force: true })
  }
  putBytenode(dir)
  writeFileSync(join(dir, 'server.cjs'), loaderFor('server.jsc'))
  say(`   mcp/${svc}/server.jsc`)
}
rmSync(join(MCP, 'common'), { recursive: true, force: true })

// ── 3 DSH 补丁模板：工具服务入口由 server.mjs 改成 server.cjs（加载桩）──
say('3/5 改 DSH 补丁模板指向加载桩')
{
  const tpl = join(DIST, 'app', 'config', 'cordis.patch.yml.template')
  if (existsSync(tpl)) writeFileSync(tpl, readFileSync(tpl, 'utf8').replace(/\/mcp\/([^/]+)\/server\.mjs/g, '/mcp/$1/server.cjs'))
}

// ── 4 Electron 入口：package.json 的 main 指向加载桩 main.cjs ──
say('4/5 Electron 入口指向 main.cjs')
{
  const pj = join(DIST, 'workbench', 'resources', 'app', 'package.json')
  const j = JSON.parse(readFileSync(pj, 'utf8'))
  j.main = j.main.replace(/main\.mjs$/, 'main.cjs')
  writeFileSync(pj, JSON.stringify(j, null, 2))
  // 工作台程序自己的 package.json（type: module）留着，字节码按 CJS 加载桩进入，不受影响
}

// ── 5 清理：删掉测试、开发脚本、只给打包/发布机用的工具；运行时诊断（selfcheck、diag）压缩 ──
say('5/5 清理与诊断脚本压缩')
rmSync(HELPER, { force: true })
for (const p of [join(APP, 'test'), join(DIST, 'app', 'scripts'), join(DIST, 'app', 'spike'), join(DIST, 'app', 'evals')]) rmSync(p, { recursive: true, force: true })
// packaging 目录：只保留装好的电脑上会用到的；删掉打包、发布、保护脚本和 Windows 的 .ps1
const PKG = join(DIST, 'app', 'packaging')
if (existsSync(PKG)) {
  // 删掉只给打包/发布机用的工具、Windows 的 .ps1、依赖引擎源码的诊断包（diag-startup）
  for (const f of ['release.mjs', 'build-offline.ps1', 'launch.ps1', 'diag-startup.mjs']) rmSync(join(PKG, f), { force: true })
  for (const f of ['build-offline-linux.sh', 'collect-debs.sh', 'protect.mjs']) rmSync(join(PKG, 'linux', f), { force: true })
  // check.sh 会跑 selfcheck.mjs：压缩，去掉可读实现（动态 import 的引擎/探测在保护包里会优雅跳过）
  const sc = join(PKG, 'selfcheck.mjs')
  if (existsSync(sc)) { await bundle(sc, join(DIST, '.pk.mjs'), { format: 'esm', external: [] }); copyFileSync(join(DIST, '.pk.mjs'), sc); rmSync(join(DIST, '.pk.mjs')) }
}

// 自检：包里不该再有可读的工作台源码
const leaks = []
const scan = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!['node_modules', 'dist', 'skills', 'runtime', '资料库'].includes(e.name)) scan(p); continue }
    if (/\.(mjs|cjs|js)$/.test(e.name) && !['_bn.cjs', 'main.cjs', 'server.cjs'].includes(e.name)) {
      const t = readFileSync(p, 'utf8')
      if (/部门研发智能体|读取围栏|export (async )?function [a-zA-Z]/.test(t) && !/bridge\.mjs|read-fence\.mjs|updater\.mjs|probe\.mjs/.test(p)) leaks.push(p)
    }
  }
}
scan(join(DIST, 'app'))
if (leaks.length) { console.error('还有可读源码：\n' + leaks.join('\n')); process.exit(1) }
say('完成：主进程、工具服务已字节码化；预加载、桥、围栏、更新器已压缩；无可读源码残留')
