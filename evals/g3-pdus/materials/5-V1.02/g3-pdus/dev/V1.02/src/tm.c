/*
 * 文件名：tm.c
 * 功能：  遥测组帧和发送（tm 模块）
 * 平台：  BM3803（SPARC V8），裸机
 * 设计：  软件详细设计说明 4.5
 * 修改记录：
 *   2025-06-10  V1.00 初版
 *   2026-05-15  V1.01 第 17～28 字节增加过流阈值和断电计数（XY-9 任务书 CHG-1、CHG-3）
 *   2026-07-30  V1.02 版本号改为 0x12；编程规则修改（静态分析意见）
 */
#include "pdu_types.h"
#include "pdu_bsp.h"
#include "ocp.h"
#include "cmd.h"
#include "tm.h"

#define TM_VERSION   (0x12U)  /* 软件版本号 V1.02 */
#define TM_SUM_POS   (31U)    /* 累加和位置 */

static U8  s_tm[TM_LEN];
static U32 s_frame_cnt = 0U;

/*
 * 函数名：tm_sum
 * 功能：  计算遥测累加和（模 256）
 * 设计：  4.5.2
 * 输入：  p  数据首地址；n  字节数
 * 输出：  无
 * 返回：  累加和
 */
static U8 tm_sum(const U8 *p, U32 n)
{
    U32 i;
    U32 sum = 0U;

    for (i = 0U; i < n; i++)
    {
        sum += (U32)p[i];
    }
    return (U8)(sum & 0xFFU);
}

/*
 * 函数名：tm_init
 * 功能：  遥测缓冲区和帧计数清零
 * 设计：  4.5.3
 * 输入：  无
 * 输出：  无
 * 返回：  无
 */
void tm_init(void)
{
    U32 i;

    for (i = 0U; i < TM_LEN; i++)
    {
        s_tm[i] = 0U;
    }
    s_frame_cnt = 0U;
}

/*
 * 函数名：tm_send
 * 功能：  按通信协议 5.2 组遥测帧并发送
 * 设计：  4.5.4
 * 输入：  无
 * 输出：  遥测帧
 * 返回：  无
 * 说明：  主循环每 500 ms 调用一次
 */
void tm_send(void)
{
    U32 ch;
    U32 cur;

    /* 帧头、帧计数、状态字（协议 5.2 第 0～5 字节） */
    s_tm[0] = 0xEBU;
    s_tm[1] = 0x90U;
    s_tm[2] = (U8)(s_frame_cnt & 0xFFU);
    s_tm[3] = (U8)(g_sw_state & 0x0FU);
    s_tm[4] = (U8)(g_ocp_en & 0x0FU);
    s_tm[5] = (U8)(g_ocp_flag & 0x0FU);
    /* 各通道电流、过流阈值、断电计数（第 6～13、17～28 字节，高字节在前） */
    for (ch = 0U; ch < PDU_CH_NUM; ch++)
    {
        cur = (U32)g_cur_code[ch] / 5U;              /* AD 码换算为 0.01 A */
        s_tm[6U + (ch * 2U)] = (U8)((cur >> 8) & 0xFFU);
        s_tm[7U + (ch * 2U)] = (U8)(cur & 0xFFU);
        s_tm[17U + (ch * 2U)] = (U8)((g_ocp_thr[ch] >> 8) & 0xFFU);
        s_tm[18U + (ch * 2U)] = (U8)(g_ocp_thr[ch] & 0xFFU);
        s_tm[25U + ch] = g_trip_cnt[ch];
    }
    /* 遥控计数、最近指令、AD 故障、版本号、累加和（第 2～30 字节累加） */
    s_tm[14] = (U8)(g_cmd_ok_cnt & 0xFFU);
    s_tm[15] = (U8)(g_cmd_err_cnt & 0xFFU);
    s_tm[16] = (U8)(g_cmd_last & 0xFFU);
    s_tm[29] = (U8)(g_ad_fault & 0x0FU);
    s_tm[30] = (U8)TM_VERSION;
    s_tm[TM_SUM_POS] = tm_sum(&s_tm[2], TM_SUM_POS - 2U);
    bsp_uart_send(s_tm, TM_LEN);
    s_frame_cnt++;
}
