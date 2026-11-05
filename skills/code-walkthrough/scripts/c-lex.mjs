// C 源文件的轻量词法和结构分析，供 gjb-scan.mjs（GJB 8114 规则扫描）和 metrics.mjs（规模、复杂度统计）共用。
// 不做预处理、不展开宏、不解析类型：结果是“疑似”，由人逐条确认。只读，不修改任何文件。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 收集 .c/.h 文件（目录下不进 test/、.utest/ 等） */
export function collectFiles(inputs) {
  const files = []
  const walk = (p) => {
    const st = statSync(p)
    if (st.isDirectory()) { for (const e of readdirSync(p).sort()) if (!['test', 'tests', '.utest', '.git', 'node_modules', 'build', 'obj'].includes(e)) walk(join(p, e)) }
    else if (/\.(c|h)$/i.test(p)) files.push(p)
  }
  for (const p of inputs) { if (!existsSync(p)) throw new Error(`找不到：${p}`); walk(p) }
  return files
}

const PUNCT = ['...', '<<=', '>>=', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '^=', '|=', '##']

/**
 * 词法分析。返回：
 *  tokens: [{ t: 'id'|'num'|'str'|'chr'|'op', v, line, col }]（不含注释和预处理行）
 *  comments: [{ line, endLine, text }]
 *  pp: [{ line, endLine, text }]（预处理指令，续行已合并）
 *  lines: 源文件按行切分
 */
export function lex(src) {
  src = src.replace(/\r\n?/g, '\n')
  const tokens = [], comments = [], pp = []
  let i = 0, line = 1, col = 0, bol = true
  const n = src.length
  const adv = (k) => { for (let j = 0; j < k; j++) { if (src[i] === '\n') { line++; col = 0 } else col++; i++ } }
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '\n') { adv(1); bol = true; continue }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') { adv(1); continue }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2), j = end < 0 ? n : end + 2
      const l0 = line; const text = src.slice(i, j); adv(j - i)
      comments.push({ line: l0, endLine: line, text }); continue
    }
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i); if (j < 0) j = n
      comments.push({ line, endLine: line, text: src.slice(i, j) }); adv(j - i); continue
    }
    if (c === '#' && bol) {
      // 预处理行：到不带续行符的换行为止；行内注释留在 text 中由使用者处理
      const l0 = line; let j = i
      while (j < n) {
        if (src[j] === '\n' && src[j - 1] !== '\\') break
        if (src[j] === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue }
        j++
      }
      const text = src.slice(i, j); adv(j - i)
      pp.push({ line: l0, endLine: line, text }); continue
    }
    bol = false
    const l0 = line, c0 = col
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      const v = src.slice(i, Math.min(j + 1, n)); adv(v.length)
      tokens.push({ t: c === '"' ? 'str' : 'chr', v, line: l0, col: c0 }); continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1; while (j < n && /\w/.test(src[j])) j++
      const v = src.slice(i, j)
      if ((v === 'L' || v === 'u8' || v === 'u' || v === 'U') && (src[j] === '"' || src[j] === "'")) { adv(j - i); continue }
      adv(j - i); tokens.push({ t: 'id', v, line: l0, col: c0 }); continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d))) {
      let j = i + 1
      while (j < n && (/[\w.]/.test(src[j]) || ((src[j] === '+' || src[j] === '-') && /[eEpP]/.test(src[j - 1]) && !/^0[xX]/.test(src.slice(i, j)) ))) j++
      const v = src.slice(i, j); adv(j - i); tokens.push({ t: 'num', v, line: l0, col: c0 }); continue
    }
    const p = PUNCT.find((s) => src.startsWith(s, i)) || c
    adv(p.length); tokens.push({ t: 'op', v: p, line: l0, col: c0 })
  }
  return { tokens, comments, pp, lines: src.split('\n') }
}

