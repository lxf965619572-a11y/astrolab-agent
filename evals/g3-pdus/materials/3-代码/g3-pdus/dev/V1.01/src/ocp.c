/*
 * 文件名：ocp.c
 * 功能：  通道开关控制、电流采集与过流保护（ocp 模块）
 * 平台：  BM3803（SPARC V8），裸机
 * 设计：  软件详细设计说明 4.4
 * 修改记录：
 *   2025-06-10  V1.00 初版
 *   2026-05-15  V1.01 过流阈值可注入、连续 3 次超限断电、断电计数（XY-9 任务书 CHG-1～CHG-3）
 * */
#include "pdu_types.h"
#include "pdu_bsp.h"
#include "ocp.h"

#define OCP_ADC_MAX        (4095U)  /* AD 码有效上限 */
#define OCP_ADC_ERR_LIMIT  (3U)     /* 连续无效次数门限 */
#define OCP_OVER_LIMIT     (3U)     /* 连续超限次数门限 */
#define OCP_CODE_PER_THR   (5u)     /* 阈值 LSB 0.01 A 对应 5 个 AD 码（AD LSB 2 mA） */
#define OCP_TRIP_CNT_MAX   (255U)   /* 断电计数饱和值 */

volatile U32 g_sw_state = 0U;
volatile U32 g_ocp_en = 0U;
volatile U32 g_ocp_flag = 0U;
volatile U32 g_ad_fault = 0U;
volatile U32 g_ocp_thr[PDU_CH_NUM];
U16 g_cur_code[PDU_CH_NUM];
U8  g_trip_cnt[PDU_CH_NUM];

static U32 s_ad_err_cnt[PDU_CH_NUM];   /* 连续 AD 无效次数 */
static U32 s_over_cnt[PDU_CH_NUM];     /* 连续超限次数 */

/*
 * 函数名：ocp_filter_reset
 * 功能：  清零指定通道的连续超限计数
 * 输入：  ch  通道号 0～3
 * 输出：  无
 * 返回：  无
 * 说明：  在定时中断（ocp_check）和主循环（ocp_set_enable）中调用，单次写操作
 */
static void ocp_filter_reset(U32 ch)
{
    s_over_cnt[ch] = 0U;
}

/*
 * 函数名：ocp_init
 * 功能：  上电初始化：全部通道断开，过流保护使能，阈值取默认值 3.00 A
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
        g_ocp_thr[ch] = OCP_THR_DEF;
        g_cur_code[ch] = 0U;
        g_trip_cnt[ch] = 0U;
        s_ad_err_cnt[ch] = 0U;
        s_over_cnt[ch] = 0U;
    }
    g_sw_state = 0U;
    g_ocp_en = 0x0FU;
    g_ocp_flag = 0U;
    g_ad_fault = 0U;
}

/*
 * 函数名：ocp_check
 * 功能：  采集 4 路电流，对接通且使能保护的通道做过流判定，连续 3 次超限断开该通道
 * 设计：  4.4.3
 * 输入：  无
 * 输出：  g_cur_code、g_ad_fault、g_sw_state、g_ocp_flag、g_trip_cnt
 * 返回：  无
 * 说明：  在 50 ms 定时中断中调用，主循环不能打断本函数
 */
void ocp_check(void)
{
    U32 ch;
    U32 bit;
    U32 thr_code;
    U32 in_range;
    U16 code;

    for (ch = 0U; ch < PDU_CH_NUM; ch++)
    {
        bit = (1U << ch);
        /* 单粒子防护：阈值超出 0.50～5.00 A 时恢复默认值 3.00 A */
        /* 本函数在定时中断中执行，主循环不能打断，两次读取 g_ocp_thr[ch] 之间不会被改写 */
        in_range = (U32)((g_ocp_thr[ch] >= OCP_THR_MIN) && (g_ocp_thr[ch] <= OCP_THR_MAX));
        if (in_range == 0U)
        {
            g_ocp_thr[ch] = OCP_THR_DEF;
        }
        /* 阈值换算为 AD 码后比较，避免对每次采样做除法 */
        thr_code = g_ocp_thr[ch] * OCP_CODE_PER_THR;
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
            if ((g_ocp_en & bit) == 0U)
            {
                /* 保护禁止：不判过流 */
                ocp_filter_reset(ch);
            }
            else if ((g_sw_state & bit) == 0U)
            {
                /* 通道断开：不判过流 */
                ocp_filter_reset(ch);
            }
            else if ((U32)code > thr_code)
            {
                /* 超限：连续计数加 1，达到 3 次断开通道 */
                s_over_cnt[ch]++;
                if (s_over_cnt[ch] >= OCP_OVER_LIMIT)
                {
                    /* 断开通道，置过流标志，断电计数加 1（饱和于 255） */
                    bsp_switch_set(ch, 0U);
                    g_sw_state &= ~bit;
                    g_ocp_flag |= bit;
                    if ((U32)g_trip_cnt[ch] < OCP_TRIP_CNT_MAX)
                    {
                        g_trip_cnt[ch]++;
                    }
                    ocp_filter_reset(ch);
                }
            }
            else
            {
                ;   /* 未超限，不处理 */
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
        ocp_filter_reset(ch);
    }
}

/*
 * 函数名：ocp_clear
 * 功能：  清除指定通道的过流标志
 * 设计：  4.4.6
 * 输入：  ch  通道号 0～3（调用者已检查）
 * 输出：  g_ocp_flag
 * 返回：  无
 * 说明：  主循环调用
 */
void ocp_clear(U32 ch)
{
    g_ocp_flag &= ~(1U << ch);
}

/*
 * 函数名：ocp_set_threshold
 * 功能：  设置指定通道的过流阈值
 * 设计：  4.4.6
 * 输入：  ch   通道号 0～3（调用者已检查）
 *         thr  过流阈值，LSB 0.01 A，有效范围 50～500
 * 输出：  g_ocp_thr
 * 返回：  PDU_OK   设置成功
 *         PDU_ERR  thr 超出范围，阈值不变
 * 说明：  主循环调用；单次写操作，定时中断读到的是写前或写后的完整值
 */
U32 ocp_set_threshold(U32 ch, U32 thr)
{
    U32 ret;

    if ((thr > OCP_THR_MIN) && (thr < OCP_THR_MAX))
    {
        g_ocp_thr[ch] = thr;
        ret = PDU_OK;
    }
    else
    {
        ret = PDU_ERR;
    }
    return ret;
}
