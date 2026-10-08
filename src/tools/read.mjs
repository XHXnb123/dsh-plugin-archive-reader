// dsh-plugin-archive-reader — archive_read 工具

import { openArchive } from '../lib/archive.mjs'
import { formatBytes } from '../lib/io.mjs'
import { decodeText, looksBinary, truncateBuffer } from '../lib/text.mjs'

const DESCRIPTION = `读取 asar / zip 归档里单个条目的内容（只读，不写盘）。
默认按 UTF-8 文本返回，超过 maxBytes 会截断；二进制条目只报告大小与 binary 标记，不返回内容。
entry 用 archive_list 给出的 path，必须精确匹配（也接受忽略大小写的完全一致）。`

export function registerArchiveReadTool(ctx, cfg) {
  return ctx.tools.register({
    name: 'archive_read',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '归档文件的绝对路径（.asar 或 .zip）' },
        entry: { type: 'string', description: '条目路径，来自 archive_list 的结果' },
        maxBytes: {
          type: 'number',
          description: `最多返回的字节数（默认 ${cfg.maxReadBytes}，上限 ${cfg.hardMaxReadBytes}）`,
        },
        format: { type: 'string', description: '可选：强制按 asar 或 zip 解析，默认 auto' },
      },
      required: ['path', 'entry'],
    },
    timeoutMs: cfg.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          entry: { type: 'string' },
          format: { type: 'string' },
          size: { type: 'number' },
          returnedBytes: { type: 'number' },
          truncated: { type: 'boolean' },
          binary: { type: 'boolean' },
          text: { type: 'string' },
        },
        required: [
          'path',
          'entry',
          'format',
          'size',
          'returnedBytes',
          'truncated',
          'binary',
          'text',
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderRead(value) }],
    },
    async execute(args) {
      const filePath = requireText(args.path, 'path')
      const entryName = requireText(args.entry, 'entry')
      const maxBytes = clampInt(args.maxBytes, cfg.maxReadBytes, 256, cfg.hardMaxReadBytes)
      const handle = await openArchive(filePath, args.format ?? 'auto')
      try {
        const entry = handle.find(entryName)
        const buf = await handle.read(entry)
        const binary = looksBinary(buf)
        const { buf: sliced, truncated } = truncateBuffer(buf, maxBytes)
        return {
          path: handle.path,
          entry: entry.path,
          format: handle.format,
          size: buf.length,
          returnedBytes: sliced.length,
          truncated,
          binary,
          text: binary ? '' : decodeText(sliced),
        }
      } finally {
        await handle.close()
      }
    },
  })
}

function requireText(value, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`archive_read: ${field} 不能为空`)
  return text
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function renderRead(value) {
  const head = `${value.path}（${value.format}）:: ${value.entry} —— ${formatBytes(value.size)}${value.truncated ? `，已截断到 ${formatBytes(value.returnedBytes)}` : ''}`
  if (value.binary) return `${head}\n（二进制内容，未返回文本）`
  if (value.size === 0) return `${head}\n（空条目）`
  return `${head}\n${value.text}`
}
