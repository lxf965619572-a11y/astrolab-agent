/*
 * 测试用替换头文件：代替 include/uart_reg.h。
 * 寄存器偏移和位定义与原文件一致（按详细设计 1.1～1.3 节），
 * UART_RD / UART_WR 改为调用寄存器模型（stub_hw.c），可以模拟状态变化并记录每次写入。
 * 调用 run_unit_tests 时，本目录要放在 include 目录之前。
 */
#ifndef UART_REG_H
#define UART_REG_H

#include <stdint.h>

#define UART_BASE       0x80000100u

#define UART_DATA       0x00u
#define UART_STATUS     0x04u
#define UART_CTRL       0x08u
#define UART_SCALER     0x0Cu

#define UART_ST_DR      (1u << 0)
#define UART_ST_TS      (1u << 1)
#define UART_ST_TH      (1u << 2)
#define UART_ST_OV      (1u << 4)
#define UART_ST_PE      (1u << 5)
#define UART_ST_FE      (1u << 6)

#define UART_CTRL_RE    (1u << 0)
#define UART_CTRL_TE    (1u << 1)
#define UART_CTRL_RI    (1u << 2)
#define UART_CTRL_PE    (1u << 4)
#define UART_CTRL_PS    (1u << 5)

uint32_t ut_reg_read(uint32_t ofs);
void     ut_reg_write(uint32_t ofs, uint32_t v);

#define UART_RD(ofs)     ut_reg_read(ofs)
#define UART_WR(ofs, v)  ut_reg_write((ofs), (uint32_t)(v))

#endif /* UART_REG_H */
