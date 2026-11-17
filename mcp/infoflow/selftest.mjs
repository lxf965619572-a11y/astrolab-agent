#!/usr/bin/env node
// 信息流图自测：直接调用纯函数和工具函数，检查校验、换行、布局质量、视图、N² 矩阵、文件规则和 MCP 握手。
// 不联网、不启动子进程；文件只写在系统临时目录。运行：node mcp/infoflow/selftest.mjs

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  buildDiagram,
  validateInfoFlow,
  wrapText,
  measureText,
  isPending,
  normalizeKind,
  planDiagram,
  normalize,
  viewModel,
  suggestViews,
  buildMatrix,
  checkModel,
  laneOrder,
} from './diagram.mjs'
import { htmlTool, matrixTool, renderTool, validateTool } from './tools.mjs'
import { GENERATED_MARK } from './common.mjs'
import { serve } from './mcp-lite.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SKILL = join(REPO, 'skills', 'info-flow')

let passed = 0
let failed = 0

const queue = []
function test(name, fn) { queue.push({ name, fn }) }
async function runAll() {
  for (const { name, fn } of queue) {
    try {
      await fn()
      passed += 1
      console.log(`PASS  ${name}`)
    } catch (e) {
      failed += 1
      console.error(`FAIL  ${name}`)
      console.error(`      ${e && e.message ? e.message : e}`)
    }
  }
}

const basic = {
  title: '测试信息流',
  source: '单元测试样例（虚构）',
  direction: 'LR',
  groups: [
    {
      id: 'g1',
      label: '外部接口',
      nodes: [
        { id: 'n1', label: '遥测请求', note: '500 ms' },
        { id: 'n2', label: '遥控指令' },
      ],
    },
    {
      id: 'g2',
      label: '应用软件',
      nodes: [
        { id: 'n3', label: '遥测组帧' },
        { id: 'n4', label: '指令处理' },
      ],
    },
    { id: 'g3', label: '存储', nodes: [{ id: 'n5', label: 'MRAM' }] },
  ],
  flows: [
    { from: 'n1', to: 'n3', label: '请求', kind: 'event' },
    { from: 'n2', to: 'n4', label: '指令码', kind: 'command' },
    { from: 'n3', to: 'n5', label: '遥测帧', kind: 'data' },
    { from: 'n4', to: 'n3', label: '状态', kind: 'data' },
  ],
}

test('基本规格校验通过，统计正确', () => {
  const c = validateInfoFlow(basic)
  assert.equal(c.ok, true)
  assert.deepEqual(c.stats, { groups: 3, nodes: 5, flows: 4 })
  assert.equal(c.errors.length, 0)
})

test('LR 布局：分组从左到右，跨组节点横向排列', () => {
  const { model, plan } = buildDiagram(basic)
  assert.equal(model.direction, 'LR')
  assert.equal(plan.lanes.length, 3)
  assert.ok(plan.lanes[1].x > plan.lanes[0].x + plan.lanes[0].w)
  assert.ok(plan.lanes[2].x > plan.lanes[1].x + plan.lanes[1].w)
  const n1 = plan.nodes.find((n) => n.id === 'n1')
  const n3 = plan.nodes.find((n) => n.id === 'n3')
  assert.ok(n3.x > n1.x)
  assert.ok(plan.width > 0 && plan.height > 0)
})

test('TB 布局：分组从上到下', () => {
  const spec = { ...basic, direction: 'TB' }
  const { model, plan } = buildDiagram(spec)
  assert.equal(model.direction, 'TB')
  assert.ok(plan.lanes[1].y > plan.lanes[0].y + plan.lanes[0].h)
  assert.ok(plan.lanes[2].y > plan.lanes[1].y + plan.lanes[1].h)
  assert.ok(plan.height > plan.width / 2)
})

test('SVG 含标题、分组、节点、三种箭头和连线标签', () => {
  const { svg } = buildDiagram(basic)
  assert.match(svg, /<svg[^>]+viewBox="0 0 \d+ \d+"/)
  assert.match(svg, /测试信息流/)
  assert.match(svg, /外部接口/)
  assert.match(svg, /遥测组帧/)
  assert.match(svg, /marker-end="url\(#arrow-data\)"/)
  assert.match(svg, /marker-end="url\(#arrow-command\)"/)
  assert.match(svg, /marker-end="url\(#arrow-event\)"/)
  assert.match(svg, />请求</)
  assert.match(svg, /依据：单元测试样例/)
})

