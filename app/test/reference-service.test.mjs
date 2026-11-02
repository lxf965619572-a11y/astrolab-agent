// 资料阅读：翻译（逐段对齐、术语表、有版权的不发公网）、改原文和还原、改译文、提交、高亮和批注（摘录写进我的库）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReferenceService, chunk, parseNumbered, termsFor } from '../main/reference.mjs'
import { buildRefIndex, loadGlossary, searchRef } from '../../mcp/knowledge/lib/ref.mjs'

function setup({ license = 'internal', scope = 'all', reply } = {}) {
  const t = mkdtempSync(join(tmpdir(), 'astro-refsvc-'))
  const ref = join(t, 'ref'), mine = join(t, 'mine'), data = join(t, 'data')
  const d = join(ref, 'reference', 'sse4')
  mkdirSync(d, { recursive: true }); mkdirSync(mine, { recursive: true })
  writeFileSync(join(d, 'doc.json'), JSON.stringify({ id: 'sse4', title: 'Spacecraft Systems Engineering (4th ed.)', titleZh: '航天器系统工程', license, sections: [
    { no: '13.3', title: 'Telemetry Data Formatting', pages: '442-449', file: '13.03-Telemetry.md' },
    { no: '13.4', title: 'Telecommand', pages: '449-455', file: '13.04-Telecommand.md' },
  ] }))
  writeFileSync(join(d, '13.03-Telemetry.md'), '---\ndoc: sse4\nsection: "13.3"\ntitle: Telemetry Data Formatting\n---\n# 13.3 Telemetry Data Formatting\n\n#### 13.3.1 Frames\n\nTelemetry frames start with a synchronization word.\n\nThe OBDH collects packets and the telecommand is verified.\n\n*Figure 13.3 Frame format*\n')
  writeFileSync(join(d, '13.04-Telecommand.md'), '---\ndoc: sse4\nsection: "13.4"\n---\n# 13.4 Telecommand\n\nEach telecommand is verified.\n')
  const calls = [], commits = [], submits = []
  const svc = new ReferenceService({
    libs: () => [{ id: 'mine', name: '我的库', dir: mine, writable: true }, { id: 'ref', name: '部门资料库', dir: ref }],
    mineDir: () => mine, dataDir: data,
    model: () => ({ baseURL: 'http://llm', apiKey: 'k', model: 'm', scope }),
    chat: async (o) => { calls.push(o); if (reply) return reply(o); const n = [...o.messages[1].content.matchAll(/【(\d+)】/g)].length; return { content: n ? Array.from({ length: n }, (_, i) => `【${i + 1}】译文${i + 1}`).join('\n\n') : '遥测数据格式' } },
    commit: async (paths, msg) => { commits.push({ paths, msg }) },
    submit: async (lib, rel, title) => { submits.push({ lib, rel, title }); return { branch: 'submit/x' } },
  })
  return { t, ref, mine, data, svc, calls, commits, submits, id: 'ref:sse4/13.03-Telemetry.md' }
}

test('读一节：标题行去掉，按空行分段；还没有译文', () => {
  const { svc, id } = setup()
  const r = svc.read(id)
  assert.deepEqual(r.paragraphs, ['#### 13.3.1 Frames', 'Telemetry frames start with a synchronization word.', 'The OBDH collects packets and the telecommand is verified.', '*Figure 13.3 Frame format*'])
  assert.equal(r.translation, null)
  assert.equal(r.next.no, '13.4')
  assert.match(r.cite, /§13\.3 Telemetry Data Formatting，第 442-449 页/)
})

