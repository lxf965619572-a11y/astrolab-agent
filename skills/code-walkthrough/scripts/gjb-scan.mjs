#!/usr/bin/env node
// GJB 8114-2013 强制准则扫描（C 语言，R-1-* 中能按词法和结构判断的部分）。
// 只读，不修改任何文件。结果是“疑似违反”，必须逐条打开源码确认：违反 / 误报 / 特殊设计（写理由）。
// 规则表、每条规则用什么方法查（本脚本 / Cppcheck / 编译告警 / 人工），见 ../references/gjb8114-c.md。
//
// 用法：node gjb-scan.mjs <文件或目录>... [--json <输出.json>] [--md <输出.md>]
//   目录下找 .c 和 .h，不进 test/、.utest/。
//   不加 --md 时把 Markdown 结果打印到屏幕。
// 退出码：0 = 完成（不论有无发现）；2 = 用法或文件错误

import { writeFileSync } from 'node:fs'
import { basename, relative } from 'node:path'
import { analyzeFile, collectFiles, commentsOnLine, localDecls, paramNames, splitTop, C_KEYWORDS } from './c-lex.mjs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
const jsonOut = opt('--json'), mdOut = opt('--md')
if (!argv.length) { console.error('用法：node gjb-scan.mjs <文件或目录>... [--json <输出.json>] [--md <输出.md>]'); process.exit(2) }
let files
try { files = collectFiles(argv) } catch (e) { console.error(e.message); process.exit(2) }

const RULES = {
  'R-1-1-7': '以函数形式定义的宏，参数和结果必须用括号括起来',
  'R-1-1-8': '结构、联合、枚举的定义中必须定义标识名',
  'R-1-1-13': '函数声明中必须对参数类型进行声明，并带有变量名',
  'R-1-1-17': '禁止在函数体内使用外部声明',
  'R-1-1-18': '数组定义禁止没有显式的边界限定',
  'R-1-1-19': '禁止使用 extern 声明对变量初始化',
  'R-1-1-21': '禁止在 #include 语句中使用绝对路径',
  'R-1-1-22': '禁止头文件重复包含',
  'R-1-1-23': '函数参数表为空时，必须使用 void 明确说明',
  'R-1-2-1': '循环体必须用大括号括起来',
  'R-1-2-2': 'if、else if、else 必须用大括号括起来',
  'R-1-2-4': '引起二义性理解的逻辑表达式，必须使用括号显式说明优先级顺序',
  'R-1-2-5': '逻辑判别表达式中的运算项必须要使用括号',
  'R-1-2-6': '禁止嵌套注释',
  'R-1-4-1': '在 if-else if 语句中必须使用 else 分支',
  'R-1-4-2': '条件判定分支如果为空，必须以单独一行的分号加 /* no deal with */ 注释进行明确说明',
  'R-1-4-3': '禁止使用空 switch 语句',
  'R-1-4-6': '除枚举类型列举完全外，switch 必须要有 default',
  'R-1-4-7': 'switch 中的 case 和 default 必须以 break 或 return 终止，共用 case 必须加 /* shared */ 注释',
  'R-1-5-1': '禁止从复合语句外 goto 到复合语句内，或由下向上 goto',
  'R-1-5-2': '禁止使用 setjmp、longjmp',
  'R-1-6-3': '禁止在逻辑表达式中使用赋值语句',
  'R-1-6-5': '禁止在运算表达式中或函数调用参数中使用 ++ 或 -- 操作符',
  'R-1-6-10': '禁止对常数值做逻辑非的运算',
  'R-1-6-13': '禁止在 sizeof 中使用赋值',
  'R-1-6-18': '禁止使用 gets 函数，应使用 fgets 函数替代',
  'R-1-7-4': '禁止使用旧形式的函数参数表定义形式',
  'R-1-7-7': '有返回值的函数必须通过返回语句返回',
  'R-1-7-8': '禁止无返回值函数的返回语句带有返回值',
  'R-1-7-9': '有返回值函数的返回语句必须带有返回值',
  'R-1-7-11': '具有返回值的函数，其返回值如果不被使用，调用时应有 (void) 说明',
  'R-1-7-12': '无返回值的函数，调用时禁止再用 (void) 重复说明',
  'R-1-7-13': '静态函数必须被使用',
  'R-1-7-15': '禁止在函数参数表中使用省略号',
  'R-1-7-16': '禁止使用直接或间接自调用函数',
  'R-1-8-4': '使用八进制数必须加 /* octal */ 明确注释',
  'R-1-8-5': '数字类型后缀必须使用大写字母',
  'R-1-9-1': 'for 循环控制变量必须使用局部变量',
  'R-1-9-3': '禁止在 for 循环体内部修改循环控制变量',
  'R-1-12-3': '禁止对浮点数进行 ==、!= 相等比较',
  'R-1-12-4': '禁止对无符号数进行大于等于零或小于零的比较',
  'R-1-13-1': '禁止局部变量与全局变量同名',
  'R-1-13-2': '禁止函数形参与全局变量同名',
  'R-1-13-3': '禁止变量名与函数名同名',
  'R-1-13-7': '禁止在内部块中重定义已有的变量名',
  'R-1-13-11': '禁止单独使用小写字母 l 或大写字母 O 作为变量名',
  'R-1-13-13': '禁止在表达式中出现多个同一 volatile 类型变量的运算',
}

