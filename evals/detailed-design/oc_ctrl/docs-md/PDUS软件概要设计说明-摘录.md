# 载荷配电单元软件概要设计说明（摘录）

文件编号：PDUS-HLD-001　版本：V1.0　日期：2026-09-28

说明：本文件为详细设计练习用的虚构示例，只摘录与 OC 指令输出模块（oc_ctrl）有关的章节。

## 1 引用文档

| 编号 | 名称 | 版本 |
|---|---|---|
| PDUS-SRS-001 | 载荷配电单元软件需求规格说明 | V1.0 |
| PDU-FPGA-ICD-003 | OC 输出控制器接口说明 | V1.0 |

## 2 软件结构

| 模块 | 标识 | 职责 | 运行环境 |
|---|---|---|---|
| 遥控处理 | tc_proc | 解析遥控指令，调用 oc_ctrl 执行 OC 指令和“OC 全部断开”指令 | 主循环 |
| OC 指令输出 | oc_ctrl | OC 指令的合法性检查、输出、脉宽计时、回读和计数 | 主循环、1 ms 定时中断 |
| 模式管理 | mode_mgr | 维护当前工作模式 | 主循环 |
| 时间管理 | timer | 1 ms 定时中断，中断服务程序中调用 oc_tick_isr | 中断 |
| 遥测 | tm_proc | 读取 oc_ctrl 的状态和计数，组遥测帧 | 主循环 |

## 3 执行概念

主循环依次调用 tc_proc、tm_proc 等模块。timer 模块的 1 ms 定时中断服务程序每次中断调用一次 oc_tick_isr。oc_request、oc_stop_all 在主循环中运行，oc_tick_isr 在中断中运行，二者共享 OC 输出状态，访问共享数据时须按 PDUS-CON-002 关中断保护。

## 4 oc_ctrl 模块设计

### 4.1 职责和需求分配

oc_ctrl 实现 PDUS-MOD-002、PDUS-FUN-021～025、PDUS-PER-005、PDUS-SAF-005、PDUS-DAT-007。

### 4.2 对外接口

| 接口 | 调用者 | 说明 |
|---|---|---|
| `void oc_init(void)` | 初始化程序，上电后调用一次 | 初始化 OC 输出控制器和模块数据 |
| `oc_result_t oc_request(uint8_t id, uint16_t width_ms)` | tc_proc | 请求输出一路 OC 指令。`id` 为指令编号 1～8，`width_ms` 为脉宽 10～200 ms |
| `void oc_stop_all(void)` | tc_proc | 断开全部 OC 输出 |
| `void oc_tick_isr(void)` | timer 的 1 ms 定时中断 | 脉宽计时，到时后断开输出 |
| `void oc_get_status(oc_status_t *st)` | tm_proc | 读取当前状态和各计数 |

返回值 `oc_result_t`：`OC_OK`（已开始输出）、`OC_ERR_ID`（编号非法）、`OC_ERR_WIDTH`（脉宽非法）、`OC_ERR_BUSY`（正在输出）、`OC_ERR_MODE`（当前模式禁止）。

状态结构 `oc_status_t`：当前输出的指令编号（无输出时为 0xFF）、剩余脉宽（ms）、执行计数、拒绝计数、回读故障计数。

### 4.3 使用的外部接口

| 接口 | 提供者 | 说明 |
|---|---|---|
| `uint8_t mode_get(void)` | mode_mgr | 返回 `MODE_NORMAL` 或 `MODE_SAFE` |
| `uint32_t irq_lock(void)`、`void irq_unlock(uint32_t key)` | BSP | 关中断、恢复中断 |
| `void delay_us(uint32_t us)` | BSP | 忙等待延时 |
| OC 输出控制器寄存器 | FPGA | 见 PDU-FPGA-ICD-003 |

### 4.4 设计决策

1. 为避免遥控指令丢失，oc_ctrl 设置深度为 4 的 OC 指令队列：正在输出时收到的指令进入队列，当前指令结束后按先后顺序依次输出；队列满时返回 `OC_ERR_BUSY`。
2. 脉宽计时由 oc_tick_isr 在 1 ms 定时中断中完成。
3. 寄存器访问通过 `oc_reg.h` 中的 `OC_RD`、`OC_WR` 宏完成。
