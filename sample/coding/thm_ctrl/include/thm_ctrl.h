/******************************************************************************
 * 文件：thm_ctrl.h
 * 说明：热控加热回路控制 对外接口（已评审，不得修改）
 * 平台：BM3803（SPARC V8，大端），C99
 ******************************************************************************/
#ifndef THM_CTRL_H
#define THM_CTRL_H

#include <stdint.h>

#define THM_CH_NUM        4U                 /* 加热回路数 */

#define THM_OK            0
#define THM_ERR_CH        (-1)               /* 回路号越界 */
#define THM_ERR_RANGE     (-2)               /* 温度超出允许范围 */
#define THM_ERR_PARAM     (-3)               /* 参数错误（空指针、下限不小于上限） */
#define THM_ERR_BUF       (-4)               /* 缓冲区太小 */

#define THM_TEMP_INVALID  ((int16_t)0x7FFF)  /* 无有效温度 */

/* 遥测帧长度：同步字 1 + 回路数 1 + 每回路 4 + 校验 1；校验为前面各字节的异或 */
#define THM_TM_LEN        (2U + (THM_CH_NUM * 4U) + 1U)

/* 故障位 */
#define THM_FAULT_PRI     0x01U              /* 主份传感器故障 */
#define THM_FAULT_BAK     0x02U              /* 备份传感器故障 */
#define THM_FAULT_HEAT    0x04U              /* 加热超时 */

typedef struct
{
    int16_t temp;     /* 当前采用的温度，0.1 ℃；无有效温度为 THM_TEMP_INVALID */
    uint8_t sensor;   /* 0：主份；1：备份 */
    uint8_t heater;   /* 0：关；1：开 */
    uint8_t fault;    /* THM_FAULT_xxx 的组合 */
} thm_status_t;

void    thm_init(void);
/* 温度允许范围 -40.0 ℃ ～ +60.0 ℃（-400 ～ 600） */
int32_t thm_set_limits(uint8_t ch, int16_t tl, int16_t th);
void    thm_cycle(void);
int32_t thm_get_status(uint8_t ch, thm_status_t *st);
int32_t thm_pack_tm(uint8_t *buf, uint32_t len);

#endif /* THM_CTRL_H */
