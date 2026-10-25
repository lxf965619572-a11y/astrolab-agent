/*
 * 文件名：stub_hw.c
 * 功能：  串口控制器寄存器模型（主机测试用），替换 include/uart_reg.h 中的
 *         UART_RD/UART_WR 宏所指向的目标机地址访问。
 * 平台：  主机（x86-64）
 * 说明：  按《uart_drv-详细设计》1.1～1.3 节建模：偏移和位定义与设计一致，
 *         只把"读写寄存器"换成"读写主机内存 + 记录"。
 *         与目标机的差别：STATUS 的读值由用例脚本给定，写 1 清除错误位
 *         不影响后续读值（真实控制器会被清零）。
 */
#include <string.h>
#include "hw/uart_reg.h"
#include "stub_hw.h"

static uint32_t s_ctrl;                        /* CTRL 当前值 */
static uint32_t s_scaler;                      /* SCALER 当前值 */
static uint8_t  s_rxq[HW_RXQ_MAX];             /* 控制器接收队列 */
static unsigned s_rxq_n;
static uint32_t s_seq[HW_STATUS_SEQ_MAX];      /* STATUS 读值序列 */
static unsigned s_seq_n;
static unsigned s_seq_i;
static uint32_t s_hold;                        /* 序列用尽后的 STATUS 读值 */

uint32_t   hw_ctrl;
uint32_t   hw_scaler;
hw_write_t hw_writes[HW_MAX_WRITES];
unsigned   hw_n_writes;
unsigned   hw_n_status_reads;
unsigned   hw_n_data_reads;
uint8_t    hw_tx[HW_TX_MAX];
unsigned   hw_tx_len;

void hw_reset(void)
{
    memset(&hw_writes[0], 0, sizeof hw_writes);
    memset(hw_tx, 0, sizeof hw_tx);
    memset(s_rxq, 0, sizeof s_rxq);
    hw_n_writes = 0u;
    hw_n_status_reads = 0u;
    hw_n_data_reads = 0u;
    hw_tx_len = 0u;
    s_ctrl = 0u;
    s_scaler = 0u;
    hw_ctrl = 0u;
    hw_scaler = 0u;
    s_rxq_n = 0u;
    s_seq_n = 0u;
    s_seq_i = 0u;
    s_hold = 0u;
}

void hw_status_seq(const uint32_t *vals, unsigned n)
{
    unsigned i;

    if (n > HW_STATUS_SEQ_MAX) {
        n = HW_STATUS_SEQ_MAX;
    }
    for (i = 0u; i < n; i++) {
        s_seq[i] = vals[i];
    }
    s_seq_n = n;
    s_seq_i = 0u;
}

void hw_status_hold(uint32_t v)
{
    s_hold = v;
}

void hw_rx_push(uint8_t b)
{
    if (s_rxq_n < HW_RXQ_MAX) {
        s_rxq[s_rxq_n] = b;
        s_rxq_n++;
    }
}

unsigned hw_rx_avail(void)
{
    return s_rxq_n;
}

uint32_t ut_reg_read(uint32_t ofs)
{
    uint32_t v = 0u;

    if (ofs == UART_STATUS) {
        hw_n_status_reads++;
        if (s_seq_i < s_seq_n) {
            v = s_seq[s_seq_i];
            s_seq_i++;
        } else {
            v = s_hold;
        }
    } else if (ofs == UART_DATA) {
        unsigned i;

        hw_n_data_reads++;
        if (s_rxq_n > 0u) {
            v = (uint32_t)s_rxq[0];
            for (i = 1u; i < s_rxq_n; i++) {
                s_rxq[i - 1u] = s_rxq[i];
            }
            s_rxq_n--;
        } else {
            v = 0u;
        }
    } else if (ofs == UART_CTRL) {
        v = s_ctrl;
    } else if (ofs == UART_SCALER) {
        v = s_scaler;
    } else {
        v = 0u;
    }
    return v;
}

void ut_reg_write(uint32_t ofs, uint32_t v)
{
    if (hw_n_writes < HW_MAX_WRITES) {
        hw_writes[hw_n_writes].ofs = ofs;
        hw_writes[hw_n_writes].val = v;
        hw_writes[hw_n_writes].ctrl = s_ctrl;
        hw_writes[hw_n_writes].scaler = s_scaler;
        hw_n_writes++;
    }
    if (ofs == UART_CTRL) {
        s_ctrl = v;
        hw_ctrl = v;
    } else if (ofs == UART_SCALER) {
        s_scaler = v;
        hw_scaler = v;
    } else if (ofs == UART_DATA) {
        if (hw_tx_len < HW_TX_MAX) {
            hw_tx[hw_tx_len] = (uint8_t)(v & 0xFFu);
            hw_tx_len++;
        }
    } else {
        /* 写 STATUS：写 1 清除错误位，读值由用例脚本控制，此处不改变 */
    }
}
