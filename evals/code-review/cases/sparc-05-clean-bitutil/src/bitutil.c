/*
 * 文件名：bitutil.c
 * 功能：  字节序转换、校验与饱和运算等通用工具（BM3803 与 D2000 共用）
 */
#include <stdint.h>
#include <stddef.h>
#include "bitutil.h"

/* 16 位字节交换 */
uint16_t bswap16(uint16_t v)
{
    return (uint16_t)((uint16_t)(v << 8) | (uint16_t)(v >> 8));
}

/* 32 位字节交换 */
uint32_t bswap32(uint32_t v)
{
    return ((v & 0x000000FFu) << 24) |
           ((v & 0x0000FF00u) << 8)  |
           ((v & 0x00FF0000u) >> 8)  |
           ((v & 0xFF000000u) >> 24);
}

/* 从字节流按大端读取 16 位；p 为空时返回 0 */
uint16_t get_be16(const uint8_t *p)
{
    if (p == NULL) {
        return 0u;
    }
    return (uint16_t)(((uint16_t)p[0] << 8) | (uint16_t)p[1]);
}

/* 按大端写入 16 位；p 为空时不操作 */
void put_be16(uint8_t *p, uint16_t v)
{
    if (p != NULL) {
        p[0] = (uint8_t)(v >> 8);
        p[1] = (uint8_t)(v & 0xFFu);
    }
}

/* 偶校验位：返回 v 中 1 的个数的奇偶（1 表示奇数个） */
uint8_t parity8(uint8_t v)
{
    uint8_t x = v;

    x ^= (uint8_t)(x >> 4);
    x ^= (uint8_t)(x >> 2);
    x ^= (uint8_t)(x >> 1);
    return (uint8_t)(x & 1u);
}

/* 无符号 32 位饱和加法 */
uint32_t sat_add_u32(uint32_t a, uint32_t b)
{
    uint32_t s = a + b;

    return (s < a) ? UINT32_MAX : s;
}

/* 把 v 限制在 [lo, hi]；要求 lo <= hi，否则返回 lo */
int32_t clamp_i32(int32_t v, int32_t lo, int32_t hi)
{
    if (lo > hi) {
        return lo;
    }
    if (v < lo) {
        return lo;
    }
    if (v > hi) {
        return hi;
    }
    return v;
}

/* CRC-8（多项式 0x07，初值 0）；p 为空或 len 为 0 时返回 0 */
uint8_t crc8(const uint8_t *p, uint32_t len)
{
    uint8_t  crc = 0u;
    uint32_t i;
    uint8_t  b;

    if (p == NULL) {
        return 0u;
    }
    for (i = 0u; i < len; i++) {
        crc ^= p[i];
        for (b = 0u; b < 8u; b++) {
            if ((crc & 0x80u) != 0u) {
                crc = (uint8_t)((uint8_t)(crc << 1) ^ 0x07u);
            } else {
                crc = (uint8_t)(crc << 1);
            }
        }
    }
    return crc;
}
