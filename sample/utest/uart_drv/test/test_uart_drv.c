/*
 * 文件名：test_uart_drv.c
 * 功能：  uart_drv 模块单元测试驱动（手写驱动 + 桩，utest.h）
 * 平台：  主机（x86-64）编译运行，目标平台 BM3803（SPARC V8）裸机
 * 依据：  doc/uart_drv-详细设计.md
 *
 * 说明：
 *   1) 按单元测试约定 #include 被测 .c，用于把模块内部 static 状态复位到
 *      上电初值（只做用例的初始状态设置，预期结果仍按设计推出）。被测
 *      代码一个字符都不改。
 *   2) 寄存器读写宏由 test/hw/uart_reg.h 替换为 stub_hw.c 中的寄存器模型，
 *      可记录每次写入的偏移、值、写入时刻的 CTRL/SCALER，用于检查设计
 *      规定的写入顺序。
 *   3) sys_ticks、irq_lock/irq_unlock 由 test/ 下的桩提供。
 */
#define UTEST_MAIN
#include "utest.h"
#include "uart_drv.h"
#include "stub_hw.h"
#include "stub_sys_time.h"
#include "stub_irq.h"
#include "../src/uart_drv.c"    /* 可直接复位 static 状态；覆盖率从本文件统计 */

#define FEED_MAX 20u

static uint32_t g_seq[FEED_MAX];

/* ---------------- 工具函数 ---------------- */

/* 把模块内部 static 状态置为上电初值（设计第 2 节），只用于用例的初始状态 */
static void uart_state_reset(void)
{
    s_rx_head = 0u;
    s_rx_tail = 0u;
    s_rx_count = 0u;
    s_rx_err = 0u;
    s_rx_ovf = 0u;
}

static void env_reset(void)
{
    uart_state_reset();
    hw_reset();
    stub_ticks_reset();
    stub_irq_reset();
}

/* 压入 n 个字节，构造"每个字节 STATUS 都置 DR（以及 bits 指定的位），
 * 读完 n 个字节后 DR=0"的序列，调用一次 uart_rx_isr()。 */
static void isr_feed(const uint8_t *vals, unsigned n, uint32_t bits)
{
    unsigned i;

    for (i = 0u; i < n; i++) {
        hw_rx_push(vals[i]);
        g_seq[i] = (uint32_t)(UART_ST_DR | bits);
    }
    g_seq[n] = bits;
    hw_status_seq(g_seq, n + 1u);
    uart_rx_isr();
}

static unsigned rd(uint8_t *buf, unsigned max)
{
    return (unsigned)uart_read(buf, (uint16_t)max);
}

/* 查找第一次写入 ofs 的下标，返回 1 表示找到 */
static int find_write(uint32_t ofs, unsigned *idx)
{
    unsigned i;

    for (i = 0u; i < hw_n_writes; i++) {
        if (hw_writes[i].ofs == ofs) {
            *idx = i;
            return 1;
        }
    }
    return 0;
}

/* ================= 1 uart_init（设计 3.1、1.4，第 2 节） ================= */

/* 上电初值：本用例必须在其他用例之前运行（设计第 2 节） */
static void test_power_on(void)
{
    uint8_t buf[8];
    uart_stats_t st;

    UT_CASE("UT-UART-INIT-001", "上电未初始化时缓冲区为空、两个计数为 0（设计第 2 节）");
    uart_state_reset();
    stub_irq_reset();
    st.rx_err = 0xAAAAu;
    st.rx_ovf = 0xBBBBu;
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 0u);
    UT_CHECK_EQ_UINT(st.rx_ovf, 0u);
    UT_CHECK_EQ_UINT(rd(buf, 8u), 0u);
    UT_END_CASE();
}

