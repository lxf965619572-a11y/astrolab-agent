/*
 * 文件名：oc_ctrl.h
 * 功能：  OC 指令输出控制（详细设计练习用示例模块，虚构）
 * 平台：  BM3803（SPARC V8）裸机
 */
#ifndef OC_CTRL_H
#define OC_CTRL_H

#include <stdint.h>

#define OC_ID_NONE      0xFFu
#define OC_QUEUE_DEPTH  4u

typedef enum {
    OC_OK        = 0,
    OC_ERR_ID    = 1,
    OC_ERR_WIDTH = 2,
    OC_ERR_BUSY  = 3,
    OC_ERR_MODE  = 4
} oc_result_t;

typedef struct {
    uint8_t  active_id;     /* 当前输出的指令编号，无输出时为 OC_ID_NONE */
    uint16_t remain_ms;     /* 剩余脉宽 */
    uint8_t  exec_count;    /* 执行计数 */
    uint8_t  reject_count;  /* 拒绝计数 */
    uint8_t  fault_count;   /* 回读故障计数 */
} oc_status_t;

void        oc_init(void);
oc_result_t oc_request(uint8_t id, uint16_t width_ms);
void        oc_stop_all(void);
void        oc_tick_isr(void);
void        oc_get_status(oc_status_t *st);

#endif /* OC_CTRL_H */
