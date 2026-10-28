/*
 * 文件名：thm_ctrl.c
 * 功能：  热控加热回路控制：传感器有效性和故障、选传感器、回差开关加热器、加热时限、遥测组帧
 * 平台：  BM3803（SPARC V8），裸机，C99
 * 设计：  thm_ctrl-详细设计 第 4 章
 * 修改记录：
 *   2026-10-28  初版（评估用参考实现，不要给智能体看）
 */
#include <stddef.h>
#include "thm_ctrl.h"
#include "thm_hw.h"

#define ADC_MIN          50U
#define ADC_MAX          4000U
#define FAULT_ENTER      3U
#define FAULT_LEAVE      5U
#define CNT_MAX          255U
#define LIMIT_LOW        (-500)
#define LIMIT_HIGH       500
#define TL_DEFAULT       50
#define TH_DEFAULT       150
#define HEAT_MAX_MS      600000UL
#define TM_SYNC          0xA5U
#define CONV_MUL         1650
#define CONV_DIV         4096
#define CONV_OFFSET      500
#define BYTE_MASK        0xFFU
#define TM_ST_HEAT       0x01U
#define TM_ST_BAK        0x02U
#define TM_ST_PRI_FAULT  0x04U
#define TM_ST_BAK_FAULT  0x08U
#define TM_ST_TIMEOUT    0x10U
#define TM_TEMP_OFS      2U
#define TM_LOOP_BYTES    4U

typedef struct
{
    uint8_t bad_cnt;
    uint8_t good_cnt;
    uint8_t fault;
} sensor_t;

typedef struct
{
    int16_t  tl;
    int16_t  th;
    sensor_t sen[2];
    uint8_t  sensor;
    int16_t  temp;
    uint8_t  heater;
    uint32_t heat_start;
    uint8_t  heat_timeout;
} loop_t;

static loop_t g_loop[THM_CH_NUM];

/*
 * 函数名：thm_adc_to_temp
 * 功能：  ADC 原始值换算为温度（0.1 ℃）
 * 设计：  D-06
 * 输入：  raw  ADC 值，调用前已确认在 50～4000 内
 * 返回：  温度，单位 0.1 ℃
 */
static int16_t thm_adc_to_temp(uint16_t raw)
{
    return (int16_t)(((int32_t)raw * CONV_MUL) / CONV_DIV - CONV_OFFSET);
}

/*
 * 函数名：thm_sensor_update
 * 功能：  按本次读数更新一个传感器的连续异常/正常计数和故障标志
 * 设计：  D-07
 * 输入：  s    传感器状态；raw  本次 ADC 值
 * 返回：  1 本次读数有效，0 无效
 */
static uint8_t thm_sensor_update(sensor_t *s, uint16_t raw)
{
    uint8_t valid = 0U;
    if ((raw >= ADC_MIN) && (raw <= ADC_MAX))
    {
        valid = 1U;
        s->bad_cnt = 0U;
        if (s->fault != 0U)
        {
            if (s->good_cnt < CNT_MAX) { s->good_cnt++; }
            if (s->good_cnt >= FAULT_LEAVE) { s->fault = 0U; s->good_cnt = 0U; }
        }
        else
        {
            s->good_cnt = 0U;
        }
    }
    else
    {
        s->good_cnt = 0U;
        if (s->bad_cnt < CNT_MAX) { s->bad_cnt++; }
        if (s->bad_cnt >= FAULT_ENTER) { s->fault = 1U; }
    }
    return valid;
}

/*
 * 函数名：thm_init
 * 功能：  初始化全部回路的数据并关加热器
 * 设计：  D-01
 * 输入：  无
 * 返回：  无
 */
void thm_init(void)
{
    uint8_t ch;
    for (ch = 0U; ch < THM_CH_NUM; ch++)
    {
        loop_t *l = &g_loop[ch];
        l->tl = TL_DEFAULT;
        l->th = TH_DEFAULT;
        l->sen[0].bad_cnt = 0U; l->sen[0].good_cnt = 0U; l->sen[0].fault = 0U;
        l->sen[1].bad_cnt = 0U; l->sen[1].good_cnt = 0U; l->sen[1].fault = 0U;
        l->sensor = 0U;
        l->temp = THM_TEMP_INVALID;
        l->heater = 0U;
        l->heat_start = 0U;
        l->heat_timeout = 0U;
    }
    for (ch = 0U; ch < THM_CH_NUM; ch++)
    {
        thm_heater_out(ch, 0U);
    }
}

/*
 * 函数名：thm_set_limits
 * 功能：  设置一个回路的温度上下限，成功时清除该回路的加热超时标志
 * 设计：  D-02
 * 输入：  ch  回路号 0～3；tl、th  下限、上限，0.1 ℃，-500～500，tl < th
 * 返回：  THM_OK、THM_ERR_CH、THM_ERR_PARAM、THM_ERR_RANGE（按此顺序检查）
 * 说明：  可能在遥控中断中调用；写入在临界区内
 */
int32_t thm_set_limits(uint8_t ch, int16_t tl, int16_t th)
{
    uint32_t key;
    if (ch >= THM_CH_NUM) { return THM_ERR_CH; }
    if (tl >= th) { return THM_ERR_PARAM; }
    if ((tl < LIMIT_LOW) || (th > LIMIT_HIGH)) { return THM_ERR_RANGE; }
    key = thm_irq_save();
    g_loop[ch].tl = tl;
    g_loop[ch].th = th;
    g_loop[ch].heat_timeout = 0U;
    thm_irq_restore(key);
    return THM_OK;
}

