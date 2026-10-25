/* 自检用：故意空指针写入，检查崩溃能被及时识别 */
#define UTEST_MAIN
#include "utest.h"
#include "demo.h"

int main(void)
{
    volatile int *p = (volatile int *)0;
    UT_CASE("UT-DEMO-CRASH-001", "故意空指针写入");
    *p = demo_clamp(1, 0, 2);
    UT_END_CASE();
    return UT_SUMMARY();
}
