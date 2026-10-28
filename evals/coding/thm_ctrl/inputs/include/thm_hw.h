/******************************************************************************
 * 文件：thm_hw.h
 * 说明：热控硬件接口（驱动组提供，实现在 BSP 中）
 ******************************************************************************/
#ifndef THM_HW_H
#define THM_HW_H

#include <stdint.h>

/* 读一个热敏电阻的 12 位 ADC 值（0～4095）。sensor：0 主份，1 备份 */
uint16_t thm_adc_read(uint8_t ch, uint8_t sensor);

/* 加热器输出：on 为 0 关，1 开 */
void     thm_heater_out(uint8_t ch, uint8_t on);

/* 上电以来的毫秒数，32 位无符号，约 49.7 天回绕 */
uint32_t thm_tick_ms(void);

/* 关中断并返回原来的中断级别；thm_irq_restore 恢复。成对使用 */
uint32_t thm_irq_save(void);
void     thm_irq_restore(uint32_t key);

#endif /* THM_HW_H */
