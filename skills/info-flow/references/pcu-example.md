# PCU 软件总体信息流（示例模型）

本规格由演示材料 `PCU软件研制任务书-示例2.docx` 和 `PCU-1553B接口控制文件-示例2.xlsx` 提炼，材料均为虚构演示文件。可作为 `render_info_flow` 的完整输入示例（第一次出图后工具会把它存成 `PCU-软件总体信息流（示例）.flow.json`，之后用 `specFile` 出其他视图）。

## 图规格（JSON）

```json
{
  "title": "PCU 软件总体信息流（示例）",
  "source": "PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）",
  "direction": "LR",
  "groups": [
    {
      "id": "obc",
      "label": "星务计算机（BC）",
      "nodes": [
        {"id": "n1", "label": "遥测请求", "note": "子地址 1，500 ms（任务书 4.3.1）"},
        {"id": "n2", "label": "间接指令", "note": "子地址 2，1 字（任务书 4.3.2；ICD 表 2）"},
        {"id": "n3", "label": "充电档位设置", "note": "子地址 3，2 字（ICD 表 2）"},
        {"id": "n4", "label": "运行参数上注", "note": "子地址 31，8 字（ICD 表 2）"},
        {"id": "n5", "label": "时间同步广播", "note": "方式码 17，每秒（任务书 4.3.3；ICD 表 3）"},
        {"id": "n6", "label": "自测试 / 复位", "note": "方式码 3 / 8（任务书 4.7；ICD 表 3）"}
      ]
    },
    {
      "id": "bus",
      "label": "1553B 总线（A/B）",
      "nodes": [
        {"id": "n7", "label": "接收 BC 消息", "note": "RT 地址 12/21【待确认】（任务书 6.1；ICD 表 1）"},
        {"id": "n8", "label": "发送遥测消息", "note": "子地址 1；32/40 字【待确认】（ICD 表 2；任务书 4.3.1）"},
        {"id": "n9", "label": "方式码 / 广播", "note": "校时、自测、复位（任务书 4.3.3～4.3.5；ICD 表 3）"}
      ]
    },
    {
      "id": "app",
      "label": "应用软件",
      "nodes": [
        {"id": "n10", "label": "数据采集调度", "note": "200 ms / 1 s（任务书 4.2）"},
        {"id": "n11", "label": "遥测组帧", "note": "40 字帧（任务书 4.3.1；ICD 表 4）"},
        {"id": "n12", "label": "遥控指令处理", "note": "指令码执行（任务书 4.3.2；ICD 表 5）"},
        {"id": "n13", "label": "充电控制", "note": "4 路档位 OC（任务书 4.5.1）"},
        {"id": "n14", "label": "过放保护", "note": "门限可上注（任务书 4.5.2）"},
        {"id": "n15", "label": "自检（BIT）", "note": "启动自测试方式码（任务书 4.7）"}
      ]
    },
    {
      "id": "sensor",
      "label": "采集电路",
      "nodes": [
        {"id": "n16", "label": "模拟量采集", "note": "16 路，200 ms（任务书 3、4.2）"},
        {"id": "n17", "label": "温度量采集", "note": "8 路，1 s（任务书 3、4.2）"}
      ]
    },
    {
      "id": "actuator",
      "label": "执行机构",
      "nodes": [
        {"id": "n18", "label": "OC 指令输出", "note": "24 路；80/160 ms【待确认】（任务书 4.4、5、6.2）"},
        {"id": "n19", "label": "负载继电器", "note": "载荷 / 加热器 / OBC（任务书 4.4）"}
      ]
    },
    {
      "id": "mem",
      "label": "数据存储",
      "nodes": [
        {"id": "n20", "label": "MRAM", "note": "遥测 24 h 循环；运行参数三份（任务书 4.6、7）"},
        {"id": "n21", "label": "EEPROM", "note": "固化默认参数，只读（任务书 7）"}
      ]
    }
  ],
  "flows": [
    {"from": "n1", "to": "n7", "label": "遥测请求", "kind": "command"},
    {"from": "n2", "to": "n7", "label": "指令码", "kind": "command"},
    {"from": "n3", "to": "n7", "label": "档位", "kind": "command"},
    {"from": "n4", "to": "n7", "label": "参数", "kind": "data"},
    {"from": "n5", "to": "n9", "label": "时间字", "kind": "event"},
    {"from": "n6", "to": "n9", "label": "方式码", "kind": "command"},
    {"from": "n7", "to": "n11", "label": "遥测请求", "kind": "command"},
    {"from": "n7", "to": "n12", "label": "指令", "kind": "command"},
    {"from": "n7", "to": "n12", "label": "参数", "kind": "data"},
    {"from": "n7", "to": "n13", "label": "档位", "kind": "command"},
    {"from": "n9", "to": "n11", "label": "时间码", "kind": "data"},
    {"from": "n9", "to": "n15", "label": "启动自测试", "kind": "command"},
    {"from": "n16", "to": "n10", "label": "电压/电流", "kind": "data"},
    {"from": "n17", "to": "n10", "label": "温度", "kind": "data"},
    {"from": "n10", "to": "n11", "label": "采集数据", "kind": "data"},
    {"from": "n10", "to": "n13", "label": "母线/蓄电池", "kind": "data"},
    {"from": "n10", "to": "n14", "label": "蓄电池电压", "kind": "data"},
    {"from": "n11", "to": "n8", "label": "遥测帧", "kind": "data"},
    {"from": "n11", "to": "n20", "label": "每 1 s 一帧", "kind": "data"},
    {"from": "n12", "to": "n18", "label": "加断电", "kind": "command"},
    {"from": "n12", "to": "n13", "label": "充电档位", "kind": "command"},
    {"from": "n12", "to": "n20", "label": "参数三份写入", "kind": "data"},
    {"from": "n12", "to": "n14", "label": "过放门限", "kind": "data"},
    {"from": "n13", "to": "n18", "label": "4 路档位", "kind": "command"},
    {"from": "n14", "to": "n18", "label": "切除非关键负载", "kind": "command"},
    {"from": "n15", "to": "n8", "label": "自检结果", "kind": "data"},
    {"from": "n20", "to": "n11", "label": "历史遥测", "kind": "data"},
    {"from": "n21", "to": "n14", "label": "默认门限", "kind": "data"},
    {"from": "n18", "to": "n19", "label": "80/160 ms 脉冲", "kind": "command"}
  ]
}
```

