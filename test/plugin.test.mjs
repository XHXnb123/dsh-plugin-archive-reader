// 插件契约与端到端：用 stub ctx 加载真实插件入口，跑通三个工具的 execute
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, inject, name } from '../src/index.mjs'
import { ASAR_PATH } from './paths.mjs'
import { buildZip } from './zip-fixture.mjs'

function makeCtx() {
  const tools = new Map()
  const disposed = []
  const ctx = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    effect(fn) {
      const dispose = fn()
      disposed.push(dispose)
      return dispose
    },
  }
  return { ctx, tools, disposed }
}

function assertContract(toolName, definition, result) {
  assert.equal(typeof definition.description, 'string')
  assert.equal(definition.parameters.type, 'object')
  assert.equal(definition.output.schema.type, 'object')
  for (const key of definition.output.schema.required) {
    assert.ok(Object.hasOwn(result, key), `${toolName} 返回缺少必需的 ${key}`)
  }
  assert.ok(Array.isArray(definition.output.render({}, result)))
}

test('插件入口：name/inject 正确，注册三个工具并可清理', () => {
  assert.equal(name, 'dsh-plugin-archive-reader')
  assert.deepEqual(inject, ['tools'])
  const { ctx, tools, disposed } = makeCtx()
  apply(ctx, {})
  assert.deepEqual([...tools.keys()].sort(), ['archive_grep', 'archive_list', 'archive_read'])
  assert.equal(disposed.length, 1)
  disposed[0]()
  assert.equal(tools.size, 0)
})

test('缺少 tools 服务时不抛错', () => {
  assert.doesNotThrow(() => apply({}, {}))
  assert.doesNotThrow(() => apply(undefined, undefined))
})

test('archive_list / archive_read：真实 asar 端到端', { skip: !fs.existsSync(ASAR_PATH) && `样本不存在：${ASAR_PATH}` }, async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx, {})
  const list = tools.get('archive_list')
  const read = tools.get('archive_read')

  const listed = await list.execute({ path: ASAR_PATH, pattern: 'dsh-plugin-manager/README\\.zh\\.md$' })
  assertContract('archive_list', list, listed)
  assert.equal(listed.format, 'asar')
  assert.equal(listed.matched, 1)
  assert.equal(listed.entries[0].path, 'dsh/node_modules/@deepseek-ai/dsh-plugin-manager/README.zh.md')

  const readResult = await read.execute({ path: ASAR_PATH, entry: listed.entries[0].path, maxBytes: 2000 })
  assertContract('archive_read', read, readResult)
  assert.equal(readResult.binary, false)
  assert.equal(readResult.truncated, true)
  assert.ok(readResult.returnedBytes <= 2000)
})

test('archive_grep：在真实 asar 里搜到已知文本', { skip: !fs.existsSync(ASAR_PATH) && `样本不存在：${ASAR_PATH}` }, async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx, {})
  const grep = tools.get('archive_grep')
  const result = await grep.execute({
    path: ASAR_PATH,
    pattern: '版本兼容性与豁免',
    maxMatches: 5,
    maxEntryBytes: 2 * 1024 * 1024,
  })
  assertContract('archive_grep', grep, result)
  assert.equal(result.matcherKind, 'regex')
  assert.ok(result.matches.length > 0, '应至少命中一行')
  assert.match(result.matches[0].entry, /plugin-manager\/README\.zh\.md/)
})

test('archive_grep：二进制条目被跳过，子串回退可用', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-reader-plugin-'))
  const zipPath = path.join(tmpDir, 'grep.zip')
  fs.writeFileSync(
    zipPath,
    buildZip([
      { name: 'a.txt', data: 'needle here\nother line\n', method: 0 },
      { name: 'b.txt', data: 'nothing to see\n', method: 8 },
      { name: 'c.bin', data: Buffer.from([0, 1, 2, 0, 3, 4]), method: 0 },
    ]),
  )
  const { ctx, tools } = makeCtx()
  apply(ctx, {})
  const grep = tools.get('archive_grep')
  const result = await grep.execute({ path: zipPath, pattern: 'needle' })
  assertContract('archive_grep', grep, result)
  assert.equal(result.filesScanned, 3)
  assert.ok(result.filesSkipped >= 1, '二进制条目应计入跳过')
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].entry, 'a.txt')
  assert.equal(result.matches[0].line, 1)
})

test('archive_list：pattern 用非法正则时回退子串匹配', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-reader-plugin2-'))
  const zipPath = path.join(tmpDir, 'fallback.zip')
  fs.writeFileSync(
    zipPath,
    buildZip([
      { name: 'docs/guide.md', data: 'x', method: 0 },
      { name: 'src/index.mjs', data: 'y', method: 0 },
      { name: 'x(1).txt', data: 'z', method: 0 },
    ]),
  )
  const { ctx, tools } = makeCtx()
  apply(ctx, {})
  const list = tools.get('archive_list')
  // "x(1" 是未闭合分组，正则解析失败；按子串匹配则命中 x(1).txt
  const result = await list.execute({ path: zipPath, pattern: 'x(1' })
  assertContract('archive_list', list, result)
  assert.equal(result.matcherKind, 'substring')
  assert.deepEqual(result.entries.map((entry) => entry.path), ['x(1).txt'])
})
