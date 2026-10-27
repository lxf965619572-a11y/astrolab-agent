#!/usr/bin/env node
// 编码自查脚本：按部门 C 编码规则（references/coding-rules.md）中“脚本”能查的几项检查 C 源文件。
// 只读，不修改任何文件。列出的是疑似问题：“必须处理”项要改正，“复核”项逐条判断，保留的在编码说明中写理由。
// 这是轻量的文本检查（去掉注释和字符串后按行、按函数分析），不替代编译告警、Cppcheck 和人工走查。
//
// 用法：node check-code.mjs <文件或目录>...   （目录下找 .c 和 .h，不进 test/、.utest/）
// 退出码：0 = 没有“必须处理”项；1 = 有“必须处理”项；2 = 用法或文件错误

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const inputs = process.argv.slice(2)
if (!inputs.length) { console.error('用法：node check-code.mjs <文件或目录>...'); process.exit(2) }
const files = []
const walk = (p) => {
  const st = statSync(p)
  if (st.isDirectory()) { for (const e of readdirSync(p)) if (!['test', 'tests', '.utest', '.git', 'node_modules'].includes(e)) walk(join(p, e)) }
  else if (/\.(c|h)$/i.test(p)) files.push(p)
}
for (const p of inputs) { if (!existsSync(p)) { console.error(`找不到：${p}`); process.exit(2) } walk(p) }

const findings = []
const add = (level, rule, file, line, msg) => findings.push({ level, rule, file, line, msg })

/** 去掉注释、字符串和字符常量（保留换行和长度），返回 { code, comments: [{start,end,text}] } */
function strip(src) {
  let out = ''
  const comments = []
  let i = 0
  while (i < src.length) {
    const c = src[i], n = src[i + 1]
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2)
      const j = end < 0 ? src.length : end + 2
      comments.push({ start: i, end: j, text: src.slice(i, j) })
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
    } else if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i)
      const j = end < 0 ? src.length : end
      comments.push({ start: i, end: j, text: src.slice(i, j) })
      out += ' '.repeat(j - i)
      i = j
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + (src[j] === c ? c : '')
      i = j + (src[j] === c ? 1 : 0)
    } else { out += c; i++ }
  }
  return { code: out, comments }
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'else', 'do'])

