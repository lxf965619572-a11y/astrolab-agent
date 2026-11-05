/*
 * 文件名：cmd.h
 * 功能：  遥控指令处理（cmd 模块）接口
 * 平台：  BM3803（SPARC V8），裸机
 * 修改记录：
 *   2025-06-10  V1.00 初版（XY-7）
 */
#ifndef CMD_H
#define CMD_H

#include "pdu_types.h"

extern U32 g_cmd_ok_cnt;    /* 遥控正确计数，模 256 */
extern U32 g_cmd_err_cnt;   /* 遥控错误计数，模 256 */
extern U32 g_cmd_last;      /* 最近一条执行成功的指令码 */

void cmd_init(void);
void cmd_poll(void);

#endif /* CMD_H */
