/*
 * 文件名：oc_ctrl.c
 * 功能：  OC 指令输出控制（详细设计练习用示例模块，虚构）
 * 平台：  BM3803（SPARC V8）裸机
 */
#include <stddef.h>
#include "oc_ctrl.h"
#include "oc_reg.h"
#include "mode_mgr.h"
#include "bsp.h"

#define WIDTH_MIN_MS  10u
#define WIDTH_MAX_MS  200u

typedef struct {
    uint8_t  id;
    uint16_t width_ms;
} oc_cmd_t;

static uint8_t  s_active = OC_ID_NONE;
static uint16_t s_remain;
static oc_cmd_t s_queue[OC_QUEUE_DEPTH];
static uint8_t  s_q_head;
static uint8_t  s_q_count;
static uint8_t  s_exec_count;
static uint8_t  s_reject_count;
static uint8_t  s_fault_count;

static void start_output(uint8_t id, uint16_t width_ms)
{
    uint32_t mask = 1u << (id - 1u);

    OC_WR(OC_OUT_SET, mask);
    if ((OC_RD(OC_OUT_STATE) & mask) == 0u) {
        s_fault_count++;
        OC_WR(OC_OUT_CLR, mask);
        s_active = OC_ID_NONE;
        return;
    }
    s_active = id;
    s_remain = (uint16_t)(width_ms - 1u);   /* 第一个 tick 已过去一部分 */
    s_exec_count++;
}

void oc_init(void)
{
    OC_WR(OC_CTRL, OC_CTRL_EN);
    OC_WR(OC_OUT_CLR, OC_ALL_MASK);
    s_active = OC_ID_NONE;
    s_remain = 0u;
    s_q_head = 0u;
    s_q_count = 0u;
    s_exec_count = 0u;
    s_reject_count = 0u;
    s_fault_count = 0u;
}

oc_result_t oc_request(uint8_t id, uint16_t width_ms)
{
    if (id == 0u || id > 8u) {
        s_reject_count++;
        return OC_ERR_ID;
    }
    if (width_ms < WIDTH_MIN_MS || width_ms > WIDTH_MAX_MS) {
        s_reject_count++;
        return OC_ERR_WIDTH;
    }
    if (mode_get() == MODE_SAFE && id >= 4u) {
        s_reject_count++;
        return OC_ERR_MODE;
    }
    if (s_active != OC_ID_NONE) {
        if (s_q_count >= OC_QUEUE_DEPTH) {
            s_reject_count++;
            return OC_ERR_BUSY;
        }
        s_queue[(s_q_head + s_q_count) % OC_QUEUE_DEPTH].id = id;
        s_queue[(s_q_head + s_q_count) % OC_QUEUE_DEPTH].width_ms = width_ms;
        s_q_count++;
        return OC_OK;
    }
    start_output(id, width_ms);
    return OC_OK;
}

void oc_stop_all(void)
{
    uint32_t key = irq_lock();

    OC_WR(OC_OUT_CLR, OC_ALL_MASK);
    s_active = OC_ID_NONE;
    s_remain = 0u;
    irq_unlock(key);
}

void oc_tick_isr(void)
{
    oc_cmd_t next;

    if (s_active == OC_ID_NONE) {
        return;
    }
    if (s_remain > 0u) {
        s_remain--;
    }
    if (s_remain == 0u) {
        OC_WR(OC_OUT_CLR, 1u << (s_active - 1u));
        s_active = OC_ID_NONE;
        if (s_q_count > 0u) {
            next = s_queue[s_q_head];
            s_q_head = (uint8_t)((s_q_head + 1u) % OC_QUEUE_DEPTH);
            s_q_count--;
            start_output(next.id, next.width_ms);
        }
    }
}

void oc_get_status(oc_status_t *st)
{
    uint32_t key;

    if (st == NULL) {
        return;
    }
    key = irq_lock();
    st->active_id = s_active;
    st->remain_ms = s_remain;
    st->exec_count = s_exec_count;
    st->reject_count = s_reject_count;
    st->fault_count = s_fault_count;
    irq_unlock(key);
}
