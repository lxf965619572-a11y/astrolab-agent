/*
 * 文件名：tc_dispatch.h
 * 功能：  遥控指令分发（遥控处理模块提供，不属于被测模块）
 */
#ifndef TC_DISPATCH_H
#define TC_DISPATCH_H

#include <stdint.h>

void tc_dispatch(const uint16_t *data, uint8_t wc);

#endif /* TC_DISPATCH_H */