test('Mermaid 含分组、方向、三类箭头和样式', () => {
  const { mermaid } = buildDiagram(basic)
  assert.match(mermaid, /flowchart LR/)
  assert.match(mermaid, /subgraph g0\["外部接口"\]/)
  assert.match(mermaid, /direction TB/)
  assert.match(mermaid, /n0 -\.->\|请求\| n2/)
  assert.match(mermaid, /n1 ==>\|指令码\| n3/)
  assert.match(mermaid, /n2 -->\|遥测帧\| n4/)
  assert.match(mermaid, /linkStyle 0 stroke:#7c3aed/)
  assert.match(mermaid, /classDef pending/)
})

test('中文标签按宽度换行，且不丢字', () => {
  const text = '遥测数据采集与处理模块'
  const lines = wrapText(text, 80, 13)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.ok(measureText(line, 13) <= 80 + 0.01, `行超宽：${line}`)
  assert.equal(lines.join(''), text)
})

test('长英文单词按字符拆行，不超宽', () => {
  const text = 'MIL-STD-1553B-BUS-CHANNEL'
  const lines = wrapText(text, 60, 11)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.ok(measureText(line, 11) <= 60 + 0.01, `行超宽：${line}`)
  assert.equal(lines.join(''), text)
})

test('显式换行和 <br/> 都保留', () => {
  assert.deepEqual(wrapText('第一行<br/>第二行\n第三行', 200, 12), ['第一行', '第二行', '第三行'])
})

test('XML 特殊字符转义', () => {
  const spec = {
    title: 'A&B <图>',
    groups: [{ id: 'g', label: '分<组>', nodes: [{ id: 'n', label: '节点 "1" & <x>' }] }],
    flows: [],
  }
  const { svg, mermaid } = buildDiagram(spec)
  assert.match(svg, /A&amp;B &lt;图&gt;/)
  assert.match(svg, /节点 &quot;1&quot; &amp; &lt;x&gt;/)
  assert.match(mermaid, /A＆B ＜图＞/)
  assert.match(mermaid, /节点 ＂1＂ ＆ ＜x＞/)
})

test('含“待确认”的节点用虚线并加 pending 类', () => {
  const spec = {
    title: '待确认标记',
    groups: [{ id: 'g', label: '接口', nodes: [{ id: 'n1', label: 'RT 地址', note: '12/21【待确认】' }] }],
    flows: [],
  }
  const { svg, mermaid } = buildDiagram(spec)
  assert.match(svg, /class="node pending"/)
  assert.match(svg, /stroke-dasharray="5 3"/)
  assert.match(mermaid, /class n0 pending/)
  assert.equal(isPending('待确认事项'), true)
  assert.equal(isPending('正常节点'), false)
})

test('自环给出提醒，仍能出图', () => {
  const spec = { ...basic, flows: [{ from: 'n1', to: 'n1', label: '重试' }] }
  const c = validateInfoFlow(spec)
  assert.equal(c.ok, true)
  assert.ok(c.warnings.some((w) => w.includes('自环')))
  const { plan, svg } = buildDiagram(spec)
  assert.equal(plan.edges.length, 1)
  assert.match(svg, /marker-end="url\(#arrow-data\)"/)
})

test('环给出提醒', () => {
  const spec = {
    ...basic,
    flows: [
      { from: 'n3', to: 'n4', label: '正向' },
      { from: 'n4', to: 'n3', label: '反馈' },
    ],
  }
  const c = validateInfoFlow(spec)
  assert.equal(c.ok, true)
  assert.ok(c.warnings.some((w) => w.includes('存在环')))
})

test('孤立节点、重复流向、空分组给出提醒', () => {
  const spec = {
    title: '提醒测试',
    groups: [
      { id: 'g1', label: 'A', nodes: [{ id: 'n1', label: '源' }, { id: 'n2', label: '孤立' }] },
      { id: 'g2', label: 'B', nodes: [{ id: 'n3', label: '宿' }] },
      { id: 'g3', label: '空组', nodes: [] },
    ],
    flows: [
      { from: 'n1', to: 'n3', label: '同一流向' },
      { from: 'n1', to: 'n3', label: '同一流向' },
    ],
  }
  const c = validateInfoFlow(spec)
  assert.equal(c.ok, true)
  assert.ok(c.warnings.some((w) => w.includes('孤立节点')))
  assert.ok(c.warnings.some((w) => w.includes('重复流向')))
  assert.ok(c.warnings.some((w) => w.includes('没有节点')))
  const { plan } = buildDiagram(spec)
  assert.equal(plan.lanes.length, 3)
})

test('重复节点 id 是错误', () => {
  const spec = {
    groups: [
      { id: 'g1', label: 'A', nodes: [{ id: 'n1', label: '一' }] },
      { id: 'g2', label: 'B', nodes: [{ id: 'n1', label: '二' }] },
    ],
    flows: [],
  }
  const c = validateInfoFlow(spec)
  assert.equal(c.ok, false)
  assert.ok(c.errors.some((e) => e.includes('节点 id 重复')))
})

test('未定义端点是错误', () => {
  const spec = {
    groups: [{ id: 'g', label: 'A', nodes: [{ id: 'n1', label: '一' }] }],
    flows: [{ from: 'n1', to: 'nX', label: '断线' }],
  }
  const c = validateInfoFlow(spec)
  assert.equal(c.ok, false)
  assert.ok(c.errors.some((e) => e.includes('终点不存在')))
})

test('空 groups、错误方向、未知类型都是错误', () => {
  assert.equal(validateInfoFlow({ groups: [], flows: [] }).ok, false)
  assert.equal(validateInfoFlow({ groups: [{ id: 'g', nodes: [] }], direction: 'RL' }).ok, false)
  const badKind = {
    groups: [{ id: 'g', nodes: [{ id: 'n1', label: 'a' }] }],
    flows: [{ from: 'n1', to: 'n1', kind: 'magic' }],
  }
  const c = validateInfoFlow(badKind)
  assert.equal(c.ok, false)
  assert.ok(c.errors.some((e) => e.includes('kind 不支持')))
})

test('缺少 groups 时有明确错误，不抛异常', () => {
  const c = validateInfoFlow(null)
  assert.equal(c.ok, false)
  assert.match(c.errors[0], /JSON 对象/)
})

test('类型别名可识别', () => {
  assert.equal(normalizeKind('数据流'), 'data')
  assert.equal(normalizeKind('指令'), 'command')
  assert.equal(normalizeKind('广播'), 'event')
  assert.equal(normalizeKind(undefined), 'data')
  assert.equal(normalizeKind('unknown'), null)
})

test('同一规格重复生成结果一致', () => {
  const a = buildDiagram(basic)
  const b = buildDiagram(basic)
  assert.equal(a.svg, b.svg)
  assert.equal(a.mermaid, b.mermaid)
})

test('计划中的边端点在节点边框上', () => {
  const { plan } = buildDiagram(basic)
  const edge = plan.edges.find((e) => e.flow.from === 'n1' && e.flow.to === 'n3')
  const n1 = plan.nodes.find((n) => n.id === 'n1')
  const n3 = plan.nodes.find((n) => n.id === 'n3')
  assert.equal(edge.p1.x, n1.x + n1.w)
  assert.equal(edge.p2.x, n3.x)
})

test('连线标签避开节点且互不重叠', () => {
  const spec = {
    ...basic,
    flows: [
      { from: 'n1', to: 'n3', label: '遥测请求帧', kind: 'command' },
      { from: 'n1', to: 'n3', label: '状态回报', kind: 'data' },
      { from: 'n2', to: 'n4', label: '指令码', kind: 'command' },
      { from: 'n4', to: 'n3', label: '执行状态', kind: 'data' },
    ],
  }
  const { plan } = buildDiagram(spec)
  const boxes = plan.edges.map((e) => {
    const w = measureText(e.flow.label, 11) + 10
    return { x: e.labelAt.x - w / 2, y: e.labelAt.y - 9, w, h: 18, label: e.flow.label }
  })
  for (const box of boxes) {
    for (const n of plan.nodes) {
      const overlap = box.x < n.x + n.w && box.x + box.w > n.x && box.y < n.y + n.h && box.y + box.h > n.y
      assert.equal(overlap, false, `标签“${box.label}”压住节点 ${n.id}`)
    }
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
      assert.equal(overlap, false, `标签“${a.label}”与“${b.label}”重叠`)
    }
  }
})