static void test_init_scaler(void)
{
    UT_CASE("UT-UART-INIT-002", "9600 的分频值为 650（系统时钟 50 MHz，设计 1.4）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(hw_scaler, 650u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-003", "19200 的分频值为 325（50000000/153600=325.52，四舍五入 326 再减 1，设计 1.4）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(19200u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(hw_scaler, 325u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-004", "38400 的分频值为 162（50000000/307200=162.76，四舍五入 163 再减 1，设计 1.4）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(38400u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(hw_scaler, 162u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-005", "57600 的分频值为 108（50000000/460800=108.51，四舍五入 109 再减 1，设计 1.4）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(57600u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(hw_scaler, 108u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-006", "115200 的分频值为 53（50000000/921600=54.25，四舍五入 54 再减 1，设计 1.4）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(115200u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(hw_scaler, 53u);
    UT_END_CASE();
}

static void test_init_ctrl(void)
{
    UT_CASE("UT-UART-INIT-007", "奇校验时 CTRL 写入 RE|TE|RI|PE|PS=0x37（设计 3.1.2.4、1.3）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_ODD), UART_OK);
    UT_CHECK_EQ_UINT(hw_ctrl, 0x37u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-008", "偶校验时 CTRL 写入 RE|TE|RI|PE=0x17（设计 3.1.2.4、1.3）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_EVEN), UART_OK);
    UT_CHECK_EQ_UINT(hw_ctrl, 0x17u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-009", "无校验时 CTRL 写入 RE|TE|RI=0x07（设计 3.1.2.4、1.3）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(hw_ctrl, 0x07u);
    UT_END_CASE();
}

static void test_init_write_order(void)
{
    UT_CASE("UT-UART-INIT-010", "按 CTRL(0)、STATUS(0x70)、SCALER、CTRL 使能的顺序共写 4 次（设计 3.1.2）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(hw_n_writes, 4u);
    UT_CHECK_EQ_UINT(hw_writes[0].ofs, UART_CTRL);
    UT_CHECK_EQ_UINT(hw_writes[0].val, 0u);
    UT_CHECK_EQ_UINT(hw_writes[1].ofs, UART_STATUS);
    UT_CHECK_EQ_UINT(hw_writes[1].val, 0x70u);
    UT_CHECK_EQ_UINT(hw_writes[2].ofs, UART_SCALER);
    UT_CHECK_EQ_UINT(hw_writes[2].val, 650u);
    UT_CHECK_EQ_UINT(hw_writes[3].ofs, UART_CTRL);
    UT_CHECK_EQ_UINT(hw_writes[3].val, 0x07u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-011", "写分频值时收发处于禁止状态（CTRL=0，设计 3.1.2）");
    {
        unsigned idx = 0u;
        int found;

        env_reset();
        UT_CHECK_EQ_INT(uart_init(115200u, UART_PARITY_ODD), UART_OK);
        found = find_write(UART_SCALER, &idx);
        UT_CHECK(found == 1);
        if (found) {
            UT_CHECK_EQ_UINT(hw_writes[idx].ctrl, 0u);
        }
    }
    UT_END_CASE();
}

static void test_init_clear_state(void)
{
    uint8_t b[2];
    uart_stats_t st;

    UT_CASE("UT-UART-INIT-012", "初始化后缓冲区清空、两个计数清零（设计 3.1.3）");
    env_reset();
    b[0] = 0x11u;
    b[1] = 0xA5u;
    isr_feed(b, 2u, 0u);
    isr_feed(&b[0], 1u, UART_ST_PE);
    st.rx_err = 0u;
    st.rx_ovf = 0u;
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 1u);          /* 初始化前有 1 次校验错 */
    UT_CHECK_EQ_INT(uart_init(9600u, UART_PARITY_NONE), UART_OK);
    UT_CHECK_EQ_UINT(rd(b, 2u), 0u);          /* 缓冲区已清空 */
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 0u);
    UT_CHECK_EQ_UINT(st.rx_ovf, 0u);
    UT_END_CASE();
}

static void test_init_param(void)
{
    uint8_t b[1];
    uart_stats_t st;

    UT_CASE("UT-UART-INIT-013", "baud=9599（最小合法值减 1）返回 UART_ERR_PARAM 且不访问寄存器、不改变状态（设计 3.1.1）");
    env_reset();
    b[0] = 0x5Au;
    isr_feed(b, 1u, 0u);                       /* 缓冲区中留 1 个字节 */
    hw_reset();
    UT_CHECK_EQ_INT(uart_init(9599u, UART_PARITY_NONE), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_CHECK_EQ_UINT(rd(b, 1u), 1u);
    UT_CHECK_EQ_UINT(b[0], 0x5Au);
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-014", "baud=115201（最大合法值加 1）返回 UART_ERR_PARAM 且不访问寄存器（设计 3.1.1）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(115201u, UART_PARITY_NONE), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-015", "baud=0xFFFFFFFF 返回 UART_ERR_PARAM 且不访问寄存器（设计 3.1.1）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(0xFFFFFFFFu, UART_PARITY_NONE), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-016", "baud=0 返回 UART_ERR_PARAM 且不访问寄存器（设计 3.1.1）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(0u, UART_PARITY_NONE), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-017", "parity=3（偶校验加 1）返回 UART_ERR_PARAM 且不访问寄存器（设计 3.1.1）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, 3u), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-018", "parity=255 返回 UART_ERR_PARAM 且不访问寄存器（设计 3.1.1）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(9600u, 255u), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-INIT-019", "baud 与 parity 同时非法时返回 UART_ERR_PARAM 且不访问寄存器（设计 3.1.1）");
    env_reset();
    UT_CHECK_EQ_INT(uart_init(12345u, 7u), UART_ERR_PARAM);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_END_CASE();
}

/* ================= 2 uart_send（设计 3.2） ================= */

static void test_send_param(void)
{
    uint16_t sent;
    uint8_t b[4];

    UT_CASE("UT-UART-SND-001", "buf 为空指针返回 UART_ERR_NULL、不访问寄存器、不修改 *sent（设计 3.2.1）");
    env_reset();
    sent = 0x5555u;
    UT_CHECK_EQ_INT(uart_send(NULL, 4u, &sent), UART_ERR_NULL);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_CHECK_EQ_UINT(sent, 0x5555u);
    UT_END_CASE();

    UT_CASE("UT-UART-SND-002", "sent 为空指针返回 UART_ERR_NULL 且不访问寄存器（设计 3.2.1）");
    env_reset();
    b[0] = 0x5Au;
    UT_CHECK_EQ_INT(uart_send(b, 1u, NULL), UART_ERR_NULL);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-SND-003", "len 为 0 返回 UART_OK、*sent 置 0、不写 DATA（设计 3.2.2）");
    env_reset();
    hw_status_hold(UART_ST_TH);
    sent = 0x5555u;
    b[0] = 0x5Au;
    UT_CHECK_EQ_INT(uart_send(b, 0u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 0u);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_END_CASE();
}

static void test_send_ok(void)
{
    uint16_t sent;
    uint8_t b[4];

    UT_CASE("UT-UART-SND-004", "TH=1 时发送 1 个字节，DATA 写入该字节、*sent=1（设计 3.2.3.2）");
    env_reset();
    hw_status_hold(UART_ST_TH);
    sent = 0u;
    b[0] = 0x5Au;
    UT_CHECK_EQ_INT(uart_send(b, 1u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 1u);
    UT_CHECK_EQ_UINT(hw_tx_len, 1u);
    UT_CHECK_EQ_UINT(hw_tx[0], 0x5Au);
    UT_END_CASE();

    UT_CASE("UT-UART-SND-005", "连续发送 4 个字节按顺序写 DATA、*sent=4（设计 3.2.3.2、3.2.4）");
    env_reset();
    hw_status_hold(UART_ST_TH);
    sent = 0u;
    b[0] = 0x01u;
    b[1] = 0x5Au;
    b[2] = 0xA5u;
    b[3] = 0xFEu;
    UT_CHECK_EQ_INT(uart_send(b, 4u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 4u);
    UT_CHECK_EQ_UINT(hw_tx_len, 4u);
    UT_CHECK_EQ_UINT(hw_tx[0], 0x01u);
    UT_CHECK_EQ_UINT(hw_tx[1], 0x5Au);
    UT_CHECK_EQ_UINT(hw_tx[2], 0xA5u);
    UT_CHECK_EQ_UINT(hw_tx[3], 0xFEu);
    UT_END_CASE();
}

static void test_send_wait(void)
{
    static const uint32_t st_busy3[4] = {0u, 0u, 0u, UART_ST_TH};
    static const uint32_t st_busy2[3] = {0u, 0u, UART_ST_TH};
    static const uint32_t tk_3[4] = {1000u, 1001u, 1002u, 1003u};
    static const uint32_t tk_4[3] = {1000u, 1002u, 1004u};
    uint16_t sent;
    uint8_t b[1];

    UT_CASE("UT-UART-SND-006", "TH 连续为 0 三次（经过 3 个 tick）后为 1，发送成功不超时（设计 3.2.3.3）");
    env_reset();
    hw_status_seq(st_busy3, 4u);
    stub_ticks_seq(tk_3, 4u);
    stub_ticks_hold(1003u);
    sent = 0u;
    b[0] = 0x5Au;
    UT_CHECK_EQ_INT(uart_send(b, 1u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 1u);
    UT_CHECK_EQ_UINT(hw_tx[0], 0x5Au);
    UT_END_CASE();

    UT_CASE("UT-UART-SND-007", "等待经过 4 个 tick（比门限少 1）不超时，随后发送成功（设计 3.2.3.3）");
    env_reset();
    hw_status_seq(st_busy2, 3u);
    stub_ticks_seq(tk_4, 3u);
    stub_ticks_hold(1004u);
    sent = 0u;
    b[0] = 0x5Au;
    UT_CHECK_EQ_INT(uart_send(b, 1u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 1u);
    UT_CHECK_EQ_UINT(hw_tx[0], 0x5Au);
    UT_END_CASE();
}

static void test_send_timeout(void)
{
    static const uint32_t st_5[5] = {0u, 0u, 0u, UART_ST_TH, UART_ST_TH};
    static const uint32_t tk_5[5] = {1000u, 1001u, 1004u, 1005u, 2000u};
    static const uint32_t st_mix[7] = {UART_ST_TH, 0u, 0u, 0u, UART_ST_TH, UART_ST_TH, UART_ST_TH};
    static const uint32_t tk_mix[6] = {500u, 600u, 601u, 604u, 605u, 2000u};
    static const uint32_t st_wrap[3] = {0u, 0u, UART_ST_TH};
    static const uint32_t tk_wrap[4] = {0xFFFFFFFEu, 0xFFFFFFFFu, 0x00000000u, 0x00000001u};
    uint16_t sent;
    uint8_t b[3];

    UT_CASE("UT-UART-SND-008", "等待正好 5 个 tick（等于门限）判为超时，返回 UART_ERR_TIMEOUT、*sent=0、不写 DATA（设计 3.2.3.3）");
    env_reset();
    hw_status_seq(st_5, 5u);
    hw_status_hold(UART_ST_TH);
    stub_ticks_seq(tk_5, 5u);
    stub_ticks_hold(2000u);
    sent = 0u;
    b[0] = 0x5Au;
    UT_CHECK_EQ_INT(uart_send(b, 1u, &sent), UART_ERR_TIMEOUT);
    UT_CHECK_EQ_UINT(sent, 0u);
    UT_CHECK_EQ_UINT(hw_tx_len, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-SND-009", "第 2 个字节超时：*sent 为已写入的 1 个字节、后面的字节不再发送（设计 3.2.3.3）");
    env_reset();
    hw_status_seq(st_mix, 7u);
    hw_status_hold(UART_ST_TH);
    stub_ticks_seq(tk_mix, 6u);
    stub_ticks_hold(2000u);
    sent = 0u;
    b[0] = 0xA1u;
    b[1] = 0xB2u;
    b[2] = 0xC3u;
    UT_CHECK_EQ_INT(uart_send(b, 3u, &sent), UART_ERR_TIMEOUT);
    UT_CHECK_EQ_UINT(sent, 1u);
    UT_CHECK_EQ_UINT(hw_tx_len, 1u);
    UT_CHECK_EQ_UINT(hw_tx[0], 0xA1u);
    UT_END_CASE();

    UT_CASE("UT-UART-SND-010", "tick 计数回绕时按 32 位无符号差判断，经过 2 个 tick 不超时（设计 3.2.3.3）");
    env_reset();
    hw_status_seq(st_wrap, 3u);
    hw_status_hold(UART_ST_TH);
    stub_ticks_seq(tk_wrap, 4u);
    stub_ticks_hold(0x00000002u);
    sent = 0u;
    b[0] = 0x5Au;
    UT_CHECK_EQ_INT(uart_send(b, 1u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 1u);
    UT_CHECK_EQ_UINT(hw_tx[0], 0x5Au);
    UT_END_CASE();
}

static void test_send_ticks_per_byte(void)
{
    uint16_t sent;
    uint8_t b[2];

    UT_CASE("UT-UART-SND-011", "每个字节各调用一次 sys_ticks 取起点（2 个字节共 2 次，设计 3.2.3.1）");
    env_reset();
    hw_status_hold(UART_ST_TH);
    stub_ticks_hold(7u);
    sent = 0u;
    b[0] = 0x12u;
    b[1] = 0x34u;
    UT_CHECK_EQ_INT(uart_send(b, 2u, &sent), UART_OK);
    UT_CHECK_EQ_UINT(sent, 2u);
    UT_CHECK_EQ_UINT(stub_ticks_calls, 2u);
    UT_END_CASE();
}

/* ================= 3 uart_rx_isr（设计 3.3） ================= */

static void test_isr_basic(void)
{
    uint8_t b[4];

    UT_CASE("UT-UART-ISR-001", "DR=0 时不读 DATA、不写 STATUS、计数不变（设计 3.3.2）");
    env_reset();
    g_seq[0] = 0u;
    hw_status_seq(g_seq, 1u);
    uart_rx_isr();
    UT_CHECK_EQ_UINT(hw_n_data_reads, 0u);
    UT_CHECK_EQ_UINT(hw_n_writes, 0u);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-002", "DR=1 时取出 1 个字节存入接收缓冲区，且中断内不调用 irq_lock（设计 3.3.1、3.3.2.2）");
    env_reset();
    b[0] = 0x5Au;
    isr_feed(b, 1u, 0u);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 0u);
    UT_CHECK_EQ_UINT(rd(b, 4u), 1u);
    UT_CHECK_EQ_UINT(b[0], 0x5Au);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-003", "DR=1 时一次中断取出 2 个字节，按先进先出保存（设计 3.3.2）");
    env_reset();
    b[0] = 0x12u;
    b[1] = 0xA5u;
    isr_feed(b, 2u, 0u);
    UT_CHECK_EQ_UINT(rd(b, 4u), 2u);
    UT_CHECK_EQ_UINT(b[0], 0x12u);
    UT_CHECK_EQ_UINT(b[1], 0xA5u);
    UT_END_CASE();
}

static void test_isr_error(void)
{
    static const uint32_t st_ov_last[2] = {UART_ST_DR, UART_ST_OV};
    uint8_t b[4];
    uart_stats_t st;
    unsigned idx = 0u;
    int found;

    UT_CASE("UT-UART-ISR-004", "PE=1 时丢弃该字节、rx_err 加 1、STATUS 写 PE|FE=0x60（设计 3.3.2.2）");
    env_reset();
    b[0] = 0x77u;
    isr_feed(b, 1u, UART_ST_PE);
    UT_CHECK_EQ_UINT(rd(b, 4u), 0u);
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 1u);
    found = find_write(UART_STATUS, &idx);
    UT_CHECK(found == 1);
    if (found) {
        UT_CHECK_EQ_UINT(hw_writes[idx].val, 0x60u);
    }
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-005", "FE=1 时丢弃该字节、rx_err 加 1、STATUS 写 PE|FE=0x60（设计 3.3.2.2）");
    env_reset();
    b[0] = 0x77u;
    isr_feed(b, 1u, UART_ST_FE);
    UT_CHECK_EQ_UINT(rd(b, 4u), 0u);
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 1u);
    found = find_write(UART_STATUS, &idx);
    UT_CHECK(found == 1);
    if (found) {
        UT_CHECK_EQ_UINT(hw_writes[idx].val, 0x60u);
    }
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-006", "PE=1 且 FE=1 时只计一次错误、只丢弃一个字节（设计 3.3.2.2）");
    env_reset();
    b[0] = 0x77u;
    isr_feed(b, 1u, UART_ST_PE | UART_ST_FE);
    UT_CHECK_EQ_UINT(rd(b, 4u), 0u);
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 1u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-011", "DR=0 且 OV=1 时 rx_ovf 加 1 并写 STATUS=0x10 清除（设计 3.3.3）");
    env_reset();
    g_seq[0] = UART_ST_OV;
    hw_status_seq(g_seq, 1u);
    uart_rx_isr();
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_ovf, 1u);
    found = find_write(UART_STATUS, &idx);
    UT_CHECK(found == 1);
    if (found) {
        UT_CHECK_EQ_UINT(hw_writes[idx].val, 0x10u);
    }
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-012", "循环结束后最后一次 STATUS 的 OV=1 时 rx_ovf 加 1 并清除（设计 3.3.3）");
    env_reset();
    b[0] = 0x33u;
    hw_rx_push(b[0]);
    hw_status_seq(st_ov_last, 2u);
    uart_rx_isr();
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_ovf, 1u);
    UT_CHECK_EQ_UINT(rd(b, 4u), 1u);
    UT_CHECK_EQ_UINT(b[0], 0x33u);
    UT_END_CASE();
}

/* 用 16 字节一次中断把 32 字节缓冲区填满 */
static void fill_rx_buffer(void)
{
    uint8_t fill[32];
    unsigned i;

    for (i = 0u; i < 32u; i++) {
        fill[i] = (uint8_t)(i + 1u);
    }
    isr_feed(fill, 16u, 0u);
    isr_feed(&fill[16], 16u, 0u);
}

static void test_isr_full(void)
{
    static const uint32_t st_ov_after_full[2] = {UART_ST_DR, UART_ST_OV};
    uint8_t fill[2];
    uint8_t out[40];
    uint8_t exp[32];
    uart_stats_t st;
    unsigned i;

    UT_CASE("UT-UART-ISR-007", "缓冲区满（32 字节）后继续来的 2 个字节丢弃、rx_ovf 加 2、缓冲区内容不变（设计 3.3.2.2、第 2 节）");
    env_reset();
    fill_rx_buffer();
    fill[0] = 0xE1u;
    fill[1] = 0xE2u;
    isr_feed(fill, 2u, 0u);
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_ovf, 2u);
    UT_CHECK_EQ_UINT(rd(out, 40u), 32u);
    for (i = 0u; i < 32u; i++) {
        exp[i] = (uint8_t)(i + 1u);
    }
    UT_CHECK_EQ_MEM(out, exp, 32u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-008", "缓冲区满且 PE=1 时按错误处理：rx_err 加 1、rx_ovf 不变（设计 3.3.2.2 处理顺序）");
    env_reset();
    fill_rx_buffer();
    fill[0] = 0xE1u;
    isr_feed(fill, 1u, UART_ST_PE);
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 1u);
    UT_CHECK_EQ_UINT(st.rx_ovf, 0u);
    UT_CHECK_EQ_UINT(rd(out, 40u), 32u);
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-013", "缓冲区满丢弃一个字节且同时检测到硬件溢出：rx_ovf 共加 2（设计 3.3.2.2、3.3.3）");
    env_reset();
    fill_rx_buffer();
    fill[0] = 0xE1u;
    hw_rx_push(fill[0]);
    hw_status_seq(st_ov_after_full, 2u);
    uart_rx_isr();
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_ovf, 2u);
    UT_END_CASE();
}

static void test_isr_limit(void)
{
    uint8_t in[20];
    uint8_t out[40];
    unsigned i;

    UT_CASE("UT-UART-ISR-009", "一次中断最多读 16 个字节，剩余字节留在控制器队列中（设计 3.3.2、3.3.4）");
    env_reset();
    for (i = 0u; i < 17u; i++) {
        in[i] = (uint8_t)(0x40u + i);
    }
    isr_feed(in, 17u, 0u);
    UT_CHECK_EQ_UINT(hw_rx_avail(), 1u);
    UT_CHECK_EQ_UINT(rd(out, 40u), 16u);
    for (i = 0u; i < 16u; i++) {
        UT_CHECK_EQ_UINT(out[i], (uint32_t)(0x40u + i));
    }
    UT_END_CASE();

    UT_CASE("UT-UART-ISR-010", "剩余字节由下一次中断读出，缓冲区保持先进先出（设计 3.3.4）");
    env_reset();
    for (i = 0u; i < 17u; i++) {
        in[i] = (uint8_t)(0x40u + i);
    }
    isr_feed(in, 17u, 0u);              /* 第 17 个字节留在控制器队列中 */
    g_seq[0] = UART_ST_DR;
    g_seq[1] = 0u;
    hw_status_seq(g_seq, 2u);
    uart_rx_isr();
    UT_CHECK_EQ_UINT(hw_rx_avail(), 0u);
    UT_CHECK_EQ_UINT(rd(out, 40u), 17u);
    for (i = 0u; i < 17u; i++) {
        UT_CHECK_EQ_UINT(out[i], (uint32_t)(0x40u + i));
    }
    UT_END_CASE();
}

static void test_isr_count_wrap(void)
{
    uint8_t b[1];
    uart_stats_t st;
    unsigned i;

    UT_CASE("UT-UART-ISR-014", "rx_err 为 16 位计数，累计 65535 次错误后计数值为 65535（设计第 2 节）");
    env_reset();
    b[0] = 0x77u;
    for (i = 0u; i < 65535u; i++) {
        isr_feed(b, 1u, UART_ST_PE);
    }
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 65535u);
    UT_CHECK_EQ_UINT(st.rx_ovf, 0u);
    UT_END_CASE();
}

/* ================= 4 uart_read（设计 3.4） ================= */

static void test_read_param(void)
{
    uint8_t b[4];

    UT_CASE("UT-UART-RD-001", "buf 为空指针时返回 0 且不调用 irq_lock（设计 3.4.1）");
    env_reset();
    UT_CHECK_EQ_UINT(uart_read(NULL, 4u), 0u);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 0u);
    UT_CHECK_EQ_UINT(stub_irq_unlock_calls, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-RD-002", "maxlen 为 0 时返回 0 且不调用 irq_lock（设计 3.4.1）");
    env_reset();
    b[0] = 0x11u;
    isr_feed(b, 1u, 0u);                       /* 缓冲区中有 1 个字节 */
    stub_irq_reset();
    UT_CHECK_EQ_UINT(uart_read(b, 0u), 0u);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 0u);
    UT_END_CASE();
}

