/*
 * 文件名：stub_sys_time.h
 * 功能：  sys_ticks() 桩的控制接口
 * 说明：  按调用顺序返回设定的 tick 值，序列用尽后返回 hold 值；
 *         调用次数用于核对设计规定的"每字节调用一次 sys_ticks"。
 */
#ifndef STUB_SYS_TIME_H
#define STUB_SYS_TIME_H

#include <stdint.h>

#define STUB_TICKS_SEQ_MAX 16u

void stub_ticks_reset(void);
void stub_ticks_seq(const uint32_t *vals, unsigned n);
void stub_ticks_hold(uint32_t v);

extern unsigned stub_ticks_calls;

#endif /* STUB_SYS_TIME_H */
