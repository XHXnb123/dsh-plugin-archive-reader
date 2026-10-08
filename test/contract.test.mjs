// 工具声明的结构自检：注册前就能发现的下限问题
//
// 说明：Harness 的 register() 会用自己的 assertSupportedJsonSchema 校验 output.schema
// （开发时已用该断言逐条验过），但本仓库不引入任何 Harness 包，所以这里做等价的
// 结构自检：object 节点必须显式声明 additionalProperties，required 必须是已声明属性。

import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.mjs'

function makeCtx() {
  const tools = new Map()
  return {
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
    effect(fn) { return fn() },
    toolsMap: tools,
  }
}

function checkNode(node, path) {
  assert.equal(typeof node, 'object', `${path} 必须是对象`)
  if (node.type === 'object') {
    assert.equal(
      typeof node.additionalProperties,
      'boolean',
      `${path}.additionalProperties 必须显式声明 true/false`,
    )
    const props = node.properties ?? {}
    for (const name of node.required ?? []) {
      assert.ok(Object.hasOwn(props, name), `${path}.required 里的 ${name} 未在 properties 中声明`)
    }
  }
  if (node.type === 'array') {
    assert.ok(node.items, `${path}.items 缺失`)
    checkNode(node.items, `${path}.items`)
  }
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    checkNode(child, `${path}.properties.${name}`)
  }
}

test('三个工具的 output.schema 结构自检', () => {
  const ctx = makeCtx()
  apply(ctx, {})
  assert.equal(ctx.toolsMap.size, 3)
  for (const [name, definition] of ctx.toolsMap) {
    checkNode(definition.output.schema, `${name}.output.schema`)
    assert.equal(typeof definition.output.render, 'function', `${name} 缺少 render`)
    assert.ok(definition.timeoutMs > 0, `${name} timeoutMs 必须为正`)
    // parameters 是注册表消费的原始 JSON Schema：对象根 + 属性表 + required 数组
    assert.equal(definition.parameters.type, 'object', `${name}.parameters 必须是对象根`)
    assert.ok(definition.parameters.properties, `${name}.parameters.properties 缺失`)
    for (const required of definition.parameters.required ?? []) {
      assert.ok(
        Object.hasOwn(definition.parameters.properties, required),
        `${name}.parameters.required 里的 ${required} 未声明`,
      )
    }
    for (const [field, spec] of Object.entries(definition.parameters.properties)) {
      assert.ok(typeof spec.type === 'string', `${name}.parameters.${field} 缺少 type`)
      assert.equal(spec.required, undefined, `${name}.parameters.${field} 的 required 应提升到根数组`)
    }
  }
})

test('config 覆盖被硬上限夹住', () => {
  const ctx = makeCtx()
  apply(ctx, { maxEntries: 99999, hardMaxEntries: 999999, maxReadBytes: 1, timeoutMs: -5 })
  const list = ctx.toolsMap.get('archive_list')
  const read = ctx.toolsMap.get('archive_read')
  // maxEntries/hardMaxEntries 都被 50000 封顶；maxReadBytes 抬到 256 下限；timeoutMs 抬到 1000 下限
  assert.match(list.parameters.properties.limit.description, /默认 50000，上限 50000/)
  assert.match(read.parameters.properties.maxBytes.description, /默认 256，上限 1048576/)
  assert.equal(list.timeoutMs, 1000)
})
