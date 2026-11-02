// 直接调部门模型（OpenAI 兼容的 /chat/completions）：给不需要智能体的小活用，比如资料翻译。
// 地址、Key、模型和引擎用的是同一套设置（local.env：DEPT_LLM_BASE_URL、DEPT_LLM_API_KEY、DEPT_LLM_MODEL）。Key 不写日志。

export async function chat({ baseURL, apiKey, model, messages, maxTokens = 8192, timeoutMs = 240000, signal }) {
  if (!apiKey) throw new Error('模型的 Key 没有配置（设置文件 local.env）')
  const url = `${String(baseURL || '').replace(/\/+$/, '')}/chat/completions`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(new Error(`模型 ${Math.round(timeoutMs / 1000)} 秒没有回复`)), timeoutMs)
  const onAbort = () => ac.abort(signal.reason)
  if (signal) signal.addEventListener('abort', onAbort, { once: true })
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens }),
      signal: ac.signal,
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`模型接口返回 ${r.status}：${text.slice(0, 300)}`)
    const j = JSON.parse(text)
    const c = j.choices && j.choices[0] && j.choices[0].message
    if (!c || typeof c.content !== 'string') throw new Error('模型没有返回内容')
    return { content: c.content, usage: j.usage || null }
  } catch (e) {
    if (ac.signal.aborted && ac.signal.reason instanceof Error) throw ac.signal.reason
    throw e
  } finally {
    clearTimeout(t)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}
