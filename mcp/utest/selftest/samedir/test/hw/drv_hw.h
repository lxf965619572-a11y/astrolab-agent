/* 替换 src/drv_hw.h：寄存器改为测试数组 */
#ifndef DRV_HW_H
#define DRV_HW_H
extern unsigned int ut_ctrl, ut_stat;
#define DRV_CTRL ut_ctrl
#define DRV_STAT ut_stat
#endif
