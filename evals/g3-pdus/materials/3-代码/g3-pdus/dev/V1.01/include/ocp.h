/*
 * 文件名：ocp.h
 * 功能：  通道开关控制、电流采集与过流保护（ocp 模块）接口
 * 平台：  BM3803（SPARC V8），裸机
 * 修改记录：
 *   2025-06-10  V1.00 初版
 *   2026-05-15  V1.01 增加过流阈值注入、断电计数（XY-9 任务书 CHG-1、CHG-3）
 */
#ifndef OCP_H
#define OCP_H

#include "pdu_types.h"

#define OCP_THR_MIN  (50U)    /* 过流阈值下限 0.50 A，LSB 0.01 A */
#define OCP_THR_MAX  (500U)   /* 过流阈值上限 5.00 A */
#define OCP_THR_DEF  (300U)   /* 过流阈值默认值 3.00 A */

extern volatile U32 g_sw_state;                 /* 通道开关状态，bit0～3 对应通道 1～4 */
extern volatile U32 g_ocp_en;                   /* 过流保护使能，bit0～3 */
extern volatile U32 g_ocp_flag;                 /* 过流标志，bit0～3 */
extern volatile U32 g_ad_fault;                 /* AD 故障标志，bit0～3 */
extern volatile U32 g_ocp_thr[PDU_CH_NUM];      /* 过流阈值，LSB 0.01 A */
extern U16 g_cur_code[PDU_CH_NUM];              /* 最近一次有效的电流 AD 码 */
extern U8  g_trip_cnt[PDU_CH_NUM];              /* 过流断电计数，饱和于 255 */

void ocp_init(void);
void ocp_check(void);
void ocp_switch_set(U32 ch, U32 on);
void ocp_set_enable(U32 ch, U32 en);
void ocp_clear(U32 ch);
U32  ocp_set_threshold(U32 ch, U32 thr);

#endif /* OCP_H */
