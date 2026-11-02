#!/usr/bin/env node
// 资料导入：把一份 PDF 按导入说明（config/reference-specs/<id>.json）切成一节一个 Markdown，写进资料库的 reference/<id>/。
//
//   node scripts/reference/import.mjs <导入说明.json> <资料库目录> [--pdf <PDF 路径>]
//
// 导入说明（只有书目信息和目录，可以进仓库；原文不进）：
//   { id, title, titleZh, edition, authors, publisher, year, license: public|internal, lang, source: 资料/xxx.pdf,
//     pageOffset: 21,                       印刷页码 = PDF 页码 - pageOffset（引用写印刷页码）
//     toc: [{ no, title, page, printed?, chapter }],  完整目录（page 是 PDF 页码，只要大致对，前后 3 页内找标题；printed 是目录上印的页码）：每节到下一节的标题为止
//     include: ["13", "9.6", ...] }         导入哪些：章号（整章的每一节）或节号
// 处理：去掉页眉页脚（多页重复的行、单独的页码）、图里的小字；连字符断行接回去；按缩进和行距分段；小节标题转成 ###。
// 资料库是一个 Git 仓库（内网服务器上的“部门资料库”）；导入后由维护人看过再提交、推送。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openPdf, pageLines } from './pdftext.mjs'

