// 路径与运行环境：开发时（仓库里的 app 目录）和安装后（安装包）两种布局；读取设置文件；生成 DSH 数据目录的补丁。
//
// 开发布局：<仓库>/app（本程序）、<仓库>/runtime/dsh、<仓库>/skills、<仓库>/config、<仓库>/sample
// 安装布局：<安装目录>/app 与仓库相同（打包脚本复制），<安装目录>/tools（node、GCC、Cppcheck、Git）
//   用户数据统一在 %LOCALAPPDATA%\AstroLab（设置、DSH 数据、任务记录、示例工作区），升级不会覆盖
// 环境变量可覆盖：ASTROLAB_ROOT、ASTROLAB_DATA、ASTROLAB_NODE、ASTROLAB_MOCK_ENGINE=1（不调用模型的模拟引擎）

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function resolvePaths(env = process.env) {
  const root = resolve(env.ASTROLAB_ROOT || join(APP_DIR, '..'))
  const tools = join(root, '..', 'tools')
  const data = resolve(env.ASTROLAB_DATA || (process.platform === 'win32'
    ? join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'AstroLab')
    : join(homedir(), '.local', 'share', 'AstroLab')))
  const installed = existsSync(join(tools, 'node'))
  const mock = env.ASTROLAB_MOCK_ENGINE === '1'
  return {
    appDir: APP_DIR,
    root,
    tools: installed ? tools : null,
    data,
    installed,
    mock,
    dshHome: join(data, 'dsh-home'),
    dshBin: mock ? join(APP_DIR, 'engine', 'mock-dsh.mjs') : join(root, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    nodePath: env.ASTROLAB_NODE || (installed ? join(tools, 'node', process.platform === 'win32' ? 'node.exe' : 'node') : findNode()),
    skillsDir: join(root, 'skills'),
    sampleSrc: join(root, 'sample'),
    template: join(root, 'config', 'cordis.patch.yml.template'),
    // 开发时用仓库里的 config\local.env；安装后在用户数据目录（首次运行从示例复制）
    localEnv: installed ? join(data, 'local.env') : join(root, 'config', 'local.env'),
    localEnvExample: join(root, 'config', 'local.env.example'),
    hookSrc: join(APP_DIR, 'git-hooks', 'reference-transaction'),
    aclScript: join(root, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'assets', 'diagnose-windows-sandbox-acl', 'scripts', 'diagnose-windows-sandbox-acl.ps1'),
    logs: join(data, 'logs'),
    engineDir: join(data, 'engine'),
  }
}

function findNode() {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { encoding: 'utf8', windowsHide: true })
  const first = (r.stdout || '').split(/\r?\n/).find(Boolean)
  return first || 'node'
}

/** 读 local.env（KEY=VALUE，# 开头为注释，空值跳过），返回对象，不改 process.env */
export function readLocalEnv(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')
    if (v) out[k] = v
  }
  return out
}

/** 引擎子进程的环境变量：系统环境 + 设置文件 + 工具路径 + DSH 数据目录 */
export function engineEnv(p, base = process.env) {
  const env = { ...base, ...readLocalEnv(p.localEnv) }
  if (!env.DEPT_LLM_API_KEY && env.DEEPSEEK_API_KEY) env.DEPT_LLM_API_KEY = env.DEEPSEEK_API_KEY
  if (p.tools) {
    const sepr = process.platform === 'win32' ? ';' : ':'
    const extra = [join(p.tools, 'node'), join(p.tools, 'ucrt64', 'bin'), join(p.tools, 'cppcheck'), join(p.tools, 'git', 'cmd')].filter(existsSync)
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH'
    env[key] = [...extra, env[key] || ''].join(sepr)
    if (!env.UTEST_CC && existsSync(join(p.tools, 'ucrt64', 'bin', 'gcc.exe'))) env.UTEST_CC = join(p.tools, 'ucrt64', 'bin', 'gcc.exe')
    if (!env.CPPCHECK_PATH && existsSync(join(p.tools, 'cppcheck', 'cppcheck.exe'))) env.CPPCHECK_PATH = join(p.tools, 'cppcheck', 'cppcheck.exe')
  }
  env.DSH_HOME = p.dshHome
  env.DSH_TELEMETRY_DISABLED = '1'
  env.DSH_TELEMETRY_MODE = 'DISABLED' // dsh-base 的会话遥测读这个（DSH_TELEMETRY_DISABLED 它不认）
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/** 模型路由：部门模型（OpenAI 兼容接口），与网页界面和验证脚本一致 */
export function modelConfig(env) {
  return {
    provider: env.ASTROLAB_PROVIDER || 'dept-llm',
    model: env.DEPT_LLM_MODEL || 'deepseek-flash',
    reasoningEffort: env.ASTROLAB_REASONING || 'high',
    baseURL: env.DEPT_LLM_BASE_URL || 'https://api.deepseek.com',
    hasKey: !!(env.DEPT_LLM_API_KEY || env.DEEPSEEK_API_KEY),
    /** 和 cordis.patch.yml 里的 contextWindow 一致（vLLM 的 --max-model-len） */
    contextWindow: Number(env.DEPT_LLM_CONTEXT_WINDOW) || 1048576,
  }
}

/** DSH 数据目录的补丁：每次启动从模板重写（工具服务、部门技能、模型路由的路径指向本程序） */
export function prepareDshHome(p) {
  mkdirSync(p.dshHome, { recursive: true })
  if (!existsSync(p.template)) return false
  const tpl = readFileSync(p.template, 'utf8')
  writeFileSync(join(p.dshHome, 'cordis.patch.yml'), tpl.replaceAll('__STARTER_DIR__', p.root.replace(/\\/g, '/')))
  return true
}
