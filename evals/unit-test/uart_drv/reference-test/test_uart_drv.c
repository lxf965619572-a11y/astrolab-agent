/*
 * uart_drv 模块参考单元测试（人工按详细设计编写，作为评分基线）
 * 预期结果全部来自 sample/utest/uart_drv/doc/uart_drv-详细设计.md。
 * 寄存器访问由 hw/uart_reg.h 替换为寄存器模型（stub_hw.c），sys_ticks、irq_lock/irq_unlock 由 stub_sys.c 提供。
 */
#define UTEST_MAIN
#include "utest.h"
#include "uart_drv.h"
#include "uart_reg.h"
#include "ut_stubs.h"

/* 每个用例开头：模型和桩复位，驱动按 115200、无校验初始化（清空缓冲区和计数），再清掉初始化产生的写入记录 */
static void setup(void)
{
    ut_hw_reset();
    ut_sys_reset();
    (void)uart_init(115200u, UART_PARITY_NONE);
    ut_hw_reset();
    ut_sys_reset();
}

static unsigned count_writes(uint32_t ofs, uint32_t val)
{
    unsigned i, n = 0u;
    for (i = 0u; i < g_hw.nlog; i++) {
        if (g_hw.log[i].ofs == ofs && g_hw.log[i].val == val) n++;
    }
    return n;
}

static void push_n(unsigned n, uint8_t first)
{
    unsigned i;
    for (i = 0u; i < n; i++) ut_rx_push((uint8_t)(first + i), 0u);
}

static void test_init(void)
{
    static const uint32_t bauds[5] = { 9600u, 19200u, 38400u, 57600u, 115200u };
    /* 1.4 节：round(50 000 000 / (8 × baud)) − 1，手算 */
    static const uint32_t scal[5] = { 650u, 325u, 162u, 108u, 53u };
    uart_stats_t s;
    uint8_t b[4];
    unsigned i;

    UT_CASE("UT-UART-INIT-001", "上电后未初始化：计数为 0、缓冲区为空（第 2 节，最先执行）");
    ut_hw_reset(); ut_sys_reset();
    s.rx_err = 0xFFFFu; s.rx_ovf = 0xFFFFu;
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_err, 0u);
    UT_CHECK_EQ_UINT(s.rx_ovf, 0u);
    UT_CHECK_EQ_UINT(uart_read(b, 4u), 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-002", "5 种波特率的分频值（1.4 节，四舍五入后减 1）");
    for (i = 0u; i < 5u; i++) {
        ut_hw_reset();
        UT_CHECK_EQ_INT(uart_init(bauds[i], UART_PARITY_NONE), UART_OK);
        UT_CHECK_EQ_UINT(g_hw.scaler, scal[i]);
    }
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-003", "不支持的波特率返回 UART_ERR_PARAM，不访问寄存器（3.1 第 1 步）");
    ut_hw_reset();
    UT_CHECK_EQ_INT(uart_init(0u, UART_PARITY_NONE), UART_ERR_PARAM);
    UT_CHECK_EQ_INT(uart_init(4800u, UART_PARITY_NONE), UART_ERR_PARAM);
    UT_CHECK_EQ_INT(uart_init(115201u, UART_PARITY_NONE), UART_ERR_PARAM);
    UT_CHECK_EQ_INT(uart_init(9599u, UART_PARITY_NONE), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(g_hw.nlog, 0u);
    UT_CHECK_EQ_UINT(g_hw.nread, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-004", "校验方式：无 0x07、奇 0x37、偶 0x17；3 非法（3.1 第 1、2 步）");
    ut_hw_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(g_hw.ctrl, 0x07u);
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_ODD), UART_OK);
    UT_CHECK_EQ_UINT(g_hw.ctrl, 0x37u);
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_EVEN), UART_OK);
    UT_CHECK_EQ_UINT(g_hw.ctrl, 0x17u);
    ut_hw_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, 3u), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(g_hw.nlog, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-005", "寄存器写入顺序：CTRL=0、STATUS=0x70、SCALER（此时 CTRL 为 0）、CTRL=使能，共 4 次（3.1 第 2 步）");
    ut_hw_reset();
    g_hw.ctrl = 0x37u;                       /* 模拟此前处于使能状态 */
    UT_CHECK_EQ_INT(uart_init(38400u, UART_PARITY_EVEN), UART_OK);
    UT_CHECK_EQ_UINT(g_hw.nlog, 4u);
    UT_CHECK_EQ_UINT(g_hw.log[0].ofs, UART_CTRL);
    UT_CHECK_EQ_UINT(g_hw.log[0].val, 0u);
    UT_CHECK_EQ_UINT(g_hw.log[1].ofs, UART_STATUS);
    UT_CHECK_EQ_UINT(g_hw.log[1].val, 0x70u);
    UT_CHECK_EQ_UINT(g_hw.log[2].ofs, UART_SCALER);
    UT_CHECK_EQ_UINT(g_hw.log[2].val, 162u);
    UT_CHECK_EQ_UINT(g_hw.log[2].ctrl_before, 0u);
    UT_CHECK_EQ_UINT(g_hw.log[3].ofs, UART_CTRL);
    UT_CHECK_EQ_UINT(g_hw.log[3].val, 0x17u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-006", "再次初始化清空接收缓冲区和两个计数（3.1 第 3 步）");
    setup();
    ut_rx_push(0x11u, 0u);
    ut_rx_push(0x22u, UART_ST_PE);
    g_hw.ov = UART_ST_OV;
    uart_rx_isr();
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_err, 1u);          /* 先确认确实有数据和计数 */
    UT_CHECK_EQ_UINT(s.rx_ovf, 1u);
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_NONE), UART_OK);
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_err, 0u);
    UT_CHECK_EQ_UINT(s.rx_ovf, 0u);
    UT_CHECK_EQ_UINT(uart_read(b, 4u), 0u);
    UT_END_CASE();
}

