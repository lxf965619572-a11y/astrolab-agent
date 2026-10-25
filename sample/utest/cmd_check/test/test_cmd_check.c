/*
 * 文件名：test_cmd_check.c
 * 功能：  cmd_check 模块单元测试驱动（手写驱动，utest.h）
 * 平台：  主机（x86-64）编译运行，目标平台 BM3803（SPARC V8）裸机
 * 说明：  1) 被测代码没有下层函数调用，也没有寄存器访问，因此不需要桩；
 *         2) 为了直接测试内部 static 函数 check_param（cmd_check 的模式检查
 *            缺陷使其 LOAD_ON 分支不可达），按单元测试约定 #include 被测 .c，
 *            不修改被测代码。
 */
#define UTEST_MAIN
#include "utest.h"
#include "../src/cmd_check.c"

/* 按详细设计第 1 节，用字节 0～5 的累加和重算字节 6～7（高字节在前）。
 * 独立计算，不调用被测的 cmd_checksum。 */
static void fix_checksum(uint8_t *f)
{
    uint16_t sum = 0u;
    uint8_t i;

    for (i = 0u; i < 6u; i++) {
        sum = (uint16_t)(sum + f[i]);
    }
    f[6] = (uint8_t)((sum >> 8) & 0xFFu);
    f[7] = (uint8_t)(sum & 0xFFu);
}

/* 按详细设计第 1 节构造 8 字节指令帧 */
static void make_frame(uint8_t *f, uint16_t code, uint16_t param)
{
    f[0] = 0xEBu;
    f[1] = 0x90u;
    f[2] = (uint8_t)((code >> 8) & 0xFFu);
    f[3] = (uint8_t)(code & 0xFFu);
    f[4] = (uint8_t)((param >> 8) & 0xFFu);
    f[5] = (uint8_t)(param & 0xFFu);
    fix_checksum(f);
}

static void update_ok(unsigned n)
{
    unsigned k;

    for (k = 0u; k < n; k++) {
        cmd_counter_update(CMD_OK);
    }
}

static void update_err(cmd_result_t r, unsigned n)
{
    unsigned k;

    for (k = 0u; k < n; k++) {
        cmd_counter_update(r);
    }
}

/* ---------------- cmd_checksum：详细设计 3.1 ---------------- */

static void test_sum(void)
{
    static const uint8_t b6[6] = {0xEBu, 0x90u, 0x02u, 0x01u, 0x03u, 0xE8u};
    uint8_t big[300];
    uint8_t b2[2];
    uint8_t b1[1];
    uint16_t i;

    UT_CASE("UT-CMD-SUM-001", "空指针返回 0（设计 3.1）");
    UT_CHECK_EQ_UINT(cmd_checksum(NULL, 6u), 0u);
    UT_END_CASE();

    UT_CASE("UT-CMD-SUM-002", "长度 0 返回 0（设计 3.1）");
    UT_CHECK_EQ_UINT(cmd_checksum(b6, 0u), 0u);
    UT_END_CASE();

    UT_CASE("UT-CMD-SUM-003", "6 字节典型帧累加和为 0x0269（设计 3.1、第 1 节）");
    UT_CHECK_EQ_UINT(cmd_checksum(b6, 6u), 0x0269u);
    UT_END_CASE();

    UT_CASE("UT-CMD-SUM-004", "累加和超过 0xFFFF 取低 16 位回绕（设计 3.1）");
    for (i = 0u; i < 300u; i++) {
        big[i] = 0xFFu;
    }
    UT_CHECK_EQ_UINT(cmd_checksum(big, 300u), 0x2AD4u);
    UT_END_CASE();

    UT_CASE("UT-CMD-SUM-005", "2 字节累加 0x00FF 与 0x0100 的边界（设计 3.1）");
    b2[0] = 0xFFu;
    b2[1] = 0x01u;
    UT_CHECK_EQ_UINT(cmd_checksum(b2, 2u), 0x0100u);
    UT_END_CASE();

    UT_CASE("UT-CMD-SUM-006", "单字节累加和等于该字节值（设计 3.1）");
    b1[0] = 0xA7u;
    UT_CHECK_EQ_UINT(cmd_checksum(b1, 1u), 0x00A7u);
    UT_END_CASE();
}

/* ---------------- cmd_check：详细设计 3.2 ---------------- */

