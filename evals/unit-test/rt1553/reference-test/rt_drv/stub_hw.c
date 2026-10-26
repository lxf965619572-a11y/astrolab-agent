/* 寄存器和共享 RAM 模型：记录寄存器写入顺序，模拟 READY 延迟置位、ISTAT 读后清除 */
#include <string.h>
#include "ut_model.h"

uint16_t g_ram[UT_RAM_WORDS];
unsigned g_ram_writes;
unsigned g_ram_oob;
ut_wr_t  g_reg_log[UT_LOG_MAX];
unsigned g_reg_log_n;
unsigned g_stat_reads;
unsigned g_ready_after;
uint16_t g_stat_bits;
uint16_t g_istat;
uint16_t g_stkptr;
static uint16_t s_reg[16];

void ut_model_reset(void)
{
    memset(g_ram, 0, sizeof g_ram);
    memset(s_reg, 0, sizeof s_reg);
    g_ram_writes = 0u; g_ram_oob = 0u; g_reg_log_n = 0u;
    g_stat_reads = 0u; g_ready_after = 0u; g_stat_bits = 0u; g_istat = 0u; g_stkptr = 0u;
}

unsigned ut_reg_writes_to(uint32_t ofs)
{
    unsigned i, n = 0u;
    for (i = 0u; i < g_reg_log_n; i++) if (g_reg_log[i].ofs == ofs) n++;
    return n;
}

uint16_t ut_reg_rd(uint32_t ofs)
{
    uint16_t v;
    switch (ofs) {
    case 0x04u:                                 /* STAT */
        g_stat_reads++;
        return (uint16_t)(g_stat_bits | ((g_stat_reads >= g_ready_after) ? 0x0001u : 0x0000u));
    case 0x06u:                                 /* ISTAT：读后清除 */
        v = g_istat;
        g_istat = 0u;
        return v;
    case 0x07u:                                 /* STKPTR */
        return g_stkptr;
    default:
        return (ofs < 16u) ? s_reg[ofs] : 0u;
    }
}

void ut_reg_wr(uint32_t ofs, uint16_t v)
{
    if (g_reg_log_n < UT_LOG_MAX) { g_reg_log[g_reg_log_n].ofs = ofs; g_reg_log[g_reg_log_n].val = v; g_reg_log_n++; }
    if (ofs < 16u) s_reg[ofs] = v;
}

uint16_t ut_ram_rd(uint32_t a)
{
    if (a >= UT_RAM_WORDS) { g_ram_oob++; return 0u; }
    return g_ram[a];
}

void ut_ram_wr(uint32_t a, uint16_t v)
{
    g_ram_writes++;
    if (a >= UT_RAM_WORDS) { g_ram_oob++; return; }
    g_ram[a] = v;
}
