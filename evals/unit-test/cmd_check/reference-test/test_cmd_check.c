/*
 * cmd_check 模块参考单元测试（人工按详细设计编写，作为评分基线）
 * 预期结果全部来自 sample/utest/cmd_check/doc/cmd_check-详细设计.md，不来自代码。
 */
#define UTEST_MAIN
#include "utest.h"
#include "cmd_check.h"

/* 按设计第 1 节组帧：同步字、指令码、参数、校验和（高字节在前） */
static void make_frame(uint8_t *f, uint16_t code, uint16_t param)
{
    uint16_t s;
    f[0] = 0xEBu; f[1] = 0x90u;
    f[2] = (uint8_t)(code >> 8);  f[3] = (uint8_t)code;
    f[4] = (uint8_t)(param >> 8); f[5] = (uint8_t)param;
    s = (uint16_t)(f[0] + f[1] + f[2] + f[3] + f[4] + f[5]);
    f[6] = (uint8_t)(s >> 8); f[7] = (uint8_t)s;
}

static cmd_result_t chk(uint16_t code, uint16_t param, work_mode_t mode)
{
    uint8_t f[8];
    make_frame(f, code, param);
    return cmd_check(f, 8u, mode);
}

static void test_counters_initial(void)
{
    UT_CASE("UT-CNT-001", "上电初值：接收计数、错误计数均为 0（3.5）");
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 0u);
    UT_END_CASE();
}

static void test_checksum(void)
{
    static uint8_t ff[300];
    uint8_t a[3] = { 1u, 2u, 3u };
    unsigned i;
    for (i = 0; i < sizeof ff; i++) ff[i] = 0xFFu;

    UT_CASE("UT-SUM-001", "空指针返回 0（3.1）");
    UT_CHECK_EQ_UINT(cmd_checksum(NULL, 5u), 0u);
    UT_END_CASE();

    UT_CASE("UT-SUM-002", "len 为 0 返回 0（3.1）");
    UT_CHECK_EQ_UINT(cmd_checksum(a, 0u), 0u);
    UT_END_CASE();

    UT_CASE("UT-SUM-003", "1+2+3=6（3.1）");
    UT_CHECK_EQ_UINT(cmd_checksum(a, 3u), 6u);
    UT_END_CASE();

    UT_CASE("UT-SUM-004", "累加溢出取低 16 位：300×0xFF=76500→10964（3.1）");
    UT_CHECK_EQ_UINT(cmd_checksum(ff, 300u), 10964u);
    UT_END_CASE();
}

static void test_frame_checks(void)
{
    uint8_t f[9];

    UT_CASE("UT-CHK-001", "空指针返回 CMD_ERR_NULL，优先于长度检查（3.2 顺序 1）");
    UT_CHECK_EQ_INT(cmd_check(NULL, 0u, MODE_NORMAL), CMD_ERR_NULL);
    UT_END_CASE();

    make_frame(f, 0x0102u, 0u);
    f[8] = 0u;
    UT_CASE("UT-CHK-002", "长度 7、9、0 返回 CMD_ERR_LEN（等价类：小于、大于 8）");
    UT_CHECK_EQ_INT(cmd_check(f, 7u, MODE_NORMAL), CMD_ERR_LEN);
    UT_CHECK_EQ_INT(cmd_check(f, 9u, MODE_NORMAL), CMD_ERR_LEN);
    UT_CHECK_EQ_INT(cmd_check(f, 0u, MODE_NORMAL), CMD_ERR_LEN);
    UT_END_CASE();

    UT_CASE("UT-CHK-003", "同步字第 1 字节错误返回 CMD_ERR_SYNC（MC/DC：条件 1 独立影响）");
    make_frame(f, 0x0102u, 0u); f[0] = 0xEAu;
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SYNC);
    UT_END_CASE();

    UT_CASE("UT-CHK-004", "同步字第 2 字节错误返回 CMD_ERR_SYNC（MC/DC：条件 2 独立影响）");
    make_frame(f, 0x0102u, 0u); f[1] = 0x00u;
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SYNC);
    UT_END_CASE();

    UT_CASE("UT-CHK-005", "校验和低字节、高字节错误均返回 CMD_ERR_SUM");
    make_frame(f, 0x0102u, 0u); f[7] ^= 0x01u;
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SUM);
    make_frame(f, 0x0102u, 0u); f[6] ^= 0x01u;
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SUM);
    UT_END_CASE();

    UT_CASE("UT-CHK-006", "未知指令码返回 CMD_ERR_CODE，优先于模式和参数检查");
    UT_CHECK_EQ_INT(chk(0x0000u, 0u, MODE_NORMAL), CMD_ERR_CODE);
    UT_CHECK_EQ_INT(chk(0x0103u, 0u, MODE_NORMAL), CMD_ERR_CODE);
    UT_CHECK_EQ_INT(chk(0x0302u, 0x5A5Au, MODE_SAFE), CMD_ERR_CODE);
    UT_END_CASE();
}

