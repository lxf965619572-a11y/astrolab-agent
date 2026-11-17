<!-- info-flow-diagram:generated 1.1.0 -->
# PCU 软件总体信息流（示例） · 链路：间接指令（到 负载继电器）

> 依据：PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）
> 由模型 `PCU-信息流.flow.json` 生成（链路：间接指令（到 负载继电器））；要修改请改模型后重新出图，不要手改本文件和图片。

![PCU 软件总体信息流（示例） · 链路：间接指令（到 负载继电器）](./PCU-%E4%BF%A1%E6%81%AF%E6%B5%81-%E9%93%BE%E8%B7%AF-%E9%97%B4%E6%8E%A5%E6%8C%87%E4%BB%A4-%E5%88%B0-%E8%B4%9F%E8%BD%BD%E7%BB%A7%E7%94%B5%E5%99%A8.svg)

<details><summary>Mermaid 源码</summary>

```mermaid
%% PCU 软件总体信息流（示例） · 链路：间接指令（到 负载继电器）
%% 依据：PCU 软件研制任务书 4.2～4.7、5、6.1、7；1553B ICD 表 1～5（虚构演示材料）
flowchart LR
  subgraph g0["起点"]
    direction TB
    n0["星务计算机（BC）：间接指令<br/>子地址 2，1 字（任务书 4.3.2；ICD 表 2）"]
  end
  subgraph g1["第 1 步"]
    direction TB
    n1["1553B 总线（A/B）：接收 BC 消息<br/>RT 地址 12/21【待确认】（任务书 6.1；ICD 表 1）"]
  end
  subgraph g2["第 2 步"]
    direction TB
    n2["应用软件：遥控指令处理<br/>指令码执行（任务书 4.3.2；ICD 表 5）"]
    n3["应用软件：充电控制<br/>4 路档位 OC（任务书 4.5.1）"]
  end
  subgraph g3["第 3 步"]
    direction TB
    n4["执行机构：OC 指令输出<br/>24 路；80/160 ms【待确认】（任务书 4.4、5、6.2）"]
  end
  subgraph g4["第 4 步"]
    direction TB
    n5["执行机构：负载继电器<br/>载荷 / 加热器 / OBC（任务书 4.4）"]
  end
  n0 ==>|指令码| n1
  n1 ==>|指令| n2
  n1 -->|参数| n2
  n1 ==>|档位| n3
  n2 ==>|加断电| n4
  n3 ==>|4 路档位| n4
  n4 ==>|80/160 ms 脉冲| n5
  style g0 fill:#f8fafc,stroke:#64748b,stroke-width:1px
  style g1 fill:#f8fafc,stroke:#64748b,stroke-width:1px
  style g2 fill:#f8fafc,stroke:#64748b,stroke-width:1px
  style g3 fill:#f8fafc,stroke:#64748b,stroke-width:1px
  style g4 fill:#f8fafc,stroke:#64748b,stroke-width:1px
  classDef pending fill:#fffbeb,stroke:#b45309,stroke-width:1.5px,stroke-dasharray:5 3
  class n1,n4 pending
  classDef focus stroke-width:3px
  class n0 focus
  linkStyle 0 stroke:#d97706,stroke-width:2.6px
  linkStyle 1 stroke:#d97706,stroke-width:2.6px
  linkStyle 2 stroke:#2563eb,stroke-width:1.8px
  linkStyle 3 stroke:#d97706,stroke-width:2.6px
  linkStyle 4 stroke:#d97706,stroke-width:2.6px
  linkStyle 5 stroke:#d97706,stroke-width:2.6px
  linkStyle 6 stroke:#d97706,stroke-width:2.6px
```

</details>

## 统计

- 分组 5 个，节点 6 个，流向 7 条。
- 连线交叉 0 处；从别的节点框上经过的线 0 条；重叠的标签 0 个。
- 可读性：在一张图能看清的范围内。

## 待确认

- 接收 BC 消息：RT 地址 12/21【待确认】（任务书 6.1；ICD 表 1）
- OC 指令输出：24 路；80/160 ms【待确认】（任务书 4.4、5、6.2）
