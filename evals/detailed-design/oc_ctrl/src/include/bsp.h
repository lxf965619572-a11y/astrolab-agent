/* BSP 提供的中断开关和延时 */
#ifndef BSP_H
#define BSP_H
#include <stdint.h>
uint32_t irq_lock(void);
void     irq_unlock(uint32_t key);
void     delay_us(uint32_t us);
#endif
