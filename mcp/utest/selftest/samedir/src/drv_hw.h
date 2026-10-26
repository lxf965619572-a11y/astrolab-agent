/* 目标机寄存器（自检用）：与 drv.c 同目录，主机上直接访问会崩溃 */
#ifndef DRV_HW_H
#define DRV_HW_H
#define DRV_CTRL (*(volatile unsigned int *)0x0000000Cu)
#define DRV_STAT (*(volatile unsigned int *)0x00000010u)
#endif
