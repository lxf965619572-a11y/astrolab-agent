/*
 * rt_msg 单元测试（参考测试）。预期结果按 doc/rt1553-详细设计.md 第 1、3 章推导。
 * 被测：src/rt_msg.c；rt_drv、sys、tc_dispatch 都用桩（stubs.c）。
 */
#define UTEST_MAIN
#include "utest.h"
#include <stddef.h>
#include "rt_msg.h"
#include "ut_stubs.h"

#define BSW_OK  0x8000u
#define BSW_BAD (0x8000u | (1u << 12))

static void start(uint32_t tick)
{
    ut_stubs_reset();
    g_tick = tick;
    rt_msg_init();
    g_lock_n = g_unlock_n = g_key_bad = 0u;
}

static void case_isr_eom(void)
{
    rt_status_t st;
    uint16_t buf[32];
    uint8_t wc = 0u;

    UT_CASE("UT-RTMSG-001", "rt_msg_isr：中断状态没有 EOM 时不读描述符");
    start(10u);
    ut_push_desc(BSW_OK, 0x0420u, ut_cmd(0u, 2u, 3u));
    g_irq_status = 0x0000u;
    rt_msg_isr();
    UT_CHECK_EQ_UINT(g_next_calls, 0u);
    rt_msg_status(&st);
    UT_CHECK_EQ_UINT(st.msg_cnt, 0u);
    UT_CHECK_EQ_INT(rt_msg_get(2u, buf, &wc), 0);
    UT_END_CASE();
}

