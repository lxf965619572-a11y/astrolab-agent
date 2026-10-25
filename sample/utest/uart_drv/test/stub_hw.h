/*
 * 文件名：stub_hw.h
 * 功能：  串口控制器寄存器模型（主机测试用）的控制接口
 * 说明：  1) STATUS 的读值由用例用"读值序列"设定：序列中的值按顺序返回，
 *            序列用尽后一直返回 hold 值；
 *         2) DATA 读：从用例预先压入的接收队列中取出一个字节（取出即移除）；
 *         3) 每次写入记录 (偏移, 值, 写入时刻的 CTRL, 写入时刻的 SCALER)，
 *            用于检查设计规定的写入顺序；写 DATA 记入发送记录。
 */
#ifndef STUB_HW_H
#define STUB_HW_H

#include <stdint.h>
#include "hw/uart_reg.h"

#define HW_MAX_WRITES      64u
#define HW_TX_MAX          64u
#define HW_STATUS_SEQ_MAX  40u
#define HW_RXQ_MAX         64u

typedef struct {
    uint32_t ofs;      /* 写入的寄存器偏移 */
    uint32_t val;      /* 写入的值 */
    uint32_t ctrl;     /* 写入时刻 CTRL 寄存器的值 */
    uint32_t scaler;   /* 写入时刻 SCALER 寄存器的值 */
} hw_write_t;

/* 一次复位全部模型和记录 */
void hw_reset(void);

/* STATUS 读值序列；序列用尽后返回 hold 值（默认 0） */
void hw_status_seq(const uint32_t *vals, unsigned n);
void hw_status_hold(uint32_t v);

/* 接收队列 */
void     hw_rx_push(uint8_t b);
unsigned hw_rx_avail(void);

/* 寄存器和记录 */
extern uint32_t   hw_ctrl;          /* CTRL 的当前值 */
extern uint32_t   hw_scaler;        /* SCALER 的当前值 */
extern hw_write_t hw_writes[HW_MAX_WRITES];
extern unsigned   hw_n_writes;      /* 写入次数 */
extern unsigned   hw_n_status_reads;
extern unsigned   hw_n_data_reads;
extern uint8_t    hw_tx[HW_TX_MAX]; /* 写入 DATA 的字节序列（发送记录） */
extern unsigned   hw_tx_len;

#endif /* STUB_HW_H */
