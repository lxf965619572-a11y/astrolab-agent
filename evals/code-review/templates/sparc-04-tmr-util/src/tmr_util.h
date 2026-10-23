#ifndef TMR_UTIL_H
#define TMR_UTIL_H

#include <stdint.h>

typedef struct {
    uint32_t copy[3];
} tmr_u32_t;

uint32_t tmr_vote_bits(uint32_t a, uint32_t b, uint32_t c);
uint32_t tmr_vote_word(uint32_t a, uint32_t b, uint32_t c, uint8_t *err);
void     tmr_store(tmr_u32_t *p, uint32_t v);
uint32_t tmr_load(tmr_u32_t *p, uint8_t *err);
int32_t  wait_ready(const volatile uint32_t *status, uint32_t mask, uint16_t timeout_ms);
uint8_t  volt_stable(float v1, float v2);

#endif /* TMR_UTIL_H */
