// 资料阅读：中英对照（翻译）、改原文、高亮和批注。资料本身在共享的资料库里（只读，同步会冲掉本地改动），
// 个人的改动叠在上面：
//   我的库/reference/<资料>/<节>.md       我改过的原文（有就用它，“还原”就删掉）
//   我的库/reference/<资料>/<节>.zh.md    我的译文（逐段对应原文，空行分段）；资料库里有审核过的 <节>.zh.md 时是部门译文
//   <数据目录>/reference-notes/<库>__<资料>.json   高亮和批注；同时写一份 我的库/摘录/<资料>.md（Obsidian 里能看）
// 改过的原文和译文可以“提交到资料库”（走共享库的审核），通过后大家都用这一份，不用每人翻一遍。
// 翻译：按段分组发给部门模型，带上术语表；有版权的资料只在部门模型下翻译（公网接口不发）。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseEntry } from '../../mcp/knowledge/lib/kb.mjs'
import { listDocs, loadGlossary } from '../../mcp/knowledge/lib/ref.mjs'

export const EXCERPTS = '摘录'
const hash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 12)
const yamlv = (v) => (/[:#\[\]{},"'&*!|>%@`]|^\s|\s$|^\d+(\.\d+)*$/.test(String(v)) ? JSON.stringify(String(v)) : String(v))
const front = (meta) => ['---', ...Object.entries(meta).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${yamlv(v)}`), '---', ''].join('\n')
export const paragraphs = (body) => String(body || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
const COLORS = ['yellow', 'green', 'blue', 'pink']

/** 英文术语 → 中文（术语表反过来），只取这段文字里出现的 */
export function termsFor(text, glossary, max = 60) {
  const out = new Map()
  const low = String(text).toLowerCase()
  for (const [zh, ens] of glossary) {
    for (const en of ens) {
      if (en.length < 2 || out.has(en)) continue
      const re = new RegExp(`(^|[^a-z0-9])${en.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`)
      if (re.test(low)) out.set(en, zh)
    }
  }
  return [...out.entries()].slice(0, max)
}

/** 分组：每组不超过 maxChars 个字符（一组一次请求） */
export function chunk(paras, maxChars = 6000) {
  const groups = []
  let cur = []
  let n = 0
  paras.forEach((p, i) => {
    if (cur.length && n + p.length > maxChars) { groups.push(cur); cur = []; n = 0 }
    cur.push(i); n += p.length
  })
  if (cur.length) groups.push(cur)
  return groups
}

const SYSTEM = [
  '你是航天器工程和嵌入式软件领域的技术翻译，把英文资料翻译成简体中文，给部门的工程师学习用。',
  '规则：',
  '1. 逐段翻译：输入里每段以【编号】开头，输出也必须每段以同样的【编号】开头，段数、顺序和输入一样；不合并、不拆分、不漏段，不加解释。',
  '2. 以 # 开头的标题保留 # 号，节号原样保留，标题译成中文。以 * 包起来的图表题保留 *，“Figure 13.6”译为“图 13.6”，“Table”译为“表”。',
  '3. 缩写、型号、标准号、公式、数字和单位原样保留（如 OBDH、1553B、ECSS-E-ST-70、kbps）；常见缩写第一次出现时可以在后面括号里给中文。',
  '4. 术语按给出的对照表译，表里没有的按航天工程的通用译法。',
  '5. 原文里因为排版提取出错的地方（断词、乱码）按上下文理解，译出意思，不保留乱码。',
].join('\n')

export function parseNumbered(text, n) {
  const out = new Array(n).fill('')
  const re = /【(\d+)】([\s\S]*?)(?=【\d+】|$)/g
  let m
  let found = 0
  while ((m = re.exec(text))) {
    const i = Number(m[1]) - 1
    if (i >= 0 && i < n) { out[i] = m[2].trim().replace(/\n{2,}/g, '\n'); found++ }
  }
  return { out, found }
}

export class ReferenceService {
  /**
   * o: { libs(): 库列表（含我的库）, mineDir(): 我的库目录, dataDir, model(): { baseURL, apiKey, model, scope }, chat(opts), commit(paths, msg), submit(libId, rel, title) }
   */
  constructor(o) { this.o = o; this.jobs = new Map() }

  locate(id) {
    const m = /^([^:]+):([^/]+)\/(.+\.md)$/.exec(String(id || ''))
    if (!m) throw new Error(`资料的 id 不对：${id}`)
    const d = listDocs(this.o.libs()).find((x) => x.lib === m[1] && x.id === m[2])
    if (!d) throw new Error(`没有这份资料：${m[1]}:${m[2]}`)
    const s = (d.sections || []).find((x) => x.file === m[3])
    if (!s) throw new Error(`没有这一节：${m[3]}`)
    const zhFile = s.file.replace(/\.md$/, '.zh.md')
    const mine = this.o.mineDir()
    return {
      id, d, s,
      shared: join(d.dir, s.file), sharedZh: join(d.dir, zhFile),
      rel: `reference/${d.id}/${s.file}`, relZh: `reference/${d.id}/${zhFile}`,
      mine: join(mine, 'reference', d.id, s.file), mineZh: join(mine, 'reference', d.id, zhFile),
    }
  }

  original(L) {
    const own = existsSync(L.mine)
    const { meta, body } = parseEntry(readFileSync(own ? L.mine : L.shared, 'utf8'))
    return { meta, body: body.replace(/^# .*\n+/, ''), edited: own } // 标题行由界面显示
  }

  translation(L, sourceHash) {
    for (const [f, from] of [[L.mineZh, 'mine'], [L.sharedZh, 'shared']]) {
      if (!existsSync(f)) continue
      const { meta, body } = parseEntry(readFileSync(f, 'utf8'))
      return { from, title: meta.title || '', model: meta.model || '', at: meta.translatedAt || '', edited: meta.edited === 'true' || meta.edited === true, stale: !!meta.source && meta.source !== sourceHash, paragraphs: body.split(/\n{2,}/).map((p) => (p.trim() === '（空）' ? '' : p.trim())) }
    }
    return null
  }

  /** 读一节（整节，不分部分）：原文段落、译文段落、高亮 */
  read(id) {
    const L = this.locate(id)
    const o = this.original(L)
    const paras = paragraphs(o.body)
    const i = L.d.sections.indexOf(L.s)
    const sib = (j) => (L.d.sections[j] ? { id: `${L.d.lib}:${L.d.id}/${L.d.sections[j].file}`, no: L.d.sections[j].no, title: L.d.sections[j].title } : null)
    return {
      id,
      meta: { doc: L.d.id, docTitle: L.d.title, docTitleZh: L.d.titleZh || '', lib: L.d.lib, libName: L.d.libName, no: L.s.no, title: L.s.title, chapter: L.s.chapter || '', pages: L.s.pages, license: L.d.license },
      cite: `${L.d.title} §${L.s.no.replace(/^App\./, 'Appendix ')} ${L.s.title}，第 ${L.s.pages} 页`,
      paragraphs: paras, edited: o.edited,
      translation: this.translation(L, hash(paras.join('\n\n'))),
      translating: this.jobs.get(id) || null,
      highlights: this.highlights(L),
      prev: sib(i - 1), next: sib(i + 1),
    }
  }

  canTranslate(L) {
    const m = this.o.model()
    if (L.d.license !== 'public' && m.scope === 'public') throw new Error('这份资料有版权，用公网接口时不能翻译（原文会发到云端）；换成部门模型后再翻译')
    return m
  }

  /** 翻译整节（后台进行，进度经 onProgress 报给界面）。返回 read() 的结果 */
  async translate(id, { onProgress = () => {} } = {}) {
    if (this.jobs.has(id)) throw new Error('这一节正在翻译')
    const L = this.locate(id)
    const m = this.canTranslate(L)
    const o = this.original(L)
    const paras = paragraphs(o.body)
    const glossary = loadGlossary(this.o.libs())
    const groups = chunk(paras)
    const job = { done: 0, total: groups.length, at: Date.now() }
    this.jobs.set(id, job)
    onProgress(id, job)
    const out = new Array(paras.length).fill('')
    try {
      let next = 0
      const worker = async () => {
        while (next < groups.length) {
          const g = groups[next++]
          const text = g.map((i, k) => `【${k + 1}】${paras[i]}`).join('\n\n')
          const terms = termsFor(text, glossary)
          const user = `${terms.length ? `术语对照：${terms.map(([en, zh]) => `${en} = ${zh}`).join('；')}\n\n` : ''}原文（${g.length} 段）：\n\n${text}`
          const r = await this.o.chat({ ...m, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] })
          const { out: tr, found } = parseNumbered(r.content, g.length)
          if (found === 0) g.forEach((i, k) => { out[i] = k === 0 ? r.content.trim().replace(/\n{2,}/g, '\n') : '' }) // 没按编号回：整组放在第一段
          else g.forEach((i, k) => { out[i] = tr[k] })
          job.done++
          onProgress(id, job)
        }
      }
      await Promise.all([worker(), worker()])
      const titleR = await this.o.chat({ ...m, maxTokens: 200, messages: [{ role: 'system', content: '把航天工程资料的节标题译成简体中文，只输出译文。' }, { role: 'user', content: L.s.title }] }).catch(() => ({ content: '' }))
      this.writeZh(L, out, { title: titleR.content.trim().split('\n')[0].slice(0, 80), model: m.model, source: hash(paras.join('\n\n')), edited: false })
      await this.o.commit([L.relZh], `资料译文：${L.d.id} §${L.s.no}`).catch(() => {})
    } finally {
      this.jobs.delete(id)
      onProgress(id, null)
    }
    return this.read(id)
  }

  writeZh(L, paras, { title, model, source, edited }) {
    mkdirSync(dirname(L.mineZh), { recursive: true })
    const meta = { doc: L.d.id, section: L.s.no, title, lang: 'zh', source, model, translatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), edited: edited ? 'true' : '' }
    writeFileSync(L.mineZh, `${front(meta)}${paras.map((p) => p.trim().replace(/\n{2,}/g, '\n') || '（空）').join('\n\n')}\n`)
  }

  /** 改译文：给出全部段落（和原文逐段对应） */
  async saveTranslation(id, paras) {
    const L = this.locate(id)
    const cur = this.read(id)
    if (!Array.isArray(paras)) throw new Error('译文格式不对')
    this.writeZh(L, paras.map(String), { title: (cur.translation && cur.translation.title) || '', model: (cur.translation && cur.translation.model) || '', source: hash(cur.paragraphs.join('\n\n')), edited: true })
    await this.o.commit([L.relZh], `资料译文：改 ${L.d.id} §${L.s.no}`).catch(() => {})
    return this.read(id)
  }

  /** 改原文（比如修正提取出错的公式、断词）：存在我的库，叠在资料库的版本上 */
  async saveOriginal(id, text) {
    const L = this.locate(id)
    const { meta } = parseEntry(readFileSync(L.shared, 'utf8'))
    mkdirSync(dirname(L.mine), { recursive: true })
    writeFileSync(L.mine, `${front({ ...meta, edited: 'true' })}# ${L.s.no} ${L.s.title}\n\n${String(text).replace(/\r\n/g, '\n').trim()}\n`)
    await this.o.commit([L.rel], `资料：改 ${L.d.id} §${L.s.no}`).catch(() => {})
    return this.read(id)
  }

  /** 还原：删掉我改的原文（或我的译文），回到资料库的版本 */
  async revert(id, what = 'original') {
    const L = this.locate(id)
    const f = what === 'translation' ? L.mineZh : L.mine
    if (existsSync(f)) rmSync(f, { force: true })
    await this.o.commit([what === 'translation' ? L.relZh : L.rel], `资料：还原 ${L.d.id} §${L.s.no}`).catch(() => {})
    return this.read(id)
  }

  /** 提交到资料库审核：我改的原文或我的译文 */
  async submit(id, what = 'translation') {
    const L = this.locate(id)
    const rel = what === 'original' ? L.rel : L.relZh
    if (!existsSync(join(this.o.mineDir(), rel))) throw new Error(what === 'original' ? '没有改过原文' : '还没有译文')
    return this.o.submit(L.d.lib, rel, `资料${what === 'original' ? '更正' : '译文'}：${L.d.titleZh || L.d.title} §${L.s.no}`)
  }

  // ---------- 高亮和批注 ----------
  notesFile(L) { return join(this.o.dataDir, 'reference-notes', `${L.d.lib}__${L.d.id}.json`) }
  loadNotes(L) { try { return JSON.parse(readFileSync(this.notesFile(L), 'utf8')) } catch { return { sections: {} } } }
  highlights(L) { return (this.loadNotes(L).sections[L.s.file] || []) }
  saveNotes(L, notes) {
    mkdirSync(dirname(this.notesFile(L)), { recursive: true })
    writeFileSync(this.notesFile(L), JSON.stringify(notes, null, 1))
    this.writeExcerpts(L.d, notes)
  }

  /** h: { quote, prefix, suffix, lang: en|zh, color, note } */
  addHighlight(id, h) {
    const L = this.locate(id)
    const quote = String(h && h.quote || '').trim()
    if (quote.length < 2) throw new Error('先选中一段文字')
    const notes = this.loadNotes(L)
    const list = notes.sections[L.s.file] || (notes.sections[L.s.file] = [])
    const item = { id: `h${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, quote: quote.slice(0, 2000), prefix: String(h.prefix || '').slice(-40), suffix: String(h.suffix || '').slice(0, 40), lang: h.lang === 'zh' ? 'zh' : 'en', color: COLORS.includes(h.color) ? h.color : 'yellow', note: String(h.note || '').slice(0, 4000), at: Date.now() }
    list.push(item)
    this.saveNotes(L, notes)
    return item
  }

  updateHighlight(id, hid, patch) {
    const L = this.locate(id)
    const notes = this.loadNotes(L)
    const h = (notes.sections[L.s.file] || []).find((x) => x.id === hid)
    if (!h) throw new Error('这条高亮已经不在了')
    if (patch.color !== undefined && COLORS.includes(patch.color)) h.color = patch.color
    if (patch.note !== undefined) h.note = String(patch.note).slice(0, 4000)
    this.saveNotes(L, notes)
    return h
  }

  removeHighlight(id, hid) {
    const L = this.locate(id)
    const notes = this.loadNotes(L)
    notes.sections[L.s.file] = (notes.sections[L.s.file] || []).filter((x) => x.id !== hid)
    this.saveNotes(L, notes)
    return true
  }

  /** 每节的高亮数（目录里显示） */
  counts(lib, docId) {
    try { const n = JSON.parse(readFileSync(join(this.o.dataDir, 'reference-notes', `${lib}__${docId}.json`), 'utf8')); return Object.fromEntries(Object.entries(n.sections).map(([k, v]) => [k, v.length]).filter(([, v]) => v)) } catch { return {} }
  }

  /** 我的库/摘录/<资料>.md：按节列出高亮和批注，带出处（Obsidian 里看、以后整理成知识条目用） */
  writeExcerpts(d, notes) {
    const name = `${(d.titleZh || d.title).replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim()}.md`
    const f = join(this.o.mineDir(), EXCERPTS, name)
    const secs = (d.sections || []).filter((s) => (notes.sections[s.file] || []).length)
    if (!secs.length) { if (existsSync(f)) rmSync(f, { force: true }); return }
    const L = [front({ title: `摘录：${d.titleZh || d.title}`, doc: d.id, updated: new Date().toISOString().slice(0, 10) }), `# ${d.titleZh || d.title}`, '', `${d.title}${d.year ? `（${d.year}）` : ''}　工作台“知识库 → 资料”里的高亮和批注，自动生成，改这里不会同步回去。`, '']
    for (const s of secs) {
      L.push(`## §${s.no.replace(/^App\./, '附录 ')} ${s.title}（第 ${s.pages} 页）`, '')
      for (const h of notes.sections[s.file]) {
        L.push(...h.quote.split('\n').map((x) => `> ${x}`))
        if (h.note) L.push('', `批注：${h.note}`)
        L.push('')
      }
    }
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, L.join('\n'))
  }
}
