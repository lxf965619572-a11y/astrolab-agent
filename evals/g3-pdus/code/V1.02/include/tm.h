/*
 * 文件名：tm.h
 * 功能：  遥测组帧发送（tm 模块）接口
 * 平台：  BM3803（SPARC V8），裸机
 * 修改记录：
 *   2025-06-10  V1.00 初版
 */
#ifndef TM_H
#define TM_H

#include "pdu_types.h"

#define TM_LEN  (32U)   /* 遥测帧长，字节 */

void tm_init(void);
void tm_send(void);

#endif /* TM_H */
