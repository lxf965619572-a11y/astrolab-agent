/*
 * 文件名：rt_msg.c
 * 功能：  1553B 远程终端（RT）接收消息处理（BM3803 + 1553B 协议芯片）
 *         rt_rx_handle 由主循环轮询调用；raw 指向协议芯片共享 RAM 中的消息块，
 *         格式为：命令字 + 数据字（每字 16 位，按处理器字节序存放）。
 */
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "rt_msg.h"

#define RT_MAX_WORDS  32u
#define RT_SA_COUNT   32u

static uint16_t sa_data[RT_SA_COUNT][RT_MAX_WORDS];
static uint16_t sa_len[RT_SA_COUNT];

/* 解析命令字：bit15-11 RT 地址，bit10 T/R，bit9-5 子地址，bit4-0 数据字计数 */
static void cmd_decode(uint16_t cmd, uint8_t *rt, uint8_t *sa, uint8_t *wc)
{
    *rt = (uint8_t)((cmd >> 11) & 0x1Fu);
    *sa = (uint8_t)((cmd >> 5) & 0x1Fu);
    *wc = (uint8_t)(cmd & 0x1Fu);    /*@D:rt-wc-zero*/
}

/* 处理一条接收消息；成功返回 0 */
int32_t rt_rx_handle(const uint8_t *raw, uint32_t raw_len, uint8_t my_rt)
{
    const uint16_t *words = (const uint16_t *)raw;    /*@D:rt-align-cast*/
    uint8_t  rt;
    uint8_t  sa;
    uint8_t  wc;
    uint16_t i;

    if ((raw == NULL) || (raw_len < 2u)) {
        return -1;
    }
    cmd_decode(words[0], &rt, &sa, &wc);
    if (rt != my_rt) {    /*@D:rt-tr-bit*/
        return -2;    /*@D:rt-tr-bit*/
    }
    if (raw_len < (2u + ((uint32_t)wc * 2u))) {
        return -3;
    }
    for (i = 0u; i < wc; i++) {
        sa_data[sa][i] = words[i + 1u];
    }
    sa_len[sa] = wc;
    return 0;
}

/*@CLEAN*/
/* 读取某子地址最近一次收到的数据；返回复制的字数，参数错误返回 -1 */
int32_t rt_get_data(uint8_t sa, uint16_t *dst, uint32_t dst_words)
{
    uint32_t n;

    if ((dst == NULL) || (sa >= RT_SA_COUNT)) {
        return -1;
    }
    n = sa_len[sa];
    if (n > dst_words) {
        n = dst_words;
    }
    (void)memcpy(dst, sa_data[sa], n * sizeof(uint16_t));
    return (int32_t)n;
}
/*@END*/
