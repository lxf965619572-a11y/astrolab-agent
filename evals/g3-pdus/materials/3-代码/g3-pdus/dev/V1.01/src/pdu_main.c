/*
 * 文件名：pdu_main.c
 * 功能：  PDUS 主程序和 50 ms 定时中断
 * 平台：  BM3803（SPARC V8），裸机
 * 设计：  软件详细设计说明 4.2
 * 修改记录：
 *   2025-06-10  V1.00 初版
 */
#include "pdu_types.h"
#include "pdu_bsp.h"
#include "ocp.h"
#include "cmd.h"
#include "tm.h"

#define PDU_TICK_MS  (50U)   /* 定时中断周期，ms */
#define PDU_TM_DIV   (10U)   /* 遥测周期 = 10 × 50 ms */

static volatile U32 s_tick = 0U;

/*
 * 函数名：pdu_tick_isr
 * 功能：  50 ms 定时中断：电流采集和过流保护，置节拍标志
 * 设计：  4.2.2
 * 输入：  无
 * 输出：  s_tick
 * 返回：  无
 * 说明：  中断服务程序
 */
static void pdu_tick_isr(void)
{
    ocp_check();
    s_tick = 1U;
}

/*
 * 函数名：main
 * 功能：  初始化各模块，启动定时器，主循环按 50 ms 节拍处理遥控、每 500 ms 发遥测、喂狗
 * 设计：  4.2.3
 * 输入：  无
 * 输出：  无
 * 返回：  不返回
 */
int main(void)
{
    U32 tm_div = 0U;

    /* 初始化：先置通道和保护的上电状态，再启动定时中断 */
    ocp_init();
    cmd_init();
    tm_init();
    bsp_timer_start(PDU_TICK_MS, pdu_tick_isr);
    for (;;)
    {
        /* 等待 50 ms 节拍（由定时中断置位） */
        if (s_tick != 0U)
        {
            s_tick = 0U;
            /* 遥控处理 */
            cmd_poll();
            /* 每 10 个节拍发一帧遥测 */
            tm_div++;
            if (tm_div >= PDU_TM_DIV)
            {
                tm_div = 0U;
                tm_send();
            }
            bsp_wdt_feed();
        }
    }
    return 0;
}
