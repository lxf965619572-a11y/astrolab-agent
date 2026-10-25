/*
 * 文件名：sys_time.h
 * 功能：  系统时间（时间管理模块提供，不在本次单元测试范围内）
 */
#ifndef SYS_TIME_H
#define SYS_TIME_H

#include <stdint.h>

/* 返回系统 tick 计数，1 tick = 1 ms，32 位无符号，溢出后回绕到 0 */
uint32_t sys_ticks(void);

#endif /* SYS_TIME_H */
