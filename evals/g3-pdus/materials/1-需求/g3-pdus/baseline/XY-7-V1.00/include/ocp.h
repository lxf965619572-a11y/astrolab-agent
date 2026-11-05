/*
 * 文件名：ocp.h
 * 功能：  通道开关控制、电流采集与过流保护（ocp 模块）接口
 * 平台：  BM3803（SPARC V8），裸机
 * 修改记录：
 *   2025-06-10  V1.00 初版（XY-7）
 * */
#ifndef OCP_H
#define OCP_H

#include "pdu_types.h"

extern volatile U32 g_sw_state;                 /* 通道开关状态，bit0～3 对应通道 1～4 */
extern volatile U32 g_ocp_en;                   /* 过流保护使能，bit0～3 */
extern volatile U32 g_ocp_flag;                 /* 过流标志，bit0～3 */
extern volatile U32 g_ad_fault;                 /* AD 故障标志，bit0～3 */
extern U16 g_cur_code[PDU_CH_NUM];              /* 最近一次有效的电流 AD 码 */

void ocp_init(void);
void ocp_check(void);
void ocp_switch_set(U32 ch, U32 on);
void ocp_set_enable(U32 ch, U32 en);
void ocp_clear(U32 ch);

#endif /* OCP_H */