/*
 * 函数名：thm_cycle
 * 功能：  每 1 s 处理全部回路：读传感器、选传感器、开关加热器、加热时限、输出
 * 设计：  D-03
 * 输入：  无
 * 返回：  无
 * 说明：  主程序调用；读上下限和超时标志时进入临界区
 */
void thm_cycle(void)
{
    uint8_t ch;
    for (ch = 0U; ch < THM_CH_NUM; ch++)
    {
        loop_t *l = &g_loop[ch];
        uint16_t raw_p = thm_adc_read(ch, 0U);
        uint16_t raw_b = thm_adc_read(ch, 1U);
        uint8_t ok_p = thm_sensor_update(&l->sen[0], raw_p);
        uint8_t ok_b = thm_sensor_update(&l->sen[1], raw_b);
        int16_t tl;
        int16_t th;
        uint8_t timeout;
        uint8_t on;
        uint32_t key;

        if ((l->sen[0].fault == 0U) && (ok_p != 0U))
        {
            l->sensor = 0U;
            l->temp = thm_adc_to_temp(raw_p);
        }
        else if ((l->sen[1].fault == 0U) && (ok_b != 0U))
        {
            l->sensor = 1U;
            l->temp = thm_adc_to_temp(raw_b);
        }
        else
        {
            l->temp = THM_TEMP_INVALID;
        }

        key = thm_irq_save();
        tl = l->tl;
        th = l->th;
        timeout = l->heat_timeout;
        thm_irq_restore(key);

        on = l->heater;
        if (l->temp != THM_TEMP_INVALID)
        {
            if (l->temp <= tl) { on = 1U; }
            else if (l->temp >= th) { on = 0U; }
            else { /* 保持 */ }
        }
        if (timeout != 0U) { on = 0U; }

        if ((on != 0U) && (l->heater == 0U))
        {
            l->heat_start = thm_tick_ms();
        }
        if ((on != 0U) && ((uint32_t)(thm_tick_ms() - l->heat_start) >= HEAT_MAX_MS))
        {
            on = 0U;
            key = thm_irq_save();
            l->heat_timeout = 1U;
            thm_irq_restore(key);
        }
        l->heater = on;
        thm_heater_out(ch, on);
    }
}

/*
 * 函数名：thm_get_status
 * 功能：  读一个回路的状态
 * 设计：  D-04
 * 输入：  ch  回路号 0～3；st  输出缓冲
 * 输出：  *st
 * 返回：  THM_OK、THM_ERR_CH、THM_ERR_PARAM（按此顺序检查）
 */
int32_t thm_get_status(uint8_t ch, thm_status_t *st)
{
    uint32_t key;
    const loop_t *l;
    if (ch >= THM_CH_NUM) { return THM_ERR_CH; }
    if (st == NULL) { return THM_ERR_PARAM; }
    l = &g_loop[ch];
    key = thm_irq_save();
    st->temp = l->temp;
    st->sensor = l->sensor;
    st->heater = l->heater;
    st->fault = (uint8_t)(((l->sen[0].fault != 0U) ? THM_FAULT_PRI : 0U)
                        | ((l->sen[1].fault != 0U) ? THM_FAULT_BAK : 0U)
                        | ((l->heat_timeout != 0U) ? THM_FAULT_HEAT : 0U));
    thm_irq_restore(key);
    return THM_OK;
}

/*
 * 函数名：thm_pack_tm
 * 功能：  组遥测帧（大端，校验为累加和低 8 位）
 * 设计：  D-05
 * 输入：  buf  输出缓冲；len  缓冲长度，至少 THM_TM_LEN
 * 返回：  写入的字节数 THM_TM_LEN；THM_ERR_PARAM、THM_ERR_BUF（按此顺序检查）
 */
int32_t thm_pack_tm(uint8_t *buf, uint32_t len)
{
    uint8_t ch;
    uint32_t i;
    uint8_t sum = 0U;
    if (buf == NULL) { return THM_ERR_PARAM; }
    if (len < THM_TM_LEN) { return THM_ERR_BUF; }
    buf[0] = TM_SYNC;
    buf[1] = (uint8_t)THM_CH_NUM;
    for (ch = 0U; ch < THM_CH_NUM; ch++)
    {
        thm_status_t st;
        uint16_t t;
        uint8_t s;
        (void)thm_get_status(ch, &st);
        t = (uint16_t)st.temp;
        s = (uint8_t)(((st.heater != 0U) ? TM_ST_HEAT : 0U)
                    | ((st.sensor != 0U) ? TM_ST_BAK : 0U)
                    | (((st.fault & THM_FAULT_PRI) != 0U) ? TM_ST_PRI_FAULT : 0U)
                    | (((st.fault & THM_FAULT_BAK) != 0U) ? TM_ST_BAK_FAULT : 0U)
                    | (((st.fault & THM_FAULT_HEAT) != 0U) ? TM_ST_TIMEOUT : 0U));
        buf[TM_TEMP_OFS + (TM_LOOP_BYTES * ch)] = (uint8_t)(t >> 8);
        buf[TM_TEMP_OFS + 1U + (TM_LOOP_BYTES * ch)] = (uint8_t)(t & BYTE_MASK);
        buf[TM_TEMP_OFS + 2U + (TM_LOOP_BYTES * ch)] = s;
        buf[TM_TEMP_OFS + 3U + (TM_LOOP_BYTES * ch)] = 0U;
    }
    for (i = 0U; i < (THM_TM_LEN - 1U); i++)
    {
        sum = (uint8_t)(sum + buf[i]);
    }
    buf[THM_TM_LEN - 1U] = sum;
    return (int32_t)THM_TM_LEN;
}
