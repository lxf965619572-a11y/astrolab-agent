#!/usr/bin/env node
// 由参考版源码 + 缺陷补丁生成工作区中的样例源码（埋缺陷版）。
// 用法：node evals/unit-test/build-sample.mjs [用例名，默认 cmd_check]

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSample, loadCase, patchFile } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const name = process.argv[2] || 'cmd_check'
const cfg = loadCase(join(HERE, name))
const defects = JSON.parse(readFileSync(join(HERE, name, 'defects.json'), 'utf8')).defects
for (const f of cfg.files) {
  const mine = defects.filter((d) => patchFile(cfg, d) === f.name)
  writeFileSync(join(ROOT, f.sample), buildSample(f.text, mine))
  console.log(`已生成 ${f.sample}（埋入 ${mine.filter((d) => d.inSample !== false).length} 个缺陷）`)
}
