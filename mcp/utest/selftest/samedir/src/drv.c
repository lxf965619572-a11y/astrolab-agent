/* 自检用被测模块：寄存器头文件与本文件同目录 */
#include "drv_hw.h"

int drv_start(unsigned int mode)
{
    if (mode > 3u) {
        return -1;
    }
    DRV_CTRL = 0x100u | mode;
    return (DRV_STAT & 0x1u) ? 0 : -2;
}
