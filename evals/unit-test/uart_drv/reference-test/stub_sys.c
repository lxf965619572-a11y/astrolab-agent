/* 下层函数的桩：sys_ticks（sys_time.h）、irq_lock / irq_unlock（irq.h） */
#include "sys_time.h"
#include "irq.h"
#include "ut_stubs.h"

uint32_t g_tick_now, g_tick_step = 1u;
unsigned g_tick_calls;
unsigned g_irq_locks, g_irq_unlocks, g_irq_bad_keys;
int g_irq_depth;
static uint32_t s_keys[16];

void ut_sys_reset(void)
{
    g_tick_now = 100u;
    g_tick_step = 1u;
    g_tick_calls = 0u;
    g_irq_locks = 0u;
    g_irq_unlocks = 0u;
    g_irq_bad_keys = 0u;
    g_irq_depth = 0;
}

uint32_t sys_ticks(void)
{
    uint32_t t = g_tick_now;
    g_tick_calls++;
    g_tick_now += g_tick_step;
    return t;
}

uint32_t irq_lock(void)
{
    uint32_t key = 0xA5000000u + g_irq_locks;
    if (g_irq_depth >= 0 && g_irq_depth < 16) {
        s_keys[g_irq_depth] = key;
    }
    g_irq_depth++;
    g_irq_locks++;
    return key;
}

void irq_unlock(uint32_t key)
{
    g_irq_unlocks++;
    g_irq_depth--;
    if (g_irq_depth < 0 || g_irq_depth >= 16 || s_keys[g_irq_depth] != key) {
        g_irq_bad_keys++;
    }
}
