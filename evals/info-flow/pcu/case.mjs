// 信息流评测用例 pcu：PCU 应用软件（示例 2，虚构材料）。答案在这里和同目录的 答案表.md，不要给智能体看。
// 正则都只在评分时用；对不上时先看 summary.md 里列出的匹配到的节点，再决定是改模型还是改这里。

const num = (v) => new RegExp(`(?<![\\d.])${v}(?![\\d])`)

export default {
  name: 'pcu',
  title: 'PCU 应用软件信息流（示例 2）',
  // 工作区里的输入（相对示例工程），以及仓库里的种子（prepare 用它恢复、score 用它核对有没有被改）
  inputs: ['docs/PCU软件研制任务书-示例2.docx', 'docs/PCU-1553B接口控制文件-示例2.xlsx'],
  seedDir: 'sample/docs',
  prompt: '根据 docs 下的《PCU软件研制任务书-示例2.docx》和《PCU-1553B接口控制文件-示例2.xlsx》，梳理 PCU 应用软件的信息流：出全图、总图、“间接指令 → 负载继电器”的链路图和 N² 接口矩阵，列出依据和待确认问题。',

  // 技能自带的示例就是这份材料：读过它，内容分偏乐观
  contamination: {
    files: [/skills[\\/]+info-flow[\\/]+references[\\/]+pcu-example\.md/i],
    reference: 'skills/info-flow/tests/pcu-demo/expected-output/PCU-信息流.flow.json',
  },
  // 读到这些就是看了答案，结果作废
  answerFiles: [/tests[\\/]+pcu-demo/i, /expected-output/i, /expected\.md/i, /evals[\\/]+info-flow/i],

  // 泳道：每类至少有一个分组标签能对上
  groups: [
    { name: '星务计算机（BC）', re: /星务|OBC|\bBC\b|总线控制器/ },
    { name: '1553B 总线', re: /1553|总线/ },
    { name: '应用软件', re: /软件|应用|处理|功能|模块/ },
    { name: '采集电路', re: /采集|传感|模拟|温度|电路/ },
    { name: '执行机构', re: /执行|OC|继电器|负载|输出|驱动/ },
    { name: '数据存储', re: /存储|MRAM|EEPROM|存储器/ },
  ],

  // 节点类别：先按节点名匹配，名字对不上再看 note；group 限定所在分组
  nodes: {
    tmReq: { name: '遥测请求', re: /遥测.{0,6}(请求|读取|查询|轮询|取数)|(读取?|请求|查询|取).{0,4}遥测/ },
    tmFrame: { name: '遥测组帧', re: /组帧|遥测.{0,4}(打包|组装|生成|编排|准备|处理|管理|缓冲|采编)/ },
    tmSend: { name: '遥测消息', re: /(发送|回送|下传|传输|返回|接收|上传).{0,4}遥测|遥测.{0,6}(消息|发送|下传|回送|接收|上传)|RT\s*→\s*BC/ },
    tcCmd: { name: '间接指令', re: /间接指令|遥控指令|指令码|^遥控$/, group: /星务|OBC|\bBC\b|1553|总线|外部/ },
    tcProc: { name: '遥控指令处理', re: /指令.{0,4}(处理|执行|解析|分发|译码|管理)|遥控.{0,4}(处理|执行|解析|管理)/ },
    oc: { name: 'OC 指令输出', re: /OC|指令输出|脉冲输出|继电器驱动/ },
    relay: { name: '负载继电器', re: /继电器|负载|载荷|加热器/, not: /OC|切除|保护|电流|电压/ },
    sensor: { name: '采集电路', re: /模拟量|温度量|采集电路|AD|热敏|传感/, group: /采集|传感|硬件|电路|外部|模拟|温度/ },
    acqSched: { name: '数据采集调度', re: /采集/, group: /软件|应用|处理|功能|模块/ },
    charge: { name: '充电控制', re: /充电/, not: /档位设置|档位上注/ },
    overdis: { name: '过放保护', re: /过放/ },
    mram: { name: 'MRAM', re: /MRAM/i },
    eeprom: { name: 'EEPROM', re: /EEPROM/i },
  },

  // 主链：相邻两类之间要有通路（最多 maxHops 步），后一段从前一段到达的节点继续
  maxHops: 3,
  chains: [
    { name: '遥测请求 → 1553B → 遥测组帧 → 遥测消息', path: ['tmReq', 'tmFrame', 'tmSend'] },
    { name: '遥控指令 → 指令处理 → OC 指令 → 负载继电器', path: ['tcCmd', 'tcProc', 'oc', 'relay'] },
    { name: '采集电路 → 数据采集调度 → 遥测组帧', path: ['sensor', 'acqSched', 'tmFrame'] },
    { name: '数据采集调度 → 充电控制', path: ['acqSched', 'charge'] },
    { name: '数据采集调度 → 过放保护', path: ['acqSched', 'overdis'] },
  ],
  // 链路图视图：文件名里要能看出起点和终点
  chainView: { from: /间接指令|遥控|指令/, to: /继电器|负载/ },

  // 存储方向（任务书 7）：运行参数写 MRAM 三份，EEPROM 只出默认参数
  storage: {
    paramToMram: { to: 'mram', re: /参数|门限|档位|上注|三份/ },
    noInto: 'eeprom',
    defaultFrom: 'eeprom',
  },

  // 跨文件冲突。inModel：模型里要有一个【待确认】节点同时写出两个值；ctx：判断“擅自定值”时的上下文
  conflicts: [
    { id: 'C1', name: 'RT 地址：任务书 6.1 写 12，ICD 表 1 写 21', values: ['12', '21'], ctx: /RT|远程终端|地址/, inModel: true },
    { id: 'C2', name: '遥测字数：任务书 4.3.1 写 40 字，ICD 表 2 子地址 1 写 32 字（表 4 定义到 40 字）', values: ['32', '40'], ctx: /字/, inModel: true },
    { id: 'C3', name: 'OC 脉宽：任务书 4.4 写 80 ms，性能要求写 160 ms ± 10%', values: ['80', '160'], ctx: /脉|ms|毫秒/, inModel: true },
    { id: 'C4', name: '遥测刷新周期：任务书 4.3.1 / ICD 表 2 为 500 ms，性能要求为不大于 100 ms', values: ['500', '100'], ctx: /刷新|周期|遥测/ },
    { id: 'C5', name: '广播回送状态字：任务书 4.3.5 要求回送，1553B 广播消息 RT 不回状态字', all: [/广播/, /状态字/] },
  ],
  // 加分：答对说明看得更深，不计入客观项
  bonus: [
    { id: 'B1', name: '“支持全部方式码”（任务书 4.3.4）与 ICD 表 3 只列 5 个方式码', all: [/方式码/, /全部|所有|只列|仅列|5\s*个/] },
    { id: 'B2', name: '同步方式码只带 1 个 16 位数据字，本地时间是 32 位秒计数', all: [/32\s*位/, /16\s*位|1\s*个数据字|一个数据字|数据字/, /时间|同步|校时/] },
    { id: 'B3', name: 'PCU 能给星务计算机（BC 本身）断电，需要确认保护措施', all: [/星务|OBC/, /断电/, /风险|保护|确认|误|安全|互锁/] },
    { id: 'B4', name: '遥测请求的状态字响应 12 μs 是 1553B 协议芯片完成，软件不参与', all: [/12\s*(μ|u)s/, /芯片|硬件|协议/] },
  ],

  // 遥测字逐个画成节点的标志（ICD 表 4 的字段）
  telemetryWords: /母线电压|负载总电流|蓄电池组电压|充放电电流|单体电压|单错计数|指令输出状态|过放保护状态|备用/,
  telemetryWordsMax: 4,
  nodeRange: [12, 60],

  // 全图的可读性（工具同一套指标，评分时按模型重算）
  fullView: { maxCrossings: 20, maxThrough: 0 },

  // 评分时用到的数值匹配
  num,
}
