<!-- info-flow-diagram:generated 1.2.0 -->
# PCU 软件总体信息流（示例） · 分图：应用软件

> 依据：PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）
> 由模型 `PCU-信息流.flow.json` 生成（分图：应用软件）；要修改请改模型后重新出图，不要手改本文件和图片。

![PCU 软件总体信息流（示例） · 分图：应用软件](./PCU-%E4%BF%A1%E6%81%AF%E6%B5%81-%E5%88%86%E5%9B%BE-%E5%BA%94%E7%94%A8%E8%BD%AF%E4%BB%B6.svg)

<details><summary>Mermaid 源码</summary>

```mermaid
%% PCU 软件总体信息流（示例） · 分图：应用软件
%% 依据：PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）
flowchart LR
  subgraph g0["1553B 总线（A/B）"]
    direction TB
    n0["接收 BC 消息<br/>RT 地址 12/21【待确认】（任务书 6.1；ICD 表 1）"]
    n1["发送遥测消息<br/>子地址 1；32/40 字【待确认】（ICD 表 2；任务书 4.3.1）"]
    n2["方式码 / 广播<br/>校时、自测、复位（任务书 4.3.3～4.3.5；ICD 表 3）"]
  end
  subgraph g1["应用软件"]
    direction TB
    n3["数据采集调度<br/>200 ms / 1 s（任务书 4.2）"]
    n4["遥测组帧<br/>40 字帧（任务书 4.3.1；ICD 表 4）"]
    n5["遥控指令处理<br/>指令码执行（任务书 4.3.2；ICD 表 5）"]
    n6["充电控制<br/>4 路档位 OC（任务书 4.5.1）"]
    n7["过放保护<br/>门限可上注（任务书 4.5.2）"]
    n8["自检（BIT）<br/>启动自测试方式码（任务书 4.7）"]
  end
  subgraph g2["采集电路"]
    direction TB
    n9["模拟量采集<br/>16 路，200 ms（任务书 3、4.2）"]
    n10["温度量采集<br/>8 路，1 s（任务书 3、4.2）"]
  end
  subgraph g3["执行机构"]
    direction TB
    n11["OC 指令输出<br/>24 路；80/160 ms【待确认】（任务书 4.4、5、6.2）"]
  end
  subgraph g4["数据存储"]
    direction TB
    n12["MRAM<br/>遥测 24 h 循环；运行参数三份（任务书 4.6、7）"]
    n13["EEPROM<br/>固化默认参数，只读（任务书 7）"]
  end
  n0 ==>|遥测请求| n4
  n0 ==>|指令| n5
  n0 -->|参数| n5
  n0 ==>|档位| n6
  n2 -->|时间码| n4
  n2 ==>|启动自测试| n8
  n9 -->|电压/电流| n3
  n10 -->|温度| n3
  n3 -->|采集数据| n4
  n3 -->|母线/蓄电池| n6
  n3 -->|蓄电池电压| n7
  n4 -->|遥测帧| n1
  n4 -->|每 1 s 一帧| n12
  n5 ==>|加断电| n11
  n5 ==>|充电档位| n6
  n5 -->|参数三份写入| n12
  n5 -->|过放门限| n7
  n6 ==>|4 路档位| n11
  n7 ==>|切除非关键负载| n11
  n8 -->|自检结果| n1
  n12 -->|历史遥测| n4
  n13 -->|默认门限| n7
  style g0 fill:#f8fafc,stroke:#7c3aed,stroke-width:1px
  style g1 fill:#f8fafc,stroke:#b45309,stroke-width:1px
  style g2 fill:#f8fafc,stroke:#be123c,stroke-width:1px
  style g3 fill:#f8fafc,stroke:#0369a1,stroke-width:1px
  style g4 fill:#f8fafc,stroke:#4d7c0f,stroke-width:1px
  classDef pending fill:#fffbeb,stroke:#b45309,stroke-width:1.5px,stroke-dasharray:5 3
  class n0,n1,n11 pending
  classDef ext fill:#f8fafc,stroke:#94a3b8,color:#64748b,stroke-dasharray:3 3
  class n0,n1,n2,n9,n10,n11,n12,n13 ext
  linkStyle 0 stroke:#d97706,stroke-width:2.6px
  linkStyle 1 stroke:#d97706,stroke-width:2.6px
  linkStyle 2 stroke:#2563eb,stroke-width:1.8px
  linkStyle 3 stroke:#d97706,stroke-width:2.6px
  linkStyle 4 stroke:#2563eb,stroke-width:1.8px
  linkStyle 5 stroke:#d97706,stroke-width:2.6px
  linkStyle 6 stroke:#2563eb,stroke-width:1.8px
  linkStyle 7 stroke:#2563eb,stroke-width:1.8px
  linkStyle 8 stroke:#2563eb,stroke-width:1.8px
  linkStyle 9 stroke:#2563eb,stroke-width:1.8px
  linkStyle 10 stroke:#2563eb,stroke-width:1.8px
  linkStyle 11 stroke:#2563eb,stroke-width:1.8px
  linkStyle 12 stroke:#2563eb,stroke-width:1.8px
  linkStyle 13 stroke:#d97706,stroke-width:2.6px
  linkStyle 14 stroke:#d97706,stroke-width:2.6px
  linkStyle 15 stroke:#2563eb,stroke-width:1.8px
  linkStyle 16 stroke:#2563eb,stroke-width:1.8px
  linkStyle 17 stroke:#d97706,stroke-width:2.6px
  linkStyle 18 stroke:#d97706,stroke-width:2.6px
  linkStyle 19 stroke:#2563eb,stroke-width:1.8px
  linkStyle 20 stroke:#2563eb,stroke-width:1.8px
  linkStyle 21 stroke:#2563eb,stroke-width:1.8px
```

</details>

## 统计

- 分组 5 个，节点 14 个，流向 22 条。
- 连线交叉 11 处；从别的节点框上经过的线 0 条；重叠的标签 0 个。
- 可读性：在一张图能看清的范围内。

## 待确认

- 接收 BC 消息：RT 地址 12/21【待确认】（任务书 6.1；ICD 表 1）
- 发送遥测消息：子地址 1；32/40 字【待确认】（ICD 表 2；任务书 4.3.1）
- OC 指令输出：24 路；80/160 ms【待确认】（任务书 4.4、5、6.2）