// ---------------- 1.1.0 新增 ----------------

// PCU 示例规格（references 里的完整例子，同时检查它本身合法）
const pcuDoc = readFileSync(join(SKILL, 'references', 'pcu-example.md'), 'utf8')
const pcu = JSON.parse(pcuDoc.match(/```json\n([\s\S]*?)\n```/)[1])

// 虚构的大型模型：9 个分组、50 个节点、约 100 条流向，结构像真实星载软件（主链 + 健康字、参数、事件）
function bigModel() {
  const G = [
    ['ground', '地面测控', 5], ['obc', '星务计算机', 6], ['bus', '总线', 5], ['tmtc', '遥测遥控', 6], ['aocs', '姿轨控', 7],
    ['power', '电源', 5], ['thermal', '热控', 3], ['io', '采集执行', 9], ['mem', '存储', 4],
  ]
  let k = 0
  const groups = G.map(([id, label, n]) => ({ id, label, nodes: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, label: `${label}${i + 1}`, note: (k++ % 7 === 0) ? '周期【待确认】' : '' })) }))
  const flows = []
  const F = (a, b, kind = 'data') => flows.push({ from: a, to: b, label: `${a}→${b}`, kind })
  for (let i = 0; i < 5; i++) F(`ground${i}`, `bus${i % 2}`, 'command')
  for (let i = 0; i < 6; i++) F(`obc${i}`, 'bus0', i % 2 ? 'command' : 'data')
  F('bus0', 'tmtc0', 'command'); F('tmtc0', 'tmtc1', 'command'); F('tmtc1', 'tmtc2', 'command')
  for (const t of ['power0', 'power2', 'thermal1', 'aocs3', 'aocs1', 'io7']) F('tmtc2', t, 'command')
  for (const t of ['aocs0', 'aocs2', 'power3', 'power4', 'thermal2', 'aocs6', 'obc5']) F(t, 'tmtc3')
  F('tmtc3', 'tmtc4'); F('tmtc4', 'bus1'); F('bus1', 'ground1'); F('tmtc3', 'mem0'); F('mem0', 'tmtc5'); F('tmtc5', 'tmtc4')
  for (const s of ['io2', 'io3', 'io4']) F(s, 'bus3')
  F('bus3', 'aocs4'); F('aocs4', 'aocs0'); F('aocs0', 'aocs1'); F('aocs2', 'aocs1'); F('aocs3', 'aocs1', 'command'); F('aocs1', 'aocs5')
  F('aocs5', 'bus4', 'command'); F('bus4', 'io5', 'command'); F('bus4', 'io6', 'command'); F('io5', 'bus3'); F('aocs6', 'aocs3', 'event')
  F('io0', 'power3'); F('power3', 'power0'); F('power3', 'power1'); F('power1', 'power2', 'command'); F('power2', 'io7', 'command'); F('power0', 'io7', 'command')
  F('io1', 'thermal0'); F('thermal0', 'thermal2'); F('thermal2', 'thermal1', 'command'); F('thermal1', 'io7', 'command'); F('io7', 'io8', 'command')
  for (const t of ['power1', 'thermal2', 'aocs3', 'aocs1', 'power0', 'tmtc1']) F('mem1', t)
  for (const s of ['aocs6', 'power1', 'obc5', 'tmtc1', 'power2', 'aocs3']) F(s, 'mem3', 'event')
  for (const s of ['tmtc0', 'tmtc3', 'aocs1', 'aocs4', 'power0', 'power2', 'thermal1', 'bus3', 'bus0']) F(s, 'obc5', 'event')
  F('mem3', 'tmtc3'); F('obc4', 'aocs3', 'command'); F('obc5', 'obc4', 'event'); F('mem2', 'obc5'); F('tmtc2', 'mem1')
  return { title: '大型模型（虚构）', source: '自测用', groups, flows }
}
const big = bigModel()