static void test_check(void)
{
    uint8_t f[8];
    uint8_t f9[9];

    UT_CASE("UT-CMD-CHK-001", "帧指针为空返回 CMD_ERR_NULL（设计 3.2 顺序 1）");
    UT_CHECK_EQ_INT(cmd_check(NULL, 8u, MODE_NORMAL), CMD_ERR_NULL);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-002", "长度 7 返回 CMD_ERR_LEN（设计 3.2 顺序 2）");
    make_frame(f, 0x0102u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 7u, MODE_NORMAL), CMD_ERR_LEN);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-003", "长度 0 返回 CMD_ERR_LEN（设计 3.2 顺序 2）");
    make_frame(f, 0x0102u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 0u, MODE_NORMAL), CMD_ERR_LEN);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-004", "长度 9 返回 CMD_ERR_LEN（设计 3.2 顺序 2：len 应等于 8）");
    make_frame(f9, 0x0102u, 0u);
    f9[8] = 0x00u;
    UT_CHECK_EQ_INT(cmd_check(f9, 9u, MODE_NORMAL), CMD_ERR_LEN);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-005", "同步字第 1 字节错返回 CMD_ERR_SYNC（设计 3.2 顺序 3）");
    make_frame(f, 0x0102u, 0u);
    f[0] = 0xEAu;
    fix_checksum(f);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SYNC);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-006", "同步字第 2 字节错返回 CMD_ERR_SYNC（设计 3.2 顺序 3）");
    make_frame(f, 0x0102u, 0u);
    f[1] = 0x00u;
    fix_checksum(f);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SYNC);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-007", "校验和高字节错返回 CMD_ERR_SUM（设计 3.2 顺序 4）");
    make_frame(f, 0x0102u, 0u);
    f[6] = (uint8_t)(f[6] ^ 0x01u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SUM);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-008", "校验和低字节错返回 CMD_ERR_SUM（设计 3.2 顺序 4）");
    make_frame(f, 0x0102u, 0u);
    f[7] = (uint8_t)(f[7] ^ 0x01u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SUM);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-009", "校验和字节序颠倒返回 CMD_ERR_SUM（设计 3.2 顺序 4）");
    make_frame(f, 0x0201u, 1000u);
    f[6] = 0x69u;
    f[7] = 0x02u;
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SUM);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-010", "未知指令码返回 CMD_ERR_CODE（设计 3.2 顺序 5、第 2 节）");
    make_frame(f, 0x0103u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_CODE);
    make_frame(f, 0xFFFFu, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_CODE);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-011", "载荷加电在正常模式允许（设计第 2 节：正常、维护允许）");
    make_frame(f, 0x0101u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-012", "载荷加电在维护模式允许（设计第 2 节：正常、维护允许）");
    make_frame(f, 0x0101u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_MAINT), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-013", "载荷加电在安全模式禁止（设计第 2 节：安全模式禁止）");
    make_frame(f, 0x0101u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_SAFE), CMD_ERR_MODE);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-014", "载荷断电在三种模式均允许（设计第 2 节：全部模式）");
    make_frame(f, 0x0102u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_OK);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_SAFE), CMD_OK);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_MAINT), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-015", "载荷断电参数非 0 返回 CMD_ERR_PARAM（设计第 2 节：必须为 0）");
    make_frame(f, 0x0102u, 1u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-016", "加热器温度门限下边界 0 合法（设计第 2 节：0～1000 含两端）");
    make_frame(f, 0x0201u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-017", "加热器温度门限中间值 500 合法（设计第 2 节：0～1000）");
    make_frame(f, 0x0201u, 500u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-018", "加热器温度门限上边界 1000 合法（设计第 2 节：含 1000）");
    make_frame(f, 0x0201u, 1000u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-019", "加热器温度门限 1001 返回 CMD_ERR_PARAM（设计第 2 节：上限 1000）");
    make_frame(f, 0x0201u, 1001u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-020", "加热器温度门限在安全模式禁止（设计第 2 节：安全模式禁止）");
    make_frame(f, 0x0201u, 500u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_SAFE), CMD_ERR_MODE);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-021", "加热器温度门限在维护模式允许（设计第 2 节：正常、维护允许）");
    make_frame(f, 0x0201u, 500u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_MAINT), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-022", "程序上注使能在维护模式参数 0x5A5A 合法（设计第 2 节）");
    make_frame(f, 0x0301u, 0x5A5Au);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_MAINT), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-023", "程序上注使能在正常模式禁止（设计第 2 节：仅维护模式）");
    make_frame(f, 0x0301u, 0x5A5Au);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_MODE);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-024", "程序上注使能在安全模式禁止（设计第 2 节：仅维护模式）");
    make_frame(f, 0x0301u, 0x5A5Au);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_SAFE), CMD_ERR_MODE);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-025", "程序上注使能关键字高低字节任一错返回 CMD_ERR_PARAM（设计第 2 节）");
    make_frame(f, 0x0301u, 0xA55Au);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_MAINT), CMD_ERR_PARAM);
    make_frame(f, 0x0301u, 0x5AA5u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_MAINT), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-026", "软件复位在三种模式均允许（设计第 2 节：全部模式）");
    make_frame(f, 0x0FFFu, 0xA5A5u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_OK);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_SAFE), CMD_OK);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_MAINT), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-027", "软件复位关键字高低字节任一错返回 CMD_ERR_PARAM（设计第 2 节）");
    make_frame(f, 0x0FFFu, 0x5AA5u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_PARAM);
    make_frame(f, 0x0FFFu, 0xA5A4u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-028", "长度错且同步字错时先报长度错（设计 3.2 检查顺序）");
    make_frame(f, 0x0102u, 0u);
    f[0] = 0xEAu;
    fix_checksum(f);
    UT_CHECK_EQ_INT(cmd_check(f, 7u, MODE_NORMAL), CMD_ERR_LEN);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-029", "同步字错且校验和错时先报同步错（设计 3.2 检查顺序）");
    make_frame(f, 0x0102u, 0u);
    f[0] = 0xEAu;
    f[6] = (uint8_t)(f[6] ^ 0xFFu);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SYNC);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-030", "校验和错且指令码未知时先报校验和错（设计 3.2 检查顺序）");
    make_frame(f, 0x0103u, 0u);
    f[6] = (uint8_t)(f[6] ^ 0x01u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_NORMAL), CMD_ERR_SUM);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-031", "指令码未知且模式不允许时先报指令码错（设计 3.2 检查顺序）");
    make_frame(f, 0x0103u, 0u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_SAFE), CMD_ERR_CODE);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-032", "模式不允许且参数非法时先报模式错（设计 3.2 检查顺序）");
    make_frame(f, 0x0201u, 2000u);
    UT_CHECK_EQ_INT(cmd_check(f, 8u, MODE_SAFE), CMD_ERR_MODE);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-033", "帧指针为空且长度错时先报空指针错（设计 3.2 检查顺序）");
    UT_CHECK_EQ_INT(cmd_check(NULL, 0u, MODE_NORMAL), CMD_ERR_NULL);
    UT_END_CASE();

    UT_CASE("UT-CMD-CHK-034", "cmd_check 不修改接收计数和错误计数（设计 3.2 末句）");
    cmd_counter_reset();
    make_frame(f, 0x0102u, 0u);
    (void)cmd_check(f, 8u, MODE_NORMAL);
    make_frame(f, 0x0102u, 0u);
    f[7] = (uint8_t)(f[7] ^ 0x01u);
    (void)cmd_check(f, 8u, MODE_NORMAL);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 0u);
    UT_END_CASE();
}

