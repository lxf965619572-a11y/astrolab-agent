/* rt_msg 测试用桩的控制接口：rt_drv（描述符队列、共享 RAM、发送结果序列）、sys、tc_dispatch */
#ifndef UT_STUBS_H
#define UT_STUBS_H

#include <stdint.h>
#include "rt_drv.h"

#define UT_DESC_MAX 1100u
#define UT_MEM_WORDS 4096u

/* rt_drv 桩 */
extern uint16_t  g_irq_status;          /* rt_drv_irq_status 的返回值 */
extern rt_desc_t g_desc[UT_DESC_MAX];   /* rt_drv_next_desc 依次返回的描述符 */
extern unsigned  g_desc_n, g_desc_i;
extern unsigned  g_next_calls;
extern uint16_t  g_mem[UT_MEM_WORDS];   /* rt_drv_read 读取的共享 RAM */
extern unsigned  g_read_calls;
extern uint16_t  g_read_addr;
extern uint8_t   g_read_wc;
extern int       g_tx_ret[8];           /* rt_drv_write_tx 依次返回的值 */
extern unsigned  g_tx_calls;
extern uint8_t   g_tx_sa, g_tx_wc;
extern const uint16_t *g_tx_buf;

/* sys 桩 */
extern uint32_t g_tick;
extern unsigned g_lock_n, g_unlock_n, g_key_bad;  /* irq_lock/unlock 次数；unlock 参数不是配对的 lock 返回值的次数 */

/* tc_dispatch 桩 */
extern unsigned g_tc_calls;
extern uint16_t g_tc_data[32];
extern uint8_t  g_tc_wc;

void ut_stubs_reset(void);
void ut_push_desc(uint16_t bsw, uint16_t ptr, uint16_t cmd);
uint16_t ut_cmd(unsigned tr, unsigned sa, unsigned wc);

#endif /* UT_STUBS_H */