const yaml = (v) => (/[:#\[\]{},"'&*!|>%@`]|^\s|\s$|^\d+(\.\d+)*$/.test(String(v)) ? JSON.stringify(String(v)) : String(v))
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** 文件名：去掉 Windows 不允许的字符（\\ / : * ? " < > | 和控制字符），结尾不能是点和空格 */
export const slug = (s) => String(s).replace(/[\x00-\x1f\x7f\u00ad\u200b-\u200f\ufeff]/g, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 60).replace(/[.\s-]+$/, '')
const clean = (s) => String(s || '').replace(/[\x00-\x1f\x7f\u00ad\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim()
/** Windows 上能不能用这个文件名（Git 在 Windows 上检出时会拒绝不合法的路径） */
export function windowsSafeName(name) {
  return !/[\x00-\x1f\x7f<>:"/\\|?*]/.test(name) && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name) && name.length <= 200
}

export function selectUnits(spec) {
  const inc = spec.include || []
  const want = (no) => inc.some((p) => no === p || no.startsWith(`${p}.`))
  const out = []
  const toc = spec.toc.map((t) => ({ ...t, title: clean(t.title), chapter: clean(t.chapter) }))
  toc.forEach((t, i) => {
    const next = toc[i + 1] || null
    if (!want(t.no)) return
    if (next && next.no.startsWith(`${t.no}.`) && next.page === t.page && !t.no.includes('.')) return // 只有章名的一条（下一条就是第一节）跳过
    out.push({ ...t, next })
  })
  return out
}

/** 页眉页脚：开头或结尾是页码，其余的字母基本都是大写（“440 TELEMETRY, COMMAND…”“ON-BOARD DATA HANDLING (OBDH) 13.6 459”） */
export function isRunningHead(t) {
  if (!/^\d{1,4}\s|\s\d{1,4}$/.test(t)) return false
  const letters = t.replace(/[^A-Za-z]/g, '')
  return letters.length >= 4 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.85
}

/** 一页的正文行：去掉页眉页脚、图里的小字 */
function bodyLines(lines, { bodySize, repeated }) {
  return lines.filter((l, i) => {
    const k = norm(l.text).replace(/\d+/g, '#')
    if (repeated.has(k)) return false
    if (/^\d{1,4}$/.test(l.text)) return false // 单独的页码
    if ((i < 2 || i >= lines.length - 2) && isRunningHead(l.text)) return false // 页眉页脚：页码 + 大写的章名、节名
    if (l.size < bodySize * 0.84 && !/^(Figure|Table|Fig\.|Box)\s*\d/i.test(l.text)) return false // 图里的标注、脚注
    return true
  })
}

/** 小节标题：“13.6.1 Platform and payloads”“C.2 Editorial Checklist” */
const HEADING = /^((?:\d+|[A-Z])(?:\.\d+)+)\s+(.+)$/

/** 行 → Markdown：标题、段落（缩进或行距大于 1.5 倍）、连字符接回 */
function toMarkdown(lines, { bodySize, base, unitNo }) {
  const out = []
  let para = ''
  let captions = [] // 图题、表题：等这一段写完再放（不把句子从中间截断）
  const flush = () => { if (para.trim()) out.push(para.trim()); para = ''; out.push(...captions); captions = [] }
  let prevHeading = false
  for (const l of lines) {
    const m = HEADING.exec(l.text)
    const big = l.size > bodySize * 1.05
    if (m && big && (m[1].startsWith(`${unitNo}.`) || m[1].startsWith(`${unitNo.replace(/^App\./, '')}.`))) { flush(); out.push(`${'#'.repeat(Math.min(6, m[1].split('.').length + 1))} ${m[1]} ${m[2]}`); prevHeading = true; continue }
    if (big && prevHeading && !/[.:]$/.test(l.text) && out.length) { out[out.length - 1] += ` ${l.text}`; continue } // 折行的标题
    prevHeading = false
    if (/^(Figure|Table|Box)\s+\d+(\.\d+)*/i.test(l.text) && l.size <= bodySize) { captions.push(`*${l.text}*`); continue }
    if (big && /^(References|Bibliography|Further Reading)$/i.test(l.text)) break // 章末的参考文献不要
    // 新段：行距大或首行缩进；但上一句没说完、这一行小写开头（跨页、跨栏）时接着写
    const unfinished = para && !/[.:;!?)”"]$/.test(para) && /^[a-z(]/.test(l.text)
    const newPara = !unfinished && (l.gapBefore > 1.55 || l.x > base + bodySize * 0.8)
    if (newPara) flush()
    const tail = /(\S+)-$/.exec(para)
    if (tail && /^[a-z]/.test(l.text) && !tail[1].includes('-')) para = para.slice(0, -1) + l.text // 断词接回；复合词（analogue-to-）保留连字符
    else if (tail && /^[a-z]/.test(l.text)) para += l.text
    else para += (para ? ' ' : '') + l.text
  }
  flush()
  return out.join('\n\n')
}

export async function importReference(spec, outDir, { pdf, log = console.log } = {}) {
  const file = resolve(pdf || spec.source)
  if (!existsSync(file)) throw new Error(`找不到资料文件：${file}`)
  const { doc, close } = await openPdf(file)
  const units = selectUnits(spec)
  if (!units.length) throw new Error('导入说明的 include 没有选中任何一节')
  const off = spec.pageOffset || 0
  // 用到的页（目录页码前后多读 3 页：书里夹了彩页时偏移会变）：读一遍，统计正文字号、找重复的页眉页脚
  const SLACK = 3
  const need = new Set()
  for (const u of units) for (let p = u.page - SLACK; p <= (u.next ? u.next.page : u.page) + SLACK; p++) need.add(p)
  const pages = new Map()
  for (const p of [...need].sort((a, b) => a - b)) if (p >= 1 && p <= doc.numPages) pages.set(p, await pageLines(doc, p))
  const sizes = new Map()
  for (const ls of pages.values()) for (const l of ls) sizes.set(l.size, (sizes.get(l.size) || 0) + l.text.length)
  const bodySize = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const seen = new Map()
  for (const ls of pages.values()) for (const k of new Set([...ls.slice(0, 3), ...ls.slice(-4)].map((l) => norm(l.text).replace(/\d+/g, '#')))) seen.set(k, (seen.get(k) || 0) + 1)
  const repeated = new Set([...seen.entries()].filter(([k, n]) => k && n >= Math.max(3, pages.size * 0.2)).map(([k]) => k))
  const base = Math.min(...[...pages.values()].flat().filter((l) => Math.abs(l.size - bodySize) < 0.3).map((l) => l.x))

  // 标题行：“13.2 SYSTEM ARCHITECTURE”；有的书节号和标题分成两行（“9.6” / “ACS COMPUTATION”）。页眉里的“ACS COMPUTATION 9.6”不算
  //   标题折行（“4.1 Stakeholder Expectations” / “Definition”）：这一行是“节号 + 标题开头”就算；附录写成“Appendix C: …”
  const find = (ls, t) => {
    const app = /^App\.([A-Z])$/.exec(t.no)
    const no = app ? `appendix ${app[1].toLowerCase()}` : norm(/^\d+$/.test(t.no) ? `${t.no}.0` : t.no) // 章写成“5.0 Product Realization”
    const words = norm(t.title).split(' ')
    const title = words.slice(0, 3).join(' ')
    const prefix = (a, b) => b.startsWith(a) || a.startsWith(b)
    const full = `${no} ${words.join(' ')}`
    for (let i = 0; i < ls.length; i++) {
      const a = norm(ls[i].text)
      if (ls[i].size < bodySize * 1.05) { if (a === full && ls[i].size >= bodySize * 0.95) return i; continue } // 和正文一样大的（加粗）标题：要整行一致
      if (a.startsWith(`${no} `) && prefix(a.slice(no.length + 1), words.join(' ')) && a.length > no.length + 3) return i
      if (a === no && ls[i + 1] && norm(ls[i + 1].text).startsWith(title)) return i + 1
      if (a === no && ls[i - 1] && norm(ls[i - 1].text).startsWith(title)) return i // 章首页：大号的“5.0”排在章名后面
      if (app && a.split(' ').length >= 2 && prefix(a, words.join(' ')) && ls.slice(Math.max(0, i - 2), i + 3).some((l) => norm(l.text).startsWith(no))) return Math.max(i, ls.findIndex((l) => norm(l.text).startsWith(no)))
    }
    return -1
  }
  /** 标题实际在哪一页：目录页码前后 SLACK 页里找 */
  const locate = (t) => {
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      const p = t.page + d
      const i = find(pages.get(p) || [], t)
      if (i >= 0) return { page: p, line: i }
    }
    return null
  }
  /** 印刷页码：页眉或页脚里的页码；这一页没有（章首页）就看相邻的页 */
  const headNo = (p) => {
    const ls = pages.get(p) || []
    for (const l of [...ls.slice(0, 2), ...ls.slice(-2)]) {
      if (!/^\d{1,4}$/.test(l.text) && !isRunningHead(l.text)) continue
      const m = /^(\d{1,4})\b|\b(\d{1,4})$/.exec(l.text)
      const n = m && Number(m[1] || m[2])
      if (n && Math.abs(p - off - n) <= 6) return n
    }
    return null
  }
  const printed = (p) => {
    for (let d = 0; d <= 4; d++) {
      const a = headNo(p - d); if (a) return a + d
      const b = headNo(p + d); if (b) return b - d
    }
    return p - off
  }
  const dir = join(outDir, 'reference', spec.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const index = []
  const warnings = []
  for (const u of units) {
    const a = locate(u)
    if (!a) warnings.push(`${u.no}：第 ${u.page} 页前后没找到标题，从页首开始`)
    const start = a || { page: u.page, line: -1 }
    const b = u.next ? locate(u.next) : null
    if (u.next && !b) warnings.push(`${u.no}：没找到下一节 ${u.next.no} 的标题，到第 ${u.next.page} 页为止`)
    let end = b || { page: u.next ? u.next.page : start.page, line: Infinity }
    // 下一节是另一章：到上一页为止（那一页的上半是新一章的章名和作者）
    if (b && u.next.chapter && u.chapter && u.next.chapter !== u.chapter) end = { page: b.page - 1, line: Infinity }
    let lines = []
    for (let p = start.page; p <= end.page; p++) {
      let ls = pages.get(p) || []
      let from = p === start.page ? start.line + 1 : 0
      while (p === start.page && ls[from] && ls[from].size > bodySize * 1.05 && !HEADING.test(ls[from].text)) from++ // 折到第二行的标题
      const to = p === end.page ? end.line : ls.length
      lines.push(...bodyLines(ls.slice(from, to), { bodySize, repeated }))
    }
    const body = toMarkdown(lines.map((l) => ({ ...l, text: l.text.replace(/^[\uf000-\uf0ff\u0080-\u009f\u25aa\u25a0\u2022]\s*/, '• ').replace(/[\uf000-\uf0ff\u0080-\u009f]/g, '') })), { bodySize, base, unitNo: u.no }) // 符号字体的项目符号（私用区、C1 控制字符）
    const lastPage = end.line === Infinity ? end.page : (b && b.line <= 1 && b.page > start.page ? b.page - 1 : end.page)
    const p1 = u.printed || printed(start.page), p2 = Math.max(p1, printed(lastPage)) // 起始页以目录印的为准
    const pagesTxt = p1 === p2 ? `${p1}` : `${p1}-${p2}`
    const name = `${/^App\./.test(u.no) ? u.no.replace('.', '-') : u.no.split('.').map((x) => x.padStart(2, '0')).join('.')}-${slug(u.title)}.md`
    const meta = { doc: spec.id, docTitle: spec.title, section: u.no, title: u.title, chapter: u.chapter || '', pages: pagesTxt, license: spec.license, lang: spec.lang || 'en' }
    const head = ['---', ...Object.entries(meta).filter(([, v]) => v !== '').map(([k, v]) => `${k}: ${yaml(v)}`), '---', '']
    writeFileSync(join(dir, name), `${head.join('\n')}# ${u.no} ${u.title}\n\n${body}\n`)
    index.push({ no: u.no, title: u.title, chapter: u.chapter || '', pages: pagesTxt, file: name, words: body.split(/\s+/).length })
    if (body.length < 300) warnings.push(`${u.no}：只有 ${body.length} 个字符，检查切分`)
  }
  const { toc, include, source, ...info } = spec
  writeFileSync(join(dir, 'doc.json'), JSON.stringify({ ...info, source: source.split(/[\\/]/).pop(), importedAt: new Date().toISOString(), sections: index }, null, 1))
  await close()
  log(`${spec.title}：导入 ${index.length} 节（${index.reduce((n, x) => n + x.words, 0)} 词）→ ${dir}`)
  for (const w of warnings) log(`  注意：${w}`)
  return { dir, sections: index, warnings }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specFile, out, ...rest] = process.argv.slice(2)
  const pdf = rest[0] === '--pdf' ? rest[1] : undefined
  if (!specFile || !out) { console.error('用法：import.mjs <导入说明.json> <资料库目录> [--pdf <PDF>]'); process.exit(1) }
  const spec = JSON.parse(readFileSync(specFile, 'utf8'))
  importReference(spec, resolve(out), { pdf }).catch((e) => { console.error(e.message); process.exitCode = 1 })
}
