/*
 * 文件名：stub_irq.c
 * 功能：  irq_lock()/irq_unlock() 的桩（BSP 不在本次测试范围内）
 * 说明：  只记录调用次数和参数，不真正关中断。
 */
#include "irq.h"
#include "stub_irq.h"

static uint32_t s_lock_ret;

unsigned stub_irq_lock_calls;
unsigned stub_irq_unlock_calls;
uint32_t stub_irq_last_unlock_key;

void stub_irq_reset(void)
{
    s_lock_ret = 0u;
    stub_irq_lock_calls = 0u;
    stub_irq_unlock_calls = 0u;
    stub_irq_last_unlock_key = 0u;
}

void stub_irq_set_lock_ret(uint32_t v)
{
    s_lock_ret = v;
}

uint32_t irq_lock(void)
{
    stub_irq_lock_calls++;
    return s_lock_ret;
}

void irq_unlock(uint32_t key)
{
    stub_irq_unlock_calls++;
    stub_irq_last_unlock_key = key;
}
