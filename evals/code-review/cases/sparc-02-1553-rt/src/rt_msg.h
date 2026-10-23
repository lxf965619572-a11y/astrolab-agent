#ifndef RT_MSG_H
#define RT_MSG_H

#include <stdint.h>

int32_t rt_rx_handle(const uint8_t *raw, uint32_t raw_len, uint8_t my_rt);
int32_t rt_get_data(uint8_t sa, uint16_t *dst, uint32_t dst_words);

#endif /* RT_MSG_H */
