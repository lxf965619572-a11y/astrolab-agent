/*
 * 文件名：tmr_util.c
 * 功能：  三模冗余表决、超时等待等通用工具（BM3803）
 */
#include <stdint.h>
#include <stddef.h>
#include "tmr_util.h"

/* 1 ms 自由运行计数，16 位，约 65.5 s 回绕一次（由定时器驱动提供） */
extern uint16_t sys_tick_ms(void);

/* 三模冗余按位多数表决 */
uint32_t tmr_vote_bits(uint32_t a, uint32_t b, uint32_t c)
{
    return (a & b) | (b & c);    /*@D:tmr-vote-term*/
}

/* 三模冗余整字表决；三份两两不一致时 *err 置 1 */
uint32_t tmr_vote_word(uint32_t a, uint32_t b, uint32_t c, uint8_t *err)
{
    if (err == NULL) {
        return a;
    }
    *err = 0u;
    if ((a == b) || (a == c)) {
        return a;
    }
    return b;    /*@D:tmr-vote-no-err*/
}

/*@CLEAN*/
/* 关键参数三份冗余存储 */
void tmr_store(tmr_u32_t *p, uint32_t v)
{
    if (p != NULL) {
        p->copy[0] = v;
        p->copy[1] = v;
        p->copy[2] = v;
    }
}
/*@END*/

/*@CLEAN*/
/* 读取冗余参数；表决一致时刷新三份副本，不一致时保留原值并置 *err */
uint32_t tmr_load(tmr_u32_t *p, uint8_t *err)
{
    uint32_t v;
    uint8_t  e = 0u;

    if (p == NULL) {
        if (err != NULL) {
            *err = 1u;
        }
        return 0u;
    }
    v = tmr_vote_word(p->copy[0], p->copy[1], p->copy[2], &e);
    if (e == 0u) {
        tmr_store(p, v);
    }
    if (err != NULL) {
        *err = e;
    }
    return v;
}
/*@END*/

/* 等待状态寄存器中 mask 位置位；timeout_ms 内未置位返回 -1 */
int32_t wait_ready(const volatile uint32_t *status, uint32_t mask, uint16_t timeout_ms)
{
    uint16_t start = sys_tick_ms();

    while ((*status & mask) == 0u) {
        if ((sys_tick_ms() - start) > timeout_ms) {    /*@D:tmr-tick-wrap*/
            return -1;
        }
    }
    return 0;
}

/* 判断两次采样电压是否稳定（相同则认为稳定） */
uint8_t volt_stable(float v1, float v2)
{
    return (v1 == v2) ? 1u : 0u;    /*@D:tmr-float-eq*/
}
