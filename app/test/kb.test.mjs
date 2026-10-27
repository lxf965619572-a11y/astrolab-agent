// 知识库检索与条目读写（mcp/knowledge/lib/kb.mjs）、编码自查脚本。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, parseEntry, readEntry, search, serializeEntry, tokens, writeEntry } from '../../mcp/knowledge/lib/kb.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('切词：中文两字一组，标识符按下划线再拆', () => {
  assert.deepEqual(tokens('复位超时'), ['复位', '位超', '超时'])
  assert.deepEqual(tokens('rt_reset OK'), ['rt_reset', 'rt', 'reset', 'ok'])
})

test('条目读写往返、检索排序、过滤、草稿状态', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-'))
  const a = writeEntry(dir, { title: '1553B RT 复位等待用大于或等于判就绪', kind: '经验', tags: ['1553B', '复位'], status: '草稿' }, '设计规定 elapsed >= 10 tick 超时。\n\n```c\nif (e >= T) {}\n```')
  writeEntry(dir, { title: '串口中断只放进环形缓冲区', kind: '设计', tags: ['UART'] }, '解析放在主循环。')
  writeEntry(dir, { title: '型号A 子地址分配', kind: '设计', model: '型号A' }, '子地址 1～3 收遥控。复位后重新配置。')
  const e = parseEntry(readFileSync(join(dir, a), 'utf8'))
  assert.equal(e.meta.title, '1553B RT 复位等待用大于或等于判就绪')
  assert.deepEqual(e.meta.tags, ['1553B', '复位'])
  assert.equal(e.meta.status, '草稿')
  assert.equal(parseEntry(serializeEntry(e.meta, e.body)).body.trim(), e.body.trim())
  const libs = [{ id: 'me', name: '我的库', dir, writable: true }]
  const idx = buildIndex(libs)
  const hits = search(idx, '复位')
  assert.equal(hits[0].title, '1553B RT 复位等待用大于或等于判就绪', '标题命中排在正文命中前面')
  assert.equal(hits[0].status, '草稿')
  assert.equal(search(idx, '复位', { kind: '设计' }).length, 1)
  assert.equal(search(idx, '子地址', { model: '型号B' }).length, 0)
  assert.equal(search(idx, '').length, 3)
  assert.match(readEntry(libs, hits[0].id).body, /elapsed/)
  assert.throws(() => readEntry(libs, 'me:../x.md'), /没有这个条目/)
})

test('编码自查脚本：找出缺函数头、无超时的等待循环、动态内存', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'))
  writeFileSync(join(dir, 'a.c'), '/*\n * 文件名：a.c\n * 功能：  测试\n */\n#include <stdlib.h>\n/*\n * 功能：等就绪\n * 设计：4.1\n */\nint w(volatile int *r)\n{\n    while (*r == 0) { }\n    return 0;\n}\nint f(void)\n{\n    char *p = malloc(4u);\n    free(p);\n    return 0;\n}\n')
  let out = ''
  try { execFileSync(process.execPath, [join(ROOT, 'skills', 'coding', 'scripts', 'check-code.mjs'), join(dir, 'a.c')], { encoding: 'utf8' }) } catch (e) { out = e.stdout }
  assert.match(out, /R3\.3 等待循环/)
  assert.match(out, /R4\.3 动态内存/)
  assert.match(out, /函数 f 前没有函数头注释/)
  assert.match(out, /设计追溯 1\/2/)
})