const viewsOf = (spec) => [
  { view: 'full' }, { view: 'overview' }, { view: 'group', group: spec.groups[2].id }, { view: 'group', group: spec.groups[4].id },
  { view: 'chain', focus: [spec.groups[0].nodes[0].id] },
]

test('任何视图里都没有线从别的节点框上经过（PCU 和大型模型，LR 和 TB）', () => {
  for (const spec of [pcu, big, { ...pcu, direction: 'TB' }, { ...big, direction: 'TB' }]) {
    for (const v of viewsOf(spec)) {
      const r = buildDiagram(spec, v)
      assert.equal(r.metrics.edgesThroughNodes, 0, `${spec.title} ${r.model.view.label} ${spec.direction || 'LR'}`)
    }
  }
})

test('PCU 全图：交叉数明显少于 1.0.0（53 处），标签不重叠', () => {
  const r = buildDiagram(pcu)
  assert.ok(r.metrics.crossings <= 20, `交叉 ${r.metrics.crossings} 处`)
  assert.equal(r.metrics.labelOverlaps, 0)
  assert.equal(r.readable.ok, true)
})

test('自动排序：交叉不多于按给出顺序排', () => {
  for (const spec of [pcu, big]) {
    const auto = buildDiagram(spec, { order: 'auto' }).metrics.orderCrossings
    const given = buildDiagram(spec, { order: 'given' }).metrics.orderCrossings
    assert.ok(auto <= given, `${spec.title}：auto ${auto} > given ${given}`)
  }
})

