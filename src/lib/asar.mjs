// dsh-plugin-archive-reader — asar 归档读取（Electron 打包格式）
//
// 布局：8 字节 Pickle 前缀（u32=4 的长度域 + u32=头部字节数），随后是指定为
// headerSize 的头部 Pickle（u32=字符串长度 + UTF-8 JSON 文件树），文件数据从
// 8 + headerSize 开始，树里每个文件带相对偏移。标记 unpacked 的条目内容不在
// 归档里，而在同目录的 <归档名>.unpacked/ 下。

import fs from 'node:fs'
import { readFully } from './io.mjs'

const MAX_HEADER_BYTES = 64 * 1024 * 1024

/** 只靠开头 16 字节判断是不是 asar（格式探测用，不打开句柄）。 */
export function isAsarHeader(head) {
  if (!head || head.length < 16) return false
  if (head.readUInt32LE(0) !== 4) return false
  const headerSize = head.readUInt32LE(4)
  return headerSize >= 8 && headerSize <= MAX_HEADER_BYTES
}

function flatten(tree) {
  const entries = []
  const walk = (node, prefix) => {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const entryPath = prefix ? `${prefix}/${name}` : name
      if (value.files) {
        walk(value, entryPath)
        continue
      }
      entries.push({
        path: entryPath,
        size: Number(value.size ?? 0),
        isDir: false,
        unpacked: value.unpacked === true,
        offset: Number(value.offset ?? -1),
      })
    }
  }
  walk(tree, '')
  return entries
}

/** 打开 asar，返回 { path, size, entries, map, read, close }。 */
export async function openAsar(filePath) {
  const fh = await fs.promises.open(filePath, 'r')
  try {
    const stat = await fh.stat()
    const head = Buffer.alloc(16)
    const { bytesRead } = await fh.read(head, 0, 16, 0)
    if (bytesRead < 16) throw new Error(`文件太小（${stat.size} 字节），不是有效的 asar 归档`)
    if (!isAsarHeader(head)) throw new Error('asar 头部不是预期的 Pickle 结构')
    const headerSize = head.readUInt32LE(4)
    const headerBuf = Buffer.alloc(headerSize)
    await readFully(fh, headerBuf, 8)
    const jsonLen = headerBuf.readUInt32LE(4)
    if (jsonLen <= 0 || 8 + jsonLen > headerBuf.length) {
      throw new Error(`asar 头部 JSON 长度异常：${jsonLen}`)
    }
    let tree
    try {
      tree = JSON.parse(headerBuf.toString('utf8', 8, 8 + jsonLen))
    } catch (error) {
      throw new Error(`asar 头部 JSON 解析失败：${error.message}`)
    }
    const entries = flatten(tree)
    const map = new Map(entries.map((entry) => [entry.path, entry]))
    const dataStart = 8 + headerSize
    const unpackedRoot = `${filePath}.unpacked`
    return {
      path: filePath,
      format: 'asar',
      size: stat.size,
      entries,
      map,
      async read(entry) {
        if (entry.unpacked) {
          const diskPath = `${unpackedRoot}/${entry.path}`
          try {
            return await fs.promises.readFile(diskPath)
          } catch (error) {
            throw new Error(`该条目标记为 unpacked，但读取 ${diskPath} 失败：${error.message}`)
          }
        }
        if (!Number.isInteger(entry.offset) || entry.offset < 0) {
          throw new Error(`条目缺少有效偏移：${entry.path}`)
        }
        const buf = Buffer.alloc(entry.size)
        await readFully(fh, buf, dataStart + entry.offset)
        return buf
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
