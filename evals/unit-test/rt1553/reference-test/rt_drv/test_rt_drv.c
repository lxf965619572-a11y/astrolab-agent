/*
 * rt_drv 单元测试（参考测试）。预期结果按 doc/rt1553-详细设计.md 第 1、2 章推导。
 * 被测：src/rt_drv.c；src/rt_hw.h 由 hw/rt_hw.h 替换（寄存器和共享 RAM 模型见 stub_hw.c）。
 */
#define UTEST_MAIN
#include "utest.h"
#include <stddef.h>
#include "rt_drv.h"
#include "ut_model.h"

/* 初始化成功：READY 第 1 次读就为 1，tick 不走 */
static void init_ok(uint8_t addr)
{
    ut_model_reset();
    g_tick = 100u; g_tick_step = 0u;
    (void)rt_drv_init(addr);
    g_reg_log_n = 0u; g_ram_writes = 0u;
}

static uint16_t addr_written(void)
{
    unsigned i;
    for (i = 0u; i < g_reg_log_n; i++) if (g_reg_log[i].ofs == 0x08u) return g_reg_log[i].val;
    return 0xFFFFu;
}

static void case_init_param(void)
{
    UT_CASE("UT-RTDRV-001", "rt_drv_init：地址 31 拒绝且不访问寄存器；地址 30 接受");
    ut_model_reset(); g_tick_step = 0u;
    UT_CHECK_EQ_INT(rt_drv_init(31u), RT_ERR_PARAM);
    UT_CHECK_EQ_UINT(g_reg_log_n, 0u);
    UT_CHECK_EQ_UINT(g_ram_writes, 0u);
    UT_CHECK_EQ_UINT(g_stat_reads, 0u);
    ut_model_reset();
    UT_CHECK_EQ_INT(rt_drv_init(30u), RT_OK);
    UT_END_CASE();
}

static void case_init_sequence(void)
{
    UT_CASE("UT-RTDRV-002", "rt_drv_init：寄存器写入顺序 START=RESET、CFG1、ADDR、IMASK、START=RUN");
    ut_model_reset();
    g_ready_after = 2u; g_tick = 0u; g_tick_step = 1u;
    UT_CHECK_EQ_INT(rt_drv_init(5u), RT_OK);
    UT_CHECK_EQ_UINT(g_reg_log_n, 5u);
    UT_CHECK_EQ_UINT(g_reg_log[0].ofs, 0x03u); UT_CHECK_EQ_UINT(g_reg_log[0].val, 0x0001u);
    UT_CHECK_EQ_UINT(g_reg_log[1].ofs, 0x01u); UT_CHECK_EQ_UINT(g_reg_log[1].val, 0x0003u);
    UT_CHECK_EQ_UINT(g_reg_log[2].ofs, 0x08u); UT_CHECK_EQ_UINT(g_reg_log[2].val, 0x0025u);  /* 地址 5 = 00101b，2 个 1，校验位为 1 */
    UT_CHECK_EQ_UINT(g_reg_log[3].ofs, 0x05u); UT_CHECK_EQ_UINT(g_reg_log[3].val, 0x0001u);
    UT_CHECK_EQ_UINT(g_reg_log[4].ofs, 0x03u); UT_CHECK_EQ_UINT(g_reg_log[4].val, 0x0002u);
    UT_CHECK_EQ_UINT(g_stat_reads, 2u);
    UT_END_CASE();
}

static void case_parity(void)
{
    UT_CASE("UT-RTDRV-003", "rt_drv_init：RT 地址奇校验（ADDR bit5～0 共奇数个 1）");
    ut_model_reset(); (void)rt_drv_init(0u);  UT_CHECK_EQ_UINT(addr_written(), 0x0020u);
    ut_model_reset(); (void)rt_drv_init(1u);  UT_CHECK_EQ_UINT(addr_written(), 0x0001u);
    ut_model_reset(); (void)rt_drv_init(3u);  UT_CHECK_EQ_UINT(addr_written(), 0x0023u);
    ut_model_reset(); (void)rt_drv_init(16u); UT_CHECK_EQ_UINT(addr_written(), 0x0010u);
    ut_model_reset(); (void)rt_drv_init(30u); UT_CHECK_EQ_UINT(addr_written(), 0x003Eu);
    ut_model_reset(); (void)rt_drv_init(7u);  UT_CHECK_EQ_UINT(addr_written(), 0x0007u);
    UT_END_CASE();
}

