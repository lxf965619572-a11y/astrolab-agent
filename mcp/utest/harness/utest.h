/*
 * utest.h —— 最小手写单元测试框架（C89，单头文件）
 *
 * 用法：
 *   1. 测试驱动文件（含 main 的那个）在 #include "utest.h" 之前写 #define UTEST_MAIN
 *   2. 每个用例：
 *        UT_CASE("UT-CMD-CHECK-001", "指令码在码表中，判为合法");
 *        UT_CHECK_EQ_INT(cmd_check(0x0101u), CMD_OK);
 *        UT_END_CASE();
 *   3. main 最后 return UT_SUMMARY();
 *
 * 输出格式固定，utest 服务按此解析（不要修改前缀）：
 *   [CASE] <用例标识> <说明>
 *   [FAIL] <用例标识> <文件>:<行号>: <检查内容> expected=<预期> actual=<实际>
 *   [PASS] <用例标识>        或   [CASE-FAILED] <用例标识>
 *   [SUMMARY] cases=<n> passed=<n> failed=<n> checks=<n> failed_checks=<n>
 *
 * 在目标机上运行时，把 UT_PRINTF 重定义为目标机的输出函数（如串口打印）。
 * 部门已有自己的测试框架时，可以不用本文件，但要让输出包含上述 [SUMMARY] 行，或改用 gtest。
 */
#ifndef UTEST_H
#define UTEST_H

#include <stdio.h>
#include <string.h>

#ifndef UT_PRINTF
#define UT_PRINTF printf
#endif
/* 每条输出后立即刷新，测试程序崩溃或超时被终止时也能看到最后执行的用例。目标机上可定义为空 */
#ifndef UT_FLUSH
#define UT_FLUSH() fflush(stdout)
#endif

#ifdef UTEST_MAIN
int ut_n_cases = 0;
int ut_n_cases_failed = 0;
int ut_n_checks = 0;
int ut_n_checks_failed = 0;
int ut_case_failed = 0;
const char *ut_case_id = "(none)";
#if defined(_WIN32) && defined(__GNUC__)
/* Windows：关闭“程序已停止工作”错误报告对话框。否则测试程序崩溃时会挂起，直到被超时终止，
 * 结果显示为“超时”而不是“崩溃”。0x0001 SEM_FAILCRITICALERRORS，0x0002 SEM_NOGPFAULTERRORBOX */
#ifdef __cplusplus
extern "C"
#endif
__declspec(dllimport) unsigned int __stdcall SetErrorMode(unsigned int uMode);
static void __attribute__((constructor)) ut_win_no_error_dialog(void) { (void)SetErrorMode(0x0001u | 0x0002u); }
#endif
#else
extern int ut_n_cases;
extern int ut_n_cases_failed;
extern int ut_n_checks;
extern int ut_n_checks_failed;
extern int ut_case_failed;
extern const char *ut_case_id;
#endif

#define UT_CASE(id, desc) do { \
    ut_case_id = (id); ut_case_failed = 0; ut_n_cases++; \
    UT_PRINTF("[CASE] %s %s\n", (id), (desc)); UT_FLUSH(); \
} while (0)

#define UT_END_CASE() do { \
    if (ut_case_failed) { ut_n_cases_failed++; UT_PRINTF("[CASE-FAILED] %s\n", ut_case_id); } \
    else { UT_PRINTF("[PASS] %s\n", ut_case_id); } \
    UT_FLUSH(); \
} while (0)

#define UT_FAIL_HERE(what, exp_fmt, exp, act) do { \
    ut_case_failed = 1; ut_n_checks_failed++; \
    UT_PRINTF("[FAIL] %s %s:%d: %s expected=" exp_fmt " actual=" exp_fmt "\n", \
              ut_case_id, __FILE__, __LINE__, (what), (exp), (act)); UT_FLUSH(); \
} while (0)

/* 条件为真 */
#define UT_CHECK(cond) do { ut_n_checks++; \
    if (!(cond)) { ut_case_failed = 1; ut_n_checks_failed++; \
        UT_PRINTF("[FAIL] %s %s:%d: UT_CHECK(%s)\n", ut_case_id, __FILE__, __LINE__, #cond); } \
} while (0)

/* 有符号整数相等 */
#define UT_CHECK_EQ_INT(actual, expected) do { long ut_a_ = (long)(actual); long ut_e_ = (long)(expected); \
    ut_n_checks++; if (ut_a_ != ut_e_) UT_FAIL_HERE(#actual, "%ld", ut_e_, ut_a_); } while (0)

/* 无符号整数相等（十六进制显示） */
#define UT_CHECK_EQ_UINT(actual, expected) do { unsigned long ut_a_ = (unsigned long)(actual); unsigned long ut_e_ = (unsigned long)(expected); \
    ut_n_checks++; if (ut_a_ != ut_e_) UT_FAIL_HERE(#actual, "0x%lX", ut_e_, ut_a_); } while (0)

/* 浮点数在容差内相等 */
#define UT_CHECK_NEAR(actual, expected, tol) do { double ut_a_ = (double)(actual); double ut_e_ = (double)(expected); \
    double ut_d_ = ut_a_ - ut_e_; ut_n_checks++; if (ut_d_ < 0) ut_d_ = -ut_d_; \
    if (ut_d_ > (double)(tol)) UT_FAIL_HERE(#actual, "%g", ut_e_, ut_a_); } while (0)

/* 内存块相等 */
#define UT_CHECK_EQ_MEM(actual, expected, len) do { ut_n_checks++; \
    if (memcmp((actual), (expected), (len)) != 0) { ut_case_failed = 1; ut_n_checks_failed++; \
        UT_PRINTF("[FAIL] %s %s:%d: UT_CHECK_EQ_MEM(%s, %s, %s)\n", ut_case_id, __FILE__, __LINE__, #actual, #expected, #len); } \
} while (0)

#define UT_SUMMARY() ( \
    UT_PRINTF("[SUMMARY] cases=%d passed=%d failed=%d checks=%d failed_checks=%d\n", \
              ut_n_cases, ut_n_cases - ut_n_cases_failed, ut_n_cases_failed, ut_n_checks, ut_n_checks_failed), \
    (ut_n_cases_failed ? 1 : 0))

#endif /* UTEST_H */
