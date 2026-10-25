/*
 * 文件名：uart_reg.h
 * 功能：  串口控制器寄存器定义和读写宏（虚构的控制器）
 * 平台：  BM3803（SPARC V8）
 */
#ifndef UART_REG_H
#define UART_REG_H

#include <stdint.h>

#define UART_BASE       0x80000100u

/* 寄存器偏移 */
#define UART_DATA       0x00u   /* 读：接收数据；写：发送数据（低 8 位） */
#define UART_STATUS     0x04u   /* 状态；错误位写 1 清除 */
#define UART_CTRL       0x08u   /* 控制 */
#define UART_SCALER     0x0Cu   /* 波特率分频，12 位 */

/* 状态寄存器位 */
#define UART_ST_DR      (1u << 0)   /* 接收数据就绪 */
#define UART_ST_TS      (1u << 1)   /* 发送移位寄存器空 */
#define UART_ST_TH      (1u << 2)   /* 发送保持寄存器空，可写入下一字节 */
#define UART_ST_OV      (1u << 4)   /* 硬件接收溢出，写 1 清除 */
#define UART_ST_PE      (1u << 5)   /* 校验错，写 1 清除 */
#define UART_ST_FE      (1u << 6)   /* 帧错，写 1 清除 */

/* 控制寄存器位 */
#define UART_CTRL_RE    (1u << 0)   /* 接收使能 */
#define UART_CTRL_TE    (1u << 1)   /* 发送使能 */
#define UART_CTRL_RI    (1u << 2)   /* 接收中断使能 */
#define UART_CTRL_PE    (1u << 4)   /* 校验使能 */
#define UART_CTRL_PS    (1u << 5)   /* 校验选择：1 = 奇校验，0 = 偶校验 */

/* 寄存器读写：所有寄存器访问都通过这两个宏 */
#define UART_RD(ofs)     (*(volatile uint32_t *)(UART_BASE + (ofs)))
#define UART_WR(ofs, v)  (*(volatile uint32_t *)(UART_BASE + (ofs)) = (uint32_t)(v))

#endif /* UART_REG_H */
