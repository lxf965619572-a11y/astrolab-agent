/*
 * 文件名：cmd_check.c
 * 功能：  遥控指令帧合法性检查与指令计数（单元测试练习用示例模块，虚构）
 * 平台：  BM3803（SPARC V8）裸机
 */
#include <stddef.h>
#include "cmd_check.h"

#define SYNC_0 0xEBu
#define SYNC_1 0x90u

#define CODE_LOAD_ON    0x0101u
#define CODE_LOAD_OFF   0x0102u
#define CODE_HEAT_LIMIT 0x0201u
#define CODE_UPLOAD_EN  0x0301u
#define CODE_SW_RESET   0x0FFFu

#define HEAT_LIMIT_MAX  1000u
#define UPLOAD_KEY      0x5A5Au
#define RESET_KEY       0xA5A5u

static uint8_t s_accept_count;
static uint8_t s_error_count;

uint16_t cmd_checksum(const uint8_t *buf, uint16_t len)
{
    uint16_t sum = 0u;
    uint16_t i;

    if (buf == NULL) {
        return 0u;
    }
    for (i = 0u; i < len; i++) {
        sum = (uint16_t)(sum + buf[i]);
    }
    return sum;
}

static int code_known(uint16_t code)
{
    int known;

    switch (code) {
    case CODE_LOAD_ON:
    case CODE_LOAD_OFF:
    case CODE_HEAT_LIMIT:
    case CODE_UPLOAD_EN:
    case CODE_SW_RESET:
        known = 1;
        break;
    default:
        known = 0;
        break;
    }
    return known;
}

static cmd_result_t check_param(uint16_t code, uint16_t param)
{
    cmd_result_t r = CMD_OK;

    if ((code == CODE_LOAD_ON || code == CODE_LOAD_OFF) && param != 0u) {
        r = CMD_ERR_PARAM;
    } else if (code == CODE_HEAT_LIMIT && param > HEAT_LIMIT_MAX) {
        r = CMD_ERR_PARAM;
    } else if (code == CODE_UPLOAD_EN && param != UPLOAD_KEY) {
        r = CMD_ERR_PARAM;
    } else if (code == CODE_SW_RESET && param != RESET_KEY) {
        r = CMD_ERR_PARAM;
    } else {
        r = CMD_OK;
    }
    return r;
}

cmd_result_t cmd_check(const uint8_t *frame, uint16_t len, work_mode_t mode)
{
    uint16_t code;
    uint16_t param;
    uint16_t sum;

    if (frame == NULL) {
        return CMD_ERR_NULL;
    }
    if (len != CMD_FRAME_LEN) {
        return CMD_ERR_LEN;
    }
    if (frame[0] != SYNC_0 || frame[1] != SYNC_1) {
        return CMD_ERR_SYNC;
    }
    sum = (uint16_t)(((uint16_t)frame[6] << 8) | frame[7]);
    if (sum != cmd_checksum(frame, 6u)) {
        return CMD_ERR_SUM;
    }
    code  = (uint16_t)(((uint16_t)frame[2] << 8) | frame[3]);
    param = (uint16_t)(((uint16_t)frame[4] << 8) | frame[5]);
    if (!code_known(code)) {
        return CMD_ERR_CODE;
    }
    if ((code == CODE_LOAD_ON || code == CODE_HEAT_LIMIT) && mode == MODE_SAFE) {
        return CMD_ERR_MODE;
    }
    if (code == CODE_UPLOAD_EN && mode != MODE_MAINT) {
        return CMD_ERR_MODE;
    }
    return check_param(code, param);
}

void cmd_counter_update(cmd_result_t result)
{
    if (result == CMD_OK) {
        s_accept_count++;
    } else if (s_error_count < 255u) {
        s_error_count++;
    } else {
        /* 错误计数饱和，保持 255 */
    }
}

uint8_t cmd_get_accept_count(void)
{
    return s_accept_count;
}

uint8_t cmd_get_error_count(void)
{
    return s_error_count;
}

void cmd_counter_reset(void)
{
    s_accept_count = 0u;
    s_error_count = 0u;
}