test('泳道排序把联系多的分组排在一起', () => {
  const spec = {
    groups: [{ id: 'a', nodes: [{ id: 'a1' }] }, { id: 'b', nodes: [{ id: 'b1' }] }, { id: 'c', nodes: [{ id: 'c1' }] }],
    flows: [{ from: 'a1', to: 'c1' }, { from: 'c1', to: 'a1' }, { from: 'a1', to: 'c1', label: 'x' }],
  }
  const m = normalize(spec)
  const ord = laneOrder(m, 'auto')
  assert.equal(Math.abs(ord.indexOf(0) - ord.indexOf(2)), 1)
  assert.deepEqual(laneOrder(m, 'given'), [0, 1, 2])
})

test('同一泳道相邻两节点之间的流向画成直线，不绕到泳道外', () => {
  const r = buildDiagram(pcu, { order: 'given' })
  const e = r.plan.edges.find((x) => x.flow.from === 'n18' && x.flow.to === 'n19')
  assert.equal(e.type, 'same')
  assert.equal(e.route, 'conn')
  assert.equal(e.segs.length, 1)
  assert.equal(e.segs[0].t, 'L')
})

test('大型模型：全图判为偏密，并建议总图、分图、链路图和 N² 矩阵', () => {
  const r = buildDiagram(big)
  assert.equal(r.readable.ok, false)
  const kinds = r.suggestedViews.map((s) => s.view)
  for (const k of ['overview', 'group', 'chain', 'matrix']) assert.ok(kinds.includes(k), `缺少 ${k}`)
  const c = checkModel(big)
  assert.ok(c.warnings.some((w) => w.includes('一张全图会看不清')))
  assert.ok(c.suggestedViews.length > 0)
})

test('总图：一对分组只有一条线，条数和方向正确', () => {
  const { model } = viewModel(normalize(pcu), { view: 'overview', minWeight: 1 })
  assert.equal(model.nodes.length, 6)
  const pairs = model.flows.map((f) => [f.from, f.to].sort().join('|'))
  assert.equal(new Set(pairs).size, pairs.length)
  const bus = model.flows.find((f) => [f.from, f.to].sort().join('|') === ['G:app', 'G:bus'].sort().join('|'))
  assert.equal(bus.weight, 8) // 总线 → 应用 6 条，应用 → 总线 2 条
  assert.equal(bus.both, true)
  assert.equal(model.flows.reduce((s, f) => s + f.weight, 0), pcu.flows.filter((f) => {
    const g = (id) => pcu.groups.find((x) => x.nodes.some((n) => n.id === id)).id
    return g(f.from) !== g(f.to)
  }).length)
})

test('总图：线多时只画主要连接，省略的条数写明', () => {
  const { model } = viewModel(normalize(big), { view: 'overview' })
  assert.ok(model.flows.length <= 15, `画了 ${model.flows.length} 条`)
  assert.ok(model.view.omitted > 0 && model.view.minWeight > 1)
  const r = buildDiagram(big, { view: 'overview' })
  assert.match(r.svg, /见 N² 接口矩阵/)
})

test('分图：只含这个分组的流向，外部节点标为 ext', () => {
  const { model } = viewModel(normalize(pcu), { view: 'group', group: '应用软件' })
  const app = new Set(pcu.groups.find((g) => g.id === 'app').nodes.map((n) => n.id))
  assert.ok(model.flows.every((f) => app.has(f.from) || app.has(f.to)))
  assert.ok(model.nodes.filter((n) => !app.has(n.id)).every((n) => n.ext))
  assert.ok(model.nodes.filter((n) => app.has(n.id)).every((n) => !n.ext))
  assert.ok(viewModel(normalize(pcu), { view: 'group', group: 'nope' }).error)
})

test('链路图：给终点时只画最短路径，列是步数，只连相邻两步', () => {
  const { model } = viewModel(normalize(pcu), { view: 'chain', focus: ['间接指令'], to: ['负载继电器'] })
  const ids = model.nodes.map((n) => n.id).sort()
  assert.deepEqual(ids, ['n12', 'n13', 'n18', 'n19', 'n2', 'n7'].sort())
  assert.deepEqual(model.groups.map((g) => g.label), ['起点', '第 1 步', '第 2 步', '第 3 步', '第 4 步'])
  const step = new Map(model.nodes.map((n) => [n.id, n.groupIndex]))
  assert.ok(model.flows.every((f) => step.get(f.to) === step.get(f.from) + 1))
  assert.ok(model.nodes.find((n) => n.id === 'n2').focus)
  assert.ok(model.nodes.every((n) => n.tag))
  assert.ok(viewModel(normalize(pcu), { view: 'chain', focus: ['负载继电器'], to: ['间接指令'] }).error)
  assert.ok(viewModel(normalize(pcu), { view: 'chain' }).error)
  const r = buildDiagram(pcu, { view: 'chain', focus: ['间接指令'], to: ['负载继电器'] })
  assert.equal(r.metrics.crossings, 0)
})