const findings = []
const add = (rule, file, line, sure, msg, func = '') => findings.push({ rule, file, line, certainty: sure ? '确定' : '疑似', func, msg })

const all = files.map((f) => ({ ...analyzeFile(f), rel: relative(process.cwd(), f).replace(/\\/g, '/') }))

// 全局信息：函数定义、原型、全局变量、类型名、volatile 变量
const fnDefs = new Map(), protos = new Map(), globals = new Map(), typeNames = new Set()
for (const a of all) {
  for (const fn of a.fns) if (!fnDefs.has(fn.name) || !fn.static) fnDefs.set(fn.name, { ...fn, file: a.rel })
  for (const d of a.decls) {
    if (d.kind === 'typedef') typeNames.add(d.name)
    else if (d.kind === 'proto') { if (!protos.has(d.name)) protos.set(d.name, { ...d, file: a.rel }) }
    else if (d.kind === 'var') { const g = globals.get(d.name); if (!g || !d.extern) globals.set(d.name, { ...d, file: a.rel }) }
  }
}
const returnsValue = (name) => { const d = fnDefs.get(name) || protos.get(name); return d ? !d.isVoid : null }
// 常用标准库函数：有返回值（GJB 8114 要求不用时加 (void)）
const STD_VALUE = new Set(['memcpy', 'memset', 'memmove', 'strcpy', 'strncpy', 'strcat', 'strncat', 'printf', 'sprintf', 'snprintf', 'fprintf', 'puts', 'fputs', 'fclose', 'fflush', 'fwrite', 'fread', 'remove', 'close', 'write', 'read', 'send', 'sendto', 'recv', 'pthread_mutex_lock', 'pthread_mutex_unlock', 'pthread_create', 'pthread_join', 'sem_post', 'sem_wait', 'usleep', 'nanosleep'])

const callGraph = new Map() // 函数名 → Set(被调函数名)

