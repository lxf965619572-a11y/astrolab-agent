#ifndef BITUTIL_H
#define BITUTIL_H

#include <stdint.h>

uint16_t bswap16(uint16_t v);
uint32_t bswap32(uint32_t v);
uint16_t get_be16(const uint8_t *p);
void     put_be16(uint8_t *p, uint16_t v);
uint8_t  parity8(uint8_t v);
uint32_t sat_add_u32(uint32_t a, uint32_t b);
int32_t  clamp_i32(int32_t v, int32_t lo, int32_t hi);
uint8_t  crc8(const uint8_t *p, uint32_t len);

#endif /* BITUTIL_H */
