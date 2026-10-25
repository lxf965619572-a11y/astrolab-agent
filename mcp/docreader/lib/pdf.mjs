// .pdf → 文本（按页输出）。依赖可选包 pdfjs-dist；未安装时给出提示。
// PDF 没有表格结构，表格会变成按行排列的文字；扫描件没有文字层，需要先 OCR。

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function loadPdfjs() {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require.resolve('pdfjs-dist/package.json')
    const lib = await import(pathToFileURL(join(dirname(pkg), 'legacy', 'build', 'pdf.mjs')).href)
    return { lib, root: dirname(pkg) }
  } catch {
    throw new Error('未安装 PDF 解析组件 pdfjs-dist。请在 mcp\\docreader 目录运行 npm install；或把 PDF 另存为 Word 后再读取')
  }
}

export async function pdfToMarkdown(buf, { pages } = {}) {
  const { lib, root } = await loadPdfjs()
  const task = lib.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: join(root, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0,
  })
  const doc = await task.promise
  const total = doc.numPages
  const [from, to] = pages ? pages : [1, total]
  const out = []
  let chars = 0
  for (let n = Math.max(1, from); n <= Math.min(total, to); n++) {
    const page = await doc.getPage(n)
    const tc = await page.getTextContent()
    // 按 y 坐标归行（容差 2pt），行内按 x 排序
    const lines = []
    for (const it of tc.items) {
      if (!it.str) continue
      const x = it.transform[4]
      const y = it.transform[5]
      let line = lines.find((l) => Math.abs(l.y - y) < 2)
      if (!line) { line = { y, items: [] }; lines.push(line) }
      line.items.push({ x, w: it.width, s: it.str })
    }
    lines.sort((a, b) => b.y - a.y)
    const text = lines.map((l) => {
      l.items.sort((a, b) => a.x - b.x)
      let s = ''
      let end = null
      for (const it of l.items) {
        if (end !== null && it.x - end > 6) s += '  '
        s += it.s
        end = it.x + it.w
      }
      return s.trimEnd()
    }).join('\n')
    chars += text.replace(/\s/g, '').length
    out.push(`## 第 ${n} 页\n\n${text}`)
    page.cleanup()
  }
  await task.destroy()
  const warnings = ['PDF 中的表格已变成按行排列的文字，列对应关系可能不准确；有 Word 原件时优先读 Word']
  const pagesRead = out.length
  if (pagesRead && chars / pagesRead < 30) warnings.push('提取到的文字很少，可能是扫描件，需要先做文字识别（OCR）')
  return {
    markdown: out.join('\n\n') + '\n',
    outline: out.map((_, i) => ({ level: 2, text: `第 ${from + i} 页` })),
    stats: { pages: total, pagesRead },
    warnings,
  }
}