for (const a of all) {
  const { tokens: T, match: M, comments, pp, rel } = a
  const isH = /\.h$/i.test(rel)
  const line = (i) => T[i]?.line ?? 0
  const cmt = (ln) => commentsOnLine(comments, ln)

  // ---------- 预处理 ----------
  const includes = new Map()
  for (const p of pp) {
    const text = p.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\\\n/g, ' ')
    let m
    if ((m = /^#\s*include\s*([<"])([^>"]+)[>"]/.exec(text))) {
      const path = m[2]
      if (/^([A-Za-z]:[\\/]|\/|\\\\)/.test(path)) add('R-1-1-21', rel, p.line, true, `#include 使用了绝对路径：${path}`)
      const key = basename(path)
      if (includes.has(key)) add('R-1-1-22', rel, p.line, true, `${key} 在本文件中重复包含（第一次在第 ${includes.get(key)} 行）`)
      else includes.set(key, p.line)
    }
    if ((m = /^#\s*define\s+(\w+)\(([^)]*)\)\s*(.*)$/s.exec(text))) {
      const params = m[2].split(',').map((s) => s.trim()).filter((s) => s && s !== '...')
      const body = m[3].trim()
      if (!body) continue
      const bad = []
      for (const prm of params) {
        const re = new RegExp(`(^|[^\\w#])(${prm})(?!\\w)`, 'g')
        let mm
        while ((mm = re.exec(body))) {
          const at = mm.index + mm[1].length
          const before = body.slice(0, at).trimEnd().slice(-1), after = body.slice(at + prm.length).trimStart()[0]
          if (before === '#' ) continue
          if (!(before === '(' && after === ')') && !(before === '(' && after === ',') && !(before === ',' && (after === ')' || after === ','))) { bad.push(prm); break }
        }
      }
      const wrapped = /^\(/.test(body) && matchesWhole(body)
      const isStmt = /^do\s*\{/.test(body) || /^\{/.test(body)
      const hasOp = /[-+*/%<>&|^!~?=]/.test(body.replace(/->/g, ''))
      if (bad.length) add('R-1-1-7', rel, p.line, false, `宏 ${m[1]} 的参数 ${[...new Set(bad)].join('、')} 在宏体中没有用括号括起来`)
      else if (!wrapped && !isStmt && hasOp) add('R-1-1-7', rel, p.line, false, `宏 ${m[1]} 的结果没有用括号整体括起来`)
    }
  }
  if (isH) {
    const first = pp[0]?.text || ''
    const guarded = /^#\s*pragma\s+once/.test(first) || (/^#\s*ifndef\s+(\w+)/.test(first) && new RegExp(`^#\\s*define\\s+${/^#\s*ifndef\s+(\w+)/.exec(first)[1]}\\b`).test(pp[1]?.text || ''))
    const codeBefore = T.length && pp[0] && T[0].line < pp[0].line
    if (!guarded || codeBefore) add('R-1-1-22', rel, 1, false, '头文件没有以 #ifndef/#define（或 #pragma once）开头的防重复包含保护')
  }

  // ---------- 注释 ----------
  for (const c of comments) if (c.text.startsWith('/*') && c.text.slice(2).includes('/*')) add('R-1-2-6', rel, c.line, true, '注释中嵌套了 /*')

  // ---------- 数字常量 ----------
  T.forEach((tk) => {
    if (tk.t !== 'num') return
    const v = tk.v
    if (/^0[0-7]+[uUlL]*$/.test(v) && !/octal/i.test(cmt(tk.line))) add('R-1-8-4', rel, tk.line, true, `八进制常量 ${v} 没有 /* octal */ 注释`)
    const hex = /^0[xX]/.test(v)
    const suf = hex ? (/[uUlL]+$/.exec(v)?.[0] || '') : (/[uUlLfF]+$/.exec(v)?.[0] || '')
    if (/[ulf]/.test(suf)) add('R-1-8-5', rel, tk.line, true, `数字 ${v} 的后缀是小写字母`)
  })
  // 预处理行（#define 等）中的数字常量也要查（词法分析不为预处理行生成记号）
  for (const p of pp) {
    const body = p.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/g, ' ').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ')
    for (const m of body.matchAll(/\b(0[xX][0-9a-fA-F]+[uUlL]*|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?[uUlLfF]*)\b/g)) {
      const v = m[1], hex = /^0[xX]/.test(v)
      const suf = hex ? (/[uUlL]+$/.exec(v)?.[0] || '') : (/[uUlLfF]+$/.exec(v)?.[0] || '')
      if (/[ulf]/.test(suf)) add('R-1-8-5', rel, p.line, true, `数字 ${v} 的后缀是小写字母`)
    }
  }

  // ---------- 顶层声明 ----------
  for (const d of a.decls) {
    if (d.kind === 'var' && d.extern && d.init) add('R-1-1-19', rel, d.line, true, `extern 声明 ${d.name} 带有初始化`)
    if (d.kind === 'var' && ['l', 'O'].includes(d.name)) add('R-1-13-11', rel, d.line, true, `变量名 ${d.name}`)
    if (d.kind === 'var' && fnDefs.has(d.name)) add('R-1-13-3', rel, d.line, true, `全局变量 ${d.name} 与函数同名`)
    if (d.kind === 'proto') {
      checkParamList(a, d.lp, d.rp, d.name, true)
    }
  }
  // 结构、联合、枚举无标识名；数组无边界
  T.forEach((tk, i) => {
    if (tk.t === 'id' && ['struct', 'union', 'enum'].includes(tk.v) && T[i + 1]?.v === '{') add('R-1-1-8', rel, tk.line, true, `${tk.v} 定义没有标识名`)
    if (tk.v === '[' && T[i + 1]?.v === ']' && T[i - 1]?.t === 'id' && (T[i + 2]?.v === '=' || T[i + 2]?.v === ';')) add('R-1-1-18', rel, tk.line, true, `数组 ${T[i - 1].v} 定义没有显式给出边界`)
  })

  // ---------- 函数 ----------
  const fileStatic = a.fns.filter((f) => f.static).map((f) => f.name).concat(a.decls.filter((d) => d.kind === 'proto' && d.static).map((d) => d.name))
  for (const name of new Set(fileStatic)) {
    const uses = T.filter((t, i) => t.t === 'id' && t.v === name && !isDeclName(a, i)).length
    if (!uses) add('R-1-7-13', rel, (a.fns.find((f) => f.name === name) || a.decls.find((d) => d.name === name)).line, true, `静态函数 ${name} 没有被使用`)
  }

  for (const fn of a.fns) {
    const F = fn.name
    const calls = new Set()
    callGraph.set(F, calls)
    if (fn.oldStyle) add('R-1-7-4', rel, fn.line, true, `函数 ${F} 使用了旧形式（K&R）参数定义`, F)
    checkParamList(a, fn.lp, fn.rp, F, false)
    const pnames = paramNames(fn)
    for (const p of pnames) {
      if (globals.has(p)) add('R-1-13-2', rel, fn.line, true, `形参 ${p} 与全局变量同名（${globals.get(p).file}:${globals.get(p).line}）`, F)
      if (['l', 'O'].includes(p)) add('R-1-13-11', rel, fn.line, true, `形参名 ${p}`, F)
    }
    const locals = localDecls(T, M, fn, typeNames)
    const seen = new Map()
    for (const d of locals) {
      if (d.extern) add('R-1-1-17', rel, d.line, true, `函数体内的外部声明 extern … ${d.name}`, F)
      if (globals.has(d.name)) add('R-1-13-1', rel, d.line, true, `局部变量 ${d.name} 与全局变量同名（${globals.get(d.name).file}:${globals.get(d.name).line}）`, F)
      if (fnDefs.has(d.name) || protos.has(d.name)) add('R-1-13-3', rel, d.line, true, `变量 ${d.name} 与函数同名`, F)
      if (['l', 'O'].includes(d.name)) add('R-1-13-11', rel, d.line, true, `变量名 ${d.name}`, F)
      if (pnames.includes(d.name) || (seen.has(d.name) && seen.get(d.name).depth < d.depth)) add('R-1-13-7', rel, d.line, false, `变量 ${d.name} 在内部块中重新定义`, F)
      if (!seen.has(d.name)) seen.set(d.name, d)
    }
    const unsignedVar = (name) => { const l = seen.get(name); if (l) return l.unsigned; if (pnames.includes(name)) { const p = fn.params.find((s) => new RegExp(`\\b${name}$`).test(s.replace(/\s*\[.*$/, ''))); return p ? /\b(unsigned|uint\d*_t|size_t)\b/.test(p) : false } const g = globals.get(name); return g ? g.unsigned : false }
    const isLocal = (name) => seen.has(name) || pnames.includes(name)
    const volatileVar = (name) => { const l = seen.get(name); if (l) return l.volatile; return !pnames.includes(name) && !!globals.get(name)?.volatile }

    let hasReturnValue = false, lastStmtReturn = false
    for (let i = fn.open + 1; i < fn.close; i++) {
      const tk = T[i], v = tk.v
      if (tk.t === 'id') {
        // 调用
        if (T[i + 1]?.v === '(' && !C_KEYWORDS.has(v) && T[i - 1]?.v !== '.' && T[i - 1]?.v !== '->') {
          calls.add(v)
          checkCallStatement(a, i, F)
        }
        if (v === 'gets' && T[i + 1]?.v === '(') add('R-1-6-18', rel, tk.line, true, '使用了 gets', F)
        if ((v === 'setjmp' || v === 'longjmp') && T[i + 1]?.v === '(') add('R-1-5-2', rel, tk.line, true, `使用了 ${v}`, F)
        if (v === 'goto') {
          const label = T[i + 1]?.v
          const at = T.findIndex((t, k) => k > fn.open && k < fn.close && t.v === label && T[k + 1]?.v === ':' && T[k - 1]?.v !== '?' && T[k - 1]?.v !== 'case')
          if (at >= 0 && at < i) add('R-1-5-1', rel, tk.line, true, `goto ${label} 向上跳转（标号在第 ${T[at].line} 行）`, F)
          else add('R-1-5-1', rel, tk.line, false, `使用了 goto ${label}：确认没有跳入复合语句`, F)
        }
        if (v === 'return') {
          const hasVal = T[i + 1]?.v !== ';'
          if (hasVal) hasReturnValue = true
          if (fn.isVoid && hasVal) add('R-1-7-8', rel, tk.line, true, `无返回值函数 ${F} 的 return 带有返回值`, F)
          if (!fn.isVoid && !hasVal) add('R-1-7-9', rel, tk.line, true, `有返回值函数 ${F} 的 return 没有返回值`, F)
        }
        if (v === 'sizeof' && T[i + 1]?.v === '(') {
          const e = M[i + 1]
          for (let k = i + 2; k < e; k++) if (isAssignOp(T[k].v)) { add('R-1-6-13', rel, tk.line, true, 'sizeof 中有赋值', F); break }
        }
        if (['if', 'while', 'for', 'switch', 'do', 'else'].includes(v)) controlChecks(a, i, F, { unsignedVar, isLocal })
        if (v === 'case' || v === 'default') { /* 在 switch 检查中处理 */ }
      }
      if (tk.t === 'op') {
        if ((v === '++' || v === '--') && !incOk(a, i)) add('R-1-6-5', rel, tk.line, true, `${v} 用在了运算表达式或函数参数中`, F)
        if (v === '!' && (T[i + 1]?.t === 'num' || (T[i + 1]?.t === 'id' && /^[A-Z][A-Z0-9_]+$/.test(T[i + 1].v) && T[i + 2]?.v !== '(' && T[i + 2]?.v !== '['))) add('R-1-6-10', rel, tk.line, T[i + 1].t === 'num', `对常数${T[i + 1].t === 'num' ? '' : '（疑为宏常量）'} ${T[i + 1].v} 做逻辑非`, F)
        if ((v === '==' || v === '!=')) {
          const l = T[i - 1], r = T[i + 1]
          if ([l, r].some((x) => x?.t === 'num' && /[.eE]/.test(x.v) && !/^0[xX]/.test(x.v))) add('R-1-12-3', rel, tk.line, true, `浮点数用 ${v} 比较`, F)
        }
        if ((v === '>=' || v === '<') && T[i + 1]?.t === 'num' && /^0[uU]?$/.test(T[i + 1].v) && T[i - 1]?.t === 'id' && unsignedVar(T[i - 1].v)) add('R-1-12-4', rel, tk.line, true, `无符号数 ${T[i - 1].v} ${v} 0`, F)
        if ((v === '<=' || v === '>') && T[i - 1]?.t === 'num' && /^0[uU]?$/.test(T[i - 1].v) && T[i + 1]?.t === 'id' && unsignedVar(T[i + 1].v)) add('R-1-12-4', rel, tk.line, true, `0 ${v} 无符号数 ${T[i + 1].v}`, F)
        if (v === '...') add('R-1-7-15', rel, tk.line, true, '参数表中使用了省略号', F)
      }
      // 语句级：同一 volatile 变量出现多次
      if (tk.v === ';' ) {
        const s = stmtStart(a, i)
        const cnt = new Map()
        for (let k = s; k < i; k++) if (T[k].t === 'id' && T[k - 1]?.v !== '.' && T[k - 1]?.v !== '->' && volatileVar(T[k].v)) cnt.set(T[k].v, (cnt.get(T[k].v) || 0) + 1)
        for (const [n, c] of cnt) if (c > 1) add('R-1-13-13', rel, tk.line, false, `一个表达式中出现 ${c} 次 volatile 变量 ${n}`, F)
      }
    }
    // 最后一条语句
    let k = fn.close - 1
    while (k > fn.open && T[k].v === '}') k--
    const s = stmtStart(a, k)
    lastStmtReturn = T[s]?.v === 'return' || T[s]?.v === 'for' || T[s]?.v === 'while'
    if (!fn.isVoid && F !== 'main' && !lastStmtReturn) add('R-1-7-7', rel, T[fn.close].line, false, `有返回值函数 ${F} 的最后一条语句不是 return，确认所有路径都有返回值`, F)
    void hasReturnValue
  }

  // ---------- 局部辅助（依赖 a） ----------
  function checkParamList(a2, lp, rp, name, isProto) {
    const toks = a2.tokens.slice(lp + 1, rp)
    if (!toks.length) { add('R-1-1-23', rel, a2.tokens[lp].line, true, `函数 ${name} 的参数表为空，没有写 void`, isProto ? '' : name); return }
    if (!isProto) return
    for (const [x, y] of splitTop(a2.tokens, lp + 1, rp, a2.match)) {
      const seg = a2.tokens.slice(x, y).map((t) => t.v)
      if (seg.length === 1 && seg[0] === 'void') continue
      if (seg.includes('...')) continue
      const last = seg[seg.length - 1]
      const named = seg.length >= 2 && /^\w+$/.test(last) && !C_KEYWORDS.has(last) && !typeNames.has(last) && !/_t$/.test(last) || seg.includes('(') || last === ']'
      if (!named) add('R-1-1-13', rel, a2.tokens[x].line, false, `函数声明 ${name} 的参数“${seg.join(' ')}”没有变量名`)
    }
  }

  function checkCallStatement(a2, i, F) {
    // 调用作为整条语句：前面是语句开始，后面 ) 之后是 ;
    const T2 = a2.tokens, M2 = a2.match, name = T2[i].v
    const rp = M2[i + 1]
    if (rp < 0 || T2[rp + 1]?.v !== ';') return
    const s = stmtStart(a2, rp + 1)
    let castVoid = false
    if (s === i) castVoid = false
    else if (T2[s]?.v === '(' && T2[s + 1]?.v === 'void' && T2[s + 2]?.v === ')' && s + 3 === i) castVoid = true
    else return
    const rv = returnsValue(name)
    if (!castVoid && (rv === true || (rv === null && STD_VALUE.has(name)))) add('R-1-7-11', rel, T2[i].line, rv === true, `${name} 的返回值没有使用，也没有 (void) 说明`, F)
    if (castVoid && rv === false) add('R-1-7-12', rel, T2[i].line, true, `${name} 无返回值，调用时又加了 (void)`, F)
  }
}

// 递归：调用图中的环
{
  const state = new Map(), stack = [], reported = new Set()
  const dfs = (f) => {
    state.set(f, 1); stack.push(f)
    for (const g of callGraph.get(f) || []) {
      if (!callGraph.has(g)) continue
      if (state.get(g) === 1) {
        const cyc = stack.slice(stack.indexOf(g)).concat(g)
        const key = [...new Set(cyc)].sort().join(',')
        if (!reported.has(key)) {
          reported.add(key)
          const d = fnDefs.get(g)
          add('R-1-7-16', d?.file || '', d?.line || 0, true, cyc.length === 2 ? `函数 ${g} 直接调用自己` : `间接递归：${cyc.join(' → ')}`, g)
        }
      } else if (!state.get(g)) dfs(g)
    }
    stack.pop(); state.set(f, 2)
  }
  for (const f of callGraph.keys()) if (!state.get(f)) dfs(f)
}

// ---------- 通用辅助 ----------
function matchesWhole(s) {
  let d = 0
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '(') d++
    else if (s[k] === ')') { d--; if (d === 0 && k < s.length - 1) return false }
  }
  return d === 0
}
function isAssignOp(v) { return ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(v) }
function isDeclName(a, i) {
  // 定义或原型中的函数名本身不算“使用”
  const T = a.tokens
  if (a.fns.some((f) => f.nameIdx === i)) return true
  return a.decls.some((d) => d.kind === 'proto' && d.lp - 1 === i)
}
/** 语句开始位置：往回找 ; { } 或控制语句头的 ) / else / do / case 标号的 : */
function stmtStart(a, i) {
  const T = a.tokens, M = a.match
  let k = i - 1
  while (k >= 0) {
    const v = T[k].v
    if (v === ')' && M[k] >= 0) {
      const kw = T[M[k] - 1]?.v
      if (['if', 'while', 'for', 'switch'].includes(kw) && !(kw === 'while' && T[M[k] - 2]?.v === '}' && isDoWhile(a, M[k] - 1))) return k + 1
      k = M[k] - 1; continue
    }
    if (v === ']' && M[k] >= 0) { k = M[k] - 1; continue }
    if (v === ';' || v === '{' || v === '}' || v === 'else' || v === 'do') return k + 1
    if (v === ':' && (T[k - 2]?.v === 'case' || T[k - 1]?.v === 'default' || (T[k - 1]?.t === 'id' && ['{', '}', ';'].includes(T[k - 2]?.v)))) return k + 1
    if (v === ':' && T.slice(Math.max(0, k - 6), k).some((t) => t.v === 'case')) return k + 1
    k--
  }
  return 0
}
function isDoWhile(a, whileIdx) {
  const T = a.tokens, M = a.match
  const rb = whileIdx - 1
  if (T[rb]?.v !== '}' || M[rb] < 0) return false
  return T[M[rb] - 1]?.v === 'do'
}
/** ++/-- 是否单独成句（x++; ++x; p->n++; a[i]++;）或在 for 的第三部分单独出现 */
function incOk(a, i) {
  const T = a.tokens, M = a.match
  // for 第三部分
  let k = i - 1, depth = 0
  // 找所在 for ( ... ) 的范围
  for (let j = i - 1; j >= 0; j--) {
    if (T[j].v === ')' && M[j] >= 0) { j = M[j]; continue }
    if (T[j].v === '(') {
      if (T[j - 1]?.v === 'for') {
        const semis = []
        for (let q = j + 1; q < M[j]; q++) { if (T[q].v === '(' && M[q] > q) { q = M[q]; continue } if (T[q].v === ';') semis.push(q) }
        if (semis.length === 2 && i > semis[1]) {
          // 第三部分按逗号切，每段必须是 “lvalue ++” 或 “++ lvalue”
          for (const [x, y] of splitTop(T, semis[1] + 1, M[j], M)) if (i >= x && i < y) return simpleIncr(T, x, y)
        }
        if (semis.length === 2 && i > semis[0] && i < semis[1]) return false
        return false
      }
      break
    }
    if (T[j].v === '{' || T[j].v === '}') break
  }
  void k; void depth
  // 单独成句
  let e = i + 1
  while (e < T.length && T[e].v !== ';' && T[e].v !== '}' ) { if (T[e].v === '(' || T[e].v === '[') { if (M[e] > e) { e = M[e] + 1; continue } } e++ }
  if (T[e]?.v !== ';') return false
  const s = stmtStart(a, e)
  return simpleIncr(T, s, e)
}
function simpleIncr(T, x, y) {
  const seg = T.slice(x, y)
  const ops = seg.filter((t) => t.v === '++' || t.v === '--')
  if (ops.length !== 1) return false
  const rest = seg.filter((t) => t.v !== '++' && t.v !== '--')
  if (!(seg[0].v === '++' || seg[0].v === '--' || seg[seg.length - 1].v === '++' || seg[seg.length - 1].v === '--')) return false
  // 只允许 标识符、. -> [ ] 和下标中的简单项
  let d = 0
  for (const t of rest) {
    if (t.v === '[') { d++; continue }
    if (t.v === ']') { d--; continue }
    if (d > 0) continue
    if (!(t.t === 'id' || t.v === '.' || t.v === '->' || t.v === '*' || t.v === '(' || t.v === ')')) return false
  }
  return true
}

/** 控制语句：大括号、if-else if-else、空分支、switch、for 循环变量、条件中的赋值、括号 */
function controlChecks(a, i, F, ctx) {
  const T = a.tokens, M = a.match, rel = a.rel, v = T[i].v
  const cmtBetween = (x, y) => a.comments.filter((c) => c.line >= T[x].line && c.endLine <= T[y].line).map((c) => c.text).join(' ')
  const bodyCheck = (bi, what) => {
    if (T[bi]?.v !== '{') { add(what === 'loop' ? 'R-1-2-1' : 'R-1-2-2', rel, T[bi]?.line ?? T[i].line, true, `${v} 的${what === 'loop' ? '循环体' : '分支'}没有用大括号括起来`, F); return }
    const e = M[bi]
    const inner = T.slice(bi + 1, e)
    if (what !== 'loop' && (inner.length === 0 || inner.every((t) => t.v === ';'))) {
      const c = cmtBetween(bi, e)
      if (!inner.length || !/no\s*deal\s*with/i.test(c)) add('R-1-4-2', rel, T[bi].line, true, `${v} 的分支为空，没有“; /* no deal with */”说明`, F)
    }
  }
  if (v === 'do') { bodyCheck(i + 1, 'loop'); return }
  if (v === 'else') {
    if (T[i + 1]?.v === 'if') return // else if 由 if 处理
    bodyCheck(i + 1, 'branch'); return
  }
  if (T[i + 1]?.v !== '(') return
  const lp = i + 1, rp = M[lp]
  if (rp < 0) return
  if (v === 'while' && T[i - 1]?.v === '}' && isDoWhile(a, i)) { condChecks(a, lp, rp, F); return }
  if (v === 'for') {
    const semis = []
    for (let q = lp + 1; q < rp; q++) { if (T[q].v === '(' && M[q] > q) { q = M[q]; continue } if (T[q].v === ';') semis.push(q) }
    if (semis.length === 2) {
      condChecks(a, semis[0], semis[1], F)
      // 循环控制变量：初始化部分被赋值的变量
      const init = T.slice(lp + 1, semis[0])
      const eq = init.findIndex((t) => t.v === '=')
      const cv = eq > 0 ? init[eq - 1] : null
      if (cv && cv.t === 'id') {
        if (!ctx.isLocal(cv.v)) add('R-1-9-1', rel, T[i].line, false, `for 循环控制变量 ${cv.v} 不是局部变量或形参`, F)
        const bs = rp + 1, be = T[bs]?.v === '{' ? M[bs] : stmtEnd(a, bs)
        for (let q = bs; q < be; q++) {
          if (T[q].t === 'id' && T[q].v === cv.v && T[q - 1]?.v !== '.' && T[q - 1]?.v !== '->') {
            const nx = T[q + 1]?.v, pv = T[q - 1]?.v
            if (isAssignOp(nx) || nx === '++' || nx === '--' || pv === '++' || pv === '--' || (pv === '&' && !['(', ',', '='].includes(T[q - 2]?.v) === false)) {
              if (pv === '&') { add('R-1-9-3', rel, T[q].line, false, `for 循环体中取了循环控制变量 ${cv.v} 的地址，确认没有通过指针修改`, F); continue }
              add('R-1-9-3', rel, T[q].line, true, `for 循环体中修改了循环控制变量 ${cv.v}`, F)
            }
          }
        }
      }
    }
    bodyCheck(rp + 1, 'loop'); return
  }
  if (v === 'while') { condChecks(a, lp, rp, F); bodyCheck(rp + 1, 'loop'); return }
  if (v === 'switch') {
    const bs = rp + 1
    if (T[bs]?.v !== '{') return
    const be = M[bs]
    // 顶层的 case/default 标号
    const labels = []
    for (let q = bs + 1; q < be; q++) {
      if (T[q].v === '{' && M[q] > q && !isCaseBlock(T, q)) { q = M[q]; continue }
      if (T[q].v === 'switch' && T[q + 1]?.v === '(') { const r = M[q + 1]; if (T[r + 1]?.v === '{') { q = M[r + 1]; continue } }
      if (T[q].v === 'case' || (T[q].v === 'default' && T[q + 1]?.v === ':')) {
        let c = q + 1; while (c < be && T[c].v !== ':') c++
        labels.push({ at: q, colon: c, isDefault: T[q].v === 'default' })
        q = c
      }
    }
    if (!labels.length) { add('R-1-4-3', rel, T[i].line, true, 'switch 语句没有 case', F); return }
    if (!labels.some((l) => l.isDefault)) add('R-1-4-6', rel, T[i].line, false, 'switch 没有 default（只有对枚举列举完全时才允许省略）', F)
    labels.forEach((l, k) => {
      const end = k + 1 < labels.length ? labels[k + 1].at : be
      let seg = T.slice(l.colon + 1, end)
      if (!seg.length) {
        if (!/shared/i.test(commentsOnLine(a.comments, T[l.at].line))) add('R-1-4-7', rel, T[l.at].line, true, `共用的 ${T[l.at].v === 'case' ? 'case' : 'default'} 没有 /* shared */ 注释`, F)
        return
      }
      // 分支被一对大括号包住时看括号内
      if (seg[0].v === '{' && M[l.colon + 1] === end - 1) seg = T.slice(l.colon + 2, end - 1)
      else if (seg[0].v === '{' && M[l.colon + 1] < end - 1) {
        // { ... } break;  —— 看括号后的部分
        const after = T.slice(M[l.colon + 1] + 1, end)
        if (after.length) seg = after
        else seg = T.slice(l.colon + 2, M[l.colon + 1])
      }
      // 最后一条语句
      let e = seg.length - 1
      while (e >= 0 && seg[e].v === '}') e--
      let s = e - 1
      while (s >= 0 && !(seg[s].v === ';' || seg[s].v === '{' || seg[s].v === '}')) s--
      const first = seg[s + 1]?.v
      if (!(first === 'break' || first === 'return')) add('R-1-4-7', rel, T[l.at].line, true, `${T[l.at].v === 'case' ? 'case' : 'default'} 分支不是以 break 或 return 结束`, F)
    })
    return
  }
  if (v === 'if') {
    condChecks(a, lp, rp, F)
    bodyCheck(rp + 1, 'branch')
    if (T[i - 1]?.v === 'else') return // 链的后续部分
    // if-else if 链必须以 else 结束
    let q = i, hadElseIf = false
    for (;;) {
      const r = M[q + 1]
      const end = stmtEnd(a, r + 1)
      if (T[end + 1]?.v === 'else') {
        if (T[end + 2]?.v === 'if') { hadElseIf = true; q = end + 2; continue }
        break
      }
      if (hadElseIf) add('R-1-4-1', rel, T[i].line, true, 'if-else if 语句没有最后的 else 分支', F)
      break
    }
  }
}
function isCaseBlock(T, q) { return T[q - 1]?.v === ':' }
/** 从 s 开始的一条语句的最后一个记号下标 */
function stmtEnd(a, s) {
  const T = a.tokens, M = a.match
  if (T[s]?.v === '{') return M[s]
  if (T[s]?.v === 'if' || T[s]?.v === 'while' || T[s]?.v === 'for' || T[s]?.v === 'switch') {
    const r = M[s + 1]
    if (T[s].v === 'while' && T[r + 1]?.v === ';') return r + 1
    const e = stmtEnd(a, r + 1)
    if (T[s].v === 'if' && T[e + 1]?.v === 'else') return stmtEnd(a, e + 2)
    return e
  }
  if (T[s]?.v === 'do') { const e = stmtEnd(a, s + 1); return M[e + 2] + 1 }
  let k = s
  while (k < T.length && T[k].v !== ';') { if ((T[k].v === '(' || T[k].v === '[' || T[k].v === '{') && M[k] > k) k = M[k]; k++ }
  return k
}
/** 条件表达式：赋值、&& || 混用、逻辑运算项不加括号 */
function condChecks(a, lp, rp, F) {
  const T = a.tokens, M = a.match, rel = a.rel
  // 赋值
  for (let q = lp + 1; q < rp; q++) {
    if (isAssignOp(T[q].v)) { add('R-1-6-3', rel, T[q].line, true, '条件表达式中使用了赋值', F); break }
  }
  // 逐层检查括号组
  const groups = [[lp, rp]]
  for (let q = lp + 1; q < rp; q++) if (T[q].v === '(' && M[q] > q && T[q - 1]?.t !== 'id') groups.push([q, M[q]])
  for (const [x, y] of groups) {
    const ops = []
    for (let q = x + 1; q < y; q++) {
      if ((T[q].v === '(' || T[q].v === '[') && M[q] > q) { q = M[q]; continue }
      if (T[q].v === '&&' || T[q].v === '||') ops.push(q)
    }
    if (!ops.length) continue
    if (new Set(ops.map((q) => T[q].v)).size > 1) add('R-1-2-4', rel, T[ops[0]].line, true, '&& 和 || 混用，没有用括号说明优先级', F)
    const bounds = [x, ...ops, y]
    for (let k = 0; k + 1 < bounds.length; k++) {
      const s = bounds[k] + 1, e = bounds[k + 1]
      if (!operandOk(T, M, s, e)) { add('R-1-2-5', rel, T[s].line, true, `逻辑运算项“${T.slice(s, e).map((t) => t.v).join(' ').slice(0, 40)}”没有用括号括起来`, F); break }
    }
  }
}
/** 逻辑运算项：单个标识符/常量、!项、函数调用、整体括号、成员访问、下标 */
function operandOk(T, M, s, e) {
  if (s >= e) return true
  let k = s
  while (k < e && T[k].v === '!') k++
  if (T[k]?.v === '(' && M[k] === e - 1) return true
  // 成员访问链、下标、调用
  let q = k
  if (T[q]?.t !== 'id' && T[q]?.t !== 'num') return false
  q++
  while (q < e) {
    const v = T[q].v
    if ((v === '.' || v === '->') && T[q + 1]?.t === 'id') { q += 2; continue }
    if ((v === '[' || v === '(') && M[q] > q) { q = M[q] + 1; continue }
    return false
  }
  return true
}

// ---------- 输出 ----------
findings.sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line || x.rule.localeCompare(y.rule, undefined, { numeric: true }))
// 小写后缀常常成片出现：每个文件合并为一条，列出行号
{
  const merged = new Map()
  for (let k = findings.length - 1; k >= 0; k--) {
    const f = findings[k]
    if (f.rule !== 'R-1-8-5') continue
    const m = merged.get(f.file) || { lines: [], vals: new Set() }
    m.lines.unshift(f.line); m.vals.add(/数字 (\S+)/.exec(f.msg)?.[1])
    merged.set(f.file, m); findings.splice(k, 1)
  }
  for (const [file, m] of merged) {
    const lines = [...new Set(m.lines)]
    const vals = [...m.vals].slice(0, 5)
    findings.push({ rule: 'R-1-8-5', file, line: lines[0], certainty: '确定', func: '', msg: `${m.lines.length} 个数字常量的后缀是小写字母（如 ${vals.join('、')}），所在行：${lines.join('、')}` })
  }
  findings.sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line || x.rule.localeCompare(y.rule, undefined, { numeric: true }))
}
const seenKey = new Set()
const list = findings.filter((f) => { const k = `${f.file}:${f.line}:${f.rule}:${f.msg}`; if (seenKey.has(k)) return false; seenKey.add(k); return true })
list.forEach((f, k) => { f.id = `GS-${String(k + 1).padStart(3, '0')}`; f.title = RULES[f.rule] || '' })

