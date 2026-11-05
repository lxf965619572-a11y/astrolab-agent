/*
 * 文件名：pdu_bsp.h
 * 功能：  PDU 底层驱动接口（由硬件组提供的 BSP 库，不属于本配置项）
 * 平台：  BM3803（SPARC V8），裸机
 * 依据：  PDU 硬件接口说明 第 3 章
 */
#ifndef PDU_BSP_H
#define PDU_BSP_H

#include "pdu_types.h"

/* 读通道电流 AD 码：ch 0～3；正常 0～4095，LSB 2 mA；AD 故障时返回 0xFFFF */
U16  bsp_adc_read(U32 ch);
/* 通道开关：ch 0～3；on 1 接通，0 断开 */
void bsp_switch_set(U32 ch, U32 on);
/* 取一帧遥控数据（帧间隔判定由 BSP 完成）：返回帧长，没有新帧返回 0 */
U32  bsp_uart_read_frame(U8 *buf, U32 max);
/* 发送遥测帧 */
void bsp_uart_send(const U8 *buf, U32 len);
/* 关中断，返回原中断级 */
U32  bsp_int_lock(void);
/* 恢复中断级 */
void bsp_int_unlock(U32 key);
/* 喂狗 */
void bsp_wdt_feed(void);
/* 启动周期定时器，每 period_ms 毫秒在中断中调用一次 isr */
void bsp_timer_start(U32 period_ms, void (*isr)(void));

#endif /* PDU_BSP_H */
