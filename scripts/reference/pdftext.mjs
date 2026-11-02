// PDF → 按页的文字行（给资料导入用）。用 mcp/docreader 带的 pdfjs-dist（纯 JS，Windows 上不用装别的）。
// 处理：按 y 归行；双栏页先左栏后右栏（跨栏的标题放在前面）；行距大于正常行距 1.4 倍算分段；
// 记下每行的字号，用来认标题。页眉页脚（多页重复出现的行、单独的页码）由导入脚本去掉。

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// 只取文字、不画图：Linux 上装的是 Windows 的依赖时没有 @napi-rs/canvas，pdfjs 缺 DOMMatrix 会加载失败，补个最小的
function polyfill() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor(m) { [this.a, this.b, this.c, this.d, this.e, this.f] = Array.isArray(m) ? m : [1, 0, 0, 1, 0, 0] }
      multiplySelf() { return this } preMultiplySelf() { return this } translateSelf() { return this } scaleSelf() { return this } invertSelf() { return this }
      translate() { return this } scale() { return this } multiply() { return this } inverse() { return this }
    }
  }
  if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = class Path2D { addPath() {} }
  if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = class ImageData {}
}

export async function openPdf(file) {
  polyfill()
  const require = createRequire(join(HERE, '..', '..', 'mcp', 'docreader', 'package.json'))
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  const lib = await import(pathToFileURL(join(root, 'legacy', 'build', 'pdf.mjs')).href)
  const task = lib.getDocument({
    data: new Uint8Array(readFileSync(file)), cMapUrl: join(root, 'cmaps') + '/', cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + '/', useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  })
  const doc = await task.promise
  return { doc, pages: doc.numPages, close: () => task.destroy() }
}

/** PDF 书签：[{ level, title, page }]（page 从 1 起） */
export async function outline(doc) {
  const out = []
  const walk = async (items, level) => {
    for (const it of items || []) {
      let page = null
      try {
        const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest
        if (dest && dest[0]) page = (await doc.getPageIndex(dest[0])) + 1
      } catch { /* 没有目标页 */ }
      out.push({ level, title: String(it.title || '').trim(), page })
      await walk(it.items, level + 1)
    }
  }
  await walk(await doc.getOutline(), 0)
  return out
}

/** 一页的行：[{ text, size, y, gapBefore }]，按阅读顺序 */
export async function pageLines(doc, n) {
  const page = await doc.getPage(n)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  page.cleanup()
  const W = vp.width
  const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({
    s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.round(Math.hypot(it.transform[2], it.transform[3]) * 10) / 10,
  }))
  if (!items.length) return []
  // 双栏：左半边和右半边各有不少文字、很少有跨过中线的长行
  const mid = W / 2
  const left = items.filter((i) => i.x + i.w <= mid + 6)
  const right = items.filter((i) => i.x >= mid - 6)
  const span = items.filter((i) => i.x < mid - 6 && i.x + i.w > mid + 6)
  const chars = (a) => a.reduce((n, i) => n + i.s.length, 0)
  const twoCol = chars(left) > 200 && chars(right) > 200 && chars(span) < 0.15 * chars(items)
  const groups = twoCol
    ? (() => {
      // 跨栏的（标题、整页宽的图题）按位置插回：在两栏都开始之前的放最前面，其余跟着所在高度最近的栏
      const top = Math.max(...left.map((i) => i.y), ...right.map((i) => i.y))
      return [span.filter((i) => i.y >= top - 2), left, right, span.filter((i) => i.y < top - 2)]
    })()
    : [items]
  const lines = []
  for (const g of groups) {
    const ls = []
    for (const it of g) {
      let l = ls.find((x) => Math.abs(x.y - it.y) < Math.max(2, it.size * 0.35))
      if (!l) { l = { y: it.y, items: [] }; ls.push(l) }
      l.items.push(it)
    }
    ls.sort((a, b) => b.y - a.y)
    let prevY = null, prevSize = null
    for (const l of ls) {
      l.items.sort((a, b) => a.x - b.x)
      let s = '', end = null
      for (const it of l.items) {
        if (end !== null && it.x - end > it.size * 0.25 && !s.endsWith(' ') && !it.s.startsWith(' ')) s += ' '
        s += it.s
        end = it.x + it.w
      }
      const size = Math.max(...l.items.map((i) => i.size))
      const gap = prevY === null ? 0 : (prevY - l.y) / Math.max(prevSize || size, 1)
      lines.push({ text: s.replace(/\s+/g, ' ').trim(), size, y: l.y, x: l.items[0].x, gapBefore: gap })
      prevY = l.y; prevSize = size
    }
  }
  return lines.filter((l) => l.text)
}
