// 模型探测（需求规格说明 G4 的“模型探测”）：连上部门模型服务，查清楚它是什么、能不能当智能体的模型用，
// 再和设置文件 local.env 里的写法对一遍，给出该怎么改。工作台设置页“检测模型”、安装脚本、自检都用它。
//
// 对象是 OpenAI 兼容接口（vLLM、SGLang 等）。逐项：
//   1 服务和模型   GET /models：模型名（--served-model-name）、上下文（vLLM 给 max_model_len）
//   2 对话         一句话，量用时和输出速度
//   3 工具调用     给一个 read_file 工具，看回来的是不是结构化的 tool_calls（服务端要开 --enable-auto-tool-choice 和对应的 --tool-call-parser）
//   4 思考         打开思考问一道小题，看思考内容是不是单独放在 reasoning / reasoning_content（服务端要开 --reasoning-parser）
// 然后核对 local.env：模型名、上下文窗口、单次输出上限、思考参数的写法。
// 只用 Node 自带的 fetch；Key 不写日志、不出现在结果里。
//
// 命令行：node app/main/probe.mjs [--base http://10.0.0.5:8000/v1] [--key EMPTY] [--model 名字] [--env local.env] [--write]
//   --env    读哪个设置文件（默认按 paths.mjs 找：开发时 config/local.env，安装后用户数据目录里的 local.env）
//   --write  把建议的 DEPT_LLM_* 写回这个设置文件（只改这几行，其他行和注释原样保留）

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 已知模型家族：按模型名认，决定思考参数的写法和建议 */
export const FAMILIES = [
  {
    id: 'qwen', test: /qwen/i, name: 'Qwen（通义千问）',
    thinkingFormat: 'qwen-chat-template',
    // chat_template_kwargs.enable_thinking 开关思考，preserve_thinking 保留历史思考（多步任务更稳）
    thinkingParams: (on) => ({ chat_template_kwargs: { enable_thinking: on, preserve_thinking: true } }),
    server: 'vllm serve <模型目录> --served-model-name <名字> --max-model-len 131072 --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_coder --enable-prefix-caching',
  },
  {
    id: 'deepseek', test: /deepseek/i, name: 'DeepSeek',
    thinkingFormat: 'chat-template',
    thinkingParams: (on) => ({ chat_template_kwargs: { thinking: on } }),
    server: 'vllm serve <模型目录> --served-model-name <名字> --reasoning-parser deepseek_v3 --enable-auto-tool-choice --tool-call-parser deepseek_v31',
  },
]
export const familyOf = (model) => FAMILIES.find((f) => f.test.test(String(model || ''))) || null

/** 官方 DeepSeek 接口不用这些参数（它有自己的 thinking 字段） */
const isDeepseekCloud = (base) => /api\.deepseek\.com/i.test(base)

const ok = (item, detail, extra) => ({ item, status: 'ok', detail, ...extra })
const warn = (item, detail, fix, extra) => ({ item, status: 'warn', detail, fix, ...extra })
const fail = (item, detail, fix, extra) => ({ item, status: 'fail', detail, fix, ...extra })

/**
 * @param {object} o
 * @param {string} o.baseURL      例如 http://10.0.0.5:8000/v1
 * @param {string} [o.apiKey]     vLLM 没设 --api-key 时随便填，空也行
 * @param {string} [o.model]      local.env 里写的模型名；空时用服务端第一个模型
 * @param {object} [o.configured] local.env 现在的写法 { contextWindow, maxTokens, thinkingFormat }，用来核对
 * @param {Function} [o.fetch]    测试时换成假的
 * @param {number} [o.timeoutMs]  每一步的超时，默认 60 秒（思考那一步给两倍）
 * @param {boolean} [o.listOnly]  只查 /models（模型列表和上下文），不发对话
 * @returns {Promise<{ ok: boolean, baseURL: string, server: string, model: string, models: string[], family: string, maxModelLen: number|null,
 *   tokPerSec: number|null, checks: {item: string, status: 'ok'|'warn'|'fail', detail: string, fix?: string}[], suggest: Record<string,string>, ms: number }>}
 */
