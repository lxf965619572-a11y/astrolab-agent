/* 串口控制器寄存器模型（按详细设计 1.1～1.3 节） */
#include <string.h>
#include "uart_reg.h"
#include "ut_stubs.h"

ut_hw_t g_hw;

void ut_hw_reset(void)
{
    memset(&g_hw, 0, sizeof g_hw);
    g_hw.th_stuck_from = UT_TH_NEVER;
}

void ut_rx_push(uint8_t b, uint32_t flags)
{
    if (g_hw.rx_n < UT_MAX_RX) {
        g_hw.rx_data[g_hw.rx_n] = b;
        g_hw.rx_flags[g_hw.rx_n] = flags;
        g_hw.rx_n++;
    }
}

uint32_t ut_reg_read(uint32_t ofs)
{
    uint32_t v = 0u;

    g_hw.nread++;
    switch (ofs) {
    case UART_STATUS:
        if (g_hw.dr_stuck) {
            v |= UART_ST_DR;
        } else if (g_hw.rx_pos < g_hw.rx_n) {
            v |= UART_ST_DR | g_hw.rx_flags[g_hw.rx_pos];
        }
        v |= g_hw.ov;
        if (g_hw.ntx >= g_hw.th_stuck_from) {
            /* TH 永不就绪 */
        } else if (g_hw.th_reads < g_hw.th_busy_reads) {
            g_hw.th_reads++;
        } else {
            v |= UART_ST_TH;
        }
        break;
    case UART_DATA:
        g_hw.data_reads++;
        if (!g_hw.dr_stuck && g_hw.rx_pos < g_hw.rx_n) {
            v = g_hw.rx_data[g_hw.rx_pos];
            g_hw.rx_pos++;
        }
        break;
    case UART_CTRL:
        v = g_hw.ctrl;
        break;
    case UART_SCALER:
        v = g_hw.scaler;
        break;
    default:
        break;
    }
    return v;
}

void ut_reg_write(uint32_t ofs, uint32_t v)
{
    if (g_hw.nlog < UT_MAX_LOG) {
        g_hw.log[g_hw.nlog].ofs = ofs;
        g_hw.log[g_hw.nlog].val = v;
        g_hw.log[g_hw.nlog].ctrl_before = g_hw.ctrl;
        g_hw.nlog++;
    }
    switch (ofs) {
    case UART_DATA:
        if (g_hw.ntx < UT_MAX_TX) {
            g_hw.tx[g_hw.ntx] = (uint8_t)v;
        }
        g_hw.ntx++;
        g_hw.th_reads = 0u;          /* 下一个字节重新计 TH 忙的次数 */
        break;
    case UART_STATUS:
        if ((v & UART_ST_OV) != 0u) {
            g_hw.ov = 0u;
        }
        break;
    case UART_CTRL:
        g_hw.ctrl = v;
        break;
    case UART_SCALER:
        g_hw.scaler = v;
        break;
    default:
        break;
    }
}
