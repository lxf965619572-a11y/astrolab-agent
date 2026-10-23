#ifndef TM_FRAME_H
#define TM_FRAME_H

#include <stdint.h>

typedef struct {
    uint16_t sync;
    uint16_t len;
    uint8_t  payload[64];
    uint16_t crc;
} tm_frame_t;

uint16_t tm_pack(tm_frame_t *frame, const uint8_t *payload, uint16_t len);
int32_t  tm_parse(const uint8_t *buf, uint16_t buf_len, tm_frame_t *out);
void     uart_rx_isr(void);
void     tm_wait_rx(uint32_t expect);
uint8_t  tm_payload_at(int32_t idx);

#endif /* TM_FRAME_H */
