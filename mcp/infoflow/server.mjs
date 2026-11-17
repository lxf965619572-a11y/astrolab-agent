#!/usr/bin/env node
// 信息流图工具服务（内置，stdio MCP，由 DSH 按 cordis.patch.yml 拉起；技能见 skills/info-flow）。
// 只用 Node 内置模块和同目录的 mcp-lite.mjs；不联网、不执行外部命令、不删除文件。
// 读写文件只在工作区（process.cwd()）里：模型 <名称>.flow.json，视图 .md + .svg。

import { serve } from './mcp-lite.mjs'
import { VERSION } from './common.mjs'
import { htmlTool, matrixTool, renderTool, validateTool } from './tools.mjs'

const groupsSchema = {
  type: 'array',
  description: '分组（泳道），如“星务计算机”“1553B 总线”“应用软件”。节点按数组顺序给出（order=auto 时工具会为了少交叉调整顺序）。',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '分组 id，全图唯一，如 obc' },
      label: { type: 'string', description: '分组显示名' },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '节点 id，全图唯一，如 n1' },
            label: { type: 'string', description: '节点显示名（短名），如“遥测组帧”' },
            note: { type: 'string', description: '补充：周期、协议、依据章节；含“待确认”时画成虚线' },
          },
          required: ['id'],
        },
      },
    },
    required: ['id', 'nodes'],
  },
}

const flowsSchema = {
  type: 'array',
  description: '流向：from → to 表示信息从哪里流到哪里。',
  items: {
    type: 'object',
    properties: {
      from: { type: 'string', description: '起点节点 id' },
      to: { type: 'string', description: '终点节点 id' },
      label: { type: 'string', description: '连线标签，如“遥测帧”“指令码”' },
      kind: { type: 'string', enum: ['data', 'command', 'event'], description: 'data 数据流（蓝实线，默认）、command 控制流（橙粗线）、event 事件流（紫虚线）' },
    },
    required: ['from', 'to'],
  },
}

const specProps = {
  specFile: { type: 'string', description: '模型文件（工作区里的 <名称>.flow.json）。给了它就不要再给 groups/flows；改过模型后都用它出图' },
  title: { type: 'string', description: '图标题，如“PCU 软件总体信息流”' },
  source: { type: 'string', description: '依据，如“任务书 4.3～4.7；ICD 表 2～5”' },
  direction: { type: 'string', enum: ['LR', 'TB'], description: '泳道方向：LR 从左到右（默认），TB 从上到下' },
  order: { type: 'string', enum: ['auto', 'given'], description: 'auto（默认）：自动排泳道和节点顺序，交叉最少；given：按给出的顺序' },
  groups: groupsSchema,
  flows: flowsSchema,
}

const outProps = {
  outputDir: { type: 'string', description: '输出目录（工作区内），默认 diagrams；用 specFile 时默认是模型文件所在目录' },
  name: { type: 'string', description: '模型名（文件名前缀），只在第一次直接给规格时用，默认取 title。视图文件自动加后缀（-总图、-分图-<分组>、-链路-…、-N2），不要把后缀写进 name；用 specFile 时文件名跟模型走，不用给 name' },
  overwrite: { type: 'boolean', description: '默认 false。模型文件已存在且内容不同、或有同名的非本工具生成的文件时，要先问用户，同意后再传 true。本插件生成的图会直接更新，不需要这个参数' },
}

serve({ name: 'infoflow', version: VERSION }, [
  {
    name: 'validate_info_flow',
    description: '校验信息流模型（不写文件）：重复 id、未定义端点、孤立节点、自环、环、重复流向；模型太大一张图看不清时，给出建议的视图（总图、分图、链路图、N² 矩阵）。从文档提炼完先调用它。',
    inputSchema: { type: 'object', properties: specProps },
    handler: async (args) => validateTool(args),
  },
  {
    name: 'render_info_flow',
    description: '出信息流图：第一次直接给规格时，同时把模型存成 <名称>.flow.json（以后改模型、换视图都用 specFile）。'
      + '每个视图生成 .md（图片 + Mermaid 源码 + 统计 + 待确认清单）和 .svg。'
      + 'view：full 全图；overview 总图（每个分组一个方块，一对分组之间的流向合并成一条线）；group 分图（一个分组和它的对外接口）；'
      + 'chain 链路图（从 focus 出发，可给 to 只看到终点的最短路径）；suggested 按模型规模一次出齐建议的视图和 N² 矩阵。'
      + '返回每张图的交叉数、穿过节点的线、是否清晰；偏密时给出建议的视图。',
    inputSchema: {
      type: 'object',
      properties: {
        ...specProps,
        view: { type: 'string', enum: ['full', 'overview', 'group', 'chain', 'suggested'], description: '默认 full。大型项目先用 suggested 或 overview' },
        group: { type: 'string', description: 'view=group 时：分组 id 或名称' },
        focus: { type: 'array', items: { type: 'string' }, description: 'view=chain 时：起点节点 id 或名称（可多个）' },
        to: { type: 'array', items: { type: 'string' }, description: 'view=chain 时可选：终点节点 id 或名称；给了就只画起点到终点的最短路径' },
        towards: { type: 'string', enum: ['down', 'up', 'both'], description: 'view=chain 且没给 to 时：down 下游（默认）、up 上游、both 两头' },
        depth: { type: 'integer', description: 'view=chain 时可选：最多走几步' },
        minWeight: { type: 'integer', description: 'view=overview 时可选：一对分组之间至少几条流向才画线；默认自动（线超过 15 条时逐步提高）' },
        ...outProps,
      },
    },
    handler: async (args) => renderTool(args),
  },
  {
    name: 'render_info_flow_matrix',
    description: '出 N² 接口矩阵：对角线是节点（或分组），第 i 行第 j 列写从 i 流向 j 的内容。没有连线，规模再大也不会重叠；'
      + '同时列出没有输入、没有输出、孤立的节点，用来核对接口是否齐全。生成 .md（含分组之间的表格和逐个节点的接口清单）和 .svg。',
    inputSchema: {
      type: 'object',
      properties: {
        ...specProps,
        level: { type: 'string', enum: ['node', 'group'], description: 'node 逐个节点（默认），group 分组之间' },
        ...outProps,
      },
    },
    handler: async (args) => matrixTool(args),
  },
  {
    name: 'export_info_flow_html',
    description: '出交互版信息流图：一个 HTML 文件（不联网，浏览器直接打开），里面有全图、总图、各分图和 N² 矩阵。'
      + '可以拖动、缩放；点方块高亮它的上下游并列出流入流出；搜节点；按流向类型筛选；待确认清单；选起点和终点找最短路径。'
      + '大型项目静态全图看不清时特别有用。view=suggested 出图时会一并生成，不用单独调用。',
    inputSchema: { type: 'object', properties: { ...specProps, ...outProps } },
    handler: async (args) => htmlTool(args),
  },
])
