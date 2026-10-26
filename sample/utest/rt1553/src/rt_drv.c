/*
 * 文件名：rt_drv.c
 * 功能：  1553B RT 芯片驱动（单元测试练习用示例模块，虚构）
 *         复位和配置芯片、建立子地址查找表、读取描述符堆栈、读写共享 RAM 中的数据块
 * 平台：  BM3803（SPARC V8）裸机
 */
#include <stddef.h>
#include "rt_drv.h"
#include "rt_hw.h"
#include "sys.h"

static uint16_t s_next;     /* 下一个待读的描述符在堆栈中的字地址 */

/* RT 地址的校验位：地址 5 位与校验位合起来有奇数个 1 */
static uint16_t addr_parity(uint8_t addr)
{
    uint8_t ones = 0u;
    uint8_t i;

    for (i = 0u; i < 5u; i++) {
        if (((addr >> i) & 1u) != 0u) {
            ones++;
        }
    }
    return ((ones & 1u) != 0u) ? RT_ADDR_PAR : 0u;
}

int rt_drv_init(uint8_t rt_addr)
{
    uint32_t start;
    uint16_t blk;
    uint8_t sa;
    uint8_t i;

    if (rt_addr > RT_ADDR_MAX) {
        return RT_ERR_PARAM;
    }

    RT_REG_WR(RT_START, RT_START_RESET);
    start = sys_ticks();
    while ((RT_REG_RD(RT_STAT) & RT_STAT_READY) == 0u) {
        if ((uint32_t)(sys_ticks() - start) > RT_RESET_TIMEOUT) {
            return RT_ERR_TIMEOUT;
        }
    }

    RT_REG_WR(RT_CFG1, RT_CFG1_RT | RT_CFG1_ENH);
    RT_REG_WR(RT_ADDR, (uint16_t)rt_addr | addr_parity(rt_addr));

    for (sa = 1u; sa <= RT_RX_SA_MAX; sa++) {
        RT_RAM_WR(RT_LUT_RX + sa, RT_BLK_RX + (uint16_t)(sa - 1u) * RT_BLK_WORDS);
    }
    for (sa = 1u; sa <= RT_TX_SA_MAX; sa++) {
        blk = (uint16_t)(RT_BLK_TX + (uint16_t)(sa - 1u) * RT_BLK_WORDS);
        RT_RAM_WR(RT_LUT_TX + sa, blk);
        for (i = 0u; i < RT_BLK_WORDS; i++) {
            RT_RAM_WR(blk + i, 0u);
        }
    }

    s_next = RT_STK_BASE;
    RT_REG_WR(RT_IMASK, RT_IRQ_EOM);
    RT_REG_WR(RT_START, RT_START_RUN);
    return RT_OK;
}

int rt_drv_next_desc(rt_desc_t *d)
{
    uint16_t ptr;

    if (d == NULL) {
        return RT_ERR_PARAM;
    }
    ptr = (uint16_t)(RT_REG_RD(RT_STKPTR) & (RT_STK_WORDS - 1u));
    if (ptr == s_next) {
        return 0;
    }
    d->bsw  = RT_RAM_RD(s_next);
    d->ttag = RT_RAM_RD(s_next + 1u);
    d->ptr  = RT_RAM_RD(s_next + 2u);
    d->cmd  = RT_RAM_RD(s_next + 3u);
    s_next = (uint16_t)(s_next + 4u);
    return 1;
}

void rt_drv_read(uint16_t addr, uint16_t *buf, uint8_t wc)
{
    uint8_t i;

    if (buf == NULL) {
        return;
    }
    for (i = 0u; i < wc; i++) {
        buf[i] = RT_RAM_RD(addr + i);
    }
}

int rt_drv_write_tx(uint8_t sa, const uint16_t *buf, uint8_t wc)
{
    uint16_t st;
    uint16_t blk;
    uint8_t i;

    if (buf == NULL || sa < 1u || sa > RT_TX_SA_MAX || wc < 1u || wc > RT_MAX_WC) {
        return RT_ERR_PARAM;
    }
    st = RT_REG_RD(RT_STAT);
    if ((st & RT_STAT_BUSY) != 0u && ((st >> 4u) & RT_STAT_SA_MASK) == sa) {
        return RT_ERR_BUSY;
    }
    blk = (uint16_t)(RT_BLK_TX + (uint16_t)(sa - 1u) * RT_BLK_WORDS);
    for (i = 0u; i < wc; i++) {
        RT_RAM_WR(blk + i, buf[i]);
    }
    return RT_OK;
}

uint16_t rt_drv_irq_status(void)
{
    return RT_REG_RD(RT_ISTAT);
}
