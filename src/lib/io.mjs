// dsh-plugin-archive-reader — 文件句柄读取小工具
// fs 的 read 允许短读，凡是按偏移取整段内容的地方都必须循环读满。

/** 从 position 开始读满整个 buffer。读到文件结尾仍不足时抛错。 */
export async function readFully(fh, buffer, position) {
  let done = 0
  while (done < buffer.length) {
    const { bytesRead } = await fh.read(buffer, done, buffer.length - done, position + done)
    if (bytesRead === 0) throw new Error('读取归档时遇到意外的文件结尾')
    done += bytesRead
  }
  return buffer
}

/** 人类可读的字节数，用于工具返回文案。 */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return String(n)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
