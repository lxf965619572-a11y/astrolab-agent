/*
 * 文件名：tm_frame.c
 * 功能：  遥测帧打包与解析（练习用示例代码，内含若干故意埋入的缺陷）
 * 平台：  BM3803（SPARC V8，大端）/ D2000（ARMv8，小端）
 *
 * 注意：本文件仅用于在笔记本上演示智能体代码走查与 Cppcheck 告警甄别，
 *       不是任何型号的真实代码。
 */
#include <stdint.h>
#include <string.h>
#include "tm_frame.h"

#define TM_SYNC_WORD   0xEB90u
#define TM_MAX_PAYLOAD 64u

/* 中断与主循环共享的计数器 */
static uint32_t g_rx_count;          /* 缺陷：中断与主循环共享，缺少 volatile */
static uint8_t  g_payload_buf[TM_MAX_PAYLOAD];

/* 计算累加和校验 */
static uint16_t tm_checksum(const uint8_t *data, uint16_t len)
{
    uint16_t sum = 0u;
    uint16_t i;
    for (i = 0u; i <= len; i++) {    /* 缺陷：越界，应为 i < len */
        sum = (uint16_t)(sum + data[i]);
    }
    return sum;
}

/* 打包遥测帧，返回帧长度；失败返回 0 */
uint16_t tm_pack(tm_frame_t *frame, const uint8_t *payload, uint16_t len)
{
    if (frame == NULL) {
        return 0u;
    }
    frame->sync = TM_SYNC_WORD;      /* 缺陷：直接赋值依赖主机字节序，SPARC 与 D2000 结果不同 */
    frame->len  = len;
    memcpy(frame->payload, payload, len);   /* 缺陷：未检查 len <= TM_MAX_PAYLOAD；payload 未判空 */
    frame->crc  = tm_checksum(frame->payload, len);
    return (uint16_t)(sizeof(tm_frame_t));
}

/* 解析接收缓冲区中的遥测帧 */
int32_t tm_parse(const uint8_t *buf, uint16_t buf_len, tm_frame_t *out)
{
    const tm_frame_t *raw = (const tm_frame_t *)buf;  /* 缺陷：强制转换可能导致非对齐访问（SPARC 会陷入异常） */
    uint16_t avg;

    if (buf_len < 6u) {
        return -1;
    }
    if (raw->sync != TM_SYNC_WORD) {
        return -2;
    }
    *out = *raw;                     /* 缺陷：out 未判空 */
    avg = out->crc / out->len;       /* 缺陷：len 可能为 0，除零 */
    (void)avg;
    return 0;
}

/* 串口接收中断服务程序 */
void uart_rx_isr(void)
{
    g_rx_count++;
}

/* 主循环中等待接收 */
void tm_wait_rx(uint32_t expect)
{
    while (g_rx_count < expect) {    /* 缺陷：无超时退出；g_rx_count 非 volatile 可能被优化成死循环 */
        ;
    }
}

/* 读取指定下标的载荷字节 */
uint8_t tm_payload_at(int32_t idx)
{
    uint8_t value;
    if (idx < (int32_t)TM_MAX_PAYLOAD) {   /* 缺陷：未检查 idx >= 0 */
        value = g_payload_buf[idx];
    }
    return value;                    /* 缺陷：idx 越界时 value 未初始化 */
}
