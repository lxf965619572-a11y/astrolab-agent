#!/usr/bin/env node
// 建资料库：按导入说明逐份导入，写 README，提交成 Git 仓库（推到内网 Git 服务器上就是“部门资料库”，工作台当共享库同步）。
//
//   node scripts/reference/build.mjs <资料库目录> [导入说明.json …]     不给导入说明时用 config/reference-specs/ 下全部
//
// 资料原文（PDF）不进这个仓库，只有切好的文字。有版权的资料（license: internal）只在部门内部使用。

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { importReference } from './import.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')

export async function build(out, specFiles, { log = console.log } = {}) {
  mkdirSync(out, { recursive: true })
  const files = specFiles.length ? specFiles : readdirSync(join(ROOT, 'config', 'reference-specs')).filter((f) => f.endsWith('.json')).map((f) => join(ROOT, 'config', 'reference-specs', f))
  const done = []
  for (const f of files) {
    const spec = JSON.parse(readFileSync(f, 'utf8'))
    const src = resolve(ROOT, spec.source)
    if (!existsSync(src)) { log(`跳过 ${spec.title}：没有 ${spec.source}`); continue }
    const r = await importReference(spec, out, { pdf: src, log })
    done.push({ spec, n: r.sections.length, words: r.sections.reduce((a, x) => a + x.words, 0) })
  }
  const docs = readdirSync(join(out, 'reference'), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(out, 'reference', d.name, 'doc.json')))
    .map((d) => JSON.parse(readFileSync(join(out, 'reference', d.name, 'doc.json'), 'utf8')))
  const lic = { public: '公版', internal: '仅部门内部' }
  writeFileSync(join(out, 'README.md'), [
    '# 部门资料库',
    '',
    '学习资料和标准的原文，按节切开，给工作台的“资料”页面和智能体的资料检索（search_reference）用。知识库里放的是提炼过的结论，这里放出处。',
    '',
    '| 资料 | 许可 | 节数 | 页码 |',
    '|---|---|---|---|',
    ...docs.map((d) => `| ${d.titleZh || d.title}（${d.id}） | ${lic[d.license] || d.license} | ${d.sections.length} | ${d.sections[0].pages.split('-')[0]}～${d.sections.at(-1).pages.split('-').pop()} |`),
    '',
    '- 由 `scripts/reference/build.mjs` 按 `config/reference-specs/` 的导入说明生成；要加资料或加章节，改导入说明后重新生成，维护人看过再提交。',
    '- “仅部门内部”的资料有版权：只在内网使用，用公网模型时智能体检索不到。',
    '- 中英术语对照放在 `reference/glossary.json`（{ "遥测": ["telemetry"] }），检索时用中文也能找到英文原文。',
    '',
  ].join('\n'))
  // 文件名在 Windows 上都要合法（大家的电脑是 Windows，Git 检出时会拒绝）
  const { windowsSafeName } = await import('./import.mjs')
  const bad = []
  for (const d of docs) for (const s of d.sections) if (!windowsSafeName(s.file)) bad.push(`${d.id}/${s.file}`)
  if (bad.length) throw new Error(`这些文件名在 Windows 上不能用：${bad.map((b) => JSON.stringify(b)).join('，')}`)
  const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: out, encoding: 'utf8', env: { ...process.env, DEPT_UI_GIT: '1' } })
  if (!existsSync(join(out, '.git'))) git('init', '-q', '-b', 'main')
  git('add', '-A')
  const staged = git('diff', '--cached', '--name-only').trim()
  if (staged) {
    const who = ['-c', 'user.name=AstroLab 资料导入', '-c', 'user.email=astrolab@localhost']
    git(...who, 'commit', '-q', '-m', `资料：${done.map((d) => `${d.spec.id} ${d.n} 节`).join('，') || '更新'}`)
    log(`已提交：${staged.split('\n').length} 个文件`)
  } else log('没有变化')
  return docs
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [out, ...specs] = process.argv.slice(2)
  if (!out) { console.error('用法：build.mjs <资料库目录> [导入说明.json …]'); process.exit(1) }
  build(resolve(out), specs.map((s) => resolve(s))).catch((e) => { console.error(e.message); process.exitCode = 1 })
}