static void test_mode(void)
{
    UT_CASE("UT-MODE-001", "载荷加电：正常、维护允许，安全禁止");
    UT_CHECK_EQ_INT(chk(0x0101u, 0u, MODE_NORMAL), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0101u, 0u, MODE_MAINT), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0101u, 0u, MODE_SAFE), CMD_ERR_MODE);
    UT_END_CASE();

    UT_CASE("UT-MODE-002", "温度门限：正常、维护允许，安全禁止");
    UT_CHECK_EQ_INT(chk(0x0201u, 500u, MODE_NORMAL), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0201u, 500u, MODE_MAINT), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0201u, 500u, MODE_SAFE), CMD_ERR_MODE);
    UT_END_CASE();

    UT_CASE("UT-MODE-003", "载荷断电、软件复位：全部模式允许");
    UT_CHECK_EQ_INT(chk(0x0102u, 0u, MODE_SAFE), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0102u, 0u, MODE_NORMAL), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0FFFu, 0xA5A5u, MODE_SAFE), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0FFFu, 0xA5A5u, MODE_NORMAL), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0FFFu, 0xA5A5u, MODE_MAINT), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-MODE-004", "程序上注使能：仅维护模式");
    UT_CHECK_EQ_INT(chk(0x0301u, 0x5A5Au, MODE_MAINT), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0301u, 0x5A5Au, MODE_NORMAL), CMD_ERR_MODE);
    UT_CHECK_EQ_INT(chk(0x0301u, 0x5A5Au, MODE_SAFE), CMD_ERR_MODE);
    UT_END_CASE();

    UT_CASE("UT-MODE-005", "模式检查优先于参数检查");
    UT_CHECK_EQ_INT(chk(0x0101u, 1u, MODE_SAFE), CMD_ERR_MODE);
    UT_CHECK_EQ_INT(chk(0x0301u, 0u, MODE_NORMAL), CMD_ERR_MODE);
    UT_END_CASE();
}

static void test_param(void)
{
    UT_CASE("UT-PAR-001", "载荷加电、断电参数非 0 返回 CMD_ERR_PARAM");
    UT_CHECK_EQ_INT(chk(0x0101u, 1u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_CHECK_EQ_INT(chk(0x0102u, 1u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-PAR-002", "温度门限边界：0、1000 合法，1001、65535 非法");
    UT_CHECK_EQ_INT(chk(0x0201u, 0u, MODE_NORMAL), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0201u, 1000u, MODE_NORMAL), CMD_OK);
    UT_CHECK_EQ_INT(chk(0x0201u, 1001u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_CHECK_EQ_INT(chk(0x0201u, 65535u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-PAR-003", "程序上注使能：0x5A5A 合法，0x5A5B、0x005A 非法");
    UT_CHECK_EQ_INT(chk(0x0301u, 0x5A5Bu, MODE_MAINT), CMD_ERR_PARAM);
    UT_CHECK_EQ_INT(chk(0x0301u, 0x005Au, MODE_MAINT), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-PAR-004", "软件复位：0xA5A4、0xA5A6 非法");
    UT_CHECK_EQ_INT(chk(0x0FFFu, 0xA5A4u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_CHECK_EQ_INT(chk(0x0FFFu, 0xA5A6u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_END_CASE();
}

static void test_counters(void)
{
    unsigned i;

    UT_CASE("UT-CNT-002", "cmd_check 不修改计数（3.2）");
    cmd_counter_reset();
    (void)chk(0x0102u, 0u, MODE_NORMAL);
    (void)chk(0x0000u, 0u, MODE_NORMAL);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 0u);
    UT_END_CASE();

    UT_CASE("UT-CNT-003", "接收与错误分别计数");
    cmd_counter_reset();
    cmd_counter_update(CMD_OK);
    cmd_counter_update(CMD_ERR_SUM);
    cmd_counter_update(CMD_ERR_MODE);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 1u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 2u);
    UT_END_CASE();

    UT_CASE("UT-CNT-004", "接收计数 255 再加 1 回绕为 0");
    cmd_counter_reset();
    for (i = 0; i < 255u; i++) cmd_counter_update(CMD_OK);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 255u);
    cmd_counter_update(CMD_OK);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    UT_END_CASE();

    UT_CASE("UT-CNT-005", "错误计数到 255 后保持（边界：254、255、256 次）");
    cmd_counter_reset();
    for (i = 0; i < 254u; i++) cmd_counter_update(CMD_ERR_LEN);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 254u);
    cmd_counter_update(CMD_ERR_LEN);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 255u);
    cmd_counter_update(CMD_ERR_LEN);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 255u);
    UT_END_CASE();

    UT_CASE("UT-CNT-006", "复位后两个计数都清零");
    cmd_counter_update(CMD_OK);
    cmd_counter_reset();
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 0u);
    UT_END_CASE();
}

int main(void)
{
    test_counters_initial();
    test_checksum();
    test_frame_checks();
    test_mode();
    test_param();
    test_counters();
    return UT_SUMMARY();
}