/** 为括号建立配对表：match[i] = 与 tokens[i] 配对的下标 */
export function pairs(tokens) {
  const match = new Array(tokens.length).fill(-1), st = []
  const open = { '(': ')', '[': ']', '{': '}' }
  tokens.forEach((tk, i) => {
    if (tk.t !== 'op') return
    if (open[tk.v]) st.push(i)
    else if (tk.v === ')' || tk.v === ']' || tk.v === '}') {
      // 容错：弹出到同类左括号
      for (let k = st.length - 1; k >= 0; k--) {
        if (open[tokens[st[k]].v] === tk.v) { match[st[k]] = i; match[i] = st[k]; st.length = k; break }
      }
    }
  })
  return match
}

export const C_KEYWORDS = new Set(['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', '_Bool', '__attribute__', '__asm__', 'asm', '__inline__', '__volatile__'])
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'else', 'do', 'case', 'goto'])

/**
 * 找出函数定义：{ name, static, retType, params:[文本], nameIdx, open, close, line, endLine, sigLine, isVoid, oldStyle, ellipsis }
 * 只认文件顶层（花括号深度 0）的 “标识符 ( ... ) {” 。
 */
export function functions(tokens, match) {
  const out = []
  let depth = 0, stmtStart = 0, blockStart = 0
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    if (tk.t === 'op' && tk.v === '{') {
      if (depth === 0) {
        // 往回找 “) {”；K&R 形式 “f(a) int a; {” 的 “)” 在上一个顶层 “;” 之前，最远找到上一个顶层 “}”
        let k = i - 1
        if (tokens[k]?.v === ';') { let q = k; while (q > blockStart && !(tokens[q].v === ')' && tokens[match[q] - 1]?.t === 'id')) q--; if (q > blockStart && tokens.slice(q + 1, i).every((t) => t.t === 'id' || [';', '*', ',', '[', ']'].includes(t.v) || t.t === 'num')) { let s0 = q; while (s0 > blockStart && ![';', '}'].includes(tokens[s0 - 1].v)) s0--; stmtStart = s0 } }
        while (k >= stmtStart && !(tokens[k].t === 'op' && tokens[k].v === ')' && match[k] >= 0 && tokens[match[k] - 1]?.t === 'id')) k--
        if (k >= stmtStart && tokens[k].v === ')') {
          const lp = match[k], nameIdx = lp - 1, name = tokens[nameIdx].v
          const prefix = tokens.slice(stmtStart, nameIdx)
          const between = tokens.slice(k + 1, i)
          const isFunc = !CONTROL.has(name) && !prefix.some((t) => t.v === '=') && !(prefix.length && prefix[prefix.length - 1].v === 'struct')
          if (isFunc && (between.length === 0 || between.some((t) => t.v === ';'))) {
            const params = splitTop(tokens, lp + 1, k, match).map((r) => tokens.slice(r[0], r[1]))
            const retToks = prefix.filter((t) => !['static', 'inline', 'extern', '__inline__', 'const', 'volatile'].includes(t.v))
            const close = match[i]
            out.push({
              name, nameIdx, open: i, close, lp, rp: k,
              static: prefix.some((t) => t.v === 'static'),
              retType: prefix.map((t) => t.v).join(' ').replace(/\b(static|inline|extern|__inline__)\b\s*/g, '').trim(),
              isVoid: retToks.length > 0 && retToks.every((t) => t.v === 'void') && !prefix.some((t) => t.v === '*'),
              params: params.map((p) => p.map((t) => t.v).join(' ')), paramToks: params,
              oldStyle: between.length > 0,
              sigLine: tokens[stmtStart < nameIdx ? stmtStart : nameIdx].line,
              line: tokens[nameIdx].line, endLine: close >= 0 ? tokens[close].line : tk.line,
            })
          }
        }
      }
      depth++
    } else if (tk.t === 'op' && tk.v === '}') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) stmtStart = blockStart = i + 1
    } else if (tk.t === 'op' && tk.v === ';' && depth === 0) stmtStart = i + 1
  }
  return out
}

