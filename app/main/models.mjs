// 模型配置：部门默认模型（设置文件 local.env 的 DEPT_LLM_*）+ 用户在设置页里加的自定义模型，选一个在用。
//
// 存在用户数据目录的 models.json：{ active: 'dept' | <id>, models: [{ id, name, baseURL, model, thinkingFormat, contextWindow, maxTokens, input, key }] }
//   key：{ enc: 'safe' | 'plain', v }。Electron 的 safeStorage 能用就加密（Windows DPAPI、Linux 的系统密钥环），
//   否则明文（和 local.env 一样，文件权限只给本人）。界面上只说“已配置 / 未配置”，密钥从不回到界面。
// 在用的模型通过 DEPT_LLM_* 环境变量交给引擎（cordis.patch.yml.template 读这些变量），所以引擎和直接调用模型的地方都不用改。
// 部门可以在 local.env 写 ASTROLAB_MODEL_LOCK=1：只能用部门默认模型，设置页只读。

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const DEPT_ID = 'dept'
export const THINKING_FORMATS = ['deepseek', 'chat-template', 'qwen-chat-template', 'qwen', 'off']

/** 新建模型时的预设：只填表单，不保存 */
export const PRESETS = [
  { id: 'lan-qwen', name: '局域网 Qwen3.8-27B（vLLM）', baseURL: 'http://192.168.10.20:8000/v1', model: 'qwen3.8-27b', thinkingFormat: 'qwen-chat-template', contextWindow: 131072, maxTokens: 32768, input: 'text', key: 'EMPTY',
    note: '地址换成你们服务器的；模型名是 vLLM 的 --served-model-name' },
  { id: 'intranet-deepseek', name: '内网 DeepSeek（vLLM）', baseURL: 'http://10.0.0.10:8000/v1', model: 'deepseek-v4', thinkingFormat: 'chat-template', contextWindow: 131072, maxTokens: 32768, input: 'text', key: 'EMPTY',
    note: '内网 4×H200 上的 vLLM' },
  { id: 'deepseek-api', name: 'DeepSeek 官方接口', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', thinkingFormat: 'deepseek', contextWindow: 1048576, maxTokens: 65536, input: 'text', key: '',
    note: '公网接口：只能用示例代码和非敏感内容' },
  { id: 'openai-compatible', name: '其他 OpenAI 兼容接口', baseURL: 'http://', model: '', thinkingFormat: 'chat-template', contextWindow: 131072, maxTokens: 32768, input: 'text', key: '',
    note: '填好地址后点“获取模型列表”，再点“检测”' },
]

const num = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : d }

/** 检查并整理一份模型配置（来自界面），出错抛出能直接给人看的话 */
export function normalize(m) {
  const name = String(m.name || '').trim()
  const baseURL = String(m.baseURL || '').trim().replace(/\/+$/, '')
  const model = String(m.model || '').trim()
  if (!name) throw new Error('给模型起个名字')
  if (!/^https?:\/\/[^\s/]+/i.test(baseURL)) throw new Error('地址要以 http:// 或 https:// 开头，例如 http://192.168.10.20:8000/v1')
  if (!model) throw new Error('填模型名（vLLM 的 --served-model-name）；不知道就点“获取模型列表”')
  const thinkingFormat = THINKING_FORMATS.includes(m.thinkingFormat) ? m.thinkingFormat : 'chat-template'
  const contextWindow = num(m.contextWindow, 131072)
  if (contextWindow < 8192) throw new Error('上下文至少 8192')
  let maxTokens = num(m.maxTokens, Math.min(32768, Math.floor(contextWindow / 4)))
  if (maxTokens >= contextWindow) throw new Error('单次输出上限要小于上下文')
  const input = m.input === 'text,image' ? 'text,image' : 'text'
  return { name: name.slice(0, 60), baseURL, model, thinkingFormat, contextWindow, maxTokens, input }
}

export class ModelStore {
  /**
   * @param {object} o
   * @param {string} o.file          models.json 的路径
   * @param {() => object} o.deptEnv 部门默认：local.env 读出来的键值
   * @param {{ available(): boolean, encrypt(s: string): string, decrypt(s: string): string }} [o.crypto] 不给就明文
   */
  constructor({ file, deptEnv, crypto = null }) {
    this.file = file; this.deptEnv = deptEnv; this.crypto = crypto
    this.data = { active: DEPT_ID, models: [] }
    try { if (existsSync(file)) this.data = { active: DEPT_ID, models: [], ...JSON.parse(readFileSync(file, 'utf8')) } } catch { /* 坏文件当没有 */ }
    if (!Array.isArray(this.data.models)) this.data.models = []
  }

  locked() { return this.deptEnv().ASTROLAB_MODEL_LOCK === '1' }

