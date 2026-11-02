// 资料库：检索（英文词干、中文按术语表扩展、标题加权）、许可（公网只开放公版）、分部分阅读、导入时挑节和认页眉
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRefIndex, expandQuery, listDocs, loadGlossary, readRef, refTokens, searchRef, stem } from '../../mcp/knowledge/lib/ref.mjs'
import { isRunningHead, selectUnits, slug, windowsSafeName } from '../../scripts/reference/import.mjs'

function lib() {
  const dir = mkdtempSync(join(tmpdir(), 'astro-ref-'))
  const put = (doc, license, secs) => {
    const d = join(dir, 'reference', doc)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'doc.json'), JSON.stringify({ id: doc, title: `${doc} Handbook`, titleZh: `${doc} 手册`, license, lang: 'en', sections: secs.map((s) => ({ no: s.no, title: s.title, pages: s.pages, file: `${s.no}.md` })) }))
    for (const s of secs) writeFileSync(join(d, `${s.no}.md`), `---\ndoc: ${doc}\nsection: "${s.no}"\ntitle: ${s.title}\npages: ${s.pages}\nlicense: ${license}\n---\n# ${s.no} ${s.title}\n\n${s.body}\n`)
  }
  put('tm', 'internal', [
    { no: '13.3', title: 'Telemetry Data Formatting', pages: '442-449', body: 'Telemetry frames carry a synchronization word. The frame format is fixed and packets are multiplexed.' },
    { no: '13.4', title: 'Telecommand', pages: '449-455', body: 'Each telecommand is verified before execution and acknowledged by telemetry.' },
  ])
  put('se', 'public', [
    { no: '5.3', title: 'Product Verification', pages: '88-99', body: 'Verification proves the product meets its requirements: test, analysis, inspection, demonstration.' },
    { no: '5.4', title: 'Product Validation', pages: '99-106', body: `Validation confirms the product does what the stakeholder needs. ${'Long paragraph about validation planning and operations. '.repeat(400)}\n\n${'Second part text about validation reports. '.repeat(200)}` },
  ])
  writeFileSync(join(dir, 'reference', 'glossary.json'), JSON.stringify({ 遥测帧: ['telemetry frame'], 产品确认: ['product validation'] }))
  return [{ id: 'ref', name: '部门资料库', dir }]
}

test('词干和切词：复数、-ing、-ed 合并；停用词去掉；1553B、TT&C 也能搜', () => {
  assert.equal(stem('requirements'), 'requirement')
  assert.equal(stem('testing'), 'test')
  assert.equal(stem('process'), 'process')
  assert.equal(stem('bus'), 'bus')
  assert.deepEqual(refTokens('The Verification of Requirements'), ['verification', 'requirement'])
  assert.ok(refTokens('MIL-STD-1553B bus').includes('milstd1553b'))
  assert.ok(refTokens('TT&C link').includes('ttc'))
})

test('中文问题按术语表补英文：长的术语优先，库里的术语表合并进来', () => {
  const L = lib()
  const g = loadGlossary(L)
  assert.ok(g.get('遥测').includes('telemetry'), '内置术语表')
  assert.deepEqual(g.get('遥测帧'), ['telemetry frame'], '库里的术语表')
  const e = expandQuery('单粒子翻转怎么处理', g)
  assert.ok(e.terms.includes('SEU'))
  assert.ok(!e.terms.includes('SEE'), '“单粒子翻转”整个匹配，不再拆出“单粒子”')
})

test('检索：中文问题找到英文原文的节；标题里有的词排前面；引用带资料名、节号、页码', () => {
  const L = lib()
  const g = loadGlossary(L)
  const idx = buildRefIndex(L)
  const r = searchRef(idx, '遥测帧格式和同步字', { glossary: g })
  assert.equal(r.hits[0].no, '13.3')
  assert.match(r.hits[0].cite, /tm Handbook §13\.3 Telemetry Data Formatting，第 442-449 页/)
  assert.equal(searchRef(idx, '产品确认', { glossary: g }).hits[0].no, '5.4')
  assert.equal(searchRef(idx, 'verification', { glossary: g }).hits[0].no, '5.3', '标题加权：5.4 正文长、validation 多，但 5.3 标题就是 Verification')
  assert.equal(searchRef(idx, 'telecommand', { doc: 'se', glossary: g }).hits.length, 0, '只在某份资料里找')
})

test('许可：scope 为 public 时有版权的资料检索不到、读不了', () => {
  const L = lib()
  const pub = buildRefIndex(L, { scope: 'public' })
  assert.ok(pub.secs.every((s) => s.license === 'public'))
  assert.equal(searchRef(pub, 'telemetry frame', {}).hits.length, 0)
  const id = buildRefIndex(L).secs.find((s) => s.no === '13.3').id
  assert.throws(() => readRef(L, id, { scope: 'public' }), /有版权/)
  assert.equal(readRef(L, id).meta.no, '13.3')
  assert.equal(listDocs(L).length, 2)
})

test('读一节：太长的分几部分；给出上一节、下一节', () => {
  const L = lib()
  const id = buildRefIndex(L).secs.find((s) => s.no === '5.4').id
  const r1 = readRef(L, id)
  assert.ok(r1.parts >= 2)
  assert.equal(r1.prev.no, '5.3')
  assert.equal(r1.next, null)
  const r2 = readRef(L, id, { part: 2 })
  assert.equal(r2.part, 2)
  assert.notEqual(r2.text, r1.text)
  assert.throws(() => readRef(L, 'ref:none/x.md'), /没有这份资料/)
})

test('导入：按 include 挑节（章号选整章，只有章名的一条跳过）；认得页眉页脚', () => {
  const toc = [
    { no: '8', title: 'Avionics', page: 249 }, { no: '8.1', title: 'Introduction', page: 249 }, { no: '8.2', title: 'Computing', page: 250 },
    { no: '9', title: 'Comm', page: 277 }, { no: '9.1', title: 'Introduction', page: 277 },
  ]
  const u = selectUnits({ toc, include: ['8'] })
  assert.deepEqual(u.map((x) => x.no), ['8.1', '8.2'])
  assert.equal(u[1].next.no, '9', '最后一节到下一章为止')
  assert.ok(isRunningHead('440 TELEMETRY, COMMAND, DATA HANDLING AND PROCESSING'))
  assert.ok(isRunningHead('ON-BOARD DATA HANDLING (OBDH) AND PROCESSING 13.6 459'))
  assert.ok(isRunningHead('NASA SYSTEMS ENGINEERING HANDBOOK 240'))
  assert.ok(!isRunningHead('The 1553 bus is a serial bus capable of operating at 765'))
})

test('文件名：书签里夹的控制字符（BEL）去掉，Windows 不允许的字符替换掉', () => {
  assert.equal(slug('\u0007Stakeholder Expectations Definition'), 'Stakeholder-Expectations-Definition')
  assert.equal(slug('Telemetry: Frames / Packets?'), 'Telemetry-Frames-Packets')
  assert.equal(slug('Ends with dot.'), 'Ends-with-dot')
  assert.ok(windowsSafeName('04.01-Stakeholder-Expectations-Definition.md'))
  assert.ok(!windowsSafeName('04.01-\u0007Stakeholder.md'))
  assert.ok(!windowsSafeName('a:b.md'))
  assert.ok(!windowsSafeName('aux.md'))
  assert.equal(selectUnits({ toc: [{ no: '4.1', title: '\u0007Stakeholder', page: 1 }], include: ['4.1'] })[0].title, 'Stakeholder')
})
