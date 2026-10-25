/*
 * 文件名：irq.h
 * 功能：  中断开关（BSP 提供，不在本次单元测试范围内）
 */
#ifndef IRQ_H
#define IRQ_H

#include <stdint.h>

/* 关中断，返回关中断前的中断状态 */
uint32_t irq_lock(void);
/* 恢复中断状态，参数为对应 irq_lock 的返回值 */
void irq_unlock(uint32_t key);

#endif /* IRQ_H */
