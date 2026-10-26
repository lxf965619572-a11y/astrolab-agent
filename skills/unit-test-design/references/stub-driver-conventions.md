# 驱动和桩的编写约定

## 1 目录和文件

测试代码放在被测模块目录下的 `test/`，不放进 `src/`：

```
<模块>/
  src/<模块>.c           被测代码（不修改）
  include/<模块>.h
  test/
    test_<模块>.c         驱动：main 和全部用例
    stub_<下层模块>.c     桩：被测代码调用、但不在本次测试范围内的函数
    stub_<下层模块>.h     桩的控制接口（设置返回值、读取调用记录）
    hw/                   替换用的硬件头文件（需要时）
    单元测试报告-<模块>-<日期>.md
```

调用 `run_unit_tests` 时，`sources` 只列 `src/` 中的被测文件，`tests` 列 `test/` 中的 `.c`，`includeDirs` 列 `include/` 和需要的 `test/` 子目录。

**被测模块有多个单元（多个 `.c`）时**，每个单元一个测试程序，放在 `test/<单元名>/` 下：

```
<模块>/
  src/a.c  src/b.c  src/a_hw.h
  include/a.h  include/b.h
  test/
    a/  test_a.c  stub_*.c  hw/a_hw.h  单元测试报告-a-<日期>.md
    b/  test_b.c  stub_a.c  stub_*.c   单元测试报告-b-<日期>.md
```

- 单元之间互为下层时，测一个单元时另一个单元用桩代替（如测 `b.c` 时写 `stub_a.c`），每个测试程序只编译一个被测 `.c`。把几个单元编译在一起测的是集成，发现不了单元内部的错误处理、边界和调用顺序问题，覆盖率也会因下层真实行为受限。
- 每个测试程序单独调用一次 `run_unit_tests`，`name` 用单元名，每个单元写一份报告，用自己的运行记录运行检查脚本。
- 桩要能检查被测单元对下层的调用：调用次数、参数、顺序，以及成对调用（如关中断和开中断次数相等、开中断的参数是配对的关中断返回值）。

## 2 手写驱动：utest.h

`utest.h` 由 utest 服务提供，自动加入头文件路径。C89 可用，不依赖动态内存。

```c
#define UTEST_MAIN          /* 只在含 main 的文件中定义一次 */
#include "utest.h"
#include "cmd_check.h"

static void test_param(void)
{
    UT_CASE("UT-CMD-PAR-002", "温度门限上边界 1000 合法（设计 3.3）");
    cmd_counter_reset();                                /* 用例开头设置初始状态 */
    UT_CHECK_EQ_INT(check_frame(0x0201u, 1000u), CMD_OK);
    UT_END_CASE();
}

int main(void)
{
    test_param();
    return UT_SUMMARY();    /* 返回失败用例数，必须调用 */
}
```

| 宏 | 用途 |
|---|---|
| `UT_CASE(id, desc)` / `UT_END_CASE()` | 一个用例的开始和结束，id 与报告用例表一致 |
| `UT_CHECK(cond)` | 条件为真 |
| `UT_CHECK_EQ_INT(actual, expected)` | 有符号整数相等 |
| `UT_CHECK_EQ_UINT(actual, expected)` | 无符号整数相等 |
| `UT_CHECK_NEAR(actual, expected, tol)` | 浮点在容差内 |
| `UT_CHECK_EQ_MEM(actual, expected, len)` | 内存块相等 |
| `UT_SUMMARY()` | 输出统计，返回失败用例数 |

**参数顺序：先实际值，后预期值。**预期值写常量或独立计算的结果，不调用被测函数。

一个用例只验证一个测试目的；一个目的需要多个检查时（如“长度 7、9、0 都应拒绝”）可以放在同一个用例中。

## 3 桩

被测代码调用的下层函数（驱动、其他模块），用桩代替。桩要能：

- 设置返回值（可以按调用次数设置不同的返回值）；
- 记录调用次数和最后一次（或每一次）的参数；
- 一次复位全部记录。

```c
/* stub_uart.h */
typedef struct {
    int      ret;            /* 下次调用的返回值 */
    unsigned calls;          /* 调用次数 */
    uint8_t  last_buf[64];   /* 最后一次发送的内容 */
    unsigned last_len;
} stub_uart_send_t;
extern stub_uart_send_t g_stub_uart_send;
void stub_uart_reset(void);

/* stub_uart.c */
#include <string.h>
#include "uart.h"            /* 被替代函数的原型，保证签名一致 */
#include "stub_uart.h"
stub_uart_send_t g_stub_uart_send;
void stub_uart_reset(void) { memset(&g_stub_uart_send, 0, sizeof g_stub_uart_send); }
int uart_send(const uint8_t *buf, unsigned len)
{
    g_stub_uart_send.calls++;
    g_stub_uart_send.last_len = len;
    if (len <= sizeof g_stub_uart_send.last_buf) memcpy(g_stub_uart_send.last_buf, buf, len);
    return g_stub_uart_send.ret;
}
```

