// 最小 XML 解析与序列化：面向 Office Open XML（格式良好、无 DTD）。
// 节点：{ name, attrs: {k: v}, children: [] }；文本节点：{ text }。
// 保留属性顺序和命名空间前缀，parse → serialize 往返不丢内容。

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decode(s) {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENT[e]
  })
}

export const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const escAttr = (s) => escText(s).replace(/"/g, '&quot;')

// 去掉 XML 1.0 不允许的控制字符
export const cleanText = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')

/** 解析 XML 字符串，返回 { decl, root }。decl 为原样保留的 <?xml ...?> 声明。 */
export function parseXml(xml) {
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1)
  let decl = ''
  const stack = [{ name: '#document', attrs: {}, children: [] }]
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?([\s\S]*?)\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.children.push({ text: m[1] })
    else if (m[2] !== undefined) { if (!decl && /^xml\s/.test(m[2])) decl = m[0] }
    else if (m[3] !== undefined) {
      if (stack.length > 1) stack.pop()
    } else if (m[4] !== undefined) {
      const attrs = {}
      if (m[5]) for (const a of m[5].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3])
      const node = { name: m[4], attrs, children: [] }
      top.children.push(node)
      if (!m[6]) stack.push(node)
    } else if (m[7] !== undefined) {
      top.children.push({ text: decode(m[7]) })
    }
  }
  const root = stack[0].children.find((c) => c.name)
  if (!root) throw new Error('XML 中没有根元素')
  return { decl, root }
}

export function serialize(node) {
  if (node.text !== undefined) return escText(cleanText(node.text))
  let s = `<${node.name}`
  for (const [k, v] of Object.entries(node.attrs)) s += ` ${k}="${escAttr(v)}"`
  if (!node.children.length) return s + '/>'
  s += '>'
  for (const c of node.children) s += serialize(c)
  return s + `</${node.name}>`
}

export function serializeDoc({ decl, root }) {
  return (decl || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>') + '\r\n' + serialize(root)
}

// —— 查询辅助 ——
export const kids = (n, name) => (n?.children || []).filter((c) => c.name === name)
export const kid = (n, name) => (n?.children || []).find((c) => c.name === name)
export function path(n, ...names) {
  let cur = n
  for (const nm of names) { cur = kid(cur, nm); if (!cur) return undefined }
  return cur
}
export function* walk(n) {
  if (!n || n.text !== undefined) return
  yield n
  for (const c of n.children) yield* walk(c)
}
/** 节点下所有文本（不含指定子树）。 */
export function textOf(n, skip = () => false) {
  if (!n) return ''
  if (n.text !== undefined) return n.text
  if (skip(n)) return ''
  return n.children.map((c) => textOf(c, skip)).join('')
}
export const val = (n, attr = 'w:val') => n?.attrs?.[attr]
