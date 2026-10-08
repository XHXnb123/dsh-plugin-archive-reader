// dsh-plugin-archive-reader — archive_grep 工具

import { openArchive } from '../lib/archive.mjs'
import { formatBytes } from '../lib/io.mjs'
import { compileMatcher, decodeText, looksBinary, matchLines } from '../lib/text.mjs'

const DESCRIPTION = `在 asar / zip 归档的所有文本条目里按正则搜内容（只读，不写盘）。
这是"归档里哪个文件提到了 X"最快的一条路：不必先列上万条再逐个读。
二进制条目、超过 maxEntryBytes 的条目会被跳过；总扫描量有上限，触顶时在 stoppedEarly 里说明。`

export function registerArchiveGrepTool(ctx, cfg) {
  return ctx.tools.register({
    name: 'archive_grep',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '归档文件的绝对路径（.asar 或 .zip）' },
        pattern: {
          type: 'string',
          description: '要搜的内容：按不区分大小写的正则解释，解析失败时退回子串匹配',
        },
        maxMatches: {
          type: 'number',
          description: `最多返回多少行匹配（默认 ${cfg.maxMatches}，上限 ${cfg.hardMaxMatches}）`,
        },
        maxEntryBytes: {
          type: 'number',
          description: `跳过大于该字节数的条目（默认 ${cfg.maxEntryBytes}）`,
        },
        format: { type: 'string', description: '可选：强制按 asar 或 zip 解析，默认 auto' },
      },
      required: ['path', 'pattern'],
    },
    timeoutMs: cfg.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          format: { type: 'string' },
          pattern: { type: 'string' },
          matcherKind: { type: 'string' },
          filesScanned: { type: 'number' },
          filesSkipped: { type: 'number' },
          filesMatched: { type: 'number' },
          scannedBytes: { type: 'number' },
          truncated: { type: 'boolean' },
          stoppedEarly: { type: 'string' },
          matches: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                entry: { type: 'string' },
                line: { type: 'number' },
                text: { type: 'string' },
              },
              required: ['entry', 'line', 'text'],
            },
          },
        },
        required: [
          'path',
          'format',
          'pattern',
          'matcherKind',
          'filesScanned',
          'filesSkipped',
          'filesMatched',
          'scannedBytes',
          'truncated',
          'stoppedEarly',
          'matches',
        ],
      },
      render: (_args, value) => [{ type: 'text', text: renderGrep(value) }],
    },
    async execute(args) {
      const filePath = requireText(args.path, 'path')
      const rawPattern = requireText(args.pattern, 'pattern')
      const maxMatches = clampInt(args.maxMatches, cfg.maxMatches, 1, cfg.hardMaxMatches)
      const maxEntryBytes = clampInt(args.maxEntryBytes, cfg.maxEntryBytes, 1024, cfg.maxScanBytes)
      const matcher = compileMatcher(rawPattern)
      const handle = await openArchive(filePath, args.format ?? 'auto')
      const matches = []
      let filesScanned = 0
      let filesSkipped = 0
      let filesMatched = 0
      let scannedBytes = 0
      let truncated = false
      let stoppedEarly = ''
      try {
        for (const entry of handle.entries) {
          if (entry.isDir) continue
          if (entry.size > maxEntryBytes) {
            filesSkipped++
            continue
          }
          if (scannedBytes + entry.size > cfg.maxScanBytes) {
            stoppedEarly = `扫描预算用尽（${formatBytes(cfg.maxScanBytes)}）`
            break
          }
          const buf = await handle.read(entry)
          scannedBytes += buf.length
          filesScanned++
          if (looksBinary(buf)) {
            filesSkipped++
            continue
          }
          const found = matchLines(decodeText(buf), matcher, maxMatches - matches.length, cfg.maxLineChars)
          if (found.length === 0) continue
          filesMatched++
          for (const hit of found) matches.push({ entry: entry.path, line: hit.line, text: hit.text })
          if (matches.length >= maxMatches) {
            truncated = true
            stoppedEarly = stoppedEarly || `匹配数达到上限（${maxMatches}）`
            break
          }
        }
        return {
          path: handle.path,
          format: handle.format,
          pattern: rawPattern,
          matcherKind: matcher.kind,
          filesScanned,
          filesSkipped,
          filesMatched,
          scannedBytes,
          truncated,
          stoppedEarly,
          matches,
        }
      } finally {
        await handle.close()
      }
    },
  })
}

function requireText(value, field) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`archive_grep: ${field} 不能为空`)
  return text
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function renderGrep(value) {
  const head = `${value.path}（${value.format}）搜 ${JSON.stringify(value.pattern)}（${value.matcherKind}）：扫描 ${value.filesScanned} 个文本条目（跳过 ${value.filesSkipped}），命中 ${value.filesMatched} 个文件，共 ${value.matches.length} 行${value.stoppedEarly ? `；提前停止：${value.stoppedEarly}` : ''}。`
  if (value.matches.length === 0) return `${head}\n没有匹配。`
  const body = value.matches
    .map((hit) => `${hit.entry}:${hit.line}: ${hit.text}`)
    .join('\n')
  return `${head}\n${body}`
}
