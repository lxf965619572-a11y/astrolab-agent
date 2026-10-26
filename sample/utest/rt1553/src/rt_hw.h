/*
 * 文件名：rt_hw.h
 * 功能：  1553B 协议芯片（虚构的 RTC1553）寄存器、共享 RAM 的地址和读写宏
 * 平台：  BM3803（SPARC V8）。寄存器和共享 RAM 均为 16 位
 * 说明：  本文件与 rt_drv.c 在同一目录，只由 rt_drv.c 包含
 */
#ifndef RT_HW_H
#define RT_HW_H

#include <stdint.h>

#define RT_REG_BASE     0x20000000u     /* 寄存器区，每个寄存器占 2 字节 */
#define RT_RAM_BASE     0x20010000u     /* 共享 RAM，4K 字 */

#define RT_REG_RD(ofs)      (*(volatile uint16_t *)(RT_REG_BASE + ((uint32_t)(ofs) << 1)))
#define RT_REG_WR(ofs, v)   (*(volatile uint16_t *)(RT_REG_BASE + ((uint32_t)(ofs) << 1)) = (uint16_t)(v))
#define RT_RAM_RD(a)        (*(volatile uint16_t *)(RT_RAM_BASE + ((uint32_t)(a) << 1)))
#define RT_RAM_WR(a, v)     (*(volatile uint16_t *)(RT_RAM_BASE + ((uint32_t)(a) << 1)) = (uint16_t)(v))

/* 寄存器（字偏移） */
#define RT_CFG1         0x01u   /* 配置 */
#define RT_START        0x03u   /* 启动/复位，只写 */
#define RT_STAT         0x04u   /* 状态，只读 */
#define RT_IMASK        0x05u   /* 中断屏蔽 */
#define RT_ISTAT        0x06u   /* 中断状态，读后清除 */
#define RT_STKPTR       0x07u   /* 描述符堆栈指针，只读 */
#define RT_ADDR         0x08u   /* RT 地址和校验位 */

#define RT_CFG1_RT      (1u << 0)   /* RT 方式 */
#define RT_CFG1_ENH     (1u << 1)   /* 增强方式 */
#define RT_START_RESET  (1u << 0)   /* 软件复位 */
#define RT_START_RUN    (1u << 1)   /* 开始工作 */
#define RT_STAT_READY   (1u << 0)   /* 复位完成 */
#define RT_STAT_BUSY    (1u << 1)   /* 正在传输消息 */
#define RT_STAT_SA_SHIFT 5u         /* bit9～5：正在传输的子地址 */
#define RT_STAT_SA_MASK 0x1Fu
#define RT_ADDR_PAR     (1u << 5)   /* RT 地址校验位 */

/* 共享 RAM 布局（字地址） */
#define RT_STK_BASE     0x0000u     /* 描述符堆栈：64 个描述符 × 4 字 */
#define RT_STK_WORDS    0x0100u
#define RT_LUT_RX       0x0140u     /* 接收子地址查找表：第 n 项为子地址 n 的数据块地址 */
#define RT_LUT_TX       0x0160u     /* 发送子地址查找表 */
#define RT_BLK_RX       0x0400u     /* 接收数据块，每个子地址 32 字 */
#define RT_BLK_TX       0x0500u     /* 发送数据块，每个子地址 32 字 */
#define RT_BLK_WORDS    0x0020u

#endif /* RT_HW_H */
