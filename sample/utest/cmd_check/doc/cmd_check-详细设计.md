# cmd_check 模块详细设计（示例，虚构）

本模块是单元测试练习用的虚构模块，对应源码 `src/cmd_check.c`、头文件 `include/cmd_check.h`。单元测试的预期结果以本文件为准。

## 1 指令帧格式

指令帧固定 8 字节，多字节字段高字节在前：

| 字节 | 内容 |
|---|---|
| 0～1 | 同步字 0xEB、0x90 |
| 2～3 | 指令码（16 位） |
| 4～5 | 指令参数（16 位，无符号） |
| 6～7 | 校验和：字节 0～5 的累加和，取低 16 位 |

## 2 指令码表

| 指令码 | 名称 | 允许的工作模式 | 参数要求 |
|---|---|---|---|
| 0x0101 | 载荷加电 | 正常、维护（安全模式禁止） | 必须为 0 |
| 0x0102 | 载荷断电 | 全部模式 | 必须为 0 |
| 0x0201 | 设置加热器温度门限 | 正常、维护（安全模式禁止） | 0～1000（含两端） |
| 0x0301 | 程序上注使能 | 仅维护模式 | 必须为 0x5A5A |
| 0x0FFF | 软件复位 | 全部模式 | 必须为 0xA5A5 |

工作模式：正常（MODE_NORMAL）、安全（MODE_SAFE）、维护（MODE_MAINT）。

## 3 函数设计

### 3.1 cmd_checksum

`uint16_t cmd_checksum(const uint8_t *buf, uint16_t len)`

- 返回 `buf[0]` 至 `buf[len-1]` 各字节的累加和，取低 16 位（溢出回绕）。
- `buf` 为空指针时返回 0。
- `len` 为 0 时返回 0。

### 3.2 cmd_check

`cmd_result_t cmd_check(const uint8_t *frame, uint16_t len, work_mode_t mode)`

按以下顺序检查，遇到第一个不满足的项即返回对应错误码，不再检查后续项；全部满足时返回 `CMD_OK`：

| 顺序 | 检查项 | 不满足时返回 |
|---|---|---|
| 1 | `frame` 不为空指针 | `CMD_ERR_NULL` |
| 2 | `len` 等于 8 | `CMD_ERR_LEN` |
| 3 | 字节 0 为 0xEB **且**字节 1 为 0x90 | `CMD_ERR_SYNC` |
| 4 | 字节 6～7 的值等于字节 0～5 的累加和 | `CMD_ERR_SUM` |
| 5 | 指令码在第 2 节指令码表中 | `CMD_ERR_CODE` |
| 6 | 当前工作模式允许该指令（见第 2 节） | `CMD_ERR_MODE` |
| 7 | 参数满足该指令的参数要求（见第 2 节） | `CMD_ERR_PARAM` |

本函数不修改指令计数。

### 3.3 cmd_counter_update

`void cmd_counter_update(cmd_result_t result)`

- `result` 为 `CMD_OK` 时，接收计数加 1。接收计数为 8 位，255 再加 1 回绕为 0。
- `result` 为其他值时，错误计数加 1。错误计数为 8 位，**到 255 后保持 255，不回绕**。

### 3.4 cmd_get_accept_count、cmd_get_error_count

分别返回当前接收计数、错误计数。

### 3.5 cmd_counter_reset

接收计数和错误计数清零。上电后两个计数的初值为 0。