test('链路图：上游、深度限制', () => {
  const up = viewModel(normalize(pcu), { view: 'chain', focus: ['n18'], towards: 'up', depth: 1 }).model
  assert.deepEqual(up.nodes.map((n) => n.id).sort(), ['n12', 'n13', 'n14', 'n18'].sort())
  assert.equal(up.groups.at(-1).label, '起点')
})

test('建议的链路不重复（下游几乎相同的起点只留一个）', () => {
  const chains = suggestViews(normalize(pcu)).filter((s) => s.view === 'chain')
  assert.ok(chains.length >= 1 && chains.length <= 3)
  const firsts = chains.map((c) => c.focus[0])
  assert.ok(!(firsts.includes('n1') && firsts.includes('n2')), '遥测请求和间接指令下游几乎相同，不应都建议')
})

test('N² 矩阵：格子内容、无输入/无输出、分组表格', () => {
  const m = buildMatrix(pcu, 'node')
  assert.equal(m.data.items.length, 21)
  assert.equal(m.data.cells.get(`${m.data.items.findIndex((x) => x.id === 'n11')}|${m.data.items.findIndex((x) => x.id === 'n8')}`)[0].label, '遥测帧')
  assert.ok(m.data.noIn.some((x) => x.id === 'n1'))
  assert.ok(m.data.noOut.some((x) => x.id === 'n19'))
  assert.match(m.svg, /无输入/)
  const md = m.markdown({ svgFile: 'x-N2.svg', modelFile: 'x.flow.json' })
  assert.match(md, /\| 从 ＼ 到 \|/)
  assert.match(md, /\*\*遥测组帧\*\*/)
  assert.match(md, /→ 发送遥测消息〔1553B 总线（A\/B）〕：遥测帧（数据流）/)
  const g = buildMatrix(pcu, 'group')
  assert.equal(g.data.items.length, 6)
})

test('所有视图结果确定（同一输入两次输出完全相同）', () => {
  for (const v of viewsOf(big)) assert.equal(buildDiagram(big, v).svg, buildDiagram(big, v).svg)
  assert.equal(buildMatrix(big).svg, buildMatrix(big).svg)
})

test('规模：大型模型 300 节点以内可以出图，速度可接受', () => {
  const t0 = Date.now()
  buildDiagram(big)
  buildDiagram(big, { view: 'overview' })
  assert.ok(Date.now() - t0 < 5000)
  const tooMany = { groups: [{ id: 'g', nodes: Array.from({ length: 301 }, (_, i) => ({ id: `x${i}` })) }] }
  assert.ok(validateInfoFlow(tooMany).errors.some((e) => e.includes('节点过多')))
})

