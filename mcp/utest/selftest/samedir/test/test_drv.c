#define UTEST_MAIN
#include "utest.h"
#include "hw/drv_hw.h"

int drv_start(unsigned int mode);
unsigned int ut_ctrl, ut_stat;

int main(void)
{
    UT_CASE("SD-1", "同目录头文件被替换：写控制寄存器、就绪返回 0");
    ut_ctrl = 0u; ut_stat = 1u;
    UT_CHECK_EQ_INT(drv_start(2u), 0);
    UT_CHECK_EQ_UINT(ut_ctrl, 0x102u);
    UT_END_CASE();

    UT_CASE("SD-2", "未就绪返回 -2，模式非法返回 -1");
    ut_stat = 0u;
    UT_CHECK_EQ_INT(drv_start(1u), -2);
    UT_CHECK_EQ_INT(drv_start(4u), -1);
    UT_END_CASE();
    return UT_SUMMARY();
}
