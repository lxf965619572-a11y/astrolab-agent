// 编译工具链：查找 gcc / g++ / gcov，判断是否支持 MC/DC（GCC 14 起的 -fcondition-coverage）。
//
// 环境变量：
//   UTEST_CC     C 编译器，默认 gcc（PATH 中查找）。Windows 示例：C:\msys64\ucrt64\bin\gcc.exe
//   UTEST_CXX    C++ 编译器（gtest 用），默认与 UTEST_CC 同目录的 g++
//   UTEST_GCOV   gcov，默认与 UTEST_CC 同目录的 gcov
//   UTEST_GTEST_ROOT  gtest 安装目录（含 include、lib），gtest 用

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'

const EXE = process.platform === 'win32' ? '.exe' : ''

// 编译器所在目录加到 PATH 最前面：MSYS2 的 gcc 在 MSYS2 终端之外运行时，cc1 等要从 ucrt64\bin 加载 DLL；
// gtest 测试程序运行时也要找到 libstdc++ 等 DLL
let toolEnvCache
function toolEnv() {
  if (toolEnvCache) return toolEnvCache
  const dirs = [process.env.UTEST_CC, process.env.UTEST_CXX, process.env.UTEST_GCOV].filter((p) => p && /[\\/]/.test(p)).map(dirname)
  if (!dirs.length) return (toolEnvCache = process.env)
  const env = { ...process.env }
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'
  env[key] = [...new Set(dirs)].join(delimiter) + delimiter + (env[key] || '')
  return (toolEnvCache = env)
}

export function run(cmd, args, { cwd, timeoutMs = 120_000, env } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true, env: env || toolEnv() })
    } catch (err) {
      resolve({ code: -1, stdout, stderr: String(err.message || err), spawnError: true })
      return
    }
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 2_000_000) child.kill('SIGKILL') })
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 2_000_000) child.kill('SIGKILL') })
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, spawnError: true }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? -1 : code, stdout, stderr, timedOut }) })
  })
}

function sibling(cc, name) {
  if (!cc || !/[\\/]/.test(cc)) return name
  const dir = dirname(cc)
  // 支持 gcc-14、x86_64-w64-mingw32-gcc 这类带前缀/后缀的名字
  const base = basename(cc).replace(/\.exe$/i, '')
  const swapped = base.replace(/gcc/, name === 'g++' ? 'g++' : name)
  for (const cand of [join(dir, swapped + EXE), join(dir, name + EXE)]) if (existsSync(cand)) return cand
  return join(dir, name + EXE)
}

let cached
export async function toolchain() {
  if (cached) return cached
  const cc = process.env.UTEST_CC || 'gcc'
  const cxx = process.env.UTEST_CXX || sibling(process.env.UTEST_CC, 'g++')
  const gcov = process.env.UTEST_GCOV || sibling(process.env.UTEST_CC, 'gcov')
  const v = await run(cc, ['-dumpfullversion', '-dumpversion'], { timeoutMs: 20_000 })
  if (v.code !== 0) {
    return { ok: false, cc, cxx, gcov, error: `找不到 C 编译器（${cc}）：${(v.stderr || '').trim().slice(0, 300)}。请安装 gcc，并在 config\\local.env 中设置 UTEST_CC（见 README“单元测试”一节）` }
  }
  const version = v.stdout.trim().split(/\s+/)[0]
  const major = Number(version.split('.')[0])
  const g = await run(gcov, ['--version'], { timeoutMs: 20_000 })
  cached = {
    ok: true,
    cc, cxx, gcov,
    version,
    major,
    gcovOk: g.code === 0,
    gcovError: g.code === 0 ? '' : `找不到 gcov（${gcov}）：${(g.stderr || '').trim().slice(0, 200)}`,
    mcdc: major >= 14,
    exe: EXE,
  }
  return cached
}
