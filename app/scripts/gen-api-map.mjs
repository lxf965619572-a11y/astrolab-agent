// 从 main/preload.cjs 生成网页入口用的接口表 main/api-map.json（preload 加了接口后运行一次；test/web.test.mjs 会检查是否同步）。
// 不直接在运行时读 preload.cjs：麒麟安装包加 --protect 时它会编成字节码，读不到原文。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePreloadMap } from '../main/web.mjs'

const MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'main')
const map = parsePreloadMap(readFileSync(join(MAIN, 'preload.cjs'), 'utf8'))
writeFileSync(join(MAIN, 'api-map.json'), JSON.stringify(map, null, 1) + '\n')
console.log(`main/api-map.json：${Object.keys(map).length} 个接口`)
