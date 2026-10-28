/* 评估用硬件桩：实现 thm_hw.h，记录调用（不要给智能体看） */
#include <string.h>
#include "thm_hw.h"
#include "stub_thm_hw.h"

#define CH_MAX 8
static uint16_t g_adc[CH_MAX][2];
static uint32_t g_tick;
static int g_out_count[CH_MAX];
static int g_out_last[CH_MAX];
static int g_depth;
static int g_mismatch;
static int g_saves;
static uint32_t g_keys[64];

void stub_reset(void)
{
    memset(g_adc, 0, sizeof g_adc);
    memset(g_out_count, 0, sizeof g_out_count);
    memset(g_out_last, 0, sizeof g_out_last);
    g_tick = 0; g_depth = 0; g_mismatch = 0; g_saves = 0;
}
void stub_set_adc(uint8_t ch, uint8_t sensor, uint16_t raw) { g_adc[ch][sensor] = raw; }
void stub_set_tick(uint32_t ms) { g_tick = ms; }
int  stub_out_count(uint8_t ch) { return g_out_count[ch]; }
int  stub_out_total(void) { int n = 0; for (int i = 0; i < CH_MAX; i++) n += g_out_count[i]; return n; }
int  stub_out_last(uint8_t ch) { return g_out_last[ch]; }
int  stub_irq_depth(void) { return g_depth; }
int  stub_irq_mismatch(void) { return g_mismatch; }
int  stub_irq_saves(void) { return g_saves; }

uint16_t thm_adc_read(uint8_t ch, uint8_t sensor) { return (ch < CH_MAX && sensor < 2) ? g_adc[ch][sensor] : 0; }
void thm_heater_out(uint8_t ch, uint8_t on) { if (ch < CH_MAX) { g_out_count[ch]++; g_out_last[ch] = on; } }
uint32_t thm_tick_ms(void) { return g_tick; }
uint32_t thm_irq_save(void)
{
    uint32_t key = 0xC0DE0000UL + (uint32_t)g_depth;
    g_saves++;
    if (g_depth < 64) g_keys[g_depth] = key;
    g_depth++;
    return key;
}
void thm_irq_restore(uint32_t key)
{
    if (g_depth <= 0) { g_mismatch = 1; return; }
    g_depth--;
    if (g_depth < 64 && g_keys[g_depth] != key) g_mismatch = 1;
}