static void test_read_empty(void)
{
    uint8_t b[4];

    UT_CASE("UT-UART-RD-003", "缓冲区为空时返回 0，但仍调用且只调用一次 irq_lock/irq_unlock（设计 3.4.4）");
    env_reset();
    stub_irq_set_lock_ret(0x00000001u);
    UT_CHECK_EQ_UINT(rd(b, 4u), 0u);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 1u);
    UT_CHECK_EQ_UINT(stub_irq_unlock_calls, 1u);
    UT_CHECK_EQ_UINT(stub_irq_last_unlock_key, 0x00000001u);
    UT_END_CASE();
}

static void test_read_ok(void)
{
    uint8_t in[8];
    uint8_t out[40];
    unsigned i;

    UT_CASE("UT-UART-RD-004", "缓冲区中 5 个字节、maxlen=3 时取出 3 个字节（取 min 值，设计 3.4.3）");
    env_reset();
    for (i = 0u; i < 5u; i++) {
        in[i] = (uint8_t)(0x10u + i);
    }
    isr_feed(in, 5u, 0u);
    stub_irq_reset();
    UT_CHECK_EQ_UINT(rd(out, 3u), 3u);
    UT_CHECK_EQ_UINT(out[0], 0x10u);
    UT_CHECK_EQ_UINT(out[1], 0x11u);
    UT_CHECK_EQ_UINT(out[2], 0x12u);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 1u);
    UT_CHECK_EQ_UINT(stub_irq_unlock_calls, 1u);
    UT_END_CASE();

    UT_CASE("UT-UART-RD-005", "缓冲区中 5 个字节、maxlen=10 时取出全部 5 个字节（设计 3.4.3）");
    env_reset();
    for (i = 0u; i < 5u; i++) {
        in[i] = (uint8_t)(0x20u + i);
    }
    isr_feed(in, 5u, 0u);
    UT_CHECK_EQ_UINT(rd(out, 10u), 5u);
    UT_CHECK_EQ_UINT(out[4], 0x24u);
    UT_END_CASE();

    UT_CASE("UT-UART-RD-006", "maxlen 正好等于缓冲区中的字节数时全部取出（边界值，设计 3.4.3）");
    env_reset();
    for (i = 0u; i < 5u; i++) {
        in[i] = (uint8_t)(0x30u + i);
    }
    isr_feed(in, 5u, 0u);
    UT_CHECK_EQ_UINT(rd(out, 5u), 5u);
    UT_CHECK_EQ_UINT(out[0], 0x30u);
    UT_CHECK_EQ_UINT(out[4], 0x34u);
    UT_END_CASE();
}

