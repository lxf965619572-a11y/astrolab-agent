#define UTEST_MAIN
#include "utest.h"
#include "demo.h"

int main(void)
{
    UT_CASE("UT-DEMO-CLAMP-001", "区间内原样返回");
    UT_CHECK_EQ_INT(demo_clamp(5, 0, 10), 5);
    UT_END_CASE();
    UT_CASE("UT-DEMO-CLAMP-002", "低于下限返回下限");
    UT_CHECK_EQ_INT(demo_clamp(-1, 0, 10), 0);
    UT_END_CASE();
    UT_CASE("UT-DEMO-CLAMP-003", "高于上限返回上限");
    UT_CHECK_EQ_INT(demo_clamp(11, 0, 10), 10);
    UT_END_CASE();
    UT_CASE("UT-DEMO-CLAMP-004", "下限大于上限返回下限");
    UT_CHECK_EQ_INT(demo_clamp(5, 10, 0), 10);
    UT_END_CASE();
    return UT_SUMMARY();
}