- 桩要包含被替代函数的头文件，让编译器检查签名。
- 链接失败时工具会列出缺少的函数，逐个写桩。不要为了少写桩去改被测代码的调用。
- 桩只做记录和返回，不复制被替代函数的业务逻辑。

## 4 static 函数和 static 变量

不修改被测代码中的 `static`。需要直接测试 static 函数或检查 static 变量时，在驱动中包含被测 `.c`：

```c
#define UTEST_MAIN
#include "utest.h"
#include "../src/cmd_check.c"    /* 可以直接调用 static 函数，读取 static 变量 */
```

此时 `run_unit_tests` 的 `sources` 照常列出这个 `.c`：工具会识别出它被测试文件包含，不再单独编译，覆盖率从测试文件中统计。

不要用 `#define static` 这类做法：它会改变所有 static 的含义，包括函数内的 static 局部变量，测试的就不是原来的代码。

## 5 硬件寄存器

主机上不能访问目标机的寄存器地址。按被测代码的写法选择：

| 被测代码的写法 | 处理方法 |
|---|---|
| 通过函数访问寄存器（如 `reg_read(addr)`） | 给这些函数写桩，用数组模拟寄存器 |
| 寄存器地址宏有测试开关（如 `#ifdef UNIT_TEST`） | 用 `defines` 打开开关，指向测试数组 |
| 寄存器通过读写宏访问（如 `REG_RD(偏移)`、`REG_WR(偏移, 值)`），宏定义在单独的头文件中 | 在 `test/hw/` 中写同名头文件：偏移和位定义照设计抄写，读写宏改为调用测试函数（见下面第一个例子）。能区分读和写，可以记录每次写入的顺序和值 |
| 寄存器宏定义在单独的头文件中（如 `hw_reg.h`） | 在 `test/hw/` 中写同名头文件，`includeDirs` 把 `test/hw` 放在最前面。头文件与被测 `.c` 在同一目录时也一样，`run_unit_tests` 会自动替换（见下面“替换头文件要点”） |
| 寄存器地址直接写在被测 `.c` 中（如 `#define TMR_LOAD (*(volatile uint32_t *)0x80000100u)`） | 测试驱动 `#include "ut_map.h"`，测试开始前调用 `UT_MAP(地址, 长度)`，把这段地址映射为主机内存，用例预置寄存器值、检查最终写入值（见下面“地址映射”）。需要模拟读清除、写 1 清除、状态随读取次数变化、写入顺序时做不到，这部分列为“需目标机验证” |

替换头文件要点：

- `includeDirs` 中 `test/hw` 必须排在被测头文件目录（如 `include`）之前，否则用的还是原头文件，测试程序一运行就因为访问目标机地址而崩溃。
- 被替换的头文件与被测 `.c` 在同一目录时（如 `src/rt_hw.h`），`#include "..."` 本来会先在 `.c` 所在目录找到原头文件。`run_unit_tests` 检测到 `includeDirs` 中排在前面的目录（或 `includeDirs` 不含 `src/` 时的任一目录）里有同名头文件，会编译被测文件的影子副本（去掉被替换的头文件），被测文件本身不改动，覆盖率仍对应原文件。结果第一行会写“替换了被测文件同目录的头文件：…”，没有这一行说明没有替换成功，检查 `includeDirs` 的顺序和文件名。不要把 `src/` 放在 `test/hw` 前面。若确认工具没有替换（构建记录中仍编译 `src/` 下的原文件），可在 `cflags` 中加 `"-include", "rt_hw.h"` 预先包含替换文件：只写文件名，GCC 按 `includeDirs` 的顺序查找，找到的是排在前面的替换文件；前提是替换文件与原头文件的 include guard 宏同名（原文件的内容因此被跳过）。不要写绝对路径（换一台电脑或评分时路径不同），并在报告中写明原因。
- 替换头文件中的偏移、位定义要与设计一致，替换的只是访问方式。

**读写宏的替换**（被测代码只通过读写宏访问寄存器时最方便）：

```c
/* test/hw/uart_reg.h：替换 include/uart_reg.h。偏移和位定义照设计抄写 */
uint32_t ut_reg_read(uint32_t ofs);
void     ut_reg_write(uint32_t ofs, uint32_t v);
#define UART_RD(ofs)     ut_reg_read(ofs)
#define UART_WR(ofs, v)  ut_reg_write((ofs), (uint32_t)(v))

/* test/stub_hw.c：寄存器模型 */
uint32_t ut_reg_read(uint32_t ofs)
{
    /* 状态寄存器：按用例设置的场景返回，如前 N 次“发送忙”、接收队列中还有字节时置“数据就绪” */
    /* 数据寄存器：读一次取出接收队列中的一个字节 */
}
void ut_reg_write(uint32_t ofs, uint32_t v)
{
    /* 记录 (偏移, 值, 写入时其他寄存器的值)，再按设计模拟效果：写 1 清除、写数据寄存器即发出一个字节 */
}
```

