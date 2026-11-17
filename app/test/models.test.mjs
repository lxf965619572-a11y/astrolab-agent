// 模型配置：部门默认 + 自定义模型；密钥加密存放、不回到界面；在用的模型覆盖引擎的 DEPT_LLM_*；部门可以锁定
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelStore, normalize } from '../main/models.mjs'

const fakeCrypto = { available: () => true, encrypt: (s) => Buffer.from('enc:' + s).toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString().slice(4) }
const mk = (dept = {}, crypto = fakeCrypto) => {
  const file = join(mkdtempSync(join(tmpdir(), 'astro-models-')), 'models.json')
  return { file, store: new ModelStore({ file, deptEnv: () => dept, crypto }) }
}
const qwen = { name: '局域网 Qwen', baseURL: 'http://192.168.10.20:8000/v1/', model: 'qwen3.8-27b', thinkingFormat: 'qwen-chat-template', contextWindow: 131072, maxTokens: 32768, input: 'text', key: 'sk-secret-123' }

test('默认只有部门模型（照 local.env），不覆盖引擎环境', () => {
  const { store } = mk({ DEPT_LLM_MODEL: 'deepseek-v4', DEPT_LLM_BASE_URL: 'http://10.0.0.10:8000/v1', DEPT_LLM_API_KEY: 'x' })
  const l = store.list()
  assert.equal(l.active, 'dept')
  assert.equal(l.models.length, 1)
  assert.equal(l.models[0].model, 'deepseek-v4')
  assert.equal(l.models[0].hasKey, true)
  assert.deepEqual(store.envOverrides(), {})
  assert.equal(l.presets.length, 4)
})

test('加自定义模型、切换：引擎环境换成它；密钥加密存、界面上看不到', () => {
  const { store, file } = mk()
  const id = store.upsert(qwen)
  assert.equal(store.activeId(), 'dept')
  assert.equal(store.activate(id), true)
  const env = store.envOverrides()
  assert.equal(env.DEPT_LLM_BASE_URL, 'http://192.168.10.20:8000/v1')
  assert.equal(env.DEPT_LLM_MODEL, 'qwen3.8-27b')
  assert.equal(env.DEPT_LLM_API_KEY, 'sk-secret-123')
  assert.equal(env.DEPT_LLM_THINKING_FORMAT, 'qwen-chat-template')
  assert.equal(env.DEPT_LLM_CONTEXT_WINDOW, '131072')
  const raw = readFileSync(file, 'utf8')
  assert.ok(!raw.includes('sk-secret-123'), '文件里不是明文')
  assert.ok(!JSON.stringify(store.list()).includes('secret'), '界面拿不到密钥')
  assert.equal(store.list().models.find((m) => m.id === id).hasKey, true)
  // 重新读文件：还在、还是在用
  const again = new ModelStore({ file, deptEnv: () => ({}), crypto: fakeCrypto })
  assert.equal(again.activeId(), id)
  assert.equal(again.envOverrides().DEPT_LLM_API_KEY, 'sk-secret-123')
})

test('修改时密钥留空不改、null 清除；删除在用的回到部门默认', () => {
  const { store } = mk()
  const id = store.upsert(qwen)
  store.activate(id)
  store.upsert({ ...qwen, id, name: '局域网 Qwen（新）', key: '' })
  assert.equal(store.connection(id).apiKey, 'sk-secret-123')
  assert.equal(store.list().models[1].name, '局域网 Qwen（新）')
  store.upsert({ ...qwen, id, key: null })
  assert.equal(store.envOverrides().DEPT_LLM_API_KEY, 'EMPTY')
  store.remove(id)
  assert.equal(store.activeId(), 'dept')
  assert.deepEqual(store.envOverrides(), {})
})

test('没有加密能力时明文存（和 local.env 一样）；不思考的模型引擎用 off', () => {
  const { store, file } = mk({}, { available: () => false })
  const id = store.upsert({ ...qwen, thinkingFormat: 'off' })
  store.activate(id)
  assert.ok(readFileSync(file, 'utf8').includes('"plain"'))
  assert.equal(store.envOverrides().ASTROLAB_REASONING, 'off')
})

test('表单检查：地址、模型名、重名、上下文和输出上限', () => {
  assert.throws(() => normalize({ ...qwen, baseURL: '192.168.1.5:8000' }), /http/)
  assert.throws(() => normalize({ ...qwen, model: '' }), /模型名/)
  assert.throws(() => normalize({ ...qwen, maxTokens: 200000 }), /小于上下文/)
  const { store } = mk()
  store.upsert(qwen)
  assert.throws(() => store.upsert(qwen), /已经有/)
  assert.throws(() => store.upsert({ ...qwen, id: 'dept' }), /local.env/)
})

test('部门锁定：只能用部门默认，不能加、不能切', () => {
  const env = { ASTROLAB_MODEL_LOCK: '0' }
  const file = join(mkdtempSync(join(tmpdir(), 'astro-models-')), 'models.json')
  const store = new ModelStore({ file, deptEnv: () => env, crypto: fakeCrypto })
  const id = store.upsert(qwen); store.activate(id)
  env.ASTROLAB_MODEL_LOCK = '1'
  assert.equal(store.activeId(), 'dept')
  assert.deepEqual(store.envOverrides(), {})
  assert.equal(store.list().locked, true)
  assert.throws(() => store.upsert({ ...qwen, name: 'x' }), /锁定/)
  assert.throws(() => store.activate(id), /锁定/)
})