static void case_lut(void)
{
    unsigned i;
    unsigned nonzero = 0u;

    UT_CASE("UT-RTDRV-004", "rt_drv_init：接收/发送查找表，发送数据块清零，范围外不写");
    ut_model_reset();
    for (i = 0u; i < UT_RAM_WORDS; i++) g_ram[i] = 0xA5A5u;
    UT_CHECK_EQ_INT(rt_drv_init(2u), RT_OK);
    UT_CHECK_EQ_UINT(g_ram[0x0141u], 0x0400u);
    UT_CHECK_EQ_UINT(g_ram[0x0142u], 0x0420u);
    UT_CHECK_EQ_UINT(g_ram[0x0143u], 0x0440u);
    UT_CHECK_EQ_UINT(g_ram[0x0144u], 0x0460u);
    UT_CHECK_EQ_UINT(g_ram[0x0140u], 0xA5A5u);
    UT_CHECK_EQ_UINT(g_ram[0x0145u], 0xA5A5u);
    UT_CHECK_EQ_UINT(g_ram[0x0161u], 0x0500u);
    UT_CHECK_EQ_UINT(g_ram[0x0162u], 0x0520u);
    UT_CHECK_EQ_UINT(g_ram[0x0163u], 0xA5A5u);
    for (i = 0x0500u; i < 0x0540u; i++) if (g_ram[i] != 0u) nonzero++;
    UT_CHECK_EQ_UINT(nonzero, 0u);
    UT_CHECK_EQ_UINT(g_ram[0x0540u], 0xA5A5u);
    UT_CHECK_EQ_UINT(g_ram[0x04FFu], 0xA5A5u);
    UT_CHECK_EQ_UINT(g_ram[0x0400u], 0xA5A5u);   /* 接收数据块不清零 */
    UT_END_CASE();
}

