/*
 * 文件名：ocp.c
 * 功能：  通道开关控制、电流采集与过流保护（ocp 模块）
 * 平台：  BM3803（SPARC V8），裸机
 * 设计：  软件详细设计说明 4.4
 * 修改记录：
 *   2025-06-10  V1.00 初版（XY-7）
 * */
#include "pdu_types.h"
#include "pdu_bsp.h"
#include "ocp.h"

#define OCP_ADC_MAX        (4095U)  /* AD 码有效上限 */
#define OCP_ADC_ERR_LIMIT  (3U)     /* 连续无效次数门限 */
#define OCP_THR_CODE       (1500U)  /* 过流阈值 3.00 A 对应的 AD 码（AD LSB 2 mA） */

volatile U32 g_sw_state = 0U;
volatile U32 g_ocp_en = 0U;
volatile U32 g_ocp_flag = 0U;
volatile U32 g_ad_fault = 0U;
U16 g_cur_code[PDU_CH_NUM];

static U32 s_ad_err_cnt[PDU_CH_NUM];   /* 连续 AD 无效次数 */

/*
 * 函数名：ocp_init
 * 功能：  上电初始化：全部通道断开，过流保护使能
 * 设计：  4.4.2
 * 输入：  无
 * 输出：  无
 * 返回：  无
 * 说明：  在定时器启动前调用
 */
void ocp_init(void)
{
    U32 ch;

    for (ch = 0U; ch < PDU_CH_NUM; ch++)
    {
        bsp_switch_set(ch, 0U);
        g_cur_code[ch] = 0U;
        s_ad_err_cnt[ch] = 0U;
    }
    g_sw_state = 0U;
    g_ocp_en = 0x0FU;
    g_ocp_flag = 0U;
    g_ad_fault = 0U;
}

/*
 * 函数名：ocp_check
 * 功能：  采集 4 路电流，对接通且使能保护的通道做过流判定，超过 3.00 A 断开该通道
 * 设计：  4.4.3
 * 输入：  无
 * 输出：  g_cur_code、g_ad_fault、g_sw_state、g_ocp_flag
 * 返回：  无
 * 说明：  在 50 ms 定时中断中调用，主循环不能打断本函数
 */
void ocp_check(void)
{
    U32 ch;
    U32 bit;
    U16 code;

    for (ch = 0U; ch < PDU_CH_NUM; ch++)
    {
        bit = (1U << ch);
        /* 采集本通道电流 */
        code = bsp_adc_read(ch);
        if (code > OCP_ADC_MAX)
        {
            /* AD 数据无效：保持上次电流值，不做过流判定；连续 3 次无效置 AD 故障标志 */
            if (s_ad_err_cnt[ch] < OCP_ADC_ERR_LIMIT)
            {
                s_ad_err_cnt[ch]++;
            }
            if (s_ad_err_cnt[ch] >= OCP_ADC_ERR_LIMIT)
            {
                g_ad_fault |= bit;
            }
        }
        else
        {
            /* AD 数据有效：清无效计数和 AD 故障标志，更新电流值 */
            s_ad_err_cnt[ch] = 0U;
            g_ad_fault &= ~bit;
            g_cur_code[ch] = code;
            /* 通道接通、保护使能且电流超过阈值时断开通道，置过流标志 */
            if (((g_ocp_en & bit) != 0U) && ((g_sw_state & bit) != 0U) && ((U32)code > OCP_THR_CODE))
            {
                bsp_switch_set(ch, 0U);
                g_sw_state &= ~bit;
                g_ocp_flag |= bit;
            }
        }
    }
}

/*
 * 函数名：ocp_switch_set
 * 功能：  接通或断开指定通道，并更新通道开关状态
 * 设计：  4.4.4
 * 输入：  ch  通道号 0～3（调用者已检查）
 *         on  1 接通，0 断开
 * 输出：  g_sw_state
 * 返回：  无
 * 说明：  主循环调用；g_sw_state 在定时中断中也会被改写，读改写期间关中断
 */
void ocp_switch_set(U32 ch, U32 on)
{
    U32 key;

    key = bsp_int_lock();
    bsp_switch_set(ch, on);
    if (on != 0U)
    {
        g_sw_state |= (1U << ch);
    }
    else
    {
        g_sw_state &= ~(1U << ch);
    }
    bsp_int_unlock(key);
}

/*
 * 函数名：ocp_set_enable
 * 功能：  设置指定通道的过流保护使能状态
 * 设计：  4.4.5
 * 输入：  ch  通道号 0～3（调用者已检查）
 *         en  1 使能，0 禁止
 * 输出：  g_ocp_en
 * 返回：  无
 * 说明：  主循环调用；g_ocp_en 只在主循环中改写，定时中断只读
 */
void ocp_set_enable(U32 ch, U32 en)
{
    if (en != 0U)
    {
        g_ocp_en |= (1U << ch);
    }
    else
    {
        g_ocp_en &= ~(1U << ch);
    }
}

/*
 * 函数名：ocp_clear
 * 功能：  清除指定通道的过流标志
 * 设计：  4.4.6
 * 输入：  ch  通道号 0～3（调用者已检查）
 * 输出：  g_ocp_flag
 * 返回：  无
 * 说明：  主循环调用；g_ocp_flag 在定时中断中置位，读改写期间关中断
 */
void ocp_clear(U32 ch)
{
    U32 key;

    key = bsp_int_lock();
    g_ocp_flag &= ~(1U << ch);
    bsp_int_unlock(key);
}
