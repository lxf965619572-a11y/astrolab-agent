/*
 * 文件名：tc_dispatch.c
 * 功能：  遥控指令分发（BM3803）
 *         遥控帧格式：[0] 指令码  [1] 参数长度 N  [2..N+1] 参数  [N+2..N+3] CRC-16（大端）
 */
#include <stdint.h>
#include <stddef.h>
#include "tc_dispatch.h"

#define TC_MAX_LEN    64u
#define PARAM_COUNT   16u

typedef int32_t (*tc_handler_t)(const uint8_t *arg, uint16_t len);

static int32_t tc_reset(const uint8_t *arg, uint16_t len);
static int32_t tc_set_mode(const uint8_t *arg, uint16_t len);
static int32_t tc_load_param(const uint8_t *arg, uint16_t len);

static const tc_handler_t tc_table[] = { tc_reset, tc_set_mode, tc_load_param };

static uint8_t  g_mode;
static uint16_t g_param[PARAM_COUNT];
static uint32_t g_tc_err_cnt;

/*@CLEAN*/
/* CRC-16/CCITT-FALSE */
static uint16_t crc16(const uint8_t *p, uint16_t len)
{
    uint16_t crc = 0xFFFFu;
    uint16_t i;
    uint8_t  b;

    for (i = 0u; i < len; i++) {
        crc ^= (uint16_t)((uint16_t)p[i] << 8);
        for (b = 0u; b < 8u; b++) {
            if ((crc & 0x8000u) != 0u) {
                crc = (uint16_t)((uint16_t)(crc << 1) ^ 0x1021u);
            } else {
                crc = (uint16_t)(crc << 1);
            }
        }
    }
    return crc;
}
/*@END*/

/* 分发一帧遥控指令；返回处理函数的结果，帧错误返回负数 */
int32_t tc_dispatch(const uint8_t *frame, uint16_t frame_len)
{
    uint8_t  code;
    uint16_t arg_len;
    uint16_t crc_rx;
    uint16_t crc_calc;

    if ((frame == NULL) || (frame_len < 4u) || (frame_len > TC_MAX_LEN)) {
        return -1;
    }
    code    = frame[0];
    arg_len = frame[1];
    if ((uint16_t)(arg_len + 4u) != frame_len) {
        return -2;
    }
    crc_rx   = (uint16_t)(((uint16_t)frame[frame_len - 2u] << 8) | frame[frame_len - 1u]);
    crc_calc = crc16(frame, (uint16_t)(frame_len - 2u));
    if (crc_calc != crc_rx) {    /*@D:tc-crc-no-reject*/
        g_tc_err_cnt++;    /*@D:tc-crc-no-reject*/
    }    /*@D:tc-crc-no-reject*/
    return tc_table[code](&frame[2], arg_len);    /*@D:tc-table-index*/
}

/*@CLEAN*/
static int32_t tc_reset(const uint8_t *arg, uint16_t len)
{
    (void)arg;
    (void)len;
    g_mode = 0u;
    return 0;
}
/*@END*/

static int32_t tc_set_mode(const uint8_t *arg, uint16_t len)
{
    if (len != 1u) {
        return -1;
    }
    switch (arg[0]) {    /*@D:tc-switch-default*/
    case 1u:
        g_mode = 1u;
        break;
    case 2u:
        g_mode = 2u;
        break;
    case 3u:
        g_mode = 3u;
        break;
    }    /*@D:tc-switch-default*/
    return 0;    /*@D:tc-switch-default*/
}

static int32_t tc_load_param(const uint8_t *arg, uint16_t len)
{
    uint8_t idx;

    if (len != 3u) {
        return -1;
    }
    idx = arg[0];
    g_param[idx] = (uint16_t)(((uint16_t)arg[1] << 8) | arg[2]);    /*@D:tc-param-index*/
    return 0;
}

/*@CLEAN*/
/* 读取遥控错误计数 */
uint32_t tc_err_count(void)
{
    return g_tc_err_cnt;
}
/*@END*/