export async function probeModel(o) {
  const t0 = Date.now()
  const doFetch = o.fetch || globalThis.fetch
  const base = String(o.baseURL || '').trim().replace(/\/+$/, '')
  const timeoutMs = o.timeoutMs || 60000
  const conf = o.configured || {}
  const checks = []
  const suggest = {}
  const out = { ok: false, baseURL: base, server: '', model: '', models: [], family: '', maxModelLen: null, tokPerSec: null, checks, suggest, ms: 0 }
  const done = () => { out.ok = !checks.some((c) => c.status === 'fail'); out.ms = Date.now() - t0; return out }
  const headers = { 'content-type': 'application/json', ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) }

  async function call(method, path, body, ms = timeoutMs) {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), ms)
    const s = Date.now()
    try {
      const r = await doFetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ac.signal })
      const text = await r.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* 不是 JSON */ }
      return { status: r.status, ok: r.ok, json, text, ms: Date.now() - s }
    } catch (e) {
      const why = ac.signal.aborted ? `${Math.round(ms / 1000)} 秒没有回应` : (e?.cause?.code || e?.code || e?.message || String(e))
      return { status: 0, ok: false, json: null, text: '', error: why, ms: Date.now() - s }
    } finally { clearTimeout(t) }
  }
  const errText = (r) => r.error || `HTTP ${r.status}：${(r.json?.error?.message || r.json?.message || r.json?.detail || r.text || '').toString().replace(/\s+/g, ' ').slice(0, 200)}`

  if (!/^https?:\/\//i.test(base)) {
    checks.push(fail('服务地址', `“${base || '（空）'}”不是 http(s) 地址`, '在 local.env 填 DEPT_LLM_BASE_URL，例如 http://10.0.0.5:8000/v1（末尾的 /v1 不能少）'))
    return done()
  }

  // 1 服务和模型
  const ls = await call('GET', '/models', null, Math.min(timeoutMs, 15000))
  if (!ls.ok) {
    const hint = ls.status === 401 || ls.status === 403 ? '服务端要密钥：在 local.env 填 DEPT_LLM_API_KEY（vLLM 的 --api-key）'
      : ls.status === 404 ? '地址末尾通常要带 /v1，例如 http://10.0.0.5:8000/v1'
        : '确认服务器地址和端口、服务已经启动，这台电脑和服务器之间的防火墙放行了这个端口（在终端试 curl <地址>/models）'
    checks.push(fail('服务和模型', `连不上 ${base}/models：${errText(ls)}`, hint))
    return done()
  }
  const list = Array.isArray(ls.json?.data) ? ls.json.data : []
  out.models = list.map((m) => m.id).filter(Boolean)
  const owned = list.map((m) => m.owned_by).find(Boolean) || ''
  out.server = /vllm/i.test(owned) ? 'vLLM' : /sglang/i.test(owned) ? 'SGLang' : owned || 'OpenAI 兼容接口'
  if (!out.models.length) {
    checks.push(fail('服务和模型', `${base} 没有列出任何模型`, '检查服务端是否把模型加载成功'))
    return done()
  }
  if (o.listOnly) {   // 只要模型列表（设置页“获取模型列表”）
    const meta0 = list.find((m) => m.id === o.model) || list[0] || {}
    out.model = meta0.id || ''
    out.maxModelLen = Number(meta0.max_model_len || meta0.context_length || meta0.max_context_length) || null
    out.family = (familyOf(out.model) || {}).name || ''
    out.listMeta = list.map((m) => ({ id: m.id, maxModelLen: Number(m.max_model_len || m.context_length || m.max_context_length) || null, family: (familyOf(m.id) || familyOf(m.root) || {}).id || '' }))
    checks.push(ok('服务和模型', `${out.server} · ${out.models.length} 个模型（${ls.ms} ms）`))
    return done()
  }
  let model = String(o.model || '').trim()
  if (model && !out.models.includes(model)) {
    checks.push(fail('模型名', `local.env 写的是“${model}”，服务端只有：${out.models.join('、')}`, `把 DEPT_LLM_MODEL 改成服务端的名字（vLLM 的 --served-model-name）`))
    suggest.DEPT_LLM_MODEL = out.models[0]
    model = out.models[0]
  } else if (!model) {
    model = out.models[0]
    suggest.DEPT_LLM_MODEL = model
    checks.push(warn('模型名', `local.env 没写模型名，服务端有：${out.models.join('、')}`, `DEPT_LLM_MODEL=${model}`))
  }
  out.model = model
  const meta = list.find((m) => m.id === model) || {}
  out.maxModelLen = Number(meta.max_model_len || meta.context_length || meta.max_context_length) || null
  const fam = familyOf(model) || familyOf(meta.root) || null
  out.family = fam ? fam.name : ''
  checks.push(ok('服务和模型', `${out.server} · ${model}${out.maxModelLen ? ` · 上下文 ${Math.round(out.maxModelLen / 1024)}K` : ''}${fam ? ` · ${fam.name}` : ''}（${ls.ms} ms）`))

  // 上下文和输出上限：DSH 按 contextWindow 决定什么时候压缩对话，比服务端大会在长任务里直接报错
  if (out.maxModelLen) {
    const cw = Number(conf.contextWindow) || 0
    if (!cw || cw > out.maxModelLen) {
      suggest.DEPT_LLM_CONTEXT_WINDOW = String(out.maxModelLen)
      checks.push((cw ? fail : warn)('上下文窗口', cw ? `local.env 写 ${cw}，比服务端的 ${out.maxModelLen} 大：长任务会在中途被服务端拒绝` : `local.env 没写，默认按 1M 算；服务端是 ${out.maxModelLen}`, `DEPT_LLM_CONTEXT_WINDOW=${out.maxModelLen}`))
    } else checks.push(ok('上下文窗口', `local.env ${cw}，服务端 ${out.maxModelLen}`))
    if (out.maxModelLen < 65536) {
      checks.push(warn('上下文大小', `服务端只给 ${Math.round(out.maxModelLen / 1024)}K。智能体每一步都要带上工具定义和技能（约 1 万 tokens），文档类任务读几份材料就满了`, '服务端 --max-model-len 建议不小于 131072（显存不够时可以 --kv-cache-dtype fp8）'))
    }
    const mt = Number(conf.maxTokens) || 65536
    const goodMt = Math.min(32768, Math.floor(out.maxModelLen / 4))
    if (mt >= out.maxModelLen / 2) {
      suggest.DEPT_LLM_MAX_TOKENS = String(goodMt)
      checks.push(warn('单次输出上限', `local.env ${conf.maxTokens ? mt : `没写（默认 ${mt}）`}，占了上下文的一半以上，留给对话的地方太少`, `DEPT_LLM_MAX_TOKENS=${goodMt}`))
    }
  }

  // 2 对话（关掉思考，量速度）
  const off = fam && !isDeepseekCloud(base) ? fam.thinkingParams(false) : {}
  const say = await call('POST', '/chat/completions', {
    model, stream: false, max_tokens: 256, ...off,
    messages: [{ role: 'user', content: '用一句话（不超过 60 个字）介绍航天嵌入式软件单元测试的目的。' }],
  })
  if (!say.ok) {
    checks.push(fail('对话', errText(say), say.status === 400 && off.chat_template_kwargs ? '服务端不认 chat_template_kwargs：确认是 vLLM 或 SGLang，或者把 DEPT_LLM_THINKING_FORMAT 改成 deepseek' : '看服务端日志'))
    return done()
  }
  const msg = say.json?.choices?.[0]?.message || {}
  const n = Number(say.json?.usage?.completion_tokens) || 0
  out.tokPerSec = n && say.ms ? Math.round((n * 1000) / say.ms) : null
  const content = String(msg.content || '')
  if (/<think>/i.test(content)) checks.push(warn('对话', '关掉思考后回复里仍有 <think>', '服务端加 --reasoning-parser（Qwen 用 qwen3）'))
  else checks.push(ok('对话', `${say.ms} ms${out.tokPerSec ? `，约 ${out.tokPerSec} tokens/秒（含首字等待）` : ''}：${content.replace(/\s+/g, ' ').slice(0, 50)}`))
  if (out.tokPerSec && out.tokPerSec < 15) checks.push(warn('速度', `约 ${out.tokPerSec} tokens/秒，一个文档类任务可能要半小时以上`, '服务端可开 --enable-prefix-caching、MTP 投机解码（--speculative-config），或减少同时使用的人数'))

  // 3 工具调用：智能体的每一步都是工具调用，这一项不过就不能用
  const tools = [{
    type: 'function',
    function: {
      name: 'read_file', description: '读取工作区里的一个文本文件',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '相对工作区的路径' } }, required: ['path'] },
    },
  }]
  const tc = await call('POST', '/chat/completions', {
    model, stream: false, max_tokens: 1024, tools, tool_choice: 'auto', ...off,
    messages: [{ role: 'system', content: '你是代码助手。需要文件内容时调用工具，不要猜。' }, { role: 'user', content: '帮我看看 src/tm_udp.c 的内容。' }],
  })
  if (!tc.ok) {
    const t = errText(tc)
    checks.push(fail('工具调用', t, /auto.?tool|tool.?choice|tool.?call.?parser/i.test(t)
      ? '服务端启动参数加 --enable-auto-tool-choice --tool-call-parser（Qwen3.5 以后的 Qwen 用 qwen3_coder，偶发参数解析错时换 qwen3_xml；DeepSeek 用 deepseek_v31）'
      : '看服务端日志'))
  } else {
    const m = tc.json?.choices?.[0]?.message || {}
    const call0 = Array.isArray(m.tool_calls) ? m.tool_calls[0] : null
    let args = null
    try { args = call0 ? JSON.parse(call0.function?.arguments || '{}') : null } catch { /* 参数不是 JSON */ }
    if (call0 && call0.function?.name === 'read_file' && args && typeof args.path === 'string') checks.push(ok('工具调用', `结构化 tool_calls：read_file(${JSON.stringify(args.path)})（${tc.ms} ms）`))
    else if (call0) checks.push(fail('工具调用', `有 tool_calls 但参数不对：${String(call0.function?.arguments || '').slice(0, 120)}`, 'Qwen 换 --tool-call-parser qwen3_xml 试试'))
    else if (/<tool_call>|<function=|"name"\s*:\s*"read_file"/.test(String(m.content || ''))) checks.push(fail('工具调用', '模型想调用工具，但调用写在了正文里，服务端没有解析出来', '服务端启动参数加 --enable-auto-tool-choice --tool-call-parser qwen3_coder（Qwen）'))
    else checks.push(warn('工具调用', `模型没有调用工具，直接回答了：${String(m.content || '').replace(/\s+/g, ' ').slice(0, 80)}`, '再测一次；仍然这样说明这个模型不适合做智能体'))
  }

  // 4 思考
  if (fam && !isDeepseekCloud(base)) {
    const th = await call('POST', '/chat/completions', {
      model, stream: false, max_tokens: 4096, ...fam.thinkingParams(true),
      messages: [{ role: 'user', content: '一个 16 位无符号计数器从 65530 开始每次加 3，第几次加完后第一次小于 10？只给数字。' }],
    }, timeoutMs * 2)
    if (!th.ok) checks.push(warn('思考', errText(th), '看服务端日志'))
    else {
      const m = th.json?.choices?.[0]?.message || {}
      const r = String(m.reasoning_content || m.reasoning || '')
      if (r) checks.push(ok('思考', `思考内容单独返回（${r.length} 字，${th.ms} ms），答案：${String(m.content || '').trim().slice(0, 20)}`))
      else if (/<think>|<\/think>/i.test(String(m.content || ''))) checks.push(fail('思考', '思考内容混在正文里', '服务端启动参数加 --reasoning-parser qwen3'))
      else checks.push(warn('思考', '打开思考后没有看到思考内容', '确认模型支持思考、chat_template_kwargs 被服务端接受'))
    }
    if (conf.thinkingFormat !== fam.thinkingFormat) {
      suggest.DEPT_LLM_THINKING_FORMAT = fam.thinkingFormat
      checks.push(warn('思考参数写法', `local.env 是 ${conf.thinkingFormat || '（没写，按 deepseek）'}，${fam.name} 要用 ${fam.thinkingFormat}`, `DEPT_LLM_THINKING_FORMAT=${fam.thinkingFormat}`))
    } else checks.push(ok('思考参数写法', fam.thinkingFormat))
  }
  return done()
}

