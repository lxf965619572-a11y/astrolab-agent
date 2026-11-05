/*
 * 文件名：pdu_types.h
 * 功能：  PDUS 公共类型和常量
 * 平台：  BM3803（SPARC V8），裸机
 * 修改记录：
 *   2025-06-10  V1.00 初版（XY-7）
 */
#ifndef PDU_TYPES_H
#define PDU_TYPES_H

typedef unsigned char  U8;
typedef unsigned short U16;
typedef unsigned int   U32;

#define PDU_OK      (0U)    /* 处理成功 */
#define PDU_ERR     (1U)    /* 处理失败 */
#define PDU_CH_NUM  (4U)    /* 负载通道数 */

#endif /* PDU_TYPES_H */
