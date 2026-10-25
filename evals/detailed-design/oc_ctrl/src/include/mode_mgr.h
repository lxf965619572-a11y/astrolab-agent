/* 模式管理（mode_mgr 模块提供） */
#ifndef MODE_MGR_H
#define MODE_MGR_H
#include <stdint.h>
#define MODE_NORMAL 0u
#define MODE_SAFE   1u
uint8_t mode_get(void);
#endif