/** 把建议写回 local.env：已有的行原地改，没有的追加在末尾；其他行和注释不动 */
export function applySuggest(text, suggest) {
  const keys = Object.keys(suggest || {})
  if (!keys.length) return text
  const seen = new Set()
  const lines = String(text || '').split(/\r?\n/).map((line) => {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line)
    if (m && keys.includes(m[1]) && !seen.has(m[1])) { seen.add(m[1]); return `${m[1]}=${suggest[m[1]]}` }
    return line
  })
  const rest = keys.filter((k) => !seen.has(k))
  if (rest.length) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push('', `# 模型探测 ${new Date().toISOString().slice(0, 10)} 写入`, ...rest.map((k) => `${k}=${suggest[k]}`), '')
  }
  return lines.join(text.includes('\r\n') ? '\r\n' : '\n')
}

/** 给人看的报告（命令行、自检报告） */
export function formatProbe(r) {
  const mark = { ok: '通过', warn: '注意', fail: '失败' }
  const lines = [`模型服务：${r.baseURL}`, '']
  for (const c of r.checks) {
    lines.push(`[${mark[c.status]}] ${c.item}：${c.detail}`)
    if (c.fix) lines.push(`        → ${c.fix}`)
  }
  const s = Object.entries(r.suggest)
  if (s.length) lines.push('', '建议改 local.env：', ...s.map(([k, v]) => `  ${k}=${v}`))
  lines.push('', r.ok ? `可以使用（${(r.ms / 1000).toFixed(1)} 秒）` : '有失败项，先按上面的提示处理')
  return lines.join('\n')
}

