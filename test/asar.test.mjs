// asar 读取路径：用本机真实的 app.asar 做样本
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { openArchive, SUPPORTED_FORMATS } from '../src/lib/archive.mjs'
import { ASAR_PATH } from './paths.mjs'

const TARGET = 'dsh/node_modules/@deepseek-ai/dsh-plugin-manager/README.zh.md'

test('格式表覆盖 asar 与 zip', () => {
  assert.deepEqual(SUPPORTED_FORMATS, ['asar', 'zip'])
})

test('asar：列出条目、定位并读到已知文件', { skip: !fs.existsSync(ASAR_PATH) && `样本不存在：${ASAR_PATH}` }, async () => {
  const archive = await openArchive(ASAR_PATH)
  try {
    assert.equal(archive.format, 'asar')
    assert.ok(archive.entries.length > 10000, `条目数异常：${archive.entries.length}`)
    const entry = archive.find(TARGET)
    assert.equal(entry.path, TARGET)
    const buf = await archive.read(entry)
    assert.ok(buf.length > 1000, `条目过小：${buf.length}`)
    assert.match(buf.toString('utf8'), /版本兼容性与豁免/)
  } finally {
    await archive.close()
  }
})

test('asar：忽略大小写命中与近似候选报错', { skip: !fs.existsSync(ASAR_PATH) && `样本不存在：${ASAR_PATH}` }, async () => {
  const archive = await openArchive(ASAR_PATH)
  try {
    assert.equal(archive.find(TARGET.toUpperCase()).path, TARGET)
    assert.throws(() => archive.find('dsh-plugin-manager/README.zh.md'), /dsh-plugin-manager\/README\.zh\.md/)
    assert.throws(() => archive.find('不存在的条目-zzz'), /归档里没有条目/)
  } finally {
    await archive.close()
  }
})

test('asar：unpacked 条目从 <归档>.unpacked 读取', { skip: !fs.existsSync(ASAR_PATH) && `样本不存在：${ASAR_PATH}` }, async (t) => {
  const archive = await openArchive(ASAR_PATH)
  try {
    const unpacked = archive.entries.filter((entry) => entry.unpacked)
    if (unpacked.length === 0) {
      t.diagnostic('该 asar 没有 unpacked 条目，跳过')
      return
    }
    const buf = await archive.read(unpacked[0])
    assert.ok(buf.length > 0)
  } finally {
    await archive.close()
  }
})