/** 找出函数定义：名字、开始位置（签名起点）、函数体范围 */
function functions(code) {
  const out = []
  const re = /([A-Za-z_][\w\s\*]*?)\b([A-Za-z_]\w*)\s*\(([^;{}()]*(?:\([^()]*\)[^;{}()]*)*)\)\s*\{/g
  let m
  while ((m = re.exec(code))) {
    const name = m[2]
    if (KEYWORDS.has(name)) continue
    // 必须在文件层（前面的大括号已经配平）
    let depth = 0
    for (let k = 0; k < m.index; k++) { if (code[k] === '{') depth++; else if (code[k] === '}') depth-- }
    if (depth !== 0) continue
    const open = m.index + m[0].length - 1
    let d = 0, k = open
    for (; k < code.length; k++) { if (code[k] === '{') d++; else if (code[k] === '}') { d--; if (d === 0) break } }
    const sigStart = m.index + (m[0].length - m[0].trimStart().length)
    out.push({ name, start: sigStart, open, close: k, body: code.slice(open, k + 1), isStatic: /\bstatic\b/.test(m[1]) })
    re.lastIndex = k + 1
  }
  return out
}

let fnCount = 0
let traced = 0
for (const f of files) {
  const rel = relative(process.cwd(), f) || f
  const src = readFileSync(f, 'utf8').replace(/^﻿/, '')
  const { code, comments } = strip(src)
  const lines = code.split('\n')

  // R6.1 文件头
  const first = comments[0]
  if (!first || src.slice(0, first.start).trim() !== '' || !/文件名|功能/.test(first.text)) add('必须处理', 'R6.1 文件头', rel, 1, '文件开头没有文件头注释（文件名、功能、平台、设计、修改记录）')

  if (/\.c$/i.test(f)) {
    for (const fn of functions(code)) {
      fnCount++
      const line = lineOf(code, fn.start)
      // 函数头：签名前最后一个注释，中间只有空白
      const before = comments.filter((c) => c.end <= fn.start).at(-1)
      const gap = before ? code.slice(before.end, fn.start) : null
      const head = before && /^\s*$/.test(gap) ? before.text : null
      if (!head) add('必须处理', 'R6.1 函数头', rel, line, `函数 ${fn.name} 前没有函数头注释`)
      else {
        if (!/功能/.test(head)) add('必须处理', 'R6.1 函数头', rel, line, `函数 ${fn.name} 的函数头缺“功能”`)
        if (!/设计\s*[：:]/.test(head)) add('必须处理', 'R6.2 设计追溯', rel, line, `函数 ${fn.name} 的函数头缺“设计：<详细设计条目号>”`)
        else traced++
      }
      const body = fn.body
      const bodyLine = (idx) => lineOf(code, fn.open + idx)
      // R3.5 递归（直接）
      const callRe = new RegExp(`\\b${fn.name}\\s*\\(`, 'g')
      if (callRe.test(body)) add('必须处理', 'R3.5 递归', rel, line, `函数 ${fn.name} 调用了自己`)
      // R3.1 switch 缺 default
      for (const sw of body.matchAll(/\bswitch\s*\(/g)) {
        let k = body.indexOf('{', sw.index), d = 0, j = k
        for (; j < body.length; j++) { if (body[j] === '{') d++; else if (body[j] === '}') { d--; if (d === 0) break } }
        if (k >= 0 && !/\bdefault\s*:/.test(body.slice(k, j))) add('必须处理', 'R3.1 switch 缺 default', rel, bodyLine(sw.index), `${fn.name} 中的 switch 没有 default 分支`)
      }
      // R3.3 等待循环没有超时：循环条件里读寄存器/标志，循环体为空或很短，且条件和循环体都不涉及计数或时间
      for (const lp of body.matchAll(/\bwhile\s*\(((?:[^()]|\([^()]*\))*)\)\s*(\{[^{}]*\}|;)/g)) {
        const cond = lp[1], blk = lp[2]
        // 有界：条件里有超时类的名字或取时间的调用，或者循环体（或条件本身）修改了条件里的某个变量
        const ids = [...new Set(cond.match(/[A-Za-z_]\w*/g) || [])]
        const modified = ids.some((v) => new RegExp(`(\\b${v}\\s*(\\+\\+|--|[+\\-*/|&^]?=(?!=)))|((\\+\\+|--)\\s*${v}\\b)`).test(cond + blk))
        const timed = modified || /timeout|tmo|retry|elapsed|deadline|limit|tick\w*\s*\(|time\w*\s*\(/i.test(cond)
        if (!timed && blk.replace(/[{};\s]/g, '').length < 40) add('必须处理', 'R3.3 等待循环', rel, bodyLine(lp.index), `${fn.name} 中的等待循环没有超时退出：while (${cond.trim().slice(0, 60)})`)
      }
      for (const lp of body.matchAll(/\bfor\s*\(\s*;\s*;\s*\)|\bwhile\s*\(\s*(1|1u|true|TRUE)\s*\)/g)) {
        add('复核', 'R3.3 无限循环', rel, bodyLine(lp.index), `${fn.name} 中有无限循环：确认是主循环或任务循环，或有超时退出`)
      }
      // R6.5 函数长度
      const len = lineOf(code, fn.close) - line + 1
      if (len > 100) add('复核', 'R6.5 函数长度', rel, line, `函数 ${fn.name} 有 ${len} 行，确认是否应按设计拆分`)
    }
  }

  lines.forEach((l, i) => {
    const ln = i + 1
    // R4.3 动态内存
    if (/\b(malloc|calloc|realloc|free)\s*\(/.test(l)) add('必须处理', 'R4.3 动态内存', rel, ln, `使用了动态内存：${l.trim().slice(0, 80)}`)
    // R3.4 goto / setjmp
    if (/\bgoto\b|\b(setjmp|longjmp)\s*\(/.test(l)) add('必须处理', 'R3.4 goto', rel, ln, `使用了 goto 或 setjmp/longjmp：${l.trim().slice(0, 80)}`)
    // R1.6 八进制常量
    for (const m of l.matchAll(/(?<![\w.])0[0-7]+\b/g)) if (!/^#\s*(line|include)/.test(l.trim())) add('复核', 'R1.6 八进制', rel, ln, `像八进制常量的 ${m[0]}：确认不是想写十进制`)
    // R2.7 魔数：比较、赋值、数组大小中的多位数字（宏定义、枚举、数组初始化表除外）
    if (!/^\s*#/.test(l) && !/^\s*\{?\s*(0x[0-9a-f]+u?|\d+u?)\s*(,\s*(0x[0-9a-f]+u?|\d+u?)\s*)+\}?\s*,?\s*$/i.test(l) && !/\benum\b/.test(l)) {
      for (const m of l.matchAll(/(?:[=<>!]=?|[+\-*/%&|^]|\[|case|return)\s*(0x[0-9A-Fa-f]{2,}[uUlL]*|[2-9]\d+[uUlL]*|1\d+[uUlL]*)\b/g)) {
        add('复核', 'R2.7 魔数', rel, ln, `数字 ${m[1]} 直接写在代码里：寄存器值、门限、超时、长度用有含义的宏或枚举`)
      }
    }
  })
}

const count = (lv) => findings.filter((x) => x.level === lv).length
console.log('# 编码自查结果\n')
console.log(`文件：${files.length} 个；函数 ${fnCount} 个，有设计追溯 ${traced} 个`)
console.log(`必须处理 ${count('必须处理')} 项，复核 ${count('复核')} 项\n`)
for (const lv of ['必须处理', '复核']) {
  const list = findings.filter((x) => x.level === lv)
  if (!list.length) continue
  console.log(`## ${lv}\n`)
  for (const f of list) console.log(`- ${f.file}:${f.line}［${f.rule}］${f.msg}`)
  console.log('')
}
if (!findings.length) console.log('没有发现需要处理的地方。')
console.log(`统计：文件 ${files.length}，函数 ${fnCount}，设计追溯 ${traced}/${fnCount}，必须处理 ${count('必须处理')}，复核 ${count('复核')}`)
process.exit(count('必须处理') ? 1 : 0)
