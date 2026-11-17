<!-- info-flow-diagram:generated 1.2.0 -->
# PCU 软件总体信息流（示例） · 总图

> 依据：PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）
> 由模型 `PCU-信息流.flow.json` 生成（总图）；要修改请改模型后重新出图，不要手改本文件和图片。

![PCU 软件总体信息流（示例） · 总图](./PCU-%E4%BF%A1%E6%81%AF%E6%B5%81-%E6%80%BB%E5%9B%BE.svg)

<details><summary>Mermaid 源码</summary>

```mermaid
%% PCU 软件总体信息流（示例） · 总图
%% 依据：PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）
flowchart LR
  n0["星务计算机（BC）<br/>遥测请求、间接指令、充电档位设置、运行参数上注 等 6 个<br/>6 个节点"]
  n1["1553B 总线（A/B）<br/>接收 BC 消息、发送遥测消息、方式码 / 广播<br/>3 个节点；含 2 项待确认"]
  n2["采集电路<br/>模拟量采集、温度量采集<br/>2 个节点"]
  n3["应用软件<br/>数据采集调度、遥测组帧、遥控指令处理、充电控制 等 6 个<br/>6 个节点；组内流向 5 条"]
  n4["执行机构<br/>OC 指令输出、负载继电器<br/>2 个节点；组内流向 1 条；含 1 项待确认"]
  n5["数据存储<br/>MRAM、EEPROM<br/>2 个节点"]
  n0 ==>|遥测请求、指令码 等 6 条| n1
  n1 <-->|遥测请求、指令 等 8 条| n3
  n2 -->|电压/电流、温度| n3
  n3 <-->|每 1 s 一帧、参数三份写入 等 4 条| n5
  n3 ==>|加断电、4 路档位 等 3 条| n4
  classDef pending fill:#fffbeb,stroke:#b45309,stroke-width:1.5px,stroke-dasharray:5 3
  class n1,n4 pending
  linkStyle 0 stroke:#d97706,stroke-width:5.6px
  linkStyle 1 stroke:#2563eb,stroke-width:4.2px
  linkStyle 2 stroke:#2563eb,stroke-width:2.6px
  linkStyle 3 stroke:#2563eb,stroke-width:3.4px
  linkStyle 4 stroke:#d97706,stroke-width:4.5px
```

</details>

## 统计

- 分组 4 个，节点 6 个，流向 5 条。
- 连线交叉 0 处；从别的节点框上经过的线 0 条；重叠的标签 0 个。
- 可读性：在一张图能看清的范围内。