static void case_receive(void)
{
    rt_status_t st;
    uint16_t buf[32];
    uint8_t wc = 0u;
    unsigned i;
    unsigned bad = 0u;

    UT_CASE("UT-RTMSG-002", "rt_msg_isr/get：子地址 2 收到 5 字，读出数据和字数，读后清除新数据标志");
    start(10u);
    ut_push_desc(BSW_OK, 0x0420u, ut_cmd(0u, 2u, 5u));
    rt_msg_isr();
    UT_CHECK_EQ_UINT(g_read_calls, 1u);
    UT_CHECK_EQ_UINT(g_read_addr, 0x0420u);
    UT_CHECK_EQ_UINT(g_read_wc, 5u);
    UT_CHECK_EQ_INT(rt_msg_get(2u, buf, &wc), 1);
    UT_CHECK_EQ_UINT(wc, 5u);
    UT_CHECK_EQ_UINT(buf[0], 0x5420u);
    UT_CHECK_EQ_UINT(buf[4], 0x5424u);
    UT_CHECK_EQ_INT(rt_msg_get(2u, buf, &wc), 0);
    UT_CHECK_EQ_INT(rt_msg_get(1u, buf, &wc), 0);
    rt_msg_status(&st);
    UT_CHECK_EQ_UINT(st.msg_cnt, 1u);
    UT_CHECK_EQ_UINT(st.err_cnt, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-003", "rt_msg_isr：命令字字数为 0 表示 32 字");
    start(10u);
    ut_push_desc(BSW_OK, 0x0460u, ut_cmd(0u, 4u, 0u));
    rt_msg_isr();
    UT_CHECK_EQ_UINT(g_read_wc, 32u);
    UT_CHECK_EQ_INT(rt_msg_get(4u, buf, &wc), 1);
    UT_CHECK_EQ_UINT(wc, 32u);
    for (i = 0u; i < 32u; i++) if (buf[i] != (uint16_t)(0x5460u + i)) bad++;
    UT_CHECK_EQ_UINT(bad, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-004", "rt_msg_isr：块状态字 ERR 为 1 的消息只计错误，不读数据、不计正确消息");
    start(10u);
    ut_push_desc(BSW_BAD, 0x0400u, ut_cmd(0u, 1u, 2u));
    rt_msg_isr();
    UT_CHECK_EQ_UINT(g_read_calls, 0u);
    UT_CHECK_EQ_INT(rt_msg_get(1u, buf, &wc), 0);
    rt_msg_status(&st);
    UT_CHECK_EQ_UINT(st.err_cnt, 1u);
    UT_CHECK_EQ_UINT(st.msg_cnt, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-005", "rt_msg_isr：发送消息（T/R=1）只计数，不读数据");
    start(10u);
    ut_push_desc(BSW_OK, 0x0500u, ut_cmd(1u, 1u, 4u));
    rt_msg_isr();
    UT_CHECK_EQ_UINT(g_read_calls, 0u);
    UT_CHECK_EQ_INT(rt_msg_get(1u, buf, &wc), 0);
    rt_msg_status(&st);
    UT_CHECK_EQ_UINT(st.msg_cnt, 1u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-006", "rt_msg_isr：子地址 0（方式码）和 5 不读数据，子地址 4 读数据；一次中断处理全部描述符");
    start(10u);
    ut_push_desc(BSW_OK, 0x0000u, ut_cmd(0u, 0u, 2u));
    ut_push_desc(BSW_OK, 0x0480u, ut_cmd(0u, 5u, 2u));
    ut_push_desc(BSW_OK, 0x0460u, ut_cmd(0u, 4u, 2u));
    rt_msg_isr();
    UT_CHECK_EQ_UINT(g_read_calls, 1u);
    UT_CHECK_EQ_UINT(g_read_addr, 0x0460u);
    UT_CHECK_EQ_INT(rt_msg_get(4u, buf, &wc), 1);
    UT_CHECK_EQ_UINT(wc, 2u);
    rt_msg_status(&st);
    UT_CHECK_EQ_UINT(st.msg_cnt, 3u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-007", "rt_msg_isr：同一子地址未读时收到新消息，读出的是最新一条");
    start(10u);
    ut_push_desc(BSW_OK, 0x0400u, ut_cmd(0u, 1u, 3u));
    ut_push_desc(BSW_OK, 0x0410u, ut_cmd(0u, 1u, 2u));
    rt_msg_isr();
    UT_CHECK_EQ_INT(rt_msg_get(1u, buf, &wc), 1);
    UT_CHECK_EQ_UINT(wc, 2u);
    UT_CHECK_EQ_UINT(buf[0], 0x5410u);
    UT_END_CASE();
}

static void case_get(void)
{
    uint16_t buf[32];
    uint8_t wc = 7u;

    UT_CASE("UT-RTMSG-008", "rt_msg_get：参数非法返回参数错误，不关中断");
    start(10u);
    UT_CHECK_EQ_INT(rt_msg_get(1u, NULL, &wc), RT_ERR_PARAM);
    UT_CHECK_EQ_INT(rt_msg_get(1u, buf, NULL), RT_ERR_PARAM);
    UT_CHECK_EQ_INT(rt_msg_get(0u, buf, &wc), RT_ERR_PARAM);
    UT_CHECK_EQ_INT(rt_msg_get(5u, buf, &wc), RT_ERR_PARAM);
    UT_CHECK_EQ_UINT(g_lock_n, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-009", "rt_msg_get：没有新数据和有新数据两条路径上关、开中断都成对且 key 配对，wc 不变");
    start(10u);
    wc = 7u;
    UT_CHECK_EQ_INT(rt_msg_get(3u, buf, &wc), 0);
    UT_CHECK_EQ_UINT(wc, 7u);
    UT_CHECK_EQ_UINT(g_lock_n, 1u);
    UT_CHECK_EQ_UINT(g_unlock_n, 1u);
    UT_CHECK_EQ_UINT(g_key_bad, 0u);
    ut_push_desc(BSW_OK, 0x0440u, ut_cmd(0u, 3u, 1u));
    rt_msg_isr();
    UT_CHECK_EQ_INT(rt_msg_get(3u, buf, &wc), 1);
    UT_CHECK_EQ_UINT(g_lock_n, 2u);
    UT_CHECK_EQ_UINT(g_unlock_n, 2u);
    UT_CHECK_EQ_UINT(g_key_bad, 0u);
    UT_END_CASE();
}

static void case_put(void)
{
    uint16_t data[4] = { 1u, 2u, 3u, 4u };

    UT_CASE("UT-RTMSG-010", "rt_msg_put：一直忙时最多调用 3 次，返回忙；参数原样传给驱动");
    start(10u);
    g_tx_ret[0] = RT_ERR_BUSY; g_tx_ret[1] = RT_ERR_BUSY; g_tx_ret[2] = RT_ERR_BUSY; g_tx_ret[3] = RT_OK;
    UT_CHECK_EQ_INT(rt_msg_put(2u, data, 4u), RT_ERR_BUSY);
    UT_CHECK_EQ_UINT(g_tx_calls, 3u);
    UT_CHECK_EQ_UINT(g_tx_sa, 2u);
    UT_CHECK_EQ_UINT(g_tx_wc, 4u);
    UT_CHECK(g_tx_buf == data);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-011", "rt_msg_put：第 2 次成功时调用 2 次返回成功；参数错误时只调用 1 次");
    start(10u);
    g_tx_ret[0] = RT_ERR_BUSY; g_tx_ret[1] = RT_OK;
    UT_CHECK_EQ_INT(rt_msg_put(1u, data, 1u), RT_OK);
    UT_CHECK_EQ_UINT(g_tx_calls, 2u);
    start(10u);
    g_tx_ret[0] = RT_ERR_PARAM;
    UT_CHECK_EQ_INT(rt_msg_put(9u, data, 1u), RT_ERR_PARAM);
    UT_CHECK_EQ_UINT(g_tx_calls, 1u);
    UT_END_CASE();
}

static void case_poll(void)
{
    rt_status_t st;

    UT_CASE("UT-RTMSG-012", "rt_msg_poll：子地址 1 有新消息时调用 tc_dispatch 一次，数据和字数一致；没有新消息不调用");
    start(10u);
    rt_msg_poll();
    UT_CHECK_EQ_UINT(g_tc_calls, 0u);
    ut_push_desc(BSW_OK, 0x0400u, ut_cmd(0u, 1u, 3u));
    rt_msg_isr();
    rt_msg_poll();
    UT_CHECK_EQ_UINT(g_tc_calls, 1u);
    UT_CHECK_EQ_UINT(g_tc_wc, 3u);
    UT_CHECK_EQ_UINT(g_tc_data[0], 0x5400u);
    UT_CHECK_EQ_UINT(g_tc_data[2], 0x5402u);
    rt_msg_poll();
    UT_CHECK_EQ_UINT(g_tc_calls, 1u);
    UT_CHECK_EQ_UINT(g_lock_n, g_unlock_n);
    UT_CHECK_EQ_UINT(g_key_bad, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-013", "rt_msg_poll：从初始化起 999 tick 未静默，1000 tick 静默；收到正确消息后恢复");
    start(1000u);
    g_tick = 1500u; rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 0u);
    g_tick = 1999u; rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 0u);
    g_tick = 2000u; rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 1u);
    g_tick = 2100u;
    ut_push_desc(BSW_OK, 0x0500u, ut_cmd(1u, 2u, 1u));
    rt_msg_isr();
    rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-014", "rt_msg_poll：错误消息不算总线有活动，静默保持");
    start(0u);
    g_tick = 1200u; rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 1u);
    ut_push_desc(BSW_BAD, 0x0400u, ut_cmd(0u, 1u, 1u));
    rt_msg_isr();
    rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 1u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-015", "rt_msg_poll：tick 回绕（0xFFFFFF00 起 16 tick）不误判静默；经过 1000 tick 判静默");
    start(0xFFFFFF00u);
    g_tick = 0xFFFFFF10u; rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 0u);
    g_tick = 0x000002E7u; rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 0u);
    g_tick = 0x000002E8u; rt_msg_poll(); rt_msg_status(&st); UT_CHECK_EQ_UINT(st.link_lost, 1u);
    UT_END_CASE();
}

static void case_counters(void)
{
    rt_status_t st;
    unsigned k;
    unsigned n;

    UT_CASE("UT-RTMSG-016", "rt_msg_isr：正确消息计数到 0xFFFF 后保持");
    start(10u);
    for (n = 0u; n < 66u; n++) {
        g_desc_n = 0u; g_desc_i = 0u;
        for (k = 0u; k < 1000u; k++) ut_push_desc(BSW_OK, 0x0500u, ut_cmd(1u, 1u, 1u));
        rt_msg_isr();
    }
    rt_msg_status(&st);
    UT_CHECK_EQ_UINT(st.msg_cnt, 0xFFFFu);
    UT_CHECK_EQ_UINT(st.err_cnt, 0u);
    UT_END_CASE();

    UT_CASE("UT-RTMSG-017", "rt_msg_status：NULL 不做操作；两个计数分别复制，关中断成对");
    start(10u);
    rt_msg_status(NULL);
    ut_push_desc(BSW_OK, 0x0500u, ut_cmd(1u, 1u, 1u));
    ut_push_desc(BSW_OK, 0x0500u, ut_cmd(1u, 1u, 1u));
    ut_push_desc(BSW_BAD, 0x0500u, ut_cmd(1u, 1u, 1u));
    rt_msg_isr();
    rt_msg_status(&st);
    UT_CHECK_EQ_UINT(st.msg_cnt, 2u);
    UT_CHECK_EQ_UINT(st.err_cnt, 1u);
    UT_CHECK_EQ_UINT(g_lock_n, 1u);
    UT_CHECK_EQ_UINT(g_unlock_n, 1u);
    UT_END_CASE();
}

static void case_init(void)
{
    rt_status_t st;
    uint16_t buf[32];
    uint8_t wc = 0u;

    UT_CASE("UT-RTMSG-018", "rt_msg_init：清除未读数据、计数和静默标志");
    start(0u);
    ut_push_desc(BSW_OK, 0x0440u, ut_cmd(0u, 3u, 2u));
    ut_push_desc(BSW_BAD, 0x0440u, ut_cmd(0u, 3u, 2u));
    rt_msg_isr();
    g_tick = 5000u; rt_msg_poll();
    rt_msg_init();
    UT_CHECK_EQ_INT(rt_msg_get(3u, buf, &wc), 0);
    rt_msg_status(&st);
    UT_CHECK_EQ_UINT(st.msg_cnt, 0u);
    UT_CHECK_EQ_UINT(st.err_cnt, 0u);
    UT_CHECK_EQ_UINT(st.link_lost, 0u);
    UT_END_CASE();
}

int main(void)
{
    case_isr_eom();
    case_receive();
    case_get();
    case_put();
    case_poll();
    case_counters();
    case_init();
    return UT_SUMMARY();
}
