#ifndef TC_DISPATCH_H
#define TC_DISPATCH_H

#include <stdint.h>

int32_t  tc_dispatch(const uint8_t *frame, uint16_t frame_len);
uint32_t tc_err_count(void);

#endif /* TC_DISPATCH_H */