// ── 命令行 ──
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
  const { readLocalEnv, resolvePaths, modelConfig } = await import('./paths.mjs')
  const envFile = arg('--env') || resolvePaths().localEnv
  const fileEnv = existsSync(envFile) ? readLocalEnv(envFile) : {}
  const env = { ...process.env, ...fileEnv }
  if (arg('--base')) env.DEPT_LLM_BASE_URL = arg('--base')
  if (arg('--key')) env.DEPT_LLM_API_KEY = arg('--key')
  if (arg('--model')) env.DEPT_LLM_MODEL = arg('--model')
  const m = modelConfig(env)
  const r = await probeModel({
    baseURL: m.baseURL, apiKey: env.DEPT_LLM_API_KEY || env.DEEPSEEK_API_KEY || '', model: env.DEPT_LLM_MODEL || '',
    configured: { contextWindow: env.DEPT_LLM_CONTEXT_WINDOW, maxTokens: env.DEPT_LLM_MAX_TOKENS, thinkingFormat: env.DEPT_LLM_THINKING_FORMAT },
  })
  console.log(formatProbe(r))
  if (process.argv.includes('--write')) {
    const add = { ...r.suggest }
    if (arg('--base')) add.DEPT_LLM_BASE_URL = r.baseURL
    if (arg('--key')) add.DEPT_LLM_API_KEY = arg('--key')
    if (!fileEnv.DEPT_LLM_MODEL && r.model) add.DEPT_LLM_MODEL = r.model
    const before = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
    writeFileSync(envFile, applySuggest(before, add))
    console.log(`\n已写入 ${envFile}：${Object.keys(add).join('、') || '（没有要改的）'}`)
  }
  process.exit(r.ok ? 0 : 1)
}
