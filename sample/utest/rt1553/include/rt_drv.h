/*
 * 文件名：rt_drv.h
 * 功能：  1553B RT 芯片驱动对外接口
 */
#ifndef RT_DRV_H
#define RT_DRV_H

#include <stdint.h>

#define RT_OK            0
#define RT_ERR_PARAM    (-1)
#define RT_ERR_TIMEOUT  (-2)
#define RT_ERR_BUSY     (-3)

#define RT_ADDR_MAX      30u    /* RT 地址 0～30；31 为广播地址 */
#define RT_RX_SA_MAX     4u     /* 接收子地址 1～4 */
#define RT_TX_SA_MAX     2u     /* 发送子地址 1～2 */
#define RT_MAX_WC        32u
#define RT_RESET_TIMEOUT 10u    /* 复位完成等待时间，tick（1 ms） */

/* 中断状态位 */
#define RT_IRQ_EOM       0x0001u    /* 消息结束 */

/* 描述符中的块状态字 */
#define RT_BSW_EOM       (1u << 15)
#define RT_BSW_ERR       (1u << 12) /* 消息有错 */

/* 命令字：bit15～11 RT 地址，bit10 T/R（1 为发送），bit9～5 子地址，bit4～0 字数（0 表示 32） */
#define RT_CMD_TR        (1u << 10)
#define RT_CMD_SA_SHIFT  5u

typedef struct {
    uint16_t bsw;   /* 块状态字 */
    uint16_t ttag;  /* 时间标签 */
    uint16_t ptr;   /* 数据块地址（共享 RAM 字地址） */
    uint16_t cmd;   /* 收到的命令字 */
} rt_desc_t;

int      rt_drv_init(uint8_t rt_addr);
int      rt_drv_next_desc(rt_desc_t *d);
void     rt_drv_read(uint16_t addr, uint16_t *buf, uint8_t wc);
int      rt_drv_write_tx(uint8_t sa, const uint16_t *buf, uint8_t wc);
uint16_t rt_drv_irq_status(void);

#endif /* RT_DRV_H */