test('工具：第一次存模型，相同内容不重写，内容不同要 overwrite；图片可直接更新', () => {
  const root = mkdtempSync(join(tmpdir(), 'infoflow-'))
  const r1 = renderTool({ ...pcu }, root)
  const model = join(root, 'diagrams', 'PCU-软件总体信息流（示例）.flow.json')
  assert.ok(existsSync(model))
  assert.ok(existsSync(join(root, 'diagrams', 'PCU-软件总体信息流（示例）.md')))
  assert.ok(existsSync(join(root, 'diagrams', 'PCU-软件总体信息流（示例）.svg')))
  assert.match(r1.text, /新建/)
  assert.doesNotMatch(renderTool({ ...pcu }, root).text, /新建|已更新/)
  assert.throws(() => renderTool({ ...pcu, source: '改过的依据' }, root), /模型文件已存在且内容不同/)
  assert.match(renderTool({ ...pcu, source: '改过的依据' , overwrite: true }, root).text, /已更新/)
  // 从模型文件换视图出图
  const r2 = renderTool({ specFile: 'diagrams/PCU-软件总体信息流（示例）.flow.json', view: 'overview' }, root)
  assert.match(r2.text, /总图/)
  assert.ok(existsSync(join(root, 'diagrams', 'PCU-软件总体信息流（示例）-总图.md')))
  const md = readFileSync(join(root, 'diagrams', 'PCU-软件总体信息流（示例）-总图.md'), 'utf8')
  assert.match(md, /```mermaid/)
  assert.match(md, /!\[.*\]\(\.\/.*\.svg\)/)
  assert.match(md, /info-flow-diagram:generated/)
  // 一次出齐
  const r3 = renderTool({ specFile: 'diagrams/PCU-软件总体信息流（示例）.flow.json', view: 'suggested' }, root)
  assert.match(r3.text, /N² 接口矩阵/)
  assert.ok(r3.data.views.length >= 5)
  // 矩阵工具
  const r4 = matrixTool({ specFile: 'diagrams/PCU-软件总体信息流（示例）.flow.json', level: 'group' }, root)
  assert.ok(existsSync(join(root, r4.data.files.markdown)))
})

test('工具：手写的同名文件不覆盖；路径不能出工作区；specFile 和 groups 不能同时给', () => {
  const root = mkdtempSync(join(tmpdir(), 'infoflow-'))
  renderTool({ ...basic, name: 'x' }, root)
  writeFileSync(join(root, 'diagrams', 'x-总图.md'), '# 我自己写的说明\n')
  assert.throws(() => renderTool({ specFile: 'diagrams/x.flow.json', view: 'overview' }, root), /不是本工具生成的/)
  assert.equal(readFileSync(join(root, 'diagrams', 'x-总图.md'), 'utf8'), '# 我自己写的说明\n')
  assert.throws(() => renderTool({ ...basic, outputDir: '../out' }, root), /不在工作区/)
  assert.throws(() => renderTool({ specFile: '../x.flow.json' }, root), /不在工作区/)
  assert.throws(() => renderTool({ specFile: 'diagrams/x.flow.json', groups: basic.groups }, root), /只能给一种/)
  assert.throws(() => renderTool({ specFile: 'diagrams/none.flow.json' }, root), /不存在/)
  const v = validateTool({ specFile: 'diagrams/x.flow.json' }, root)
  assert.equal(v.data.ok, true)
})

test('视图文件名跟模型走：用 specFile 时不用 name，后缀不会叠两遍', () => {
  const root = mkdtempSync(join(tmpdir(), 'infoflow-'))
  renderTool({ ...pcu, name: 'PCU' }, root)
  const sf = 'diagrams/PCU.flow.json'
  const r1 = renderTool({ specFile: sf, view: 'overview', name: 'PCU-总图' }, root)
  assert.equal(r1.data.views[0].files.markdown, 'diagrams/PCU-总图.md')
  const r2 = renderTool({ specFile: sf, view: 'chain', focus: ['间接指令'], to: ['负载继电器'], name: '链路图' }, root)
  assert.equal(r2.data.views[0].files.markdown, 'diagrams/PCU-链路-间接指令-到-负载继电器.md')
  assert.match(r2.text, /没有用 name/)
  const r3 = matrixTool({ specFile: sf, name: 'N2矩阵' }, root)
  assert.equal(r3.data.files.markdown, 'diagrams/PCU-N2.md')
  // 直接给规格时 name 已带后缀，也不叠
  const r4 = renderTool({ ...pcu, name: 'PCU-总图', view: 'overview' }, mkdtempSync(join(tmpdir(), 'infoflow-')))
  assert.equal(r4.data.views[0].files.markdown, 'diagrams/PCU-总图.md')
})

test('示例模型：运行参数写入 MRAM（任务书 7），EEPROM 只出默认参数', () => {
  assert.ok(pcu.flows.some((f) => f.from === 'n12' && f.to === 'n20'))
  assert.ok(!pcu.flows.some((f) => f.to === 'n21'))
  assert.ok(pcu.groups.flatMap((g) => g.nodes).every((n) => /任务书|ICD/.test(n.note || '')), '每个节点的 note 都写了依据')
})

test('文档里的工具名和引擎配置里注册的服务名一致（内置服务 infoflow）', () => {
  const patch = readFileSync(join(REPO, 'config', 'cordis.patch.yml.template'), 'utf8')
  assert.match(patch, /serverName: infoflow\b/, 'cordis.patch.yml.template 里没有注册 infoflow 服务')
  assert.match(patch, /mcp\/infoflow\/server\.mjs/)
  const prefix = 'mcp__infoflow__'
  for (const f of [join(HERE, 'README.md'), join(SKILL, 'SKILL.md'), join(SKILL, 'tests', 'pcu-demo', 'expected.md')]) {
    const text = readFileSync(f, 'utf8').split('## 版本记录')[0] // 版本记录里可以提到插件时期的旧名字
    assert.ok(text.includes(prefix), `${f} 没写完整工具名`)
    assert.ok(!/mcp__info[-_]flow[-_]diagram/.test(text), `${f} 里还有插件时期的工具名`)
  }
})

test('交互版 HTML：一个文件含全部视图和模型数据；不联网；标签里的 </script> 不会提前结束脚本', () => {
  const ws = mkdtempSync(join(tmpdir(), 'infoflow-html-'))
  const spec = JSON.parse(JSON.stringify(basic))
  spec.groups[0].nodes[0].label = '坏</script><b>标签'
  const r = htmlTool({ ...spec, name: '交互' }, ws)
  assert.match(r.text, /已生成交互版：diagrams\/交互\.html/)
  const html = readFileSync(join(ws, 'diagrams', '交互.html'), 'utf8')
  assert.ok(html.slice(0, 600).includes(GENERATED_MARK), '带生成标记：以后能直接更新')
  assert.equal((html.match(/<\/script>/g) || []).length, 2, '只有两个脚本标签的结尾')
  const json = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1]
  const data = JSON.parse(json)
  assert.equal(data.nodes.length, normalize(spec).nodes.length)
  assert.equal(data.flows.length, spec.flows.length)
  assert.ok(data.nodes.some((n) => n.label === '坏</script><b>标签'))
  const keys = data.views.map((v) => v.key)
  assert.ok(keys.includes('full') && keys.includes('overview') && keys.includes('matrix') && keys.filter((k) => k.startsWith('group:')).length === spec.groups.length, keys.join(','))
  const fullView = data.views.find((v) => v.key === 'full')
  assert.match(fullView.svg, /class="edge" data-e="0"/)
  assert.match(fullView.svg, /class="elabel" data-e="\d+"/)
  assert.equal(fullView.edges.length, (fullView.svg.match(/class="edge"/g) || []).length, '每条线都有对应的流向信息（悬停提示用）')
  // 不引用外部资源（内网离线能用）
  assert.ok(!/(src|href)=["']https?:/i.test(html))
  assert.ok(!/@import|url\(\s*["']?https?:/i.test(html))
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/)
  // 再出一次：本工具生成的文件直接更新
  assert.doesNotThrow(() => htmlTool({ ...spec, name: '交互' }, ws))
})

test('view=suggested 时一并生成交互版 HTML', () => {
  const ws = mkdtempSync(join(tmpdir(), 'infoflow-sug-'))
  const r = renderTool({ ...basic, name: '建议', view: 'suggested' }, ws)
  assert.match(r.text, /交互版：diagrams\/建议\.html/)
  assert.ok(existsSync(join(ws, 'diagrams', '建议.html')))
  assert.ok(r.data.views.some((v) => v.view === 'html'))
})

test('MCP：initialize、tools/list（3 个工具）、tools/call', async () => {
  const input = new PassThrough()
  const output = new PassThrough()
  let buf = ''
  output.on('data', (c) => { buf += c })
  const { renderTool: rt } = await import('./tools.mjs')
  void rt
  serve({ name: 'infoflow', version: 't' }, [
    { name: 'validate_info_flow', handler: async (a) => validateTool(a) },
    { name: 'render_info_flow', handler: async () => ({ text: 'x' }) },
    { name: 'render_info_flow_matrix', handler: async () => ({ text: 'x' }) },
  ], { input, output })
  const send = (m) => input.write(JSON.stringify(m) + '\n')
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'validate_info_flow', arguments: basic } })
  await new Promise((r) => setTimeout(r, 50))
  const msgs = buf.trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(msgs[0].result.serverInfo.name, 'infoflow')
  assert.equal(msgs[1].result.tools.length, 3)
  assert.match(msgs[2].result.content[0].text, /校验：通过/)
  // 真实的 server.mjs 声明了这三个工具
  const src = readFileSync(join(HERE, 'server.mjs'), 'utf8')
  for (const n of ['validate_info_flow', 'render_info_flow', 'render_info_flow_matrix', 'export_info_flow_html']) assert.ok(src.includes(`name: '${n}'`))
  assert.ok(!/child_process|node:http|node:net|fetch\(/.test(src + readFileSync(join(HERE, 'tools.mjs'), 'utf8') + readFileSync(join(HERE, 'files.mjs'), 'utf8') + readFileSync(join(HERE, 'html.mjs'), 'utf8')))
})

await runAll()
console.log(`\n${passed} 项通过，${failed} 项失败`)
if (failed > 0) process.exit(1)
