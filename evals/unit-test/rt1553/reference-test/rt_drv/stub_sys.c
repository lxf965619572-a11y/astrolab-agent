/* sys_ticks 桩：返回 g_tick，然后加 g_tick_step（模拟等待过程中时间流逝） */
#include "sys.h"
#include "ut_model.h"

uint32_t g_tick;
uint32_t g_tick_step;

uint32_t sys_ticks(void)
{
    uint32_t t = g_tick;
    g_tick += g_tick_step;
    return t;
}
