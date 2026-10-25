/*
 * 文件名：stub_sys_time.c
 * 功能：  sys_ticks() 的桩（时间管理模块不在本次测试范围内）
 * 说明：  按设计 3.2 的规定，由用例推算每次调用应返回的 tick 值。
 */
#include "sys_time.h"
#include "stub_sys_time.h"

static uint32_t s_seq[STUB_TICKS_SEQ_MAX];
static unsigned s_seq_n;
static unsigned s_seq_i;
static uint32_t s_hold;

unsigned stub_ticks_calls;

void stub_ticks_reset(void)
{
    s_seq_n = 0u;
    s_seq_i = 0u;
    s_hold = 0u;
    stub_ticks_calls = 0u;
}

void stub_ticks_seq(const uint32_t *vals, unsigned n)
{
    unsigned i;

    if (n > STUB_TICKS_SEQ_MAX) {
        n = STUB_TICKS_SEQ_MAX;
    }
    for (i = 0u; i < n; i++) {
        s_seq[i] = vals[i];
    }
    s_seq_n = n;
    s_seq_i = 0u;
}

void stub_ticks_hold(uint32_t v)
{
    s_hold = v;
}

uint32_t sys_ticks(void)
{
    uint32_t v;

    stub_ticks_calls++;
    if (s_seq_i < s_seq_n) {
        v = s_seq[s_seq_i];
        s_seq_i++;
    } else {
        v = s_hold;
    }
    return v;
}