  save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data, null, 1))
    try { chmodSync(tmp, 0o600) } catch { /* Windows */ }
    renameSync(tmp, this.file)
  }

  sealKey(k) {
    if (!k) return null
    if (this.crypto && this.crypto.available()) return { enc: 'safe', v: this.crypto.encrypt(k) }
    return { enc: 'plain', v: k }
  }
  openKey(sealed) {
    if (!sealed) return ''
    if (sealed.enc === 'plain') return sealed.v
    try { return this.crypto ? this.crypto.decrypt(sealed.v) : '' } catch { return '' }
  }

  dept() {
    const e = this.deptEnv()
    return {
      id: DEPT_ID, name: '部门默认（local.env）', builtin: true,
      baseURL: e.DEPT_LLM_BASE_URL || 'https://api.deepseek.com', model: e.DEPT_LLM_MODEL || 'deepseek-flash',
      thinkingFormat: e.DEPT_LLM_THINKING_FORMAT || 'deepseek', contextWindow: num(e.DEPT_LLM_CONTEXT_WINDOW, 1048576),
      maxTokens: num(e.DEPT_LLM_MAX_TOKENS, 65536), input: e.DEPT_LLM_INPUT || 'text', hasKey: !!(e.DEPT_LLM_API_KEY || e.DEEPSEEK_API_KEY),
    }
  }

  activeId() {
    if (this.locked()) return DEPT_ID
    const a = this.data.active
    return a !== DEPT_ID && this.data.models.some((m) => m.id === a) ? a : DEPT_ID
  }

  /** 给界面：不含密钥 */
  list() {
    const active = this.activeId()
    const pub = (m) => ({ id: m.id, name: m.name, baseURL: m.baseURL, model: m.model, thinkingFormat: m.thinkingFormat, contextWindow: m.contextWindow, maxTokens: m.maxTokens, input: m.input, hasKey: !!m.key, builtin: false })
    return {
      active, locked: this.locked(), presets: PRESETS.map(({ key, ...p }) => ({ ...p, defaultKey: key })),
      models: [this.dept(), ...this.data.models.map(pub)].map((m) => ({ ...m, active: m.id === active })),
    }
  }

  /**
   * 新建或修改。key：undefined 或 '' 表示不改（新建时为没有密钥），null 表示清除，字符串表示新密钥
   * @returns {string} id
   */
  upsert(input) {
    if (this.locked()) throw new Error('部门锁定了模型配置（local.env 的 ASTROLAB_MODEL_LOCK）')
    if (input.id === DEPT_ID) throw new Error('部门默认模型在 local.env 里改')
    const m = normalize(input)
    const old = input.id ? this.data.models.find((x) => x.id === input.id) : null
    if (input.id && !old) throw new Error('这个模型已经不在了')
    if (this.data.models.some((x) => x.name === m.name && x.id !== input.id)) throw new Error(`已经有叫“${m.name}”的模型了`)
    const key = input.key === null ? null : typeof input.key === 'string' && input.key ? this.sealKey(input.key) : old ? old.key : null
    const rec = { id: old ? old.id : randomUUID().slice(0, 8), ...m, key }
    if (old) Object.assign(old, rec); else this.data.models.push(rec)
    this.save()
    return rec.id
  }

  remove(id) {
    if (this.locked()) throw new Error('部门锁定了模型配置')
    if (id === DEPT_ID) throw new Error('部门默认模型不能删')
    this.data.models = this.data.models.filter((m) => m.id !== id)
    if (this.data.active === id) this.data.active = DEPT_ID
    this.save()
  }

  activate(id) {
    if (this.locked() && id !== DEPT_ID) throw new Error('部门锁定了模型配置，只能用部门默认模型')
    if (id !== DEPT_ID && !this.data.models.some((m) => m.id === id)) throw new Error('这个模型已经不在了')
    const changed = this.activeId() !== id
    this.data.active = id
    this.save()
    return changed
  }

  /** 模型探测用：某个已存模型的连接信息（含密钥，只在主进程里用） */
  connection(id) {
    if (id === DEPT_ID) {
      const e = this.deptEnv(); const d = this.dept()
      return { ...d, apiKey: e.DEPT_LLM_API_KEY || e.DEEPSEEK_API_KEY || '' }
    }
    const m = this.data.models.find((x) => x.id === id)
    if (!m) throw new Error('这个模型已经不在了')
    return { ...m, apiKey: this.openKey(m.key) }
  }

  /** 在用的是自定义模型时，覆盖引擎环境里的 DEPT_LLM_*；部门默认时返回空对象（照 local.env） */
  envOverrides() {
    const id = this.activeId()
    if (id === DEPT_ID) return {}
    const m = this.connection(id)
    return {
      ASTROLAB_PROVIDER: 'dept-llm',
      DEPT_LLM_BASE_URL: m.baseURL, DEPT_LLM_MODEL: m.model, DEPT_LLM_API_KEY: m.apiKey || 'EMPTY',
      DEPT_LLM_THINKING_FORMAT: m.thinkingFormat === 'off' ? 'chat-template' : m.thinkingFormat,
      DEPT_LLM_CONTEXT_WINDOW: String(m.contextWindow), DEPT_LLM_MAX_TOKENS: String(m.maxTokens), DEPT_LLM_INPUT: m.input,
      ...(m.thinkingFormat === 'off' ? { ASTROLAB_REASONING: 'off' } : {}),
      ASTROLAB_MODEL_NAME: m.name,
    }
  }
}
