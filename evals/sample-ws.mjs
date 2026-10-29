// 评测用：找到 AstroLab 里“示例工程”的实际目录。
//
// 应用第一次运行时把仓库的 sample 复制到数据目录的 workspace/sample，之后智能体读写的是那份副本；
// 仓库的 sample 只是种子（新版本新增的示例文件由应用启动时补进去，见 app/main/projects.mjs 的 updateSample）。
// 所以评测的 prepare（放输入、清上次输出）和 score（读智能体的输出）都要对着这份副本。
//
// 数据目录的查找规则与 app/main/paths.mjs 相同：ASTROLAB_DATA → 开发时的 runtime/app-data →
// 安装后的 %LOCALAPPDATA%\AstroLab（Linux 为 ~/.local/share/AstroLab）；都没有示例工程时退回仓库的 sample
// （还没运行过 AstroLab，或直接用 DSH 测试时）。设置 ASTROLAB_SAMPLE=<目录> 可以直接指定。

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 返回 { dir, from }：示例工程目录和找到它的依据 */
export function sampleWorkspace(env = process.env) {
  if (env.ASTROLAB_SAMPLE) return { dir: resolve(env.ASTROLAB_SAMPLE), from: 'ASTROLAB_SAMPLE' }
  const local = process.platform === 'win32'
    ? join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'AstroLab')
    : join(homedir(), '.local', 'share', 'AstroLab')
  const cands = [
    [env.ASTROLAB_DATA, 'ASTROLAB_DATA'],
    [join(ROOT, 'runtime', 'app-data'), '开发环境数据目录'],
    [local, '安装后的数据目录'],
  ]
  for (const [d, from] of cands) if (d && existsSync(join(d, 'workspace', 'sample'))) return { dir: join(resolve(d), 'workspace', 'sample'), from }
  return { dir: join(ROOT, 'sample'), from: '仓库（还没有运行过 AstroLab）' }
}

/** 用例配置里写的“sample/...”路径换成示例工程中的实际路径；其他相对路径按仓库根目录解析 */
export function samplePath(rel, ws = sampleWorkspace().dir) {
  const s = String(rel).replace(/\\/g, '/')
  if (s === 'sample') return ws
  if (s.startsWith('sample/')) return join(ws, ...s.slice('sample/'.length).split('/'))
  return resolve(ROOT, rel)
}

/** 在脚本开头打印一次示例工程的位置，便于核对 */
export function announce() {
  const w = sampleWorkspace()
  console.log(`示例工程：${w.dir}（${w.from}）`)
  return w
}

// 直接运行时只打印目录，便于在 PowerShell 里用：$S = node evals\sample-ws.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(sampleWorkspace().dir)
