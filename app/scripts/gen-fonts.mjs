// 生成 src/styles/fonts.css：思源黑体 400/500/700、JetBrains Mono 400/500，只用 woff2（Chromium 都支持），
// 按 unicode-range 分片，界面只下载用到的分片——这里是离线随包，打进 dist 约 11 MB。
// 用法：node scripts/gen-fonts.mjs（npm install 之后；生成的文件提交到仓库）

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const sets = [['noto-sans-sc', [400, 500, 700]], ['jetbrains-mono', [400, 500]]]
const out = ['/* 由 scripts/gen-fonts.mjs 生成，不要手改 */']
for (const [pkg, weights] of sets) {
  for (const w of weights) {
    const css = readFileSync(join(APP, 'node_modules', '@fontsource', pkg, `${w}.css`), 'utf8')
    out.push(css
      .replace(/,\s*url\([^)]*\.woff\) format\('woff'\)/g, '')
      .replace(/url\(\.\/files\//g, `url(../../node_modules/@fontsource/${pkg}/files/`))
  }
}
writeFileSync(join(APP, 'src', 'styles', 'fonts.css'), out.join('\n'))
console.log('fonts.css written')
