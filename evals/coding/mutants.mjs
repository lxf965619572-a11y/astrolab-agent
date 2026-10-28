#!/usr/bin/env node
// 验证隐藏测试的区分度：参考实现必须全部通过；在参考实现上植入 mutants.json 中的典型错误，每个变体都必须被至少一个用例抓到。
// 用法：node evals/coding/mutants.mjs [用例名，默认 thm_ctrl]      需要 gcc（UTEST_CC，与单元测试相同）
import { join } from 'node:path'
import { caseDir, loadLocalEnv, readText, ROOT, runHidden, tmp, toolchain, writeText } from './lib.mjs'

const name = process.argv[2] || 'thm_ctrl'
loadLocalEnv(ROOT)
const tc = await toolchain()
if (!tc.ok) { console.error(tc.error); process.exit(2) }
const dir = caseDir(name)
const ref = readText(join(dir, 'reference', `${name}.c`))
const { mutants } = JSON.parse(readText(join(dir, 'mutants.json')))
const inc = join(dir, 'inputs', 'include')

async function check(src) {
  const work = tmp('coding-mut-')
  const c = join(work, `${name}.c`)
  writeText(c, src)
  return runHidden({ cc: tc.cc, name, cFiles: [c], incDirs: [inc], work })
}

const base = await check(ref)
if (!base.ok || base.fail || base.crashed) {
  console.error('参考实现没有全部通过隐藏测试：\n' + (base.compileError || base.log))
  process.exit(2)
}
console.log(`参考实现：${base.pass}/${base.results.length} 通过（${tc.cc} ${tc.version}）\n`)
let missed = 0
for (const m of mutants) {
  const n = ref.split(m.find).length - 1
  if (n !== 1) { console.log(`??  ${m.name}：替换点出现 ${n} 次（应为 1 次）`); missed++; continue }
  const r = await check(ref.replace(m.find, m.replace))
  if (!r.ok) { console.log(`??  ${m.name}：变体编译失败\n${r.compileError}`); missed++; continue }
  const fails = r.results.filter((x) => !x.pass).map((x) => x.id)
  if (r.crashed) fails.push('（崩溃）')
  if (fails.length) console.log(`抓到  ${m.name.padEnd(16, '　')} → ${fails.join('、')}`)
  else { console.log(`漏掉  ${m.name}`); missed++ }
}
console.log(`\n${mutants.length - missed}/${mutants.length} 个变体被抓到`)
process.exit(missed ? 1 : 0)
