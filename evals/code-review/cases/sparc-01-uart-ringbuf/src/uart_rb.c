/*
 * 文件名：uart_rb.c
 * 功能：  UART1 接收环形缓冲区（BM3803）
 *         uart1_rx_isr 在 UART1 接收中断中调用，其余函数在主循环中调用。
 */
#include <stdint.h>
#include <stddef.h>
#include "uart_rb.h"

#define RB_SIZE       128u
#define UART1_DATA    (*(volatile uint32_t *)0x80000100u)
#define UART1_STATUS  (*(volatile uint32_t *)0x80000104u)
#define UART_DR_BIT   0x1u

static uint8_t  rb_buf[RB_SIZE];
static uint32_t rb_head;
static uint32_t rb_tail;
static uint32_t rb_overflow;

/* 初始化缓冲区，上电后在开中断之前调用 */
void rb_init(void)
{
    rb_head = 0u;
    rb_tail = 0u;
    rb_overflow = 0u;
}

/* UART1 接收中断服务程序：把接收数据寄存器中的字节全部搬入缓冲区 */
void uart1_rx_isr(void)
{
    uint32_t next;

    while ((UART1_STATUS & UART_DR_BIT) != 0u) {
        next = rb_head + 1u;
        if (next > RB_SIZE) {
            next = 0u;
        }
        if (next == rb_tail) {
            rb_overflow++;
            continue;
        }
        rb_buf[rb_head] = (uint8_t)UART1_DATA;
        rb_head = next;
    }
}

/* 取一个字节；成功返回 0，缓冲区空返回 -1 */
int32_t rb_get(uint8_t *out)
{
    if (rb_head == rb_tail) {
        return -1;
    }
    *out = rb_buf[rb_tail];
    rb_tail = (rb_tail + 1u) % RB_SIZE;
    return 0;
}

/* 读取并清零溢出计数 */
uint32_t rb_take_overflow(void)
{
    uint32_t n = rb_overflow;
    rb_overflow = 0u;
    return n;
}
