// dsh-plugin-archive-reader — archive_list 工具

import { openArchive } from '../lib/archive.mjs'
import { formatBytes } from '../lib/io.mjs'
import { compileMatcher } from '../lib/text.mjs'

const DESCRIPTION = `列出 asar / zip 归档内部的条目（只读，不写盘）。
大归档动辄上万条，先用 pattern 过滤再取；返回的 path 可直接交给 archive_read。
支持 .asar（Electron 打包格式）与 .zip；ZIP64、加密条目、tar/gz/7z 不支持。`

export function registerArchiveListTool(ctx, cfg) {
  return ctx.tools.register({
    name: 'archive_list',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '归档文件的绝对路径（.asar 或 .zip）' },
        pattern: {
          type: 'string',
          description: '可选过滤：按不区分大小写的正则匹配条目路径，正则解析失败时退回子串匹配',
        },
        limit: {
          type: 'number',
          description: `最多返回条目数（默认 ${cfg.maxEntries}，上限 ${cfg.hardMaxEntries}）`,
        },
        format: {
          type: 'string',
          description: '可选：强制按 asar 或 zip 解析，默认 auto 按文件头探测',
        },
      },
      required: ['path'],
    },
    timeoutMs: cfg.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          format: { type: 'string' },
          archiveBytes: { type: 'number' },
          matcherKind: { type: 'string' },
          totalEntries: { type: 'number' },
          matched: { type: 'number' },
          returned: { type: 'number' },
          truncated: { type: 'boolean' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                size: { type: 'number' },
                isDir: { type: 'boolean' },
              },
              required: ['path', 'size', 'isDir'],
            },
          },
        },
        required: [
          'path',
          'format',
          'archiveBytes',
          'matcherKind',
          'totalEntries',
          'matched',
          'returned',
          'truncated',
          'entries',
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderList(value) }],
    },
    async execute(args) {
      const filePath = requirePath(args.path)
      const limit = clampInt(args.limit, cfg.maxEntries, 1, cfg.hardMaxEntries)
      const handle = await openArchive(filePath, args.format ?? 'auto')
      try {
        const matcher = compileMatcher(args.pattern)
        const matched = handle.entries
          .filter((entry) => !matcher || matcher.test(entry.path))
          .slice()
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        const shown = matched.slice(0, limit)
        return {
          path: handle.path,
          format: handle.format,
          archiveBytes: handle.size,
          matcherKind: matcher ? matcher.kind : 'none',
          totalEntries: handle.entries.length,
          matched: matched.length,
          returned: shown.length,
          truncated: matched.length > shown.length,
          entries: shown.map((entry) => ({
            path: entry.path,
            size: entry.size,
            isDir: entry.isDir === true,
          })),
        }
      } finally {
        await handle.close()
      }
    },
  })
}

function requirePath(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error('archive_list: path 不能为空')
  return text
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function renderList(value) {
  if (value.totalEntries === 0) {
    return `${value.path}（${value.format}）里没有条目。`
  }
  if (value.matched === 0) {
    return `${value.path}（${value.format}，共 ${value.totalEntries} 条）没有匹配的条目。`
  }
  const head = `${value.path}（${value.format}，归档 ${formatBytes(value.archiveBytes)}，共 ${value.totalEntries} 条，匹配 ${value.matched} 条，展示 ${value.returned} 条${value.truncated ? '，其余未展示' : ''}）：`
  const body = value.entries
    .map((entry) => `${entry.isDir ? 'dir ' : String(entry.size).padStart(10, ' ')}  ${entry.path}`)
    .join('\n')
  return `${head}\n${body}`
}
