// zip 读取路径：用测试内构造的 zip（store + deflate + 中文名 + 目录条目）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openArchive } from '../src/lib/archive.mjs'
import { buildZip } from './zip-fixture.mjs'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-reader-'))
const zipPath = path.join(tmpDir, 'sample.zip')

fs.writeFileSync(
  zipPath,
  buildZip([
    { name: 'readme.txt', data: 'hello archive reader\n第二行内容\n', method: 0 },
    { name: 'nested/data.json', data: JSON.stringify({ hello: '世界', n: 42 }), method: 8 },
    { name: '中文目录/笔记.md', data: '# 标题\n\n正文\n', method: 8 },
    { name: 'emptydir/', data: '', method: 0 },
  ]),
)

test('zip：探测格式并列出全部条目', async () => {
  const archive = await openArchive(zipPath)
  try {
    assert.equal(archive.format, 'zip')
    assert.equal(archive.entries.length, 4)
    assert.equal(archive.find('emptydir/').isDir, true)
  } finally {
    await archive.close()
  }
})

test('zip：读 store 条目', async () => {
  const archive = await openArchive(zipPath)
  try {
    const text = (await archive.read('readme.txt')).toString('utf8')
    assert.match(text, /hello archive reader/)
    assert.match(text, /第二行内容/)
  } finally {
    await archive.close()
  }
})

test('zip：读 deflate 条目（含中文路径）', async () => {
  const archive = await openArchive(zipPath)
  try {
    const json = JSON.parse((await archive.read('nested/data.json')).toString('utf8'))
    assert.deepEqual(json, { hello: '世界', n: 42 })
    const note = (await archive.read('中文目录/笔记.md')).toString('utf8')
    assert.match(note, /# 标题/)
  } finally {
    await archive.close()
  }
})

test('zip：目录条目读取报错，缺失条目给出候选', async () => {
  const archive = await openArchive(zipPath)
  try {
    await assert.rejects(() => archive.read('emptydir/'), /目录/)
    assert.throws(() => archive.find('data.json'), /相近条目/)
  } finally {
    await archive.close()
  }
})

test('错误路径：文件不存在 / 不是归档 / 未知格式', async () => {
  await assert.rejects(() => openArchive(path.join(tmpDir, 'nope.zip')), /归档不存在/)
  const textPath = path.join(tmpDir, 'plain.txt')
  fs.writeFileSync(textPath, 'this is definitely not an archive, just plain text')
  await assert.rejects(() => openArchive(textPath), /无法识别的归档格式/)
  await assert.rejects(() => openArchive(zipPath, 'rar'), /未知格式/)
})
