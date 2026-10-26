/* rt_msg 的下层桩：rt_drv、sys、tc_dispatch */
#include <string.h>
#include "ut_stubs.h"
#include "sys.h"
#include "tc_dispatch.h"

uint16_t  g_irq_status;
rt_desc_t g_desc[UT_DESC_MAX];
unsigned  g_desc_n, g_desc_i, g_next_calls;
uint16_t  g_mem[UT_MEM_WORDS];
unsigned  g_read_calls;
uint16_t  g_read_addr;
uint8_t   g_read_wc;
int       g_tx_ret[8];
unsigned  g_tx_calls;
uint8_t   g_tx_sa, g_tx_wc;
const uint16_t *g_tx_buf;
uint32_t  g_tick;
unsigned  g_lock_n, g_unlock_n, g_key_bad;
unsigned  g_tc_calls;
uint16_t  g_tc_data[32];
uint8_t   g_tc_wc;
static uint32_t s_key_stack[8];
static unsigned s_key_depth;

void ut_stubs_reset(void)
{
    unsigned i;
    g_irq_status = RT_IRQ_EOM;
    g_desc_n = g_desc_i = g_next_calls = 0u;
    for (i = 0u; i < UT_MEM_WORDS; i++) g_mem[i] = (uint16_t)(0x5000u + i);
    g_read_calls = 0u; g_read_addr = 0u; g_read_wc = 0u;
    for (i = 0u; i < 8u; i++) g_tx_ret[i] = RT_OK;
    g_tx_calls = 0u; g_tx_sa = 0u; g_tx_wc = 0u; g_tx_buf = 0;
    g_lock_n = g_unlock_n = g_key_bad = 0u; s_key_depth = 0u;
    g_tc_calls = 0u; g_tc_wc = 0u; memset(g_tc_data, 0, sizeof g_tc_data);
}

uint16_t ut_cmd(unsigned tr, unsigned sa, unsigned wc)
{
    return (uint16_t)((5u << 11) | ((tr & 1u) << 10) | ((sa & 0x1Fu) << 5) | (wc & 0x1Fu));
}

void ut_push_desc(uint16_t bsw, uint16_t ptr, uint16_t cmd)
{
    if (g_desc_n < UT_DESC_MAX) {
        g_desc[g_desc_n].bsw = bsw; g_desc[g_desc_n].ttag = 0u; g_desc[g_desc_n].ptr = ptr; g_desc[g_desc_n].cmd = cmd;
        g_desc_n++;
    }
}

/* —— rt_drv —— */
uint16_t rt_drv_irq_status(void) { return g_irq_status; }

int rt_drv_next_desc(rt_desc_t *d)
{
    g_next_calls++;
    if (g_desc_i >= g_desc_n) return 0;
    *d = g_desc[g_desc_i++];
    return 1;
}

void rt_drv_read(uint16_t addr, uint16_t *buf, uint8_t wc)
{
    uint8_t i;
    g_read_calls++; g_read_addr = addr; g_read_wc = wc;
    for (i = 0u; i < wc; i++) buf[i] = g_mem[(addr + i) % UT_MEM_WORDS];
}

int rt_drv_write_tx(uint8_t sa, const uint16_t *buf, uint8_t wc)
{
    int r = (g_tx_calls < 8u) ? g_tx_ret[g_tx_calls] : RT_OK;
    g_tx_calls++; g_tx_sa = sa; g_tx_wc = wc; g_tx_buf = buf;
    return r;
}

int rt_drv_init(uint8_t rt_addr) { (void)rt_addr; return RT_OK; }

/* —— sys —— */
uint32_t sys_ticks(void) { return g_tick; }

uint32_t irq_lock(void)
{
    uint32_t key = 0x100u + g_lock_n;
    g_lock_n++;
    if (s_key_depth < 8u) s_key_stack[s_key_depth++] = key;
    return key;
}

void irq_unlock(uint32_t key)
{
    g_unlock_n++;
    if (s_key_depth == 0u || s_key_stack[s_key_depth - 1u] != key) g_key_bad++;
    if (s_key_depth) s_key_depth--;
}

/* —— tc_dispatch —— */
void tc_dispatch(const uint16_t *data, uint8_t wc)
{
    uint8_t i;
    g_tc_calls++; g_tc_wc = wc;
    for (i = 0u; i < wc && i < 32u; i++) g_tc_data[i] = data[i];
}