/* ---------------- check_param（static，详细设计 3.2 第 7 项、第 2 节） ---------------- */

static void test_param(void)
{
    UT_CASE("UT-CMD-PAR-001", "载荷加电参数 0 合法（设计第 2 节：必须为 0）");
    UT_CHECK_EQ_INT(check_param(0x0101u, 0u), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-002", "载荷加电参数 1 返回 CMD_ERR_PARAM（设计第 2 节：必须为 0）");
    UT_CHECK_EQ_INT(check_param(0x0101u, 1u), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-003", "载荷断电参数 1 返回 CMD_ERR_PARAM（设计第 2 节：必须为 0）");
    UT_CHECK_EQ_INT(check_param(0x0102u, 1u), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-004", "加热器温度门限 0 合法（设计第 2 节：0～1000）");
    UT_CHECK_EQ_INT(check_param(0x0201u, 0u), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-005", "加热器温度门限 1001 返回 CMD_ERR_PARAM（设计第 2 节：上限 1000）");
    UT_CHECK_EQ_INT(check_param(0x0201u, 1001u), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-006", "程序上注使能参数 0x5A5A 合法（设计第 2 节）");
    UT_CHECK_EQ_INT(check_param(0x0301u, 0x5A5Au), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-007", "软件复位参数 0xA5A5 合法（设计第 2 节）");
    UT_CHECK_EQ_INT(check_param(0x0FFFu, 0xA5A5u), CMD_OK);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-008", "程序上注使能参数低字节错返回 CMD_ERR_PARAM（设计第 2 节）");
    UT_CHECK_EQ_INT(check_param(0x0301u, 0x5AA5u), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-009", "软件复位参数误用上注关键字返回 CMD_ERR_PARAM（设计第 2 节）");
    UT_CHECK_EQ_INT(check_param(0x0FFFu, 0x5AA5u), CMD_ERR_PARAM);
    UT_END_CASE();

    UT_CASE("UT-CMD-PAR-010", "软件复位参数低字节错返回 CMD_ERR_PARAM（设计第 2 节）");
    UT_CHECK_EQ_INT(check_param(0x0FFFu, 0xA5A4u), CMD_ERR_PARAM);
    UT_END_CASE();
}

/* ---------------- 计数：详细设计 3.3、3.4、3.5 ---------------- */

static void test_counter_initial(void)
{
    UT_CASE("UT-CMD-CNT-001", "上电后接收计数和错误计数初值均为 0（设计 3.5，本用例最先执行）");
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 0u);
    UT_END_CASE();
}

static void test_counter_update(void)
{
    UT_CASE("UT-CMD-CNT-002", "CMD_OK 使接收计数加 1、错误计数不变（设计 3.3）");
    cmd_counter_reset();
    cmd_counter_update(CMD_OK);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 1u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 0u);
    cmd_counter_update(CMD_OK);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 2u);
    UT_END_CASE();

    UT_CASE("UT-CMD-CNT-003", "非 CMD_OK 使错误计数加 1、接收计数不变（设计 3.3）");
    cmd_counter_reset();
    cmd_counter_update(CMD_ERR_SUM);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 1u);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    cmd_counter_update(CMD_ERR_NULL);
    cmd_counter_update(CMD_ERR_PARAM);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 3u);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    UT_END_CASE();

    UT_CASE("UT-CMD-CNT-004", "接收计数 255 再加 1 回绕为 0，再加 1 为 1（设计 3.3）");
    cmd_counter_reset();
    update_ok(255u);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 255u);
    cmd_counter_update(CMD_OK);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    cmd_counter_update(CMD_OK);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 1u);
    UT_END_CASE();

    UT_CASE("UT-CMD-CNT-005", "错误计数 255 后保持 255，不回绕（设计 3.3）");
    cmd_counter_reset();
    update_err(CMD_ERR_LEN, 254u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 254u);
    cmd_counter_update(CMD_ERR_LEN);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 255u);
    cmd_counter_update(CMD_ERR_LEN);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 255u);
    UT_END_CASE();

    UT_CASE("UT-CMD-CNT-006", "连续多次调用后两个计数独立累计（设计 3.3）");
    cmd_counter_reset();
    update_ok(3u);
    update_err(CMD_ERR_CODE, 2u);
    update_ok(4u);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 7u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 2u);
    UT_END_CASE();
}

static void test_getters(void)
{
    UT_CASE("UT-CMD-GET-001", "两个读取函数分别返回当前接收计数和错误计数（设计 3.4）");
    cmd_counter_reset();
    update_ok(2u);
    update_err(CMD_ERR_MODE, 3u);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 2u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 3u);
    UT_END_CASE();
}

static void test_reset(void)
{
    UT_CASE("UT-CMD-RST-001", "复位后两个计数均清零（设计 3.5）");
    cmd_counter_reset();
    update_ok(5u);
    update_err(CMD_ERR_SUM, 4u);
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 5u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 4u);
    cmd_counter_reset();
    UT_CHECK_EQ_UINT(cmd_get_accept_count(), 0u);
    UT_CHECK_EQ_UINT(cmd_get_error_count(), 0u);
    UT_END_CASE();
}

int main(void)
{
    test_counter_initial();   /* 检查上电初值，必须最先执行 */
    test_sum();
    test_check();
    test_param();
    test_counter_update();
    test_getters();
    test_reset();
    return UT_SUMMARY();
}
