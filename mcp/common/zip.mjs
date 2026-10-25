// 最小 ZIP 读写：只用 Node 自带的 zlib，供 docx/xlsx 读写使用。
// 支持“存储”和“deflate”两种压缩方式；不支持 ZIP64、加密和分卷（Office 文档用不到）。

import zlib from 'node:zlib'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

let crcTable
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 读取 ZIP，返回 Map<文件名, Buffer>（按需解压）。 */
export function readZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（可能是旧版 .doc/.xls/.wps 二进制格式，请另存为 .docx/.xlsx）')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || p === 0xffffffff) throw new Error('不支持 ZIP64 格式的文件')
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('ZIP 中央目录损坏')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (flags & 0x1) throw new Error('文件已加密，无法读取')
    entries.set(name, { method, compSize, localOff })
  }
  const cache = new Map()
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    get(name) {
      if (cache.has(name)) return cache.get(name)
      const e = entries.get(name)
      if (!e) return undefined
      if (buf.readUInt32LE(e.localOff) !== SIG_LOCAL) throw new Error(`ZIP 本地文件头损坏：${name}`)
      const start = e.localOff + 30 + buf.readUInt16LE(e.localOff + 26) + buf.readUInt16LE(e.localOff + 28)
      const raw = buf.subarray(start, start + e.compSize)
      let data
      if (e.method === 0) data = Buffer.from(raw)
      else if (e.method === 8) data = zlib.inflateRawSync(raw)
      else throw new Error(`不支持的压缩方式 ${e.method}：${name}`)
      cache.set(name, data)
      return data
    },
    text(name) {
      const d = this.get(name)
      return d === undefined ? undefined : d.toString('utf8')
    },
  }
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** 写 ZIP。files：Array<[文件名, Buffer|string]>，按给定顺序写入（[Content_Types].xml 应放第一个）。 */
export function writeZip(files) {
  const { time, date } = dosTime(new Date())
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const comp = zlib.deflateRawSync(data, { level: 6 })
    const useDeflate = comp.length < data.length
    const body = useDeflate ? comp : data
    const crc = crc32(data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(SIG_LOCAL, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x800, 6)
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8)
    lh.writeUInt16LE(time, 10)
    lh.writeUInt16LE(date, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    locals.push(lh, nameBuf, body)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(SIG_CENTRAL, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x800, 8)
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10)
    ch.writeUInt16LE(time, 12)
    ch.writeUInt16LE(date, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, eocd])
}
