// 模型探测：对着假的 vLLM（Qwen3.8-27B 的样子）逐项查，服务端和 local.env 没配好时给出对的提示
import test from 'node:test'
import assert from 'node:assert/strict'
import { applySuggest, familyOf, formatProbe, probeModel } from '../main/probe.mjs'
import { startFakeVllm } from './fake-vllm.mjs'

const qwenConf = { contextWindow: '131072', maxTokens: '32768', thinkingFormat: 'qwen-chat-template' }
const status = (r) => Object.fromEntries(r.checks.map((c) => [c.item, c.status]))

test('配好的 vLLM + Qwen3.8-27B：全部通过，没有要改的', async (t) => {
  const s = await startFakeVllm()
  t.after(() => s.close())
  const r = await probeModel({ baseURL: s.baseURL + '/', apiKey: 'EMPTY', model: 'qwen3.8-27b', configured: qwenConf })
  assert.equal(r.ok, true, formatProbe(r))
  assert.equal(r.server, 'vLLM')
  assert.equal(r.maxModelLen, 131072)
  assert.equal(r.family, 'Qwen（通义千问）')
  assert.deepEqual(r.suggest, {})
  const st = status(r)
  for (const k of ['服务和模型', '上下文窗口', '对话', '工具调用', '思考', '思考参数写法']) assert.equal(st[k], 'ok', `${k}: ${formatProbe(r)}`)
  // 发出去的参数：关思考的请求带 enable_thinking false，思考那一步带 true 和 preserve_thinking
  const kw = s.requests.map((q) => q.chat_template_kwargs)
  assert.ok(kw.some((k) => k && k.enable_thinking === false))
  assert.ok(kw.some((k) => k && k.enable_thinking === true && k.preserve_thinking === true))
  const tc = s.requests.find((q) => q.tools)
  assert.equal(tc.tool_choice, 'auto')
})

test('local.env 还是 DeepSeek 的写法：指出模型名、上下文、输出上限、思考参数要改，并能写回', async (t) => {
  const s = await startFakeVllm()
  t.after(() => s.close())
  const r = await probeModel({ baseURL: s.baseURL, model: 'deepseek-flash', configured: { contextWindow: '1048576', maxTokens: '', thinkingFormat: '' } })
  assert.equal(r.ok, false)
  const st = status(r)
  assert.equal(st['模型名'], 'fail')
  assert.equal(st['上下文窗口'], 'fail')
  assert.equal(st['单次输出上限'], 'warn')
  assert.equal(st['思考参数写法'], 'warn')
  assert.deepEqual(r.suggest, { DEPT_LLM_MODEL: 'qwen3.8-27b', DEPT_LLM_CONTEXT_WINDOW: '131072', DEPT_LLM_MAX_TOKENS: '32768', DEPT_LLM_THINKING_FORMAT: 'qwen-chat-template' })
  const before = '# 注释\nDEPT_LLM_BASE_URL=http://x/v1\nDEPT_LLM_MODEL=deepseek-flash\nDEPT_LLM_CONTEXT_WINDOW=\n'
  const after = applySuggest(before, r.suggest)
  assert.match(after, /^# 注释$/m)
  assert.match(after, /^DEPT_LLM_MODEL=qwen3\.8-27b$/m)
  assert.match(after, /^DEPT_LLM_CONTEXT_WINDOW=131072$/m)
  assert.match(after, /^DEPT_LLM_THINKING_FORMAT=qwen-chat-template$/m)
  assert.equal(after.match(/DEPT_LLM_MODEL=/g).length, 1)
})

test('服务端没开工具调用解析：失败，并说出要加的启动参数', async (t) => {
  for (const [flag, re] of [['noToolParser', /--enable-auto-tool-choice/], ['rawToolCall', /--tool-call-parser qwen3_coder/]]) {
    const s = await startFakeVllm({ [flag]: true })
    const r = await probeModel({ baseURL: s.baseURL, model: 'qwen3.8-27b', configured: qwenConf })
    await s.close()
    const c = r.checks.find((x) => x.item === '工具调用')
    assert.equal(c.status, 'fail', flag)
    assert.match(c.fix, re, flag)
    assert.equal(r.ok, false)
  }
})

test('思考混在正文里：提示 --reasoning-parser qwen3；老版本 vLLM 的 reasoning_content 也认', async (t) => {
  const s = await startFakeVllm({ noReasoningParser: true })
  const r = await probeModel({ baseURL: s.baseURL, model: 'qwen3.8-27b', configured: qwenConf })
  await s.close()
  const c = r.checks.find((x) => x.item === '思考')
  assert.equal(c.status, 'fail')
  assert.match(c.fix, /--reasoning-parser qwen3/)
  const s2 = await startFakeVllm({ reasoningField: 'reasoning_content' })
  const r2 = await probeModel({ baseURL: s2.baseURL, model: 'qwen3.8-27b', configured: qwenConf })
  await s2.close()
  assert.equal(r2.checks.find((x) => x.item === '思考').status, 'ok')
})

test('连不上、要密钥、地址不对：给出能照着做的提示', async (t) => {
  const s = await startFakeVllm({ apiKey: 'k1' })
  t.after(() => s.close())
  const r = await probeModel({ baseURL: s.baseURL, apiKey: 'wrong', model: 'qwen3.8-27b' })
  assert.match(r.checks[0].fix, /DEPT_LLM_API_KEY/)
  const r2 = await probeModel({ baseURL: `http://127.0.0.1:${s.port}`, apiKey: 'k1', model: 'qwen3.8-27b' })
  assert.match(r2.checks[0].fix, /\/v1/)
  const r3 = await probeModel({ baseURL: 'http://127.0.0.1:1/v1', model: 'x', timeoutMs: 3000 })
  assert.equal(r3.ok, false)
  assert.match(r3.checks[0].fix, /防火墙/)
  const r4 = await probeModel({ baseURL: '192.168.1.5:8000' })
  assert.match(r4.checks[0].detail, /不是 http/)
  // 密钥不出现在结果里
  assert.ok(!JSON.stringify([r, r2]).includes('k1'))
})

test('小上下文提醒；按模型名认家族', async (t) => {
  const s = await startFakeVllm({ maxModelLen: 32768 })
  t.after(() => s.close())
  const r = await probeModel({ baseURL: s.baseURL, model: 'qwen3.8-27b', configured: { ...qwenConf, contextWindow: '32768' } })
  assert.equal(r.checks.find((x) => x.item === '上下文大小').status, 'warn')
  assert.equal(r.suggest.DEPT_LLM_MAX_TOKENS, '8192')
  assert.equal(familyOf('Qwen3.8-27B-FP8').id, 'qwen')
  assert.equal(familyOf('deepseek-v4').id, 'deepseek')
  assert.equal(familyOf('glm-5'), null)
})

test('只要模型列表（设置页“获取模型列表”）：不发对话，带上每个模型的上下文和家族', async (t) => {
  const s = await startFakeVllm()
  t.after(() => s.close())
  const r = await probeModel({ baseURL: s.baseURL, listOnly: true })
  assert.equal(r.ok, true)
  assert.deepEqual(r.listMeta, [{ id: 'qwen3.8-27b', maxModelLen: 131072, family: 'qwen' }])
  assert.equal(s.requests.length, 0)
})
