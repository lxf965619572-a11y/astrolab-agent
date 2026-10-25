/*
 * 文件名：stub_irq.h
 * 功能：  irq_lock()/irq_unlock() 桩的控制接口
 * 说明：  记录调用次数和最后一次 unlock 的参数，用于检查设计规定的
 *         "每次 irq_lock 后必须调用且只调用一次 irq_unlock，且参数配对"。
 */
#ifndef STUB_IRQ_H
#define STUB_IRQ_H

#include <stdint.h>

void stub_irq_reset(void);
void stub_irq_set_lock_ret(uint32_t v);   /* 设定下次 irq_lock 的返回值 */

extern unsigned stub_irq_lock_calls;
extern unsigned stub_irq_unlock_calls;
extern uint32_t stub_irq_last_unlock_key;

#endif /* STUB_IRQ_H */
