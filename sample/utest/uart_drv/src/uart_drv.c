/*
 * 文件名：uart_drv.c
 * 功能：  RS-422 串口收发驱动（单元测试练习用示例模块，虚构）
 * 平台：  BM3803（SPARC V8）裸机
 */
#include <stddef.h>
#include "uart_drv.h"
#include "uart_reg.h"
#include "sys_time.h"
#include "irq.h"

static uint8_t  s_rx_buf[UART_RX_BUF_SIZE];
static uint16_t s_rx_head;   /* 下一个写入位置 */
static uint16_t s_rx_tail;   /* 下一个读出位置 */
static uint16_t s_rx_count;  /* 缓冲区中的字节数 */
static uint16_t s_rx_err;
static uint16_t s_rx_ovf;

static int baud_supported(uint32_t baud)
{
    int ok;

    switch (baud) {
    case 9600u:
    case 19200u:
    case 38400u:
    case 57600u:
    case 115200u:
        ok = 1;
        break;
    default:
        ok = 0;
        break;
    }
    return ok;
}

static uint32_t baud_scaler(uint32_t baud)
{
    uint32_t div = 8u * baud;

    return UART_SYS_CLK_HZ / div - 1u;
}

uart_result_t uart_init(uint32_t baud, uint8_t parity)
{
    uint32_t ctrl;

    if (!baud_supported(baud) || parity > UART_PARITY_EVEN) {
        return UART_ERR_PARAM;
    }

    ctrl = UART_CTRL_RE | UART_CTRL_TE | UART_CTRL_RI;
    if (parity == UART_PARITY_ODD) {
        ctrl |= UART_CTRL_PE | UART_CTRL_PS;
    } else if (parity == UART_PARITY_EVEN) {
        ctrl |= UART_CTRL_PE;
    } else {
        /* 无校验 */
    }

    UART_WR(UART_CTRL, 0u);
    UART_WR(UART_STATUS, UART_ST_OV | UART_ST_PE | UART_ST_FE);
    UART_WR(UART_CTRL, ctrl);
    UART_WR(UART_SCALER, baud_scaler(baud));

    s_rx_head = 0u;
    s_rx_tail = 0u;
    s_rx_count = 0u;
    s_rx_err = 0u;
    s_rx_ovf = 0u;

    UART_WR(UART_CTRL, ctrl);
    return UART_OK;
}

/* 等待发送保持寄存器空。返回 1 表示可以写入，0 表示超时 */
static int tx_wait_ready(void)
{
    uint32_t start = sys_ticks();
    int ok = 1;

    while ((UART_RD(UART_STATUS) & UART_ST_TH) == 0u) {
        if (sys_ticks() > start + UART_TX_TIMEOUT_MS) {
            ok = 0;
            break;
        }
    }
    return ok;
}

uart_result_t uart_send(const uint8_t *buf, uint16_t len, uint16_t *sent)
{
    uint16_t i;

    if (buf == NULL || sent == NULL) {
        return UART_ERR_NULL;
    }
    *sent = 0u;
    for (i = 0u; i < len; i++) {
        if (!tx_wait_ready()) {
            return UART_ERR_TIMEOUT;
        }
        UART_WR(UART_DATA, buf[i]);
        *sent = (uint16_t)(i + 1u);
    }
    return UART_OK;
}

void uart_rx_isr(void)
{
    uint32_t st;
    uint8_t  byte;
    uint16_t n = 0u;

    st = UART_RD(UART_STATUS);
    while ((n < UART_ISR_MAX_BYTES) && ((st & UART_ST_DR) != 0u)) {
        byte = (uint8_t)UART_RD(UART_DATA);
        if ((st & UART_ST_PE) != 0u) {
            s_rx_err++;
            UART_WR(UART_STATUS, UART_ST_PE | UART_ST_FE);
        } else if (s_rx_count > UART_RX_BUF_SIZE) {
            s_rx_ovf++;
        } else {
            s_rx_buf[s_rx_head] = byte;
            s_rx_head = (uint16_t)((s_rx_head + 1u) % UART_RX_BUF_SIZE);
            s_rx_count++;
        }
        n++;
        st = UART_RD(UART_STATUS);
    }
    if ((st & UART_ST_OV) != 0u) {
        s_rx_ovf++;
        UART_WR(UART_STATUS, UART_ST_OV);
    }
}

uint16_t uart_read(uint8_t *buf, uint16_t maxlen)
{
    uint32_t key;
    uint16_t n = 0u;

    if (buf == NULL || maxlen == 0u) {
        return 0u;
    }
    key = irq_lock();
    if (s_rx_count == 0u) {
        return 0u;
    }
    while (n < maxlen && s_rx_count > 0u) {
        buf[n] = s_rx_buf[s_rx_tail];
        s_rx_tail = (uint16_t)((s_rx_tail + 1u) % UART_RX_BUF_SIZE);
        s_rx_count--;
        n++;
    }
    irq_unlock(key);
    return n;
}

void uart_get_stats(uart_stats_t *st)
{
    uint32_t key;

    if (st == NULL) {
        return;
    }
    key = irq_lock();
    st->rx_err = s_rx_err;
    st->rx_ovf = s_rx_ovf;
    irq_unlock(key);
}
