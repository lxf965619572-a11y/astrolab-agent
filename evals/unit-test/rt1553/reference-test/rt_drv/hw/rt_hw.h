/*
 * 替换 src/rt_hw.h（与 rt_drv.c 同目录，由 run_unit_tests 自动替换）。
 * 偏移、位定义、共享 RAM 布局照详细设计第 1 章抄写；读写宏改为调用寄存器和共享 RAM 模型（stub_hw.c）。
 */
#ifndef RT_HW_H
#define RT_HW_H

#include <stdint.h>

uint16_t ut_reg_rd(uint32_t ofs);
void     ut_reg_wr(uint32_t ofs, uint16_t v);
uint16_t ut_ram_rd(uint32_t a);
void     ut_ram_wr(uint32_t a, uint16_t v);

#define RT_REG_RD(ofs)      ut_reg_rd((uint32_t)(ofs))
#define RT_REG_WR(ofs, v)   ut_reg_wr((uint32_t)(ofs), (uint16_t)(v))
#define RT_RAM_RD(a)        ut_ram_rd((uint32_t)(a))
#define RT_RAM_WR(a, v)     ut_ram_wr((uint32_t)(a), (uint16_t)(v))

#define RT_CFG1         0x01u
#define RT_START        0x03u
#define RT_STAT         0x04u
#define RT_IMASK        0x05u
#define RT_ISTAT        0x06u
#define RT_STKPTR       0x07u
#define RT_ADDR         0x08u

#define RT_CFG1_RT      (1u << 0)
#define RT_CFG1_ENH     (1u << 1)
#define RT_START_RESET  (1u << 0)
#define RT_START_RUN    (1u << 1)
#define RT_STAT_READY   (1u << 0)
#define RT_STAT_BUSY    (1u << 1)
#define RT_STAT_SA_SHIFT 5u
#define RT_STAT_SA_MASK 0x1Fu
#define RT_ADDR_PAR     (1u << 5)

#define RT_STK_BASE     0x0000u
#define RT_STK_WORDS    0x0100u
#define RT_LUT_RX       0x0140u
#define RT_LUT_TX       0x0160u
#define RT_BLK_RX       0x0400u
#define RT_BLK_TX       0x0500u
#define RT_BLK_WORDS    0x0020u

#endif /* RT_HW_H */