static void test_read_wrap(void)
{
    uint8_t in[32];
    uint8_t out[40];
    uint8_t exp[32];
    unsigned i;

    UT_CASE("UT-UART-RD-007", "读 10 个字节后缓冲区写指针回绕，再读时仍按先进先出顺序（设计 3.4.3、第 2 节）");
    env_reset();
    for (i = 0u; i < 32u; i++) {
        in[i] = (uint8_t)(i + 1u);
    }
    isr_feed(in, 16u, 0u);
    isr_feed(&in[16], 16u, 0u);
    UT_CHECK_EQ_UINT(rd(out, 10u), 10u);
    for (i = 0u; i < 10u; i++) {
        in[i] = (uint8_t)(0x80u + i);
    }
    isr_feed(in, 10u, 0u);
    UT_CHECK_EQ_UINT(rd(out, 40u), 32u);
    for (i = 0u; i < 22u; i++) {
        exp[i] = (uint8_t)(i + 11u);
    }
    for (i = 0u; i < 10u; i++) {
        exp[22u + i] = (uint8_t)(0x80u + i);
    }
    UT_CHECK_EQ_MEM(out, exp, 32u);
    UT_END_CASE();
}

static void test_read_irq_paired(void)
{
    uint8_t b[2];
    uint8_t out[4];

    UT_CASE("UT-UART-RD-008", "irq_unlock 的参数等于本次 irq_lock 的返回值（设计 3.4.4）");
    env_reset();
    b[0] = 0x99u;
    b[1] = 0x66u;
    isr_feed(b, 2u, 0u);
    stub_irq_reset();
    stub_irq_set_lock_ret(0x1234ABCDu);
    UT_CHECK_EQ_UINT(rd(out, 2u), 2u);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 1u);
    UT_CHECK_EQ_UINT(stub_irq_unlock_calls, 1u);
    UT_CHECK_EQ_UINT(stub_irq_last_unlock_key, 0x1234ABCDu);
    UT_END_CASE();
}

