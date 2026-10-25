#!/usr/bin/env node
// 由参考版源码 + 缺陷补丁生成工作区中的样例源码（埋缺陷版）。
// 用法：node evals/unit-test/build-sample.mjs [用例名，默认 cmd_check]

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSample } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const name = process.argv[2] || 'cmd_check'
const cfg = JSON.parse(readFileSync(join(HERE, name, 'case.json'), 'utf8'))
const ref = readFileSync(join(HERE, name, cfg.reference), 'utf8')
const defects = JSON.parse(readFileSync(join(HERE, name, 'defects.json'), 'utf8')).defects
writeFileSync(join(ROOT, cfg.sampleSource), buildSample(ref, defects))
console.log(`已生成 ${cfg.sampleSource}（埋入 ${defects.length} 个缺陷）`)
