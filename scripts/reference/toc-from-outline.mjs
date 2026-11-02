#!/usr/bin/env node
// 从 PDF 书签生成导入说明里的目录（toc）：node scripts/reference/toc-from-outline.mjs <PDF> [最深层级，默认 2]
// 只要标题像“4.2 Technical Requirements Definition”“Appendix C: …”的书签；章号取节号的第一段。生成后手工挑 include。
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openPdf, outline } from './pdftext.mjs'

export async function tocFromOutline(file, depth = 2) {
  const { doc, close } = await openPdf(file)
  const ol = await outline(doc)
  await close()
  const toc = []
  let chapter = ''
  for (const o of ol) {
    if (o.level >= depth || !o.page) continue
    const t = o.title.replace(/[\x00-\x1f\x7f\u00ad\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim() // 书签里夹的控制字符（BEL 等）
    const m = /^(\d+(?:\.\d+)*)\s+(.+)$/.exec(t) || /^(Appendix\s+[A-Z])\s*[:.]?\s*(.+)$/i.exec(t)
    if (!m) continue
    let no = m[1].replace(/^Appendix\s+/i, 'App.')
    no = no.replace(/^(\d+)\.0$/, '$1')
    if (/^\d+$/.test(no) || /^App\./.test(no)) chapter = `${no.replace('App.', 'Appendix ')} ${m[2]}`
    toc.push({ no, title: m[2].trim(), page: o.page, chapter })
  }
  return toc
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, depth] = process.argv.slice(2)
  tocFromOutline(resolve(file), Number(depth) || 2).then((t) => console.log(JSON.stringify(t, null, 1)))
}
