// dsh-plugin-archive-reader — 插件入口
//
// 契约：export name / inject / apply(ctx, config)。
// 三个工具全部只读：只打开归档、只读条目，从不写盘，也不改任何 profile 状态。

import { registerArchiveListTool } from './tools/list.mjs'
import { registerArchiveReadTool } from './tools/read.mjs'
import { registerArchiveGrepTool } from './tools/grep.mjs'

export const name = 'dsh-plugin-archive-reader'
export const inject = ['tools']

/** 默认上限；都可在 cordis.patch.yml 的 config 里覆盖（会被硬上限夹住）。 */
const DEFAULTS = {
  maxEntries: 200,
  hardMaxEntries: 5000,
  maxReadBytes: 65536,
  hardMaxReadBytes: 1048576,
  maxMatches: 50,
  hardMaxMatches: 500,
  maxEntryBytes: 4 * 1024 * 1024,
  maxScanBytes: 64 * 1024 * 1024,
  maxLineChars: 400,
  timeoutMs: 30000,
}

const HARD = {
  maxEntries: [1, 50000],
  maxReadBytes: [256, 16 * 1024 * 1024],
  maxMatches: [1, 5000],
  maxEntryBytes: [1024, 512 * 1024 * 1024],
  maxScanBytes: [1024, 4 * 1024 * 1024 * 1024],
  maxLineChars: [80, 4000],
  timeoutMs: [1000, 600000],
}

/** 单次调用的绝对上限；config 可以调低、不能调高于常量封顶。 */
const CEILINGS = {
  hardMaxEntries: 50000,
  hardMaxReadBytes: 16 * 1024 * 1024,
  hardMaxMatches: 5000,
}

function clampNumber(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function normalizeConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const cfg = { ...DEFAULTS }
  for (const [key, value] of Object.entries(source)) {
    if (typeof DEFAULTS[key] !== 'number' || key.startsWith('hard')) continue
    const bounds = HARD[key]
    cfg[key] = bounds ? clampNumber(value, bounds[0], bounds[1]) : clampNumber(value, 0, Number.MAX_SAFE_INTEGER)
  }
  for (const [key, ceiling] of Object.entries(CEILINGS)) {
    cfg[key] = source[key] === undefined ? DEFAULTS[key] : clampNumber(source[key], 1, ceiling)
    // 默认上限不能超过 hard 上限
    const soft = key.replace('hard', '')
    const softKey = soft.charAt(0).toLowerCase() + soft.slice(1) // hardMaxEntries -> maxEntries
    cfg[softKey] = Math.min(cfg[softKey], cfg[key])
  }
  // 单条目上限不得超过总扫描预算，否则 grep 的预算判断形同虚设
  cfg.maxEntryBytes = Math.min(cfg.maxEntryBytes, cfg.maxScanBytes)
  return cfg
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  if (!ctx?.tools || typeof ctx.tools.register !== 'function') return

  const disposers = [
    registerArchiveListTool(ctx, cfg),
    registerArchiveReadTool(ctx, cfg),
    registerArchiveGrepTool(ctx, cfg),
  ]

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        /* 清理失败不阻塞其余清理 */
      }
    }
  })
}
