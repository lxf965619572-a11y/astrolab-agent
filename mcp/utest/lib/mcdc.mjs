// MC/DC 分析表核对：给定判定表达式和测试向量，检查每个条件是否有“独立影响对”。
// 准则：短路求值下的唯一原因 MC/DC（unique-cause with short-circuit）——
//   一对向量中，该条件取值相反、判定结果相反；其余条件要么取值相同，要么至少在一个向量中因短路未被求值。
// 用于编译器不能直接测量 MC/DC（GCC 14 以下）时，核对用例设计是否满足 MC/DC。

function tokenize(src) {
  const toks = []
  const re = /\s*(\|\||&&|!|\(|\)|[A-Za-z_][A-Za-z0-9_]*)/y
  let pos = 0
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break
    re.lastIndex = pos
    const m = re.exec(src)
    if (!m) throw new Error(`表达式第 ${pos + 1} 个字符附近无法识别：“${src.slice(pos, pos + 10)}”。只支持条件名、&&、||、!、括号`)
    toks.push(m[1])
    pos = re.lastIndex
  }
  return toks
}

// 语法：or := and ('||' and)* ; and := unary ('&&' unary)* ; unary := '!' unary | '(' or ')' | NAME
export function parseDecision(src) {
  const toks = tokenize(src)
  let i = 0
  const names = []
  const peek = () => toks[i]
  const eat = (t) => { if (toks[i] !== t) throw new Error(`表达式缺少“${t}”`); i++ }
  function or() { let n = and(); while (peek() === '||') { i++; n = { op: '||', l: n, r: and() } } return n }
  function and() { let n = unary(); while (peek() === '&&') { i++; n = { op: '&&', l: n, r: unary() } } return n }
  function unary() {
    const t = peek()
    if (t === '!') { i++; return { op: '!', e: unary() } }
    if (t === '(') { i++; const n = or(); eat(')'); return n }
    if (t && /^[A-Za-z_]/.test(t)) { i++; if (!names.includes(t)) names.push(t); return { op: 'var', name: t } }
    throw new Error(`表达式在“${t ?? '结尾'}”处不完整`)
  }
  const ast = or()
  if (i !== toks.length) throw new Error(`表达式多余的内容：“${toks.slice(i).join(' ')}”`)
  return { ast, names }
}

// 短路求值；values: name -> true/false/undefined（未给出）。返回 { value, evaluated:Set }
function evalShort(node, values, evaluated) {
  switch (node.op) {
    case 'var': {
      evaluated.add(node.name)
      const v = values[node.name]
      if (v === undefined) throw Object.assign(new Error(`条件 ${node.name} 会被求值，但向量中没有给出它的取值`), { missing: node.name })
      return v
    }
    case '!': return !evalShort(node.e, values, evaluated)
    case '&&': return evalShort(node.l, values, evaluated) ? evalShort(node.r, values, evaluated) : false
    case '||': return evalShort(node.l, values, evaluated) ? true : evalShort(node.r, values, evaluated)
  }
}

function parseValues(v, names) {
  const out = {}
  if (typeof v === 'string') {
    const s = v.replace(/[\s,]/g, '')
    if (s.length !== names.length) throw new Error(`向量“${v}”有 ${s.length} 位，条件有 ${names.length} 个（${names.join('、')}）`)
    names.forEach((n, k) => {
      const c = s[k].toUpperCase()
      if (c === 'T' || c === '1') out[n] = true
      else if (c === 'F' || c === '0') out[n] = false
      else if (c === 'X' || c === '-') out[n] = undefined
      else throw new Error(`向量“${v}”中的“${s[k]}”无法识别，用 T/F/X（或 1/0/-）`)
    })
  } else {
    for (const n of names) {
      const x = v[n]
      out[n] = x === undefined || x === null || x === 'X' || x === 'x' ? undefined : x === true || x === 1 || x === 'T' || x === 't' || x === '1'
    }
  }
  return out
}

/**
 * @param {string} decision 例："(A && B) || C"
 * @param {{id: string, values: string|object, expected?: boolean}[]} vectors
 */
export function checkMcdc(decision, vectors) {
  const { ast, names } = parseDecision(decision)
  if (names.length > 16) throw new Error('条件超过 16 个，请拆分判定')
  const rows = vectors.map((v) => {
    const values = parseValues(v.values, names)
    const evaluated = new Set()
    let outcome
    let error
    try { outcome = evalShort(ast, values, evaluated) } catch (e) { error = e.message }
    const mismatch = !error && v.expected !== undefined && v.expected !== null && Boolean(v.expected) !== outcome
    return { id: v.id, values, evaluated, outcome, error, mismatch }
  })
  const good = rows.filter((r) => !r.error)
  const result = []
  for (const c of names) {
    const pairs = []
    for (let a = 0; a < good.length; a++) for (let b = a + 1; b < good.length; b++) {
      const x = good[a], y = good[b]
      if (!x.evaluated.has(c) || !y.evaluated.has(c)) continue
      if (x.values[c] === y.values[c] || x.outcome === y.outcome) continue
      const ok = names.every((d) => d === c || !x.evaluated.has(d) || !y.evaluated.has(d) || x.values[d] === y.values[d])
      if (ok) pairs.push([x.id, y.id])
    }
    result.push({ condition: c, covered: pairs.length > 0, pairs: pairs.slice(0, 3) })
  }
  const missing = result.filter((r) => !r.covered).map((r) => r.condition)
  return {
    decision,
    conditions: names,
    vectors: rows.map((r) => ({
      id: r.id,
      values: names.map((n) => (r.values[n] === undefined ? 'X' : r.values[n] ? 'T' : 'F')).join(''),
      evaluated: names.filter((n) => r.evaluated.has(n)).join(''),
      outcome: r.error ? null : r.outcome,
      error: r.error,
      expectedMismatch: r.mismatch || undefined,
    })),
    perCondition: result,
    covered: names.length - missing.length,
    total: names.length,
    satisfied: missing.length === 0 && rows.every((r) => !r.error && !r.mismatch),
    suggestions: missing.map((c) => suggestPair(ast, names, c)).filter(Boolean),
  }
}

// 为未覆盖的条件找一对满足准则的向量（穷举，条件数 ≤ 16）
function suggestPair(ast, names, c) {
  const n = names.length
  const k = names.indexOf(c)
  for (let m = 0; m < 1 << n; m++) {
    if (m & (1 << k)) continue
    const mk = (mask) => { const v = {}; names.forEach((nm, j) => { v[nm] = !!(mask & (1 << j)) }); return v }
    const v1 = mk(m), v2 = mk(m | (1 << k))
    const e1 = new Set(), e2 = new Set()
    const o1 = evalShort(ast, v1, e1), o2 = evalShort(ast, v2, e2)
    if (o1 !== o2 && e1.has(c) && e2.has(c)) {
      const fmt = (v, e) => names.map((nm) => (e.has(nm) ? (v[nm] ? 'T' : 'F') : 'X')).join('')
      return { condition: c, pair: [fmt(v1, e1), fmt(v2, e2)], outcomes: [o1, o2] }
    }
  }
  return { condition: c, pair: null, note: `条件 ${c} 无法独立影响判定结果（可能是冗余条件或表达式写法问题），请核对代码` }
}
