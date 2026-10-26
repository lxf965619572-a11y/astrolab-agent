/*
 * ut_map.h —— 把目标机的寄存器、存储区地址映射为主机上的普通内存（手写驱动和 gtest 都可用）
 *
 * 用途：被测 .c 中直接写死了地址（如 #define UART_SR (*(volatile uint32_t *)0x80000104u)），
 * 又没有可替换的头文件时，主机上一访问就崩溃。在测试开始前把这段地址映射为可读写的内存：
 *
 *     #include "ut_map.h"
 *     int main(void) {
 *         if (!UT_MAP(0x80000100u, 0x100u)) { printf("映射失败\n"); return 2; }
 *         ...
 *     }
 *
 * 之后被测代码读写这些地址就是读写普通内存：用例可以预置寄存器的值、检查最终写入的值。
 * 限制：模拟不了硬件的副作用（读清除、写 1 清除、FIFO、状态随读取次数变化），
 *      也记录不了写入顺序。需要这些时，仍要把寄存器访问改为可替换的宏或函数。
 * 地址范围已被主机占用时映射失败（返回 NULL），换一个测试程序或在目标机上验证。
 */
#ifndef UT_MAP_H
#define UT_MAP_H

#include <stddef.h>

#if defined(_WIN32)
#ifdef __cplusplus
extern "C" {
#endif
__declspec(dllimport) void *__stdcall VirtualAlloc(void *addr, size_t size, unsigned long type, unsigned long protect);
#ifdef __cplusplus
}
#endif
/* 返回 addr 本身（映射成功）或 NULL。Windows 按 64 KB 对齐保留，按页提交 */
static void *ut_map(unsigned long long addr, unsigned long long size)
{
    const unsigned long long gran = 0x10000ull;
    unsigned long long base = addr & ~(gran - 1ull);
    unsigned long long len = addr + size - base;
    void *p = VirtualAlloc((void *)(size_t)base, (size_t)len, 0x3000ul /* MEM_COMMIT | MEM_RESERVE */, 0x04ul /* PAGE_READWRITE */);
    return p == (void *)(size_t)base ? (void *)(size_t)addr : NULL;
}
#else
#include <sys/mman.h>
#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS 0x20
#endif
static void *ut_map(unsigned long long addr, unsigned long long size)
{
    unsigned long long base = addr & ~0xFFFull;
    unsigned long long len = addr + size - base;
    void *p = mmap((void *)(size_t)base, (size_t)len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p == MAP_FAILED) return NULL;
    if (p != (void *)(size_t)base) { munmap(p, (size_t)len); return NULL; } /* 内核没有按指定地址映射 */
    return (void *)(size_t)addr;
}
#endif

#define UT_MAP(addr, size) ut_map((unsigned long long)(addr), (unsigned long long)(size))

#endif /* UT_MAP_H */
