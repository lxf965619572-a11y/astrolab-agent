/* 桩和寄存器模型的控制接口 */
#ifndef UT_STUBS_H
#define UT_STUBS_H

#include <stdint.h>

#define UT_MAX_RX   128u
#define UT_MAX_LOG  256u
#define UT_MAX_TX   256u
#define UT_TH_NEVER 0xFFFFu

typedef struct { uint32_t ofs; uint32_t val; uint32_t ctrl_before; } ut_wr_t;

typedef struct {
    /* 接收：控制器接收队列中的字节和各字节的 PE/FE 标志 */
    uint8_t  rx_data[UT_MAX_RX];
    uint32_t rx_flags[UT_MAX_RX];
    unsigned rx_n, rx_pos;
    int      dr_stuck;          /* 1：DR 一直为 1（模拟故障），DATA 读出 0 */
    unsigned data_reads;
    uint32_t ov;                /* OV 位，写 1 清除 */
    /* 发送：每个字节前 TH 为 0 的状态读取次数；th_stuck_from 起的字节 TH 永不就绪 */
    unsigned th_busy_reads, th_reads, th_stuck_from;
    uint8_t  tx[UT_MAX_TX];
    unsigned ntx;
    /* 写入记录 */
    ut_wr_t  log[UT_MAX_LOG];
    unsigned nlog;
    unsigned nread;
    uint32_t ctrl, scaler;
} ut_hw_t;
extern ut_hw_t g_hw;
void ut_hw_reset(void);
void ut_rx_push(uint8_t b, uint32_t flags);

/* sys_ticks 桩：每次调用返回 now，然后 now += step */
extern uint32_t g_tick_now, g_tick_step;
extern unsigned g_tick_calls;

/* irq 桩：每次 irq_lock 返回不同的 key，irq_unlock 核对 key 是否配对 */
extern unsigned g_irq_locks, g_irq_unlocks, g_irq_bad_keys;
extern int g_irq_depth;
void ut_sys_reset(void);

#endif
