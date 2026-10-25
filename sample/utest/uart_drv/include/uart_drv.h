/*
 * 文件名：uart_drv.h
 * 功能：  RS-422 串口收发驱动（单元测试练习用示例模块，虚构）
 * 平台：  BM3803（SPARC V8）裸机
 */
#ifndef UART_DRV_H
#define UART_DRV_H

#include <stdint.h>

#define UART_SYS_CLK_HZ     50000000u  /* 系统时钟 50 MHz */
#define UART_RX_BUF_SIZE    32u        /* 接收缓冲区容量（字节） */
#define UART_TX_TIMEOUT_MS  5u         /* 每字节发送等待超时（ms，即 tick 数） */
#define UART_ISR_MAX_BYTES  16u        /* 每次接收中断最多读取的字节数 */

#define UART_PARITY_NONE    0u
#define UART_PARITY_ODD     1u
#define UART_PARITY_EVEN    2u

typedef enum {
    UART_OK          = 0,
    UART_ERR_NULL    = 1,
    UART_ERR_PARAM   = 2,
    UART_ERR_TIMEOUT = 3
} uart_result_t;

typedef struct {
    uint16_t rx_err;   /* 接收错误计数（校验错、帧错） */
    uint16_t rx_ovf;   /* 接收溢出计数（缓冲区满丢弃、硬件溢出） */
} uart_stats_t;

uart_result_t uart_init(uint32_t baud, uint8_t parity);
uart_result_t uart_send(const uint8_t *buf, uint16_t len, uint16_t *sent);
void          uart_rx_isr(void);
uint16_t      uart_read(uint8_t *buf, uint16_t maxlen);
void          uart_get_stats(uart_stats_t *st);

#endif /* UART_DRV_H */
