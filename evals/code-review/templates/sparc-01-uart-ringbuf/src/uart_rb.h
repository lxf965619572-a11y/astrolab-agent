#ifndef UART_RB_H
#define UART_RB_H

#include <stdint.h>

void     rb_init(void);
void     uart1_rx_isr(void);
int32_t  rb_get(uint8_t *out);
uint32_t rb_take_overflow(void);

#endif /* UART_RB_H */
