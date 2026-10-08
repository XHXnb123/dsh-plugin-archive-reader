#!/usr/bin/env node
// 一键自检：跑完这个仓库的全部测试，用人话报告结果。
//
// 这个文件是给"不想看代码"的人准备的：只管最后那几行结论。
// 所有中文都在这个 .mjs 里（Node 按 UTF-8 正确读取），
// 外层 verify.bat 保持纯 ASCII，避免 Windows 控制台代码页把中文弄乱。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'test/asar.test.mjs',
  'test/zip.test.mjs',
  'test/plugin.test.mjs',
  'test/contract.test.mjs',
]

const line = '='.repeat(52)
console.log('')
console.log(line)
console.log('  归档读取插件 · 本地自检')
console.log(line)
console.log('')

const missing = files.filter((file) => !fs.existsSync(path.join(root, file)))
if (missing.length > 0) {
  console.log('❌ 仓库不完整，缺少这些测试文件：')
  for (const file of missing) console.log(`   - ${file}`)
  console.log('')
  console.log('请重新克隆仓库后再试。')
  process.exit(1)
}

console.log(`正在运行 ${files.length} 个测试文件，请稍候（通常不到 2 秒）……`)
console.log('')

const started = Date.now()
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

// 兼容两种报告格式：默认的 "ℹ pass 17" 与 TAP 的 "# pass 17"
function count(label) {
  const match = output.match(new RegExp(`(?:ℹ|#)\\s*${label}\\s+(\\d+)`))
  return match ? Number(match[1]) : null
}

const tests = count('tests')
const pass = count('pass')
const fail = count('fail')
const skipped = count('skipped') ?? 0
const seconds = ((Date.now() - started) / 1000).toFixed(1)

if (tests === null || pass === null) {
  console.log('⚠️  没能读懂测试结果，原始输出如下：')
  console.log('')
  console.log(output.trim())
  process.exit(1)
}

console.log(line)
console.log(`  测试项 ${tests}    通过 ${pass}    失败 ${fail ?? '未知'}    跳过 ${skipped}    用时 ${seconds} 秒`)
console.log(line)
console.log('')

if ((fail ?? 1) === 0) {
  console.log('✅ 结论：全部通过。')
  if (skipped > 0) {
    console.log(`   （跳过的 ${skipped} 项需要本机存在样本文件，比如 DeepSeek Harness 自带的 app.asar；`)
    console.log('     没有样本时跳过属于正常，不代表失败。）')
  }
} else {
  console.log('❌ 结论：有测试没通过。上面的英文细节已存到 verify-output.txt。')
  try {
    fs.writeFileSync(path.join(root, 'verify-output.txt'), output, 'utf8')
    console.log('   把 verify-output.txt 交给帮你写代码的 AI，它能直接定位问题。')
  } catch {
    console.log('   （原始输出写入失败，请把窗口里的英文内容复制出来。）')
  }
}

console.log('')
process.exit((fail ?? 1) === 0 ? 0 : 1)
