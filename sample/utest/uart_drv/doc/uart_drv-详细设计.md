# uart_drv 模块详细设计（示例，虚构）

本模块是单元测试练习用的虚构模块：RS-422 串口收发驱动，对应源码 `src/uart_drv.c`，头文件 `include/uart_drv.h`。寄存器定义在 `include/uart_reg.h`，系统时间和中断开关由其他模块提供（`include/sys_time.h`、`include/irq.h`）。单元测试的预期结果以本文件为准。

## 1 硬件接口

### 1.1 寄存器

串口控制器基地址 0x80000100，寄存器均为 32 位。本模块对寄存器的所有读写都通过 `uart_reg.h` 中的 `UART_RD(偏移)`、`UART_WR(偏移, 值)` 两个宏完成。

| 偏移 | 名称 | 说明 |
|---|---|---|
| 0x00 | DATA | 读：取出一个接收字节（低 8 位），同时该字节从控制器的接收队列中移除；写：写入一个待发送字节（低 8 位） |
| 0x04 | STATUS | 状态寄存器，位定义见 1.2 |
| 0x08 | CTRL | 控制寄存器，位定义见 1.3 |
| 0x0C | SCALER | 波特率分频值（12 位） |

### 1.2 状态寄存器 STATUS

| 位 | 名称 | 含义 |
|---|---|---|
| 0 | DR | 1：接收队列中有数据，可读 DATA |
| 1 | TS | 1：发送移位寄存器空（本模块不使用） |
| 2 | TH | 1：发送保持寄存器空，可以写入下一个发送字节 |
| 4 | OV | 1：控制器接收队列硬件溢出。写 1 清除 |
| 5 | PE | 1：当前待读的接收字节校验错。写 1 清除 |
| 6 | FE | 1：当前待读的接收字节帧错（停止位错）。写 1 清除 |

PE、FE 描述的是 DR=1 时当前待读的那个字节。

### 1.3 控制寄存器 CTRL

| 位 | 名称 | 含义 |
|---|---|---|
| 0 | RE | 接收使能 |
| 1 | TE | 发送使能 |
| 2 | RI | 接收中断使能 |
| 4 | PE | 校验使能 |
| 5 | PS | 校验选择：1 为奇校验，0 为偶校验 |

### 1.4 波特率分频

分频值 SCALER = 系统时钟 ÷（8 × 波特率）− 1，除法结果**四舍五入**取整后再减 1。系统时钟为 50 MHz（`UART_SYS_CLK_HZ`）。

### 1.5 外部函数

| 函数 | 提供者 | 说明 |
|---|---|---|
| `uint32_t sys_ticks(void)` | 时间管理模块 | 返回系统 tick 计数，1 tick = 1 ms，32 位无符号，到 0xFFFFFFFF 后回绕为 0 |
| `uint32_t irq_lock(void)` | BSP | 关中断，返回关中断前的中断状态 |
| `void irq_unlock(uint32_t key)` | BSP | 恢复中断状态，参数必须是与之配对的 `irq_lock` 的返回值 |

## 2 数据结构

- 接收缓冲区：容量 32 字节（`UART_RX_BUF_SIZE`）的环形缓冲区，先进先出。
- 接收错误计数 `rx_err`：16 位，接收字节有校验错或帧错时加 1。
- 接收溢出计数 `rx_ovf`：16 位，接收缓冲区满而丢弃字节时加 1，检测到硬件溢出（OV）时加 1。
- 上电后（调用 `uart_init` 之前）缓冲区为空，两个计数为 0。

## 3 函数设计

### 3.1 uart_init

`uart_result_t uart_init(uint32_t baud, uint8_t parity)`

1. 参数检查：`baud` 只能是 9600、19200、38400、57600、115200 之一；`parity` 只能是 0（无校验）、1（奇校验）、2（偶校验）。不满足时返回 `UART_ERR_PARAM`，**不访问任何寄存器**，不改变缓冲区和计数。
2. 按以下顺序写寄存器（分频值必须在收发禁止的状态下写入）：
   1. CTRL 写 0，禁止收发和中断；
   2. STATUS 写 OV|PE|FE（0x70），清除残留的错误位；
   3. SCALER 写按 1.4 节计算的分频值；
   4. CTRL 写使能值：RE|TE|RI，奇校验再加 PE|PS，偶校验再加 PE。
   
   除以上 4 次写入外，不写其他寄存器。
3. 清空接收缓冲区，`rx_err`、`rx_ovf` 清零。
4. 返回 `UART_OK`。

### 3.2 uart_send

`uart_result_t uart_send(const uint8_t *buf, uint16_t len, uint16_t *sent)`

1. `buf` 或 `sent` 为空指针时返回 `UART_ERR_NULL`，不访问寄存器。
2. `*sent` 置 0。`len` 为 0 时返回 `UART_OK`。
3. 按顺序逐字节发送。每个字节的处理：
   1. 调用一次 `sys_ticks()`，记为起点；
   2. 读 STATUS。TH=1 时，把该字节写入 DATA，`*sent` 加 1，处理下一个字节；
   3. TH=0 时，调用一次 `sys_ticks()` 取当前值。当前值减起点（按 32 位无符号运算，tick 回绕时结果仍正确）**大于或等于 5**（`UART_TX_TIMEOUT_MS`）时判为超时，立即返回 `UART_ERR_TIMEOUT`，`*sent` 为已写入 DATA 的字节数；否则回到第 2 步。
4. 全部字节写入后返回 `UART_OK`，`*sent` 等于 `len`。

### 3.3 uart_rx_isr

`void uart_rx_isr(void)`

接收中断服务程序，由中断向量调用（运行时中断已关闭，本函数内不调用 `irq_lock`）。

1. 读 STATUS。
2. 当 DR=1，且本次中断已读取的字节数小于 16（`UART_ISR_MAX_BYTES`）时，循环：
   1. 读 DATA 取出一个字节；
   2. 按以下顺序处理该字节（用第 1 步或上一轮第 3 步读到的 STATUS 判断）：
      - PE=1 或 FE=1：丢弃该字节，`rx_err` 加 1，STATUS 写 PE|FE（0x60）清除错误位；
      - 否则，接收缓冲区已满（32 字节）：丢弃该字节，`rx_ovf` 加 1；
      - 否则：存入接收缓冲区；
   3. 已读取字节数加 1，重新读 STATUS。
3. 循环结束后，若最后一次读到的 STATUS 中 OV=1：`rx_ovf` 加 1，STATUS 写 OV（0x10）清除。

每次中断最多读取 16 个字节，剩余字节由下一次中断处理，以限制中断服务程序的执行时间。

### 3.4 uart_read

`uint16_t uart_read(uint8_t *buf, uint16_t maxlen)`

1. `buf` 为空指针或 `maxlen` 为 0 时，直接返回 0，不调用 `irq_lock`。
2. 调用 `irq_lock` 关中断。
3. 按先进先出的顺序，从接收缓冲区取出 min（缓冲区中的字节数，`maxlen`）个字节，依次写入 `buf[0]` 起的位置。
4. 调用 `irq_unlock` 恢复中断（参数为第 2 步的返回值）。**每次调用 `irq_lock` 后必须调用且只调用一次 `irq_unlock`，包括缓冲区为空的情况。**
5. 返回取出的字节数。

### 3.5 uart_get_stats

`void uart_get_stats(uart_stats_t *st)`

- `st` 为空指针时直接返回，不调用 `irq_lock`。
- 否则在 `irq_lock` / `irq_unlock` 保护下，把 `rx_err`、`rx_ovf` 写入 `*st`。