用例检查写入记录，就能验证设计规定的写入顺序（如“先禁止收发，再写分频值，最后使能”）、写 1 清除是否执行、发送的数据是否正确。只检查寄存器最终值，顺序错误发现不了。

**指针宏的替换**：宏写成 `(*(volatile uint32_t *)地址)` 时，也可以指向一个函数，实现“读第 N 次后状态改变”，用于测试等待循环和超时：

```c
/* test/hw/hw_reg.h：替换目标机的 hw_reg.h */
extern volatile uint32_t *ut_uart_sr(void);
#define UART_SR   (*ut_uart_sr())          /* 被测代码读写 UART_SR 时调用该函数 */

/* test/stub_hw.c */
static volatile uint32_t s_uart_sr;
unsigned g_uart_sr_reads, g_uart_sr_ready_after = 3u;
volatile uint32_t *ut_uart_sr(void)
{
    if (++g_uart_sr_reads >= g_uart_sr_ready_after) s_uart_sr |= 0x1u;   /* 第 3 次读取时就绪 */
    return &s_uart_sr;
}
```

替换头文件的做法要写进报告，说明替换了哪个文件、替换后与目标机有什么不同。

**地址映射**（地址直接写在被测 `.c` 中，没有可替换的头文件时）：

```c
/* test/test_tmr.c */
#define UTEST_MAIN
#include "utest.h"
#include "ut_map.h"                     /* 由 utest 服务提供，自动加入头文件路径 */
#define REG32(a) (*(volatile uint32_t *)(a))

int main(void)
{
    if (UT_MAP(0x80000100u, 0x100u) == NULL) {   /* 映射失败：本机这段地址已被占用 */
        UT_PRINTF("[FAIL] MAP 地址映射失败\n");
        return UT_SUMMARY() + 2;
    }
    UT_CASE("UT-TMR-001", "启动定时器：写重装值和控制位");
    REG32(0x80000104u) = 0u;
    tmr_start(1000u);
    UT_CHECK_EQ_UINT(REG32(0x80000100u), 999u);
    UT_CHECK_EQ_UINT(REG32(0x80000104u), 0x3u);
    UT_END_CASE();
    return UT_SUMMARY();
}
```

映射的是普通内存：被测代码写什么就是什么，读出的是用例预置的值。等待某个状态位的循环，要在调用前把状态位预置好，否则会一直等待到超时。地址映射只在主机上的测试中使用，报告中注明“寄存器用地址映射模拟，未模拟硬件副作用”。

## 6 中断、等待循环和时序

- **中断服务程序**：在驱动中像普通函数一样直接调用。带编译器专用属性（如 `__attribute__((interrupt))`、SPARC 陷阱表声明）时，用 `defines` 把属性宏定义为空。
- **等待循环**：用桩或寄存器替换函数控制循环在第 N 次后退出；另设用例让条件一直不满足，检查设计规定的超时处理。设计没有规定超时而代码会无限等待时，用例会超时，这时记为疑似缺陷或待确认问题，不改被测代码。
- **时间相关逻辑**：时间读取函数写桩，由用例设置起始值和每次调用的增量。按设计推算每次调用返回什么值，构造“正好到超时门限”和“差 1 个 tick”两种情况；起始值取接近类型最大值（如 0xFFFFFFFE），检查计数回绕时的超时判断。
- **关中断/开中断**：桩记录调用次数和参数，每次 `lock` 返回不同的值，`unlock` 核对参数是否与对应的 `lock` 配对。函数的每条返回路径（包括提前返回）都要有用例检查次数相等。

## 7 平台差异

主机测试不能发现以下问题，相关内容写进报告的“主机测试局限”：

| 差异 | 主机（x86-64） | SPARC（BM3803 等） | D2000（ARMv8） |
|---|---|---|---|
| 字节序 | 小端 | 大端 | 小端 |
| `char` 符号 | 有符号 | 有符号 | 无符号 |
| `long` | Windows 32 位，Linux 64 位 | 32 位 | 64 位（Linux） |
| 指针 | 64 位 | 32 位 | 64 位 |
| 非对齐访问 | 允许 | 产生陷阱 | 一般允许 |

- 被测代码用移位和掩码组装多字节数据时，结果与字节序无关，主机测试有效；用指针强制转换、`memcpy` 到整型、联合体解析帧时，结果与字节序有关，主机结果不能代表目标机。
- 测 D2000 代码时，加 `cflags: ["-funsigned-char"]`，与目标机的 `char` 一致。
- 编译选项尽量接近目标机：如目标机用 C89，加 `-std=c89`；加 `-Wall -Wextra`，把编译警告中与缺陷有关的（如 `-Wparentheses`、有符号与无符号比较）写进疑似缺陷或复核意见。