static void case_reset_timeout(void)
{
    UT_CASE("UT-RTDRV-005", "rt_drv_init：READY 不置位时经过 10 tick 返回超时，不再配置");
    ut_model_reset();
    g_ready_after = 0xFFFFu; g_tick = 100u; g_tick_step = 1u;
    UT_CHECK_EQ_INT(rt_drv_init(1u), RT_ERR_TIMEOUT);
    UT_CHECK_EQ_UINT(g_stat_reads, 10u);
    UT_CHECK_EQ_UINT(g_reg_log_n, 1u);
    UT_CHECK_EQ_UINT(ut_reg_writes_to(0x01u), 0u);
    UT_CHECK_EQ_UINT(g_ram_writes, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTDRV-006", "rt_drv_init：第 11 次读 STAT 才就绪（已过 10 tick）仍判超时；第 10 次就绪则成功");
    ut_model_reset();
    g_ready_after = 11u; g_tick = 100u; g_tick_step = 1u;
    UT_CHECK_EQ_INT(rt_drv_init(1u), RT_ERR_TIMEOUT);
    ut_model_reset();
    g_ready_after = 10u; g_tick = 100u; g_tick_step = 1u;
    UT_CHECK_EQ_INT(rt_drv_init(1u), RT_OK);
    UT_END_CASE();

    UT_CASE("UT-RTDRV-007", "rt_drv_init：等待中 tick 回绕（起点 0xFFFFFFFA）不误判超时");
    ut_model_reset();
    g_ready_after = 8u; g_tick = 0xFFFFFFFAu; g_tick_step = 1u;
    UT_CHECK_EQ_INT(rt_drv_init(1u), RT_OK);
    UT_END_CASE();
}

static void put_desc(uint16_t at, uint16_t bsw, uint16_t ttag, uint16_t ptr, uint16_t cmd)
{
    g_ram[at] = bsw; g_ram[at + 1u] = ttag; g_ram[at + 2u] = ptr; g_ram[at + 3u] = cmd;
}

static void case_next_desc(void)
{
    rt_desc_t d;

    UT_CASE("UT-RTDRV-008", "rt_drv_next_desc：NULL 返回参数错误；无新描述符返回 0 且不改 d");
    init_ok(1u);
    UT_CHECK_EQ_INT(rt_drv_next_desc(NULL), RT_ERR_PARAM);
    d.bsw = 0x1111u; d.ttag = 0x2222u; d.ptr = 0x3333u; d.cmd = 0x4444u;
    g_stkptr = 0u;
    UT_CHECK_EQ_INT(rt_drv_next_desc(&d), 0);
    UT_CHECK_EQ_UINT(d.bsw, 0x1111u);
    UT_CHECK_EQ_UINT(d.cmd, 0x4444u);
    UT_END_CASE();

    UT_CASE("UT-RTDRV-009", "rt_drv_next_desc：初始化后从地址 0 读出第一个描述符的 4 个字");
    init_ok(1u);
    put_desc(0u, 0x8000u, 0x1234u, 0x0420u, 0x0845u);
    g_stkptr = 4u;
    UT_CHECK_EQ_INT(rt_drv_next_desc(&d), 1);
    UT_CHECK_EQ_UINT(d.bsw, 0x8000u);
    UT_CHECK_EQ_UINT(d.ttag, 0x1234u);
    UT_CHECK_EQ_UINT(d.ptr, 0x0420u);
    UT_CHECK_EQ_UINT(d.cmd, 0x0845u);
    UT_CHECK_EQ_INT(rt_drv_next_desc(&d), 0);
    UT_END_CASE();

    UT_CASE("UT-RTDRV-010", "rt_drv_next_desc：STKPTR 只取 bit7～0");
    init_ok(1u);
    put_desc(0u, 0x8000u, 0x0001u, 0x0400u, 0x0821u);
    g_stkptr = 0x1004u;
    UT_CHECK_EQ_INT(rt_drv_next_desc(&d), 1);
    UT_CHECK_EQ_UINT(d.ttag, 0x0001u);
    UT_CHECK_EQ_INT(rt_drv_next_desc(&d), 0);
    UT_END_CASE();
}

static void case_stack_wrap(void)
{
    rt_desc_t d;
    unsigned k;
    unsigned bad = 0u;

    UT_CASE("UT-RTDRV-011", "rt_drv_next_desc：读完 64 个描述符后从地址 0 继续（堆栈回绕）");
    init_ok(1u);
    for (k = 0u; k < 64u; k++) {
        put_desc((uint16_t)(k * 4u), 0x8000u, (uint16_t)k, 0x0400u, 0x0821u);
        g_stkptr = (uint16_t)((k * 4u + 4u) & 0xFFu);
        if (rt_drv_next_desc(&d) != 1 || d.ttag != k) bad++;
        if (rt_drv_next_desc(&d) != 0) bad++;
    }
    UT_CHECK_EQ_UINT(bad, 0u);
    put_desc(0u, 0x8000u, 64u, 0x0400u, 0x0821u);   /* 第 65 个描述符写在地址 0 */
    g_stkptr = 4u;
    UT_CHECK_EQ_INT(rt_drv_next_desc(&d), 1);
    UT_CHECK_EQ_UINT(d.ttag, 64u);
    UT_CHECK_EQ_UINT(g_ram_oob, 0u);
    UT_END_CASE();
}

static void case_read(void)
{
    uint16_t buf[5];

    UT_CASE("UT-RTDRV-012", "rt_drv_read：读出 wc 个字，不多读；wc 为 0 不读；buf 为 NULL 不做操作");
    init_ok(1u);
    g_ram[0x0420u] = 0x0101u; g_ram[0x0421u] = 0x0202u; g_ram[0x0422u] = 0x0303u; g_ram[0x0423u] = 0x0404u;
    buf[0] = buf[1] = buf[2] = buf[3] = buf[4] = 0xEEEEu;
    rt_drv_read(0x0420u, buf, 3u);
    UT_CHECK_EQ_UINT(buf[0], 0x0101u);
    UT_CHECK_EQ_UINT(buf[2], 0x0303u);
    UT_CHECK_EQ_UINT(buf[3], 0xEEEEu);
    rt_drv_read(0x0420u, buf + 4, 0u);
    UT_CHECK_EQ_UINT(buf[4], 0xEEEEu);
    rt_drv_read(0x0420u, NULL, 3u);
    UT_END_CASE();
}

static void case_write_tx(void)
{
    uint16_t data[32];
    unsigned i;
    unsigned bad = 0u;

    for (i = 0u; i < 32u; i++) data[i] = (uint16_t)(0x1000u + i);

    UT_CASE("UT-RTDRV-013", "rt_drv_write_tx：参数非法返回参数错误，不读 STAT、不写数据块");
    init_ok(1u);
    g_stat_reads = 0u;
    UT_CHECK_EQ_INT(rt_drv_write_tx(1u, NULL, 1u), RT_ERR_PARAM);
    UT_CHECK_EQ_INT(rt_drv_write_tx(0u, data, 1u), RT_ERR_PARAM);
    UT_CHECK_EQ_INT(rt_drv_write_tx(3u, data, 1u), RT_ERR_PARAM);
    UT_CHECK_EQ_INT(rt_drv_write_tx(1u, data, 0u), RT_ERR_PARAM);
    UT_CHECK_EQ_INT(rt_drv_write_tx(1u, data, 33u), RT_ERR_PARAM);
    UT_CHECK_EQ_UINT(g_ram_writes, 0u);
    UT_CHECK_EQ_UINT(g_stat_reads, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTDRV-014", "rt_drv_write_tx：子地址 2 写 32 字到 0x0520～0x053F，不越界");
    init_ok(1u);
    g_ram[0x0540u] = 0x7777u; g_ram[0x0500u] = 0x6666u;
    UT_CHECK_EQ_INT(rt_drv_write_tx(2u, data, 32u), RT_OK);
    for (i = 0u; i < 32u; i++) if (g_ram[0x0520u + i] != data[i]) bad++;
    UT_CHECK_EQ_UINT(bad, 0u);
    UT_CHECK_EQ_UINT(g_ram[0x0540u], 0x7777u);
    UT_CHECK_EQ_UINT(g_ram[0x0500u], 0x6666u);
    UT_CHECK_EQ_UINT(g_ram_writes, 32u);
    UT_END_CASE();

    UT_CASE("UT-RTDRV-015", "rt_drv_write_tx：BC 正在读子地址 1 时写子地址 1 返回忙且不写");
    init_ok(1u);
    g_stat_bits = (uint16_t)(0x0002u | (1u << 5));
    UT_CHECK_EQ_INT(rt_drv_write_tx(1u, data, 4u), RT_ERR_BUSY);
    UT_CHECK_EQ_UINT(g_ram_writes, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTDRV-016", "rt_drv_write_tx：BC 读子地址 2 时写子地址 1 照常写入；不忙时子地址字段为 1 也照常写入");
    init_ok(1u);
    g_stat_bits = (uint16_t)(0x0002u | (2u << 5));
    UT_CHECK_EQ_INT(rt_drv_write_tx(1u, data, 4u), RT_OK);
    UT_CHECK_EQ_UINT(g_ram[0x0500u], 0x1000u);
    UT_CHECK_EQ_UINT(g_ram[0x0503u], 0x1003u);
    g_stat_bits = (uint16_t)(1u << 5);
    UT_CHECK_EQ_INT(rt_drv_write_tx(1u, data, 1u), RT_OK);
    UT_END_CASE();
}

static void case_irq_status(void)
{
    UT_CASE("UT-RTDRV-017", "rt_drv_irq_status：返回 ISTAT 的值（读后清除）");
    init_ok(1u);
    g_istat = 0x0001u; g_stat_bits = 0x0000u; g_ready_after = 0xFFFFu;
    UT_CHECK_EQ_UINT(rt_drv_irq_status(), 0x0001u);
    UT_CHECK_EQ_UINT(rt_drv_irq_status(), 0x0000u);
    UT_END_CASE();
}

int main(void)
{
    case_init_param();
    case_init_sequence();
    case_parity();
    case_lut();
    case_reset_timeout();
    case_next_desc();
    case_stack_wrap();
    case_read();
    case_write_tx();
    case_irq_status();
    return UT_SUMMARY();
}
