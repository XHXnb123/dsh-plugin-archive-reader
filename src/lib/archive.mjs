// dsh-plugin-archive-reader — 统一入口：探测格式、给出统一句柄
//
// 句柄形状：{ path, format, size, entries, find, read, close }
// entries: [{ path, size, isDir }]，read(entryName) 返回 Buffer。调用方必须在
// finally 里 close()，否则文件句柄会一直占着。

import fs from 'node:fs'
import { openAsar, isAsarHeader } from './asar.mjs'
import { openZip, isZipMagic } from './zip.mjs'

export const SUPPORTED_FORMATS = ['asar', 'zip']

/** 打开归档；format 传 'auto'（默认）时按文件头探测。 */
export async function openArchive(filePath, format = 'auto') {
  const stat = await fs.promises.stat(filePath).catch((error) => {
    if (error.code === 'ENOENT') throw new Error(`归档不存在：${filePath}`)
    throw error
  })
  if (!stat.isFile()) throw new Error(`不是普通文件：${filePath}`)
  if (stat.size < 16) throw new Error(`文件太小（${stat.size} 字节），不是有效的归档：${filePath}`)

  let kind = String(format || 'auto').toLowerCase()
  if (kind === 'auto') {
    const fh = await fs.promises.open(filePath, 'r')
    try {
      const head = Buffer.alloc(16)
      const { bytesRead } = await fh.read(head, 0, 16, 0)
      if (bytesRead < 16) throw new Error(`文件太小（${bytesRead} 字节），不是有效的归档：${filePath}`)
      if (isZipMagic(head)) kind = 'zip'
      else if (isAsarHeader(head)) kind = 'asar'
      else {
        throw new Error(
          `无法识别的归档格式：${filePath}（支持 asar 与 zip；tar/gz/7z/rar 不在支持范围）`,
        )
      }
    } finally {
      await fh.close().catch(() => {})
    }
  }
  if (!SUPPORTED_FORMATS.includes(kind)) {
    throw new Error(`未知格式 "${format}"，可选：${SUPPORTED_FORMATS.join(' / ')} / auto`)
  }

  const handle = kind === 'zip' ? await openZip(filePath) : await openAsar(filePath)

  /** 精确命中 → 忽略大小写命中 → 报错并给出近似候选。 */
  function findEntry(entryPath) {
    const wanted = String(entryPath ?? '')
    if (!wanted) throw new Error('entry 不能为空')
    const exact = handle.map.get(wanted)
    if (exact) return exact
    const lower = wanted.toLowerCase()
    const insensitive = handle.entries.find((entry) => entry.path.toLowerCase() === lower)
    if (insensitive) return insensitive
    const tail = lower.split('/').filter(Boolean).pop() ?? lower
    const near = handle.entries
      .filter((entry) => entry.path.toLowerCase().includes(tail))
      .slice(0, 5)
      .map((entry) => entry.path)
    const hint = near.length ? `；相近条目：${near.join('、')}` : ''
    throw new Error(`归档里没有条目：${wanted}${hint}`)
  }

  return {
    path: handle.path,
    format: handle.format,
    size: handle.size,
    entries: handle.entries,
    find: findEntry,
    async read(entryOrName) {
      const entry = typeof entryOrName === 'string' ? findEntry(entryOrName) : entryOrName
      return handle.read(entry)
    },
    async close() {
      await handle.close()
    },
  }
}
