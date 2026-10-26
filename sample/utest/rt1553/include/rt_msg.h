/*
 * 文件名：rt_msg.h
 * 功能：  1553B RT 消息处理对外接口
 */
#ifndef RT_MSG_H
#define RT_MSG_H

#include <stdint.h>

#define RT_SA_TC          1u        /* 遥控指令子地址 */
#define RT_TX_TRIES       3u        /* 发送数据写入最多尝试次数 */
#define RT_LINK_TIMEOUT   1000u     /* 总线静默判定时间，tick（1 ms） */

typedef struct {
    uint16_t msg_cnt;   /* 正确消息计数 */
    uint16_t err_cnt;   /* 错误消息计数 */
    uint8_t  link_lost; /* 1：总线静默 */
} rt_status_t;

void rt_msg_init(void);
void rt_msg_isr(void);
int  rt_msg_get(uint8_t sa, uint16_t *buf, uint8_t *wc);
int  rt_msg_put(uint8_t sa, const uint16_t *buf, uint8_t wc);
void rt_msg_poll(void);
void rt_msg_status(rt_status_t *st);

#endif /* RT_MSG_H */