## 依据对照

- 外部接口、RT 地址、子地址 1/2/3/31、方式码 17/3/8：任务书 6.1、4.3；ICD 表 1～3。
- 采集周期 200 ms / 1 s、遥测 40 字、存储 24 h：任务书 4.2、4.3.1、4.6。
- 充电控制、过放保护、OC 指令：任务书 4.4、4.5；ICD 表 5。
- 运行参数（过放门限、充电档位等）在 MRAM 中三份存储、三取二表决，EEPROM 只存固化的默认参数：任务书 3、7。所以“参数写入”指向 MRAM，EEPROM 只有“默认门限”一条输出。（1.1.0 初版这里误画成写入 EEPROM，试用时智能体对照任务书 7 发现并改正。）
- 自检与 BIT 字：任务书 4.7；ICD 表 3 方式码 3/19。

## 图中的待确认标记

- `n7`：任务书 6.1 写 RT 地址 12，ICD 表 1 写 21。
- `n8`：任务书 4.3.1 写 40 个数据字，ICD 表 2 写子地址 1 为 32 字，表 4 又定义到 40 字。
- `n18`：任务书 4.4 写 OC 脉冲 80 ms，性能要求写 160 ms ± 10%。

其余跨文件不一致（遥测刷新周期、遥测响应时间、广播是否回状态字）在技能输出的“待确认问题”中列出，不强行画进图里。

