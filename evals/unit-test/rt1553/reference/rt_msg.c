/*
 * 文件名：rt_msg.c
 * 功能：  1553B RT 消息处理（单元测试练习用示例模块，虚构）
 *         中断中取出收到的消息，主循环中读取、发送数据，转发遥控指令，判断总线静默
 * 平台：  BM3803（SPARC V8）裸机
 */
#include <stddef.h>
#include "rt_msg.h"
#include "rt_drv.h"
#include "sys.h"
#include "tc_dispatch.h"

static uint16_t s_rx[RT_RX_SA_MAX + 1u][RT_MAX_WC];   /* 下标为子地址，0 不用 */
static uint8_t  s_rx_wc[RT_RX_SA_MAX + 1u];
static uint8_t  s_rx_new[RT_RX_SA_MAX + 1u];
static uint16_t s_msg_cnt;
static uint16_t s_err_cnt;
static uint32_t s_last_rx;      /* 最近一次收到正确消息的 tick */
static uint8_t  s_link_lost;

static void cnt_inc(uint16_t *c)
{
    if (*c < 0xFFFFu) {
        (*c)++;
    }
}

void rt_msg_init(void)
{
    uint8_t sa;

    for (sa = 0u; sa <= RT_RX_SA_MAX; sa++) {
        s_rx_wc[sa] = 0u;
        s_rx_new[sa] = 0u;
    }
    s_msg_cnt = 0u;
    s_err_cnt = 0u;
    s_link_lost = 0u;
    s_last_rx = sys_ticks();
}

void rt_msg_isr(void)
{
    rt_desc_t d;
    uint8_t sa;
    uint8_t wc;

    if ((rt_drv_irq_status() & RT_IRQ_EOM) == 0u) {
        return;
    }
    while (rt_drv_next_desc(&d) == 1) {
        if ((d.bsw & RT_BSW_ERR) != 0u) {
            cnt_inc(&s_err_cnt);
            continue;
        }
        cnt_inc(&s_msg_cnt);
        s_last_rx = sys_ticks();
        sa = (uint8_t)((d.cmd >> RT_CMD_SA_SHIFT) & 0x1Fu);
        wc = (uint8_t)(d.cmd & 0x1Fu);
        if (wc == 0u) {
            wc = RT_MAX_WC;
        }
        if ((d.cmd & RT_CMD_TR) == 0u && sa >= 1u && sa <= RT_RX_SA_MAX) {
            rt_drv_read(d.ptr, s_rx[sa], wc);
            s_rx_wc[sa] = wc;
            s_rx_new[sa] = 1u;
        }
    }
}

int rt_msg_get(uint8_t sa, uint16_t *buf, uint8_t *wc)
{
    uint32_t key;
    uint8_t i;

    if (buf == NULL || wc == NULL || sa < 1u || sa > RT_RX_SA_MAX) {
        return RT_ERR_PARAM;
    }
    key = irq_lock();
    if (s_rx_new[sa] == 0u) {
        irq_unlock(key);
        return 0;
    }
    for (i = 0u; i < s_rx_wc[sa]; i++) {
        buf[i] = s_rx[sa][i];
    }
    *wc = s_rx_wc[sa];
    s_rx_new[sa] = 0u;
    irq_unlock(key);
    return 1;
}

int rt_msg_put(uint8_t sa, const uint16_t *buf, uint8_t wc)
{
    int r = RT_ERR_BUSY;
    uint8_t n;

    for (n = 0u; n < RT_TX_TRIES && r == RT_ERR_BUSY; n++) {
        r = rt_drv_write_tx(sa, buf, wc);
    }
    return r;
}

void rt_msg_poll(void)
{
    uint16_t buf[RT_MAX_WC];
    uint8_t wc;
    uint32_t key;
    uint32_t last;

    if (rt_msg_get(RT_SA_TC, buf, &wc) == 1) {
        tc_dispatch(buf, wc);
    }
    key = irq_lock();
    last = s_last_rx;
    irq_unlock(key);
    s_link_lost = ((uint32_t)(sys_ticks() - last) >= RT_LINK_TIMEOUT) ? 1u : 0u;
}

void rt_msg_status(rt_status_t *st)
{
    uint32_t key;

    if (st == NULL) {
        return;
    }
    key = irq_lock();
    st->msg_cnt = s_msg_cnt;
    st->err_cnt = s_err_cnt;
    irq_unlock(key);
    st->link_lost = s_link_lost;
}