/* ================= 5 uart_get_stats（设计 3.5） ================= */

static void test_stats(void)
{
    static const uint32_t st_ov[1] = {UART_ST_OV};
    uint8_t b[2];
    uart_stats_t st;

    UT_CASE("UT-UART-STAT-001", "st 为空指针时直接返回、不调用 irq_lock（设计 3.5）");
    env_reset();
    uart_get_stats(NULL);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 0u);
    UT_CHECK_EQ_UINT(stub_irq_unlock_calls, 0u);
    UT_END_CASE();

    UT_CASE("UT-UART-STAT-002", "在 irq_lock/irq_unlock 保护下把 rx_err、rx_ovf 写入 *st（设计 3.5）");
    env_reset();
    b[0] = 0x77u;
    isr_feed(b, 1u, UART_ST_PE);               /* rx_err = 1 */
    hw_status_seq(st_ov, 1u);
    uart_rx_isr();                             /* rx_ovf = 1 */
    stub_irq_reset();
    stub_irq_set_lock_ret(0x0F0F0000u);
    st.rx_err = 0u;
    st.rx_ovf = 0u;
    uart_get_stats(&st);
    UT_CHECK_EQ_UINT(st.rx_err, 1u);
    UT_CHECK_EQ_UINT(st.rx_ovf, 1u);
    UT_CHECK_EQ_UINT(stub_irq_lock_calls, 1u);
    UT_CHECK_EQ_UINT(stub_irq_unlock_calls, 1u);
    UT_CHECK_EQ_UINT(stub_irq_last_unlock_key, 0x0F0F0000u);
    UT_END_CASE();
}

int main(void)
{
    test_power_on();          /* 必须最先运行：检查上电初值 */
    test_init_scaler();
    test_init_ctrl();
    test_init_write_order();
    test_init_clear_state();
    test_init_param();
    test_send_param();
    test_send_ok();
    test_send_wait();
    test_send_timeout();
    test_send_ticks_per_byte();
    test_isr_basic();
    test_isr_error();
    test_isr_full();
    test_isr_limit();
    test_isr_count_wrap();
    test_read_param();
    test_read_empty();
    test_read_ok();
    test_read_wrap();
    test_read_irq_paired();
    test_stats();
    return UT_SUMMARY();
}
