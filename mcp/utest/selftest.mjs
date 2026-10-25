// 自检：以 MCP 客户端身份拉起 utest 服务，编译运行自带的小例子，核对用例结果和覆盖率，再核对一张 MC/DC 分析表。
// 由 scripts\check.ps1 调用。构建目录放在临时目录，结束后删除。
// 退出码：0 = 通过；1 = 失败；2 = 本机没有可用的编译器（check.ps1 显示为警告）

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const here = dirname(fileURLToPath(import.meta.url))
const ex = join(here, 'selftest')
const tmp = mkdtempSync(join(tmpdir(), 'astrolab-utest-'))
let bad = 0
let code = 0
const say = (okay, msg) => { console.log(`   ${okay ? '[OK]' : '[X] '} ${msg}`); if (!okay) bad++ }

const c = new Client({ name: 'selftest', version: '0' })
try {
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, 'server.mjs')], env: { ...process.env, DOC_ALLOWED_ROOTS: tmp } }))
  const tools = (await c.listTools()).tools.map((t) => t.name)
  say(['toolchain_info', 'run_unit_tests', 'coverage_detail', 'check_mcdc'].every((n) => tools.includes(n)), `工具：${tools.join('、')}`)

  // MC/DC 分析表核对不需要编译器
  const m = await c.callTool({ name: 'check_mcdc', arguments: { decision: 'A || B', vectors: [
    { id: 'V1', values: 'TX', expected: true }, { id: 'V2', values: 'FT', expected: true }, { id: 'V3', values: 'FF', expected: false }] } })
  say(!m.isError && m.structuredContent?.satisfied === true, 'check_mcdc：A || B 三个向量满足 MC/DC')

  const tc = await c.callTool({ name: 'toolchain_info', arguments: {} })
  if (tc.isError) {
    console.log(`   [!]  ${tc.content[0].text}`)
    code = 2
  } else {
    const t = tc.structuredContent
    console.log(`   [OK] 编译器 ${t.cc}（${t.version}），gcov ${t.gcovOk ? '可用' : '不可用'}，MC/DC 测量${t.mcdc ? '支持' : '不支持（GCC 14 以下）'}`)
    if (!t.gcovOk) say(false, `gcov 不可用：${t.gcovError}`)
    const r = await c.callTool({ name: 'run_unit_tests', arguments: {
      sources: [join(ex, 'demo.c')], tests: [join(ex, 'test_demo.c')], includeDirs: [ex], name: 'selftest' } })
    const s = r.structuredContent || {}
    if (r.isError) say(false, `run_unit_tests 失败：${r.content[0].text.slice(0, 600)}`)
    else {
      say(s.summary?.cases === 4 && s.summary?.failed === 0, `用例 ${s.summary?.cases ?? '?'} 个，失败 ${s.summary?.failed ?? '?'} 个（期望 4 个全部通过）`)
      const tot = s.coverage?.total
      if (t.gcovOk) {
        say(tot?.statements?.percent === 100, `语句覆盖 ${tot?.statements?.covered}/${tot?.statements?.total}`)
        say(tot?.branches?.total > 0 && tot.branches.percent === 100, `分支覆盖 ${tot?.branches?.covered}/${tot?.branches?.total}`)
        if (t.mcdc) say(!!tot?.mcdc, `MC/DC ${tot?.mcdc ? `${tot.mcdc.covered}/${tot.mcdc.total}` : '没有读到数据（GCC 14 的输出格式可能与预期不同，请告诉维护人员）'}`)
      }
    }
    // 崩溃的测试程序应立即结束并被识别为崩溃，而不是挂起到超时（Windows 错误报告对话框）
    const t0 = Date.now()
    const cr = await c.callTool({ name: 'run_unit_tests', arguments: {
      sources: [join(ex, 'demo.c')], tests: [join(ex, 'test_crash.c')], includeDirs: [ex], name: 'selftest-crash', timeoutSec: 20 } })
    const cs = cr.structuredContent || {}
    if (cr.isError) say(false, `崩溃识别：编译失败：${cr.content[0].text.slice(0, 400)}`)
    else say(!cs.timedOut && !cs.summary, cs.timedOut
      ? '崩溃识别：测试程序崩溃后挂起到超时（Windows 错误报告对话框未关闭），请告诉维护人员'
      : `崩溃识别：测试程序崩溃后 ${((Date.now() - t0) / 1000).toFixed(1)} 秒内结束，最后的用例 ${cs.cases?.at(-1)?.id ?? '?'}`)
  }
} catch (e) {
  say(false, `自检出错：${e.message}`)
} finally {
  await c.close().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(bad ? 1 : code)