static void test_send(void)
{
    static const uint8_t data[3] = { 0x12u, 0x34u, 0xA5u };
    uint16_t sent;

    UT_CASE("UT-UART-SEND-001", "buf 或 sent 为空返回 UART_ERR_NULL，不访问寄存器（3.2 第 1 步）");
    setup();
    sent = 77u;
    UT_CHECK_EQ_INT(uart_send(NULL, 3u, &sent), UART_ERR_NULL);
    UT_CHECK_EQ_INT(uart_send(data, 3u, NULL), UART_ERR_NULL);
    UT_CHECK_EQ_UINT(g_hw.nread, 0u);
    UT_CHECK_EQ_UINT(g_hw.nlog, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-SEND-002", "len 为 0：返回 UART_OK，*sent 置 0，不发送（3.2 第 2 步）");
    setup();
    sent = 99u;
    UT_CHECK_EQ_INT(uart_send(data, 0u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 0u);
    UT_CHECK_EQ_UINT(g_hw.ntx, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-SEND-003", "TH 一直就绪：3 字节按顺序写入 DATA，*sent=3（3.2 第 3、4 步）");
    setup();
    UT_CHECK_EQ_INT(uart_send(data, 3u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 3u);
    UT_CHECK_EQ_UINT(g_hw.ntx, 3u);
    UT_CHECK_EQ_MEM(g_hw.tx, data, 3u);
    UT_END_CASE();

    UT_CASE("UT-UART-SEND-004", "等待 4 tick 后就绪：不超时（边界 5−1，3.2 第 3 步）");
    setup();
    g_hw.th_busy_reads = 4u;                 /* 起点 100；4 次 TH=0 后的当前值 101～104 */
    UT_CHECK_EQ_INT(uart_send(data, 1u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 1u);
    UT_END_CASE();

    UT_CASE("UT-UART-SEND-005", "经过 5 tick 仍未就绪：超时（边界 5，第 6 次才就绪也不能成功）");
    setup();
    g_hw.th_busy_reads = 5u;                 /* 第 5 次 TH=0 后当前值 105，105−100=5 */
    UT_CHECK_EQ_INT(uart_send(data, 1u, &sent), UART_ERR_TIMEOUT);
    UT_CHECK_EQ_UINT(sent, 0u);
    UT_CHECK_EQ_UINT(g_hw.ntx, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-SEND-006", "第 3 字节超时：返回超时，*sent=2，只写入前 2 字节（3.2 第 3 步）");
    setup();
    g_hw.th_stuck_from = 2u;
    UT_CHECK_EQ_INT(uart_send(data, 3u, &sent), UART_ERR_TIMEOUT);
    UT_CHECK_EQ_UINT(sent, 2u);
    UT_CHECK_EQ_UINT(g_hw.ntx, 2u);
    UT_CHECK_EQ_MEM(g_hw.tx, data, 2u);
    UT_END_CASE();

    UT_CASE("UT-UART-SEND-007", "tick 回绕：起点 0xFFFFFFFE，等待 2 tick 后就绪，不超时（3.2 第 3 步、1.5 节）");
    setup();
    g_tick_now = 0xFFFFFFFEu;
    g_hw.th_busy_reads = 2u;                 /* 当前值 0xFFFFFFFF、0x00000000 */
    UT_CHECK_EQ_INT(uart_send(data, 1u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 1u);
    UT_END_CASE();

    UT_CASE("UT-UART-SEND-008", "tick 回绕：起点 0xFFFFFFFE，经过 5 tick（当前值 3）超时");
    setup();
    g_tick_now = 0xFFFFFFFEu;
    g_hw.th_busy_reads = 5u;
    UT_CHECK_EQ_INT(uart_send(data, 1u, &sent), UART_ERR_TIMEOUT);
    UT_CHECK_EQ_UINT(sent, 0u);
    UT_END_CASE();
}

static void test_isr(void)
{
    uint8_t b[64];
    uart_stats_t s;
    unsigned i;

    UT_CASE("UT-UART-ISR-001", "3 个正常字节按顺序存入缓冲区（3.3 第 2 步）");
    setup();
    ut_rx_push(0x01u, 0u); ut_rx_push(0x80u, 0u); ut_rx_push(0xFFu, 0u);
    uart_rx_isr();
    UT_CHECK_EQ_UINT(uart_read(b, 10u), 3u);
    UT_CHECK_EQ_UINT(b[0], 0x01u);
    UT_CHECK_EQ_UINT(b[1], 0x80u);
    UT_CHECK_EQ_UINT(b[2], 0xFFu);
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_err, 0u);
    UT_CHECK_EQ_UINT(s.rx_ovf, 0u);
    UT_CHECK_EQ_UINT(g_hw.nlog, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-002", "校验错字节丢弃，rx_err 加 1，写 STATUS=0x60 清除（3.3 第 2 步）");
    setup();
    ut_rx_push(0x41u, 0u); ut_rx_push(0x42u, UART_ST_PE); ut_rx_push(0x43u, 0u);
    uart_rx_isr();
    UT_CHECK_EQ_UINT(uart_read(b, 10u), 2u);
    UT_CHECK_EQ_UINT(b[0], 0x41u);
    UT_CHECK_EQ_UINT(b[1], 0x43u);
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_err, 1u);
    UT_CHECK_EQ_UINT(count_writes(UART_STATUS, 0x60u), 1u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-003", "只有帧错的字节同样丢弃，rx_err 加 1（3.3 第 2 步：PE=1 或 FE=1）");
    setup();
    ut_rx_push(0x51u, UART_ST_FE); ut_rx_push(0x52u, 0u);
    uart_rx_isr();
    UT_CHECK_EQ_UINT(uart_read(b, 10u), 1u);
    UT_CHECK_EQ_UINT(b[0], 0x52u);
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_err, 1u);
    UT_CHECK_EQ_UINT(count_writes(UART_STATUS, 0x60u), 1u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-004", "缓冲区满：第 33 个字节丢弃，rx_ovf 加 1，读出的是前 32 个（3.3 第 2 步）");
    setup();
    push_n(33u, 0x10u);
    uart_rx_isr(); uart_rx_isr(); uart_rx_isr();   /* 每次最多 16 字节：16+16+1 */
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_ovf, 1u);
    UT_CHECK_EQ_UINT(uart_read(b, 64u), 32u);
    for (i = 0u; i < 32u; i++) UT_CHECK_EQ_UINT(b[i], 0x10u + i);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-005", "每次中断最多读 16 字节：20 字节需两次中断（3.3 第 2 步）");
    setup();
    push_n(20u, 0x30u);
    uart_rx_isr();
    UT_CHECK_EQ_UINT(g_hw.data_reads, 16u);
    UT_CHECK_EQ_UINT(uart_read(b, 64u), 16u);
    uart_rx_isr();
    UT_CHECK_EQ_UINT(uart_read(b, 64u), 4u);
    UT_CHECK_EQ_UINT(b[0], 0x40u);
    UT_CHECK_EQ_UINT(b[3], 0x43u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-006", "DR 一直为 1（故障）：一次中断只读 16 次后返回（3.3 第 2 步）");
    setup();
    g_hw.dr_stuck = 1;
    uart_rx_isr();
    UT_CHECK_EQ_UINT(g_hw.data_reads, 16u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-007", "硬件溢出 OV：rx_ovf 加 1，写 STATUS=0x10 清除（3.3 第 3 步）");
    setup();
    g_hw.ov = UART_ST_OV;
    uart_rx_isr();
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_ovf, 1u);
    UT_CHECK_EQ_UINT(count_writes(UART_STATUS, 0x10u), 1u);
    UT_CHECK_EQ_UINT(g_hw.ov, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-008", "缓冲区满时到达的错误字节计入 rx_err，不计入 rx_ovf（3.3 第 2 步的判断顺序）");
    setup();
    push_n(16u, 0u); uart_rx_isr();
    push_n(16u, 0u); uart_rx_isr();          /* 缓冲区满 32 */
    ut_rx_push(0x77u, UART_ST_PE);
    uart_rx_isr();
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_err, 1u);
    UT_CHECK_EQ_UINT(s.rx_ovf, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-009", "无数据时中断：不读 DATA，不写寄存器，缓冲区不变");
    setup();
    uart_rx_isr();
    UT_CHECK_EQ_UINT(g_hw.data_reads, 0u);
    UT_CHECK_EQ_UINT(g_hw.nlog, 0u);
    UT_CHECK_EQ_UINT(uart_read(b, 4u), 0u);
    UT_END_CASE();
}

static void test_read(void)
{
    uint8_t b[64];
    unsigned i, k;
    int ok;

    UT_CASE("UT-UART-READ-001", "buf 为空或 maxlen 为 0：返回 0，不调用 irq_lock，数据不被取走（3.4 第 1 步）");
    setup();
    push_n(2u, 0x60u); uart_rx_isr();
    UT_CHECK_EQ_UINT(uart_read(NULL, 4u), 0u);
    UT_CHECK_EQ_UINT(uart_read(b, 0u), 0u);
    UT_CHECK_EQ_UINT(g_irq_locks, 0u);
    UT_CHECK_EQ_UINT(uart_read(b, 4u), 2u);
    UT_END_CASE();

    UT_CASE("UT-UART-READ-002", "缓冲区为空：返回 0，irq_lock 和 irq_unlock 各一次且 key 配对（3.4 第 4 步）");
    setup();
    UT_CHECK_EQ_UINT(uart_read(b, 4u), 0u);
    UT_CHECK_EQ_UINT(g_irq_locks, 1u);
    UT_CHECK_EQ_UINT(g_irq_unlocks, 1u);
    UT_CHECK_EQ_UINT(g_irq_bad_keys, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-READ-003", "maxlen 小于字节数：先取 3 个，再取剩余 2 个，先进先出（3.4 第 3 步）");
    setup();
    push_n(5u, 0x70u); uart_rx_isr();
    UT_CHECK_EQ_UINT(uart_read(b, 3u), 3u);
    UT_CHECK_EQ_UINT(b[0], 0x70u);
    UT_CHECK_EQ_UINT(b[2], 0x72u);
    UT_CHECK_EQ_UINT(uart_read(b, 10u), 2u);
    UT_CHECK_EQ_UINT(b[0], 0x73u);
    UT_CHECK_EQ_UINT(b[1], 0x74u);
    UT_END_CASE();

    UT_CASE("UT-UART-READ-004", "maxlen 等于字节数：只写 maxlen 个，buf 之后的内容不变");
    setup();
    push_n(5u, 0x01u); uart_rx_isr();
    memset(b, 0xCC, sizeof b);
    UT_CHECK_EQ_UINT(uart_read(b, 4u), 4u);
    UT_CHECK_EQ_UINT(b[4], 0xCCu);
    UT_END_CASE();

    UT_CASE("UT-UART-READ-005", "环形缓冲区回绕：写 20 读 20、再写 20 读 20，数据正确（2 节先进先出）");
    setup();
    ok = 1;
    for (k = 0u; k < 2u; k++) {               /* 第 2 轮从位置 20 开始写，越过 32 回绕 */
        ut_hw_reset();
        push_n(20u, (uint8_t)(k * 0x40u));
        uart_rx_isr();
        uart_rx_isr();
        if (uart_read(b, 64u) != 20u) ok = 0;
        for (i = 0u; i < 20u; i++) if (b[i] != (uint8_t)(k * 0x40u + i)) ok = 0;
    }
    UT_CHECK(ok);
    UT_END_CASE();

    UT_CASE("UT-UART-READ-006", "正常读取：irq_lock 和 irq_unlock 各一次且 key 配对");
    setup();
    push_n(3u, 0u); uart_rx_isr();
    UT_CHECK_EQ_UINT(uart_read(b, 8u), 3u);
    UT_CHECK_EQ_UINT(g_irq_locks, 1u);
    UT_CHECK_EQ_UINT(g_irq_unlocks, 1u);
    UT_CHECK_EQ_UINT(g_irq_bad_keys, 0u);
    UT_END_CASE();
}

static void test_stats(void)
{
    uart_stats_t s;

    UT_CASE("UT-UART-STAT-001", "st 为空：直接返回，不调用 irq_lock（3.5 节）");
    setup();
    uart_get_stats(NULL);
    UT_CHECK_EQ_UINT(g_irq_locks, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-STAT-002", "两个计数分别输出，irq_lock/irq_unlock 配对（3.5 节）");
    setup();
    ut_rx_push(1u, UART_ST_FE); ut_rx_push(2u, UART_ST_PE); ut_rx_push(3u, UART_ST_PE | UART_ST_FE);
    g_hw.ov = UART_ST_OV;
    uart_rx_isr();
    ut_sys_reset();
    uart_get_stats(&s);
    UT_CHECK_EQ_UINT(s.rx_err, 3u);
    UT_CHECK_EQ_UINT(s.rx_ovf, 1u);
    UT_CHECK_EQ_UINT(g_irq_locks, 1u);
    UT_CHECK_EQ_UINT(g_irq_unlocks, 1u);
    UT_CHECK_EQ_UINT(g_irq_bad_keys, 0u);
    UT_END_CASE();
}

int main(void)
{
    test_init();
    test_send();
    test_isr();
    test_read();
    test_stats();
    return UT_SUMMARY();
}
