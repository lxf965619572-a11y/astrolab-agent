// 打包电脑上用：生成安装包的清单、把安装包发布到更新位置（内网共享文件夹）。
//
//   node packaging/release.mjs manifest <安装包目录> [--version 0.2.0] [--commit abc1234]
//       给打好的包（runtime\dist\AstroLab）写 manifest.json：版本号（默认取 app\app\package.json）和每个文件的 sha256。
//       build-offline.ps1 最后一步会调用。
//   node packaging/release.mjs publish <安装包目录> <更新位置> [--notes "这次改了什么"] [--force]
//       复制到 <更新位置>\<版本>\files，写 <版本>\manifest.json，最后写 latest.json（大家的软件看这个文件发现新版本）。
//       版本已经发布过、或不比当前最新的版本新时拒绝（--force 跳过）。
//
// 旧版本文件夹可以删掉（建议保留最近两三个）。软件只升不降：要退回，就把旧的代码改个更大的版本号重新发布。

import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, makeManifest, MANIFEST, readManifest } from '../app/main/updater.mjs'

function args(argv) {
  const pos = [], opt = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; opt[k] = v } else pos.push(argv[i])
  }
  return { pos, opt }
}

export async function writePackageManifest(pkg, { version, commit } = {}) {
  if (!version) {
    const pj = join(pkg, 'app', 'app', 'package.json')
    if (!existsSync(pj)) throw new Error(`找不到 ${pj}，用 --version 指定版本号`)
    version = JSON.parse(readFileSync(pj, 'utf8')).version
  }
  const m = await makeManifest(pkg, { version, commit })
  await writeFile(join(pkg, MANIFEST), JSON.stringify(m, null, 1))
  return m
}

export async function publish(pkg, updateDir, { notes = '', force = false, log = console.log } = {}) {
  const m = readManifest(pkg)
  if (!m) throw new Error(`${pkg} 里没有 ${MANIFEST}：先运行 release.mjs manifest（build-offline.ps1 会自动生成）`)
  const latestFile = join(updateDir, 'latest.json')
  const cur = existsSync(latestFile) ? JSON.parse(readFileSync(latestFile, 'utf8').replace(/^﻿/, '')) : null
  const dest = join(updateDir, m.version)
  if (!force && existsSync(join(dest, MANIFEST))) throw new Error(`版本 ${m.version} 已经发布过（${dest}）。先改 app\\package.json 的版本号再打包，或用 --force 覆盖`)
  if (!force && cur && compareVersions(m.version, cur.version) <= 0) throw new Error(`版本 ${m.version} 不比更新位置上的 ${cur.version} 新`)
  const rels = Object.keys(m.files)
  let n = 0
  for (const rel of rels) {
    const to = join(dest, 'files', ...rel.split('/'))
    await mkdir(dirname(to), { recursive: true })
    await copyFile(join(pkg, ...rel.split('/')), to)
    if (++n % 500 === 0) log(`  已复制 ${n}/${rels.length}`)
  }
  await writeFile(join(dest, MANIFEST), JSON.stringify(m, null, 1))
  const latest = { version: m.version, date: new Date().toISOString(), notes: String(notes || ''), dir: m.version }
  const tmp = `${latestFile}.tmp`
  await writeFile(tmp, JSON.stringify(latest, null, 1))
  await rename(tmp, latestFile)
  log(`已发布 ${m.version}（${rels.length} 个文件）到 ${dest}；latest.json 已更新${cur ? `（原来是 ${cur.version}）` : ''}`)
  return latest
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const { pos, opt } = args(process.argv.slice(2))
  const [cmd, a, b] = pos
  const run = cmd === 'manifest' && a ? writePackageManifest(resolve(a), { version: opt.version, commit: opt.commit }).then((m) => console.log(`manifest.json：版本 ${m.version}，${Object.keys(m.files).length} 个文件`))
    : cmd === 'publish' && a && b ? publish(resolve(a), resolve(b), { notes: opt.notes === true ? '' : opt.notes, force: !!opt.force })
      : Promise.reject(new Error('用法：release.mjs manifest <包目录> [--version v] | publish <包目录> <更新位置> [--notes "…"] [--force]'))
  run.catch((e) => { console.error(e.message); process.exitCode = 1 })
}
