// dsh-plugin-archive-reader — 文本判定与截断

const SNIFF_BYTES = 8192

/** 开头出现 NUL 字节即视为二进制（够用且不误伤普通文本/JSON/JS）。 */
export function looksBinary(buf) {
  const n = Math.min(buf.length, SNIFF_BYTES)
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

/** 按 UTF-8 解码并去掉 BOM。 */
export function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString('utf8', 3)
  }
  return buf.toString('utf8')
}

/** 截断到 maxBytes；可能切在多字节字符中间，解码后会出现替换字符。 */
export function truncateBuffer(buf, maxBytes) {
  if (buf.length <= maxBytes) return { buf, truncated: false }
  return { buf: buf.subarray(0, maxBytes), truncated: true }
}

/** pattern 先按不区分大小写的正则解释，解析不了就退回子串匹配。 */
export function compileMatcher(pattern) {
  if (pattern === undefined || pattern === null || pattern === '') return null
  const text = String(pattern)
  try {
    const re = new RegExp(text, 'i')
    return {
      kind: 'regex',
      source: text,
      test(value) {
        re.lastIndex = 0
        return re.test(value)
      },
    }
  } catch {
    const needle = text.toLowerCase()
    return {
      kind: 'substring',
      source: text,
      test: (value) => value.toLowerCase().includes(needle),
    }
  }
}

/** 在文本里找匹配行（用于 archive_grep），行号从 1 开始。 */
export function matchLines(text, matcher, remaining, maxLineChars) {
  const out = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length && out.length < remaining; i++) {
    if (!matcher.test(lines[i])) continue
    const line = lines[i].length > maxLineChars ? `${lines[i].slice(0, maxLineChars)}…` : lines[i]
    out.push({ line: i + 1, text: line.trim() })
  }
  return out
}
