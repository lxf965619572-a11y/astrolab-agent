/*
 * 文件名：cmd_check.h
 * 功能：  遥控指令帧合法性检查与指令计数（单元测试练习用示例模块，虚构）
 * 平台：  BM3803（SPARC V8）裸机
 */
#ifndef CMD_CHECK_H
#define CMD_CHECK_H

#include <stdint.h>

#define CMD_FRAME_LEN 8u

typedef enum {
    CMD_OK        = 0,
    CMD_ERR_NULL  = 1,
    CMD_ERR_LEN   = 2,
    CMD_ERR_SYNC  = 3,
    CMD_ERR_SUM   = 4,
    CMD_ERR_CODE  = 5,
    CMD_ERR_MODE  = 6,
    CMD_ERR_PARAM = 7
} cmd_result_t;

typedef enum {
    MODE_NORMAL = 0,
    MODE_SAFE   = 1,
    MODE_MAINT  = 2
} work_mode_t;

uint16_t     cmd_checksum(const uint8_t *buf, uint16_t len);
cmd_result_t cmd_check(const uint8_t *frame, uint16_t len, work_mode_t mode);
void         cmd_counter_update(cmd_result_t result);
uint8_t      cmd_get_accept_count(void);
uint8_t      cmd_get_error_count(void);
void         cmd_counter_reset(void);

#endif /* CMD_CHECK_H */
