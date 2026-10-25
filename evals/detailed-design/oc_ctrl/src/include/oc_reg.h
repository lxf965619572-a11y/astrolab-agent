/*
 * 文件名：oc_reg.h
 * 功能：  OC 输出控制器寄存器定义和读写宏（见 PDU-FPGA-ICD-003）
 */
#ifndef OC_REG_H
#define OC_REG_H

#include <stdint.h>

#define OC_BASE        0x80000300u
#define OC_OUT_STATE   0x00u
#define OC_OUT_SET     0x04u
#define OC_OUT_CLR     0x08u
#define OC_CTRL        0x0Cu
#define OC_CTRL_EN     (1u << 0)
#define OC_ALL_MASK    0xFFu

#define OC_RD(ofs)     (*(volatile uint32_t *)(OC_BASE + (ofs)))
#define OC_WR(ofs, v)  (*(volatile uint32_t *)(OC_BASE + (ofs)) = (uint32_t)(v))

#endif /* OC_REG_H */
