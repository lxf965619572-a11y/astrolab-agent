<!-- info-flow-diagram:generated 1.2.0 -->
# PCU 软件总体信息流（示例）

> 依据：PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）
> 由模型 `PCU-信息流.flow.json` 生成（全图）；要修改请改模型后重新出图，不要手改本文件和图片。

![PCU 软件总体信息流（示例）](./PCU-%E4%BF%A1%E6%81%AF%E6%B5%81.svg)

<details><summary>Mermaid 源码</summary>

```mermaid
%% PCU 软件总体信息流（示例）
%% 依据：PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）
flowchart LR
  subgraph g0["星务计算机（BC）"]
    direction TB
    n0["遥测请求<br/>子地址 1，500 ms（任务书 4.3.1）"]
    n1["间接指令<br/>子地址 2，1 字（任务书 4.3.2；ICD 表 2）"]
    n2["充电档位设置<br/>子地址 3，2 字（ICD 表 2）"]
    n3["运行参数上注<br/>子地址 31，8 字（ICD 表 2）"]
    n4["时间同步广播<br/>方式码 17，每秒（任务书 4.3.3；ICD 表 3）"]
    n5["自测试 / 复位<br/>方式码 3 / 8（任务书 4.7；ICD 表 3）"]
  end
  subgraph g1["1553B 总线（A/B）"]
    direction TB
    n6["接收 BC 消息<br/>RT 地址 12/21【待确认】（任务书 6.1；ICD 表 1）"]
    n7["发送遥测消息<br/>子地址 1；32/40 字【待确认】（ICD 表 2；任务书 4.3.1）"]
    n8["方式码 / 广播<br/>校时、自测、复位（任务书 4.3.3～4.3.5；ICD 表 3）"]
  end
  subgraph g2["应用软件"]
    direction TB
    n9["数据采集调度<br/>200 ms / 1 s（任务书 4.2）"]
    n10["遥测组帧<br/>40 字帧（任务书 4.3.1；ICD 表 4）"]
    n11["遥控指令处理<br/>指令码执行（任务书 4.3.2；ICD 表 5）"]
    n12["充电控制<br/>4 路档位 OC（任务书 4.5.1）"]
    n13["过放保护<br/>门限可上注（任务书 4.5.2）"]
    n14["自检（BIT）<br/>启动自测试方式码（任务书 4.7）"]
  end
  subgraph g3["采集电路"]
    direction TB
    n15["模拟量采集<br/>16 路，200 ms（任务书 3、4.2）"]
    n16["温度量采集<br/>8 路，1 s（任务书 3、4.2）"]
  end
  subgraph g4["执行机构"]
    direction TB
    n17["OC 指令输出<br/>24 路；80/160 ms【待确认】（任务书 4.4、5、6.2）"]
    n18["负载继电器<br/>载荷 / 加热器 / OBC（任务书 4.4）"]
  end
  subgraph g5["数据存储"]
    direction TB
    n19["MRAM<br/>遥测 24 h 循环；运行参数三份（任务书 4.6、7）"]
    n20["EEPROM<br/>固化默认参数，只读（任务书 7）"]
  end
  n0 ==>|遥测请求| n6
  n1 ==>|指令码| n6
  n2 ==>|档位| n6
  n3 -->|参数| n6
  n4 -.->|时间字| n8
  n5 ==>|方式码| n8
  n6 ==>|遥测请求| n10
  n6 ==>|指令| n11
  n6 -->|参数| n11
  n6 ==>|档位| n12
  n8 -->|时间码| n10
  n8 ==>|启动自测试| n14
  n15 -->|电压/电流| n9
  n16 -->|温度| n9
  n9 -->|采集数据| n10
  n9 -->|母线/蓄电池| n12
  n9 -->|蓄电池电压| n13
  n10 -->|遥测帧| n7
  n10 -->|每 1 s 一帧| n19
  n11 ==>|加断电| n17
  n11 ==>|充电档位| n12
  n11 -->|参数三份写入| n19
  n11 -->|过放门限| n13
  n12 ==>|4 路档位| n17
  n13 ==>|切除非关键负载| n17
  n14 -->|自检结果| n7
  n19 -->|历史遥测| n10
  n20 -->|默认门限| n13
  n17 ==>|80/160 ms 脉冲| n18
  style g0 fill:#f8fafc,stroke:#0f766e,stroke-width:1px
  style g1 fill:#f8fafc,stroke:#7c3aed,stroke-width:1px
  style g2 fill:#f8fafc,stroke:#b45309,stroke-width:1px
  style g3 fill:#f8fafc,stroke:#be123c,stroke-width:1px
  style g4 fill:#f8fafc,stroke:#0369a1,stroke-width:1px
  style g5 fill:#f8fafc,stroke:#4d7c0f,stroke-width:1px
  classDef pending fill:#fffbeb,stroke:#b45309,stroke-width:1.5px,stroke-dasharray:5 3
  class n6,n7,n17 pending
  linkStyle 0 stroke:#d97706,stroke-width:2.6px
  linkStyle 1 stroke:#d97706,stroke-width:2.6px
  linkStyle 2 stroke:#d97706,stroke-width:2.6px
  linkStyle 3 stroke:#2563eb,stroke-width:1.8px
  linkStyle 4 stroke:#7c3aed,stroke-width:1.6px,stroke-dasharray:6 4
  linkStyle 5 stroke:#d97706,stroke-width:2.6px
  linkStyle 6 stroke:#d97706,stroke-width:2.6px
  linkStyle 7 stroke:#d97706,stroke-width:2.6px
  linkStyle 8 stroke:#2563eb,stroke-width:1.8px
  linkStyle 9 stroke:#d97706,stroke-width:2.6px
  linkStyle 10 stroke:#2563eb,stroke-width:1.8px
  linkStyle 11 stroke:#d97706,stroke-width:2.6px
  linkStyle 12 stroke:#2563eb,stroke-width:1.8px
  linkStyle 13 stroke:#2563eb,stroke-width:1.8px
  linkStyle 14 stroke:#2563eb,stroke-width:1.8px
  linkStyle 15 stroke:#2563eb,stroke-width:1.8px
  linkStyle 16 stroke:#2563eb,stroke-width:1.8px
  linkStyle 17 stroke:#2563eb,stroke-width:1.8px
  linkStyle 18 stroke:#2563eb,stroke-width:1.8px
  linkStyle 19 stroke:#d97706,stroke-width:2.6px
  linkStyle 20 stroke:#d97706,stroke-width:2.6px
  linkStyle 21 stroke:#2563eb,stroke-width:1.8px
  linkStyle 22 stroke:#2563eb,stroke-width:1.8px
  linkStyle 23 stroke:#d97706,stroke-width:2.6px
  linkStyle 24 stroke:#d97706,stroke-width:2.6px
  linkStyle 25 stroke:#2563eb,stroke-width:1.8px
  linkStyle 26 stroke:#2563eb,stroke-width:1.8px
  linkStyle 27 stroke:#2563eb,stroke-width:1.8px
  linkStyle 28 stroke:#d97706,stroke-width:2.6px
```

</details>

## 统计

- 分组 6 个，节点 21 个，流向 29 条。
- 连线交叉 18 处；从别的节点框上经过的线 0 条；重叠的标签 0 个。
- 可读性：在一张图能看清的范围内。

## 待确认

- 接收 BC 消息：RT 地址 12/21【待确认】（任务书 6.1；ICD 表 1）
- 发送遥测消息：子地址 1；32/40 字【待确认】（ICD 表 2；任务书 4.3.1）
- OC 指令输出：24 路；80/160 ms【待确认】（任务书 4.4、5、6.2）
