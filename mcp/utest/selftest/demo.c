/* 自检用的小模块：限幅 */
#include "demo.h"

int demo_clamp(int v, int lo, int hi)
{
    if (lo > hi) {
        return lo;
    }
    if (v < lo || v > hi) {
        return (v < lo) ? lo : hi;
    }
    return v;
}