/** 在 [a,b) 范围内按顶层逗号切分，返回 [[起,止),...] */
export function splitTop(tokens, a, b, match, sep = ',') {
  const parts = []; let s = a
  for (let i = a; i < b; i++) {
    const v = tokens[i].v
    if (tokens[i].t === 'op' && (v === '(' || v === '[' || v === '{') && match[i] > i) { i = match[i]; continue }
    if (tokens[i].t === 'op' && v === sep) { parts.push([s, i]); s = i + 1 }
  }
  if (b > s) parts.push([s, b])
  return parts
}

/** 文件顶层的声明（变量、函数原型、typedef），粗略：{ kind:'var'|'proto'|'typedef', name, text, line, static, extern, volatile, unsigned } */
export function topDecls(tokens, match) {
  const out = []
  let depth = 0, s = 0
  for (let i = 0; i < tokens.length; i++) {
    const v = tokens[i].v
    if (tokens[i].t !== 'op') continue
    if (v === '{') {
      // struct/union/enum 定义体或初始化表：跳过，保持语句继续；函数体：语句结束
      const prev = tokens[i - 1]
      if (depth === 0 && prev && prev.v === ')' ) { s = match[i] + 1; i = match[i]; continue }
      if (match[i] > i) { i = match[i]; continue }
    }
    if (v === ';' && depth === 0) {
      const st = tokens.slice(s, i)
      s = i + 1
      if (!st.length) continue
      const words = st.map((t) => t.v)
      if (words[0] === 'typedef') {
        const name = lastIdent(dropBraces(st))
        if (name) out.push({ kind: 'typedef', name, text: words.join(' '), line: st[0].line })
        continue
      }
      // 函数原型：顶层的 “标识符 ( ... ) ;”（“= ”之前；函数指针 “(*名字)” 不算）
      const off = i - st.length
      const lpIdx = st.findIndex((t, k) => t.v === '(' && st[k - 1]?.t === 'id' && !C_KEYWORDS.has(st[k - 1].v) && !words.slice(0, k).includes('='))
      if (lpIdx > 0 && st[lpIdx - 2]?.v !== '(') {
        const absLp = off + lpIdx, absRp = match[absLp]
        if (absRp > 0 && (tokens[absRp + 1]?.v === ';' || tokens[absRp + 1]?.v === '__attribute__')) {
          out.push({ kind: 'proto', name: st[lpIdx - 1].v, text: words.join(' '), line: st[0].line, static: words.includes('static'), extern: words.includes('extern'), lp: absLp, rp: absRp, isVoid: isVoidRet(st.slice(0, lpIdx - 1)) })
          continue
        }
      }
      // 变量：按顶层逗号切声明符
      const parts = splitTop(tokens, off, i, match)
      parts.forEach(([a, b], idx) => {
        const seg = tokens.slice(a, b)
        const eq = seg.findIndex((t) => t.v === '=')
        const decl = eq >= 0 ? seg.slice(0, eq) : seg
        const name = lastIdent(dropBraces(decl))
        if (!name || C_KEYWORDS.has(name)) return
        out.push({ kind: 'var', name, text: words.join(' '), line: seg[0]?.line ?? st[0].line, static: words.includes('static'), extern: words.includes('extern'), volatile: words.includes('volatile'), unsigned: isUnsignedType(words), init: eq >= 0, first: idx === 0 })
      })
    }
  }
  return out
}

/** 去掉成对的 { } 及其内容（struct 定义体） */
export function dropBraces(toks) {
  const out = []; let d = 0
  for (const t of toks) {
    if (t.v === '{') { d++; continue }
    if (t.v === '}') { d--; continue }
    if (d === 0) out.push(t)
  }
  return out
}

function isVoidRet(toks) {
  const w = toks.map((t) => t.v).filter((v) => !['static', 'extern', 'inline', '__inline__'].includes(v))
  return w.length > 0 && w.every((v) => v === 'void')
}

