// dsh-plugin-archive-reader — zip 归档读取（只读，无需第三方库）
//
// 从尾部找 EOCD → 读中央目录 → 按本地文件头定位数据。支持 method 0（store）
// 与 method 8（deflate）。ZIP64 与加密条目明确报错，不做静默降级。

import fs from 'node:fs'
import zlib from 'node:zlib'
import { readFully } from './io.mjs'

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50
const LFH_SIG = 0x04034b50
const MAX_COMMENT = 0xffff

/** 只靠开头 4 字节判断是不是 zip（格式探测用）。 */
export function isZipMagic(head) {
  if (!head || head.length < 4) return false
  const sig = head.readUInt32LE(0)
  return sig === 0x04034b50 || sig === 0x06054b50 || sig === 0x08074b50
}

function decodeName(buf, flags) {
  const name = buf.toString('utf8')
  if (flags & 0x800) return name
  // 未声明 UTF-8 的名字按历史规范可能是 CP437；Node 无内置解码器，
  // 仅在明显乱码时保留原文，由调用方按字面处理。
  return name
}

/** 打开 zip，返回 { path, size, entries, map, read, close }。 */
export async function openZip(filePath) {
  const fh = await fs.promises.open(filePath, 'r')
  try {
    const stat = await fh.stat()
    if (stat.size < 22) throw new Error(`文件太小（${stat.size} 字节），不是有效的 zip 归档`)
    const tailLen = Math.min(stat.size, MAX_COMMENT + 22)
    const tail = Buffer.alloc(tailLen)
    await readFully(fh, tail, stat.size - tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error('找不到 zip 中央目录尾部（EOCD），文件可能被截断')
    const entryCount = tail.readUInt16LE(eocd + 10)
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
      throw new Error('暂不支持 ZIP64 归档')
    }
    if (cdOffset + cdSize > stat.size) throw new Error('zip 中央目录越界，文件可能损坏')
    const cd = Buffer.alloc(cdSize)
    await readFully(fh, cd, cdOffset)
    const entries = []
    let p = 0
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === CD_SIG) {
      const flags = cd.readUInt16LE(p + 8)
      const method = cd.readUInt16LE(p + 10)
      const compressedSize = cd.readUInt32LE(p + 20)
      const uncompressedSize = cd.readUInt32LE(p + 24)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const localOffset = cd.readUInt32LE(p + 42)
      const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), flags)
      entries.push({
        path: name,
        size: uncompressedSize,
        isDir: name.endsWith('/'),
        compressedSize,
        method,
        flags,
        localOffset,
      })
      p += 46 + nameLen + extraLen + commentLen
    }
    const map = new Map(entries.map((entry) => [entry.path, entry]))
    return {
      path: filePath,
      format: 'zip',
      size: stat.size,
      entries,
      map,
      async read(entry) {
        if (entry.isDir) throw new Error(`条目是目录，没有内容：${entry.path}`)
        if (entry.flags & 0x1) throw new Error(`条目已加密，无法读取：${entry.path}`)
        const lfh = Buffer.alloc(30)
        await readFully(fh, lfh, entry.localOffset)
        if (lfh.readUInt32LE(0) !== LFH_SIG) throw new Error(`zip 本地文件头签名不符：${entry.path}`)
        const nameLen = lfh.readUInt16LE(26)
        const extraLen = lfh.readUInt16LE(28)
        const dataStart = entry.localOffset + 30 + nameLen + extraLen
        if (dataStart + entry.compressedSize > stat.size) {
          throw new Error(`条目数据越界，文件可能损坏：${entry.path}`)
        }
        const raw = Buffer.alloc(entry.compressedSize)
        await readFully(fh, raw, dataStart)
        if (entry.method === 0) return raw
        if (entry.method === 8) return zlib.inflateRawSync(raw)
        throw new Error(`不支持的压缩方法 ${entry.method}：${entry.path}`)
      },
      async close() {
        await fh.close()
      },
    }
  } catch (error) {
    await fh.close().catch(() => {})
    throw error
  }
}