const byRule = new Map()
for (const f of list) byRule.set(f.rule, (byRule.get(f.rule) || 0) + 1)
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const L = []
L.push(`# GJB 8114 强制准则扫描结果`, '')
L.push(`扫描文件 ${files.length} 个，发现 ${list.length} 处疑似违反（确定 ${list.filter((f) => f.certainty === '确定').length}，疑似 ${list.filter((f) => f.certainty === '疑似').length}）。`)
L.push('“确定”是按规则字面能判定的；“疑似”需要看上下文。每一条都要打开源码确认，在走查/静态分析记录中写判定（违反 / 误报 / 特殊设计）和理由。', '')
L.push('本脚本只查规则表中“检查方式”含“脚本”的条目，其余条目用 Cppcheck、编译告警和人工检查。', '')
L.push('| 编号 | 文件:行号 | 函数 | 规则 | 确定性 | 说明 |', '|---|---|---|---|---|---|')
for (const f of list) L.push(`| ${f.id} | ${f.file}:${f.line} | ${cell(f.func)} | ${f.rule} | ${f.certainty} | ${cell(f.msg)} |`)
L.push('', '## 按规则统计', '', '| 规则 | 内容 | 处数 |', '|---|---|---|')
for (const [r, n] of [...byRule].sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }))) L.push(`| ${r} | ${cell(RULES[r])} | ${n} |`)
const md = L.join('\n') + '\n'
if (mdOut) writeFileSync(mdOut, md, 'utf8'); else process.stdout.write(md)
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ tool: 'gjb-scan', version: 1, files: all.map((a) => a.rel), rules: Object.keys(RULES), findings: list }, null, 2), 'utf8')
if (mdOut || jsonOut) console.log(`扫描 ${files.length} 个文件，${list.length} 处疑似违反。${mdOut ? `结果：${mdOut}` : ''}${jsonOut ? ` 数据：${jsonOut}` : ''}`)
