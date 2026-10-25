/*
 * 文件名：hw/uart_reg.h
 * 功能：  单元测试用替换头文件，替换 include/uart_reg.h
 * 说明：  寄存器偏移和位定义按《uart_drv-详细设计》1.1～1.3 节抄写，
 *         只把"直接访问目标机地址"的读写宏改为调用测试用的寄存器模型函数
 *         （stub_hw.c），从而可以在主机上运行并记录每次写入的顺序和值。
 *         includeDirs 中 test/hw 必须排在 include 之前。
 */
#ifndef UART_REG_H
#define UART_REG_H

#include <stdint.h>

/* 目标机串口控制器基地址，主机测试不使用，保留以与被测头文件一致 */
#define UART_BASE       0x80000100u

/* 寄存器偏移（设计 1.1） */
#define UART_DATA       0x00u   /* 读：接收数据；写：发送数据（低 8 位） */
#define UART_STATUS     0x04u   /* 状态；错误位写 1 清除 */
#define UART_CTRL       0x08u   /* 控制 */
#define UART_SCALER     0x0Cu   /* 波特率分频，12 位 */

/* 状态寄存器位（设计 1.2） */
#define UART_ST_DR      (1u << 0)   /* 接收数据就绪 */
#define UART_ST_TS      (1u << 1)   /* 发送移位寄存器空 */
#define UART_ST_TH      (1u << 2)   /* 发送保持寄存器空 */
#define UART_ST_OV      (1u << 4)   /* 硬件接收溢出，写 1 清除 */
#define UART_ST_PE      (1u << 5)   /* 校验错，写 1 清除 */
#define UART_ST_FE      (1u << 6)   /* 帧错，写 1 清除 */

/* 控制寄存器位（设计 1.3） */
#define UART_CTRL_RE    (1u << 0)   /* 接收使能 */
#define UART_CTRL_TE    (1u << 1)   /* 发送使能 */
#define UART_CTRL_RI    (1u << 2)   /* 接收中断使能 */
#define UART_CTRL_PE    (1u << 4)   /* 校验使能 */
#define UART_CTRL_PS    (1u << 5)   /* 校验选择：1 = 奇校验，0 = 偶校验 */

/* 寄存器读写：改为调用测试寄存器模型 */
uint32_t ut_reg_read(uint32_t ofs);
void     ut_reg_write(uint32_t ofs, uint32_t v);

#define UART_RD(ofs)     ut_reg_read(ofs)
#define UART_WR(ofs, v)  ut_reg_write((ofs), (uint32_t)(v))

#endif /* UART_REG_H */
