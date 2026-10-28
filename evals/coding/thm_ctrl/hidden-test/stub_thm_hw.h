/* 评估用硬件桩（不要给智能体看） */
#ifndef STUB_THM_HW_H
#define STUB_THM_HW_H
#include <stdint.h>
void stub_reset(void);
void stub_set_adc(uint8_t ch, uint8_t sensor, uint16_t raw);
void stub_set_tick(uint32_t ms);
int  stub_out_count(uint8_t ch);
int  stub_out_total(void);
int  stub_out_last(uint8_t ch);
int  stub_irq_depth(void);
int  stub_irq_mismatch(void);
int  stub_irq_saves(void);
#endif
