// 从 app/build/icon.svg（大尺寸）和 icon-small.svg（24 像素及以下）生成应用图标：icon.png（256）和 Windows 用的 icon.ico（16～256 多尺寸）。
// 需要 Playwright 的 Chromium 和 Python Pillow；只在改图标时跑一次，生成的文件随仓库提交。
// 用法：node app/scripts/make-icon.cjs
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const { readFileSync, mkdirSync } = require('fs')
const { join } = require('path')
const dir = join(__dirname, '..', 'build')
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')
const small = readFileSync(join(dir, 'icon-small.svg'), 'utf8') // 24 像素及以下用简化版
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage()
  const tmp = join(dir, '.png'); mkdirSync(tmp, { recursive: true })
  for (const s of SIZES) {
    await p.setViewportSize({ width: s, height: s })
    await p.setContent(`<html><body style="margin:0;background:transparent">${(s <= 24 ? small : svg).replace('width="256" height="256"', `width="${s}" height="${s}"`)}</body></html>`)
    await p.screenshot({ path: join(tmp, `${s}.png`), omitBackground: true })
  }
  await b.close()
  const py = `
import sys
from PIL import Image
d=sys.argv[1]; sizes=[int(x) for x in sys.argv[2:]]
ims={s:Image.open(f"{d}/.png/{s}.png").convert("RGBA") for s in sizes}
ims[256].save(f"{d}/icon.png")
ims[256].save(f"{d}/icon.ico", format="ICO", sizes=[(s,s) for s in sizes], append_images=[ims[s] for s in sizes if s!=256])
`
  execFileSync('python3', ['-c', py, dir, ...SIZES.map(String)], { stdio: 'inherit' })
  require('fs').rmSync(tmp, { recursive: true, force: true })
  console.log('icon.png / icon.ico 已生成：', dir)
})().catch((e) => { console.error(e); process.exit(1) })