test('翻译：逐段编号发出去、按编号对回来；带上术语表；存在我的库并提交；资料库里的译文进检索', async () => {
  const { svc, id, calls, commits, mine, ref } = setup()
  const progress = []
  const r = await svc.translate(id, { onProgress: (i, j) => progress.push(j && j.done) })
  assert.deepEqual(r.translation.paragraphs, ['译文1', '译文2', '译文3', '译文4'])
  assert.equal(r.translation.from, 'mine')
  assert.equal(r.translation.title, '遥测数据格式')
  assert.equal(r.translation.stale, false)
  assert.match(calls[0].messages[1].content, /【1】#### 13\.3\.1 Frames/)
  assert.match(calls[0].messages[1].content, /术语对照：[^\n]*telemetry = 遥测/)
  assert.match(calls[0].messages[1].content, /OBDH = /)
  assert.ok(existsSync(join(mine, 'reference', 'sse4', '13.03-Telemetry.zh.md')))
  assert.deepEqual(commits[0].paths, ['reference/sse4/13.03-Telemetry.zh.md'])
  assert.ok(progress.includes(1) && progress.at(-1) === null)
  // 提交审核、通过后在资料库里：中文问题直接命中
  writeFileSync(join(ref, 'reference', 'sse4', '13.04-Telecommand.zh.md'), '---\ntitle: 遥控\n---\n每条遥控指令都要校验。\n')
  const L = [{ id: 'ref', name: 'r', dir: ref }]
  assert.equal(searchRef(buildRefIndex(L), '遥控指令校验', { glossary: new Map() }).hits[0].no, '13.4')
})

test('模型没按编号回：整组放在第一段，不丢内容；有版权的资料用公网接口时不翻译', async () => {
  const a = setup({ reply: () => ({ content: '一整段没有编号的译文' }) })
  const r = await a.svc.translate(a.id)
  assert.equal(r.translation.paragraphs[0], '一整段没有编号的译文')
  assert.equal(r.translation.paragraphs.length, 4)
  const b = setup({ scope: 'public' })
  await assert.rejects(b.svc.translate(b.id), /有版权/)
  const c = setup({ scope: 'public', license: 'public' })
  assert.ok((await c.svc.translate(c.id)).translation)
})

test('改原文：叠在我的库上；译文标成可能对不上；还原；改译文；提交到资料库审核', async () => {
  const { svc, id, submits, mine } = setup()
  await svc.translate(id)
  let r = await svc.saveOriginal(id, '#### 13.3.1 Frames\n\nTelemetry frames start with a sync word (fixed).\n\nSecond.')
  assert.equal(r.edited, true)
  assert.equal(r.paragraphs[1], 'Telemetry frames start with a sync word (fixed).')
  assert.equal(r.translation.stale, true, '原文改了，译文可能对不上')
  r = await svc.saveTranslation(id, ['帧', '遥测帧以同步字开头。', '第二段'])
  assert.equal(r.translation.edited, true)
  assert.equal(r.translation.stale, false)
  assert.equal(r.translation.paragraphs[1], '遥测帧以同步字开头。')
  await svc.submit(id, 'original')
  await svc.submit(id, 'translation')
  assert.deepEqual(submits.map((s) => s.rel), ['reference/sse4/13.03-Telemetry.md', 'reference/sse4/13.03-Telemetry.zh.md'])
  assert.match(submits[0].title, /资料更正：航天器系统工程 §13\.3/)
  r = await svc.revert(id, 'original')
  assert.equal(r.edited, false)
  assert.ok(!existsSync(join(mine, 'reference', 'sse4', '13.03-Telemetry.md')))
  await assert.rejects(svc.submit(id, 'original'), /没有改过原文/)
})

test('高亮和批注：加、改色、写批注、删；摘录写进我的库；目录里的数', () => {
  const { svc, id, mine } = setup()
  assert.throws(() => svc.addHighlight(id, { quote: 'x' }), /先选中/)
  const h = svc.addHighlight(id, { quote: 'synchronization word', prefix: 'start with a ', suffix: '.', color: 'green', lang: 'en' })
  svc.addHighlight(id, { quote: '同步字', lang: 'zh', color: 'purple' })
  let r = svc.read(id)
  assert.equal(r.highlights.length, 2)
  assert.equal(r.highlights[1].color, 'yellow', '不认识的颜色用黄色')
  svc.updateHighlight(id, h.id, { note: '帧同步靠同步字，地面按它找帧头', color: 'blue' })
  const ex = readFileSync(join(mine, '摘录', '航天器系统工程.md'), 'utf8')
  assert.match(ex, /## §13\.3 Telemetry Data Formatting（第 442-449 页）/)
  assert.match(ex, /> synchronization word\n\n批注：帧同步靠同步字/)
  assert.deepEqual(svc.counts('ref', 'sse4'), { '13.03-Telemetry.md': 2 })
  svc.removeHighlight(id, h.id)
  svc.removeHighlight(id, svc.read(id).highlights[0].id)
  assert.equal(svc.read(id).highlights.length, 0)
  assert.ok(!existsSync(join(mine, '摘录', '航天器系统工程.md')), '没有高亮了，摘录文件删掉')
})

test('分组、编号解析、术语', () => {
  assert.deepEqual(chunk(['a'.repeat(4000), 'b'.repeat(3000), 'c'.repeat(100)], 6000), [[0], [1, 2]])
  assert.deepEqual(parseNumbered('【1】一\n\n【2】二\n多行\n\n\n【9】越界', 2).out, ['一', '二\n多行'])
  const g = loadGlossary([])
  const ts = termsFor('The TT&C link and OBDH bus; telecommand', g)
  assert.ok(ts.some(([en, zh]) => en === 'OBDH'))
  assert.ok(ts.some(([en]) => en === 'telecommand'))
})
