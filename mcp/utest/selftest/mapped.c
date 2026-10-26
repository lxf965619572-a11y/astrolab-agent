/* 自检用被测模块：寄存器地址直接写在 .c 中，没有可替换的头文件 */
#define TMR_LOAD (*(volatile unsigned int *)0x20000100u)
#define TMR_CTRL (*(volatile unsigned int *)0x20000104u)

void tmr_start(unsigned int period_us)
{
    TMR_LOAD = period_us - 1u;
    TMR_CTRL = 0x3u;
}
