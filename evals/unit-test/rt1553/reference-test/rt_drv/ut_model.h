/* 寄存器、共享 RAM 模型和 tick 桩的控制接口 */
#ifndef UT_MODEL_H
#define UT_MODEL_H

#include <stdint.h>

#define UT_RAM_WORDS 4096u
#define UT_LOG_MAX   64u

typedef struct { uint32_t ofs; uint16_t val; } ut_wr_t;

extern uint16_t g_ram[UT_RAM_WORDS];
extern unsigned g_ram_writes;       /* 共享 RAM 写入次数 */
extern unsigned g_ram_oob;          /* 越界访问次数 */
extern ut_wr_t  g_reg_log[UT_LOG_MAX];
extern unsigned g_reg_log_n;        /* 寄存器写入记录（按顺序） */
extern unsigned g_stat_reads;       /* STAT 被读次数 */
extern unsigned g_ready_after;      /* 第几次读 STAT 起 READY 为 1（0 表示一开始就就绪） */
extern uint16_t g_stat_bits;        /* STAT 中 READY 以外的位（BUSY、子地址） */
extern uint16_t g_istat;            /* ISTAT，读后清除 */
extern uint16_t g_stkptr;           /* STKPTR 的读出值 */
extern uint32_t g_tick;             /* sys_ticks 的返回值 */
extern uint32_t g_tick_step;        /* 每次调用 sys_ticks 后加的值 */

void ut_model_reset(void);
unsigned ut_reg_writes_to(uint32_t ofs);

#endif /* UT_MODEL_H */