/** 声明符中最后一个不在 [] 和 () 参数里的标识符 */
export function lastIdent(toks) {
  let name = null, depth = 0
  for (let k = 0; k < toks.length; k++) {
    const v = toks[k].v
    if (v === '[' || v === '(') {
      // 函数指针 (*name)(...)：括号里第一个 id 是名字
      if (v === '(' && toks[k + 1]?.v === '*' && toks[k + 2]?.t === 'id' && depth === 0) { name = toks[k + 2].v; k += 2; depth++; continue }
      depth++; continue
    }
    if (v === ']' || v === ')') { depth--; continue }
    if (v === '{' ) break
    if (depth === 0 && toks[k].t === 'id' && !C_KEYWORDS.has(v)) name = v
  }
  return name
}

export const isUnsignedType = (words) => words.includes('unsigned') || words.some((w) => /^(uint\d*_t|uint\d+|u8|u16|u32|u64|UINT\d+|U8|U16|U32|size_t|BYTE|WORD|DWORD|uintptr_t)$/.test(w))

/**
 * 函数体内的局部声明（粗略）：语句以类型开头的视为声明。
 * typeNames：已知的类型名（typedef、*_t）。返回 [{ name, line, unsigned, volatile, depth, idx }]
 */
export function localDecls(tokens, match, fn, typeNames) {
  const out = []
  const isType = (tk) => tk && tk.t === 'id' && (BASE_TYPES.has(tk.v) || typeNames.has(tk.v) || /_t$/.test(tk.v))
  let depth = 0
  let s = fn.open + 1
  for (let i = fn.open + 1; i < fn.close; i++) {
    const v = tokens[i].v
    if (v === '{') { depth++; s = i + 1; continue }
    if (v === '}') { depth--; s = i + 1; continue }
    if (v === '(' && match[i] > i) { i = match[i]; continue }
    if (v === ';') {
      const st = tokens.slice(s, i)
      const startIdx = s
      s = i + 1
      let k = 0
      while (k < st.length && ['static', 'const', 'volatile', 'register', 'auto', 'extern', 'struct', 'union', 'enum', 'signed', 'unsigned'].includes(st[k].v)) k++
      if (st[k - 1] && ['struct', 'union', 'enum'].includes(st[k - 1].v)) k++
      else if (!(isType(st[k]) || (k > 0 && ['signed', 'unsigned'].includes(st[k - 1].v)))) continue
      // 类型之后必须是声明符（* 或 标识符），排除 “a = b;” “f(x);”
      const nx = st[k + 1]
      if (!nx || !(nx.t === 'id' || nx.v === '*' || nx.v === '(' && st[k + 2]?.v === '*')) continue
      const words = st.map((t) => t.v)
      for (const [a, b] of splitTop(tokens, startIdx, i, match)) {
        const seg = tokens.slice(a, b)
        const eq = seg.findIndex((t) => t.v === '=')
        const name = lastIdent(eq >= 0 ? seg.slice(0, eq) : seg)
        if (name && !C_KEYWORDS.has(name) && !BASE_TYPES.has(name)) out.push({ name, line: seg[seg.length - 1].line, unsigned: isUnsignedType(words), volatile: words.includes('volatile'), extern: words.includes('extern'), depth, idx: a, init: eq >= 0, text: words.join(' ') })
      }
    }
  }
  return out
}

export const BASE_TYPES = new Set(['void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', '_Bool', 'bool'])

/** 参数名列表 */
export function paramNames(fn) {
  return fn.paramToks.map((p) => lastIdent(p)).filter((x) => x && x !== 'void')
}

/** 某行的注释文本（含跨行注释覆盖到该行的） */
export function commentsOnLine(comments, line) {
  return comments.filter((c) => c.line <= line && c.endLine >= line).map((c) => c.text).join(' ')
}

/** 读取并分析一个文件 */
export function analyzeFile(path) {
  const src = readFileSync(path, 'utf8').replace(/^﻿/, '')
  const lx = lex(src)
  const match = pairs(lx.tokens)
  const fns = functions(lx.tokens, match)
  const decls = topDecls(lx.tokens, match)
  return { path, src, ...lx, match, fns, decls }
}
