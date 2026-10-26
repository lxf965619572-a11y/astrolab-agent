#define UTEST_MAIN
#include "utest.h"
#include "ut_map.h"

void tmr_start(unsigned int period_us);
#define REG(a) (*(volatile unsigned int *)(a))

int main(void)
{
    UT_CASE("MAP-1", "目标机地址映射为主机内存后，检查写入的寄存器值");
    if (UT_MAP(0x20000100u, 0x10u) == NULL) {
        UT_PRINTF("[FAIL] MAP-1 ut_map: 地址 0x20000100 映射失败\n");
        return UT_SUMMARY() + 2;
    }
    tmr_start(1000u);
    UT_CHECK_EQ_UINT(REG(0x20000100u), 999u);
    UT_CHECK_EQ_UINT(REG(0x20000104u), 0x3u);
    UT_END_CASE();
    return UT_SUMMARY();
}
