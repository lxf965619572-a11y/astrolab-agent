/*
 * 文件名：sys.h
 * 功能：  系统时间和中断开关（由 BSP 提供，不属于被测模块）
 */
#ifndef SYS_H
#define SYS_H

#include <stdint.h>

uint32_t sys_ticks(void);           /* 1 ms 计数，32 位，会回绕 */
uint32_t irq_lock(void);            /* 关中断，返回关之前的状态 */
void     irq_unlock(uint32_t key);  /* 恢复为 key 表示的状态 */

#endif /* SYS_H */
