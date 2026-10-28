/******************************************************************************
 * 评估用隐藏测试（不要给智能体看）：按 thm_ctrl-详细设计.md 推导的黑盒测试。
 * 和被测代码、stub_thm_hw.c 一起编译；每个用例输出一行 "PASS <id>" 或 "FAIL <id> <原因>"。
 ******************************************************************************/
#include <stdio.h>
#include <string.h>
#include "thm_ctrl.h"
#include "stub_thm_hw.h"

static int g_fail_case;
static int g_pass_n;
static int g_fail_n;
static char g_why[256];

#define CHECK(cond, ...) do { if (!(cond) && !g_fail_case) { g_fail_case = 1; snprintf(g_why, sizeof g_why, __VA_ARGS__); } } while (0)

static void run(const char *id, void (*fn)(void))
{
    g_fail_case = 0; g_why[0] = 0;
    stub_reset();
    fn();
    if (!g_fail_case && stub_irq_depth() != 0) { g_fail_case = 1; snprintf(g_why, sizeof g_why, "关中断和恢复不成对（结束时嵌套 %d）", stub_irq_depth()); }
    if (!g_fail_case && stub_irq_mismatch()) { g_fail_case = 1; snprintf(g_why, sizeof g_why, "thm_irq_restore 的参数不是对应 thm_irq_save 的返回值"); }
    if (g_fail_case) { g_fail_n++; printf("FAIL %s %s\n", id, g_why); } else { g_pass_n++; printf("PASS %s\n", id); }
}

/* 设计 4.3 的换算 */
static int conv(int raw) { return raw * 1650 / 4096 - 500; }
/* 得到指定温度的最小 ADC 值（50～4000 内） */
static uint16_t raw_for(int temp)
{
    for (int r = 50; r <= 4000; r++) if (conv(r) == temp) return (uint16_t)r;
    return 0;
}
static thm_status_t st_of(uint8_t ch) { thm_status_t s; memset(&s, 0xCC, sizeof s); (void)thm_get_status(ch, &s); return s; }
static void set_all(uint16_t pri, uint16_t bak) { for (uint8_t c = 0; c < THM_CH_NUM; c++) { stub_set_adc(c, 0, pri); stub_set_adc(c, 1, bak); } }

/* D-01 初始化 */
static void t_init(void)
{
    thm_init();
    for (uint8_t c = 0; c < THM_CH_NUM; c++)
    {
        thm_status_t s = st_of(c);
        CHECK(s.temp == THM_TEMP_INVALID, "回路 %u 初始温度应为 THM_TEMP_INVALID，实际 %d", c, s.temp);
        CHECK(s.heater == 0 && s.sensor == 0 && s.fault == 0, "回路 %u 初始状态应全 0（heater %u sensor %u fault %u）", c, s.heater, s.sensor, s.fault);
        CHECK(stub_out_count(c) == 1 && stub_out_last(c) == 0, "初始化应对回路 %u 调用一次 thm_heater_out(ch, 0)（调用 %d 次）", c, stub_out_count(c));
    }
}

/* D-02 检查顺序和边界 */
static void t_limits_order(void)
{
    thm_init();
    CHECK(thm_set_limits(4, 200, 100) == THM_ERR_CH, "回路号越界应先返回 THM_ERR_CH");
    CHECK(thm_set_limits(0, 100, 100) == THM_ERR_PARAM, "tl == th 应返回 THM_ERR_PARAM");
    CHECK(thm_set_limits(0, 600, 550) == THM_ERR_PARAM, "tl >= th 且超范围时，参数检查要先于范围检查，返回 THM_ERR_PARAM");
    CHECK(thm_set_limits(0, -600, -550) == THM_ERR_RANGE, "tl < -500 应返回 THM_ERR_RANGE");
    CHECK(thm_set_limits(0, -501, 100) == THM_ERR_RANGE, "tl = -501 应返回 THM_ERR_RANGE");
    CHECK(thm_set_limits(0, 0, 501) == THM_ERR_RANGE, "th = 501 应返回 THM_ERR_RANGE");
    CHECK(thm_set_limits(0, -450, 550) == THM_ERR_RANGE, "th = 550 超出设计的 +50.0 ℃，应返回 THM_ERR_RANGE（头文件注释的 +60 ℃ 与设计不一致）");
    CHECK(thm_set_limits(0, -500, 500) == THM_OK, "-500～500 含两端，应返回 THM_OK");
    CHECK(thm_set_limits(3, 10, 20) == THM_OK, "回路 3 正常设置应返回 THM_OK");
}

/* D-02 出错时不改数据、不碰硬件 */
static void t_limits_no_change(void)
{
    thm_init();
    int base = stub_out_total();
    (void)thm_set_limits(0, 300, 200);
    (void)thm_set_limits(0, -600, 0);
    CHECK(stub_out_total() == base, "参数错误时不应调用硬件接口");
    set_all(raw_for(40), raw_for(40));
    thm_cycle();
    CHECK(st_of(0).heater == 1, "出错的 thm_set_limits 不应改上下限：默认 TL=50 时 4.0 ℃ 应开加热");
}

/* D-06 换算 */
static void t_convert(void)
{
    static const uint16_t raws[] = { 1241, 50, 4000, 2482, 100 };
    thm_init();
    for (unsigned i = 0; i < sizeof raws / sizeof raws[0]; i++)
    {
        set_all(raws[i], raws[i]);
        thm_cycle();
        CHECK(st_of(0).temp == conv(raws[i]), "raw %u 应换算为 %d，实际 %d", raws[i], conv(raws[i]), st_of(0).temp);
    }
}

/* D-07 有效范围含两端 */
static void t_valid_range(void)
{
    thm_init();
    set_all(50, 1500); thm_cycle();
    CHECK(st_of(0).sensor == 0 && st_of(0).temp == conv(50), "raw 50 有效，应采用主份");
    set_all(4000, 1500); thm_cycle();
    CHECK(st_of(0).sensor == 0 && st_of(0).temp == conv(4000), "raw 4000 有效，应采用主份");
    set_all(49, 1500); thm_cycle();
    CHECK(st_of(0).sensor == 1 && st_of(0).temp == conv(1500), "raw 49 无效，应改用备份");
    set_all(4001, 1500); thm_cycle();
    CHECK(st_of(0).sensor == 1, "raw 4001 无效，应改用备份");
}

/* D-07 连续 3 次才判故障（不是累计） */
static void t_fault_consecutive(void)
{
    thm_init();
    set_all(0, 1500); thm_cycle(); thm_cycle();
    CHECK((st_of(0).fault & THM_FAULT_PRI) == 0, "连续 2 次异常不应判故障");
    set_all(1500, 1500); thm_cycle();
    set_all(0, 1500); thm_cycle(); thm_cycle();
    CHECK((st_of(0).fault & THM_FAULT_PRI) == 0, "中间有一次正常，计数应清零：累计 4 次、连续 2 次不应判故障");
    thm_cycle();
    CHECK((st_of(0).fault & THM_FAULT_PRI) != 0, "连续 3 次异常应判主份故障");
    CHECK((st_of(0).fault & THM_FAULT_BAK) == 0, "备份正常，不应置备份故障");
}

/* D-07 连续 5 次正常才恢复；故障期间不用主份 */
static void t_fault_recover(void)
{
    thm_init();
    set_all(0, 1500); thm_cycle(); thm_cycle(); thm_cycle();
    set_all(1000, 1500);
    for (int i = 0; i < 4; i++) thm_cycle();
    CHECK((st_of(0).fault & THM_FAULT_PRI) != 0, "连续 4 次正常不应恢复");
    CHECK(st_of(0).sensor == 1 && st_of(0).temp == conv(1500), "主份故障未恢复时应采用备份");
    set_all(0, 1500); thm_cycle();
    set_all(1000, 1500);
    for (int i = 0; i < 4; i++) thm_cycle();
    CHECK((st_of(0).fault & THM_FAULT_PRI) != 0, "恢复计数中间被打断应清零：再 4 次正常不应恢复");
    thm_cycle();
    CHECK((st_of(0).fault & THM_FAULT_PRI) == 0, "连续 5 次正常应清除主份故障");
    CHECK(st_of(0).sensor == 0 && st_of(0).temp == conv(1000), "恢复后应采用主份");
}

/* D-03 第 2 步：本次异常但未判故障也换备份，下周期正常就回主份 */
static void t_select(void)
{
    thm_init();
    set_all(1000, 1500); thm_cycle();
    CHECK(st_of(0).sensor == 0, "主份有效时采用主份");
    set_all(0, 1500); thm_cycle();
    CHECK(st_of(0).sensor == 1 && st_of(0).temp == conv(1500), "主份本次异常（未判故障）时应采用备份");
    set_all(1000, 1500); thm_cycle();
    CHECK(st_of(0).sensor == 0 && st_of(0).temp == conv(1000), "主份恢复有效、未判故障，应回到主份");
}

/* D-03 第 2、3 步：两份都不可用时温度无效，采用的传感器和加热器状态都保持 */
static void t_both_invalid_hold(void)
{
    thm_init();
    set_all(0, raw_for(40)); thm_cycle();
    CHECK(st_of(0).heater == 1 && st_of(0).sensor == 1, "备份 4.0 ℃ 应开加热、采用备份");
    set_all(0, 0); thm_cycle();
    thm_status_t s = st_of(0);
    CHECK(s.temp == THM_TEMP_INVALID, "两份都无效时温度应为 THM_TEMP_INVALID");
    CHECK(s.sensor == 1, "两份都无效时“采用的传感器”应保持上一周期（备份）");
    CHECK(s.heater == 1 && stub_out_last(0) == 1, "温度无效时加热器状态应保持（设计规定），并照常输出");
    thm_cycle(); thm_cycle();
    CHECK(st_of(0).fault == (THM_FAULT_PRI | THM_FAULT_BAK), "两份连续异常都应判故障（fault=%u）", st_of(0).fault);
    CHECK(st_of(0).heater == 1, "两份都故障后，按设计加热器仍保持（这一点应列为待确认问题，而不是自行改为关）");
}

/* D-03 第 3 步：回差边界 ≤TL 开、≥TH 关 */
static void t_hysteresis(void)
{
    thm_init();
    set_all(raw_for(51), raw_for(51)); thm_cycle();
    CHECK(st_of(0).heater == 0, "5.1 ℃（>TL）初始关，应保持关");
    set_all(raw_for(50), raw_for(50)); thm_cycle();
    CHECK(st_of(0).heater == 1, "温度等于 TL（5.0 ℃）应开");
    set_all(raw_for(100), raw_for(100)); thm_cycle();
    CHECK(st_of(0).heater == 1, "介于上下限之间应保持开");
    set_all(raw_for(149), raw_for(149)); thm_cycle();
    CHECK(st_of(0).heater == 1, "14.9 ℃ 低于 TH，应保持开");
    set_all(raw_for(150), raw_for(150)); thm_cycle();
    CHECK(st_of(0).heater == 0, "温度等于 TH（15.0 ℃）应关");
    set_all(raw_for(51), raw_for(51)); thm_cycle();
    CHECK(st_of(0).heater == 0, "回落到 5.1 ℃ 应保持关（回差）");
}

/* D-03 第 5 步：每周期都输出 */
static void t_output_every_cycle(void)
{
    thm_init();
    int before[THM_CH_NUM];
    for (uint8_t c = 0; c < THM_CH_NUM; c++) before[c] = stub_out_count(c);
    set_all(raw_for(100), raw_for(100));
    for (int i = 0; i < 5; i++) thm_cycle();
    for (uint8_t c = 0; c < THM_CH_NUM; c++)
        CHECK(stub_out_count(c) - before[c] == 5, "回路 %u：5 个周期应调用 5 次 thm_heater_out（实际 %d 次）", c, stub_out_count(c) - before[c]);
    CHECK(stub_out_last(0) == 0, "状态没变时也应输出当前状态（关）");
}

/* D-03 第 4 步：加热时限 10 min，超时后一直关，thm_set_limits 成功后清除 */
static void t_heat_timeout(void)
{
    thm_init();
    stub_set_tick(1000);
    set_all(raw_for(0), raw_for(0)); thm_cycle();
    CHECK(st_of(0).heater == 1, "0 ℃ 应开加热");
    stub_set_tick(1000 + 599999); thm_cycle();
    CHECK(st_of(0).heater == 1 && (st_of(0).fault & THM_FAULT_HEAT) == 0, "加热 599999 ms 未到时限，应保持开");
    stub_set_tick(1000 + 600000); thm_cycle();
    CHECK(st_of(0).heater == 0 && stub_out_last(0) == 0, "加热满 600000 ms 应关");
    CHECK((st_of(0).fault & THM_FAULT_HEAT) != 0, "超时应置加热超时标志");
    stub_set_tick(1000 + 700000); thm_cycle();
    CHECK(st_of(0).heater == 0, "超时后温度再低也应保持关");
    CHECK(thm_set_limits(0, 50, 150) == THM_OK, "重设上下限应成功");
    CHECK((st_of(0).fault & THM_FAULT_HEAT) == 0, "thm_set_limits 成功应清除加热超时标志");
    thm_cycle();
    CHECK(st_of(0).heater == 1, "清除超时后，温度低应重新开加热");
    stub_set_tick(1000 + 700000 + 599999); thm_cycle();
    CHECK(st_of(0).heater == 1, "重新开始加热应重新计时：599999 ms 未到时限");
}

/* D-03 第 4 步：毫秒计数回绕 */
static void t_tick_wrap(void)
{
    thm_init();
    uint32_t start = 0xFFFFF000UL;
    stub_set_tick(start);
    set_all(raw_for(0), raw_for(0)); thm_cycle();
    stub_set_tick(start + 599999UL); thm_cycle();
    CHECK(st_of(0).heater == 1, "计数回绕后 599999 ms 未到时限，应保持开（用无符号减法计算经过时间）");
    stub_set_tick(start + 600000UL); thm_cycle();
    CHECK(st_of(0).heater == 0, "计数回绕后满 600000 ms 应关");
}

/* D-04 错误码和顺序 */
static void t_get_status(void)
{
    thm_status_t s;
    thm_init();
    CHECK(thm_get_status(4, &s) == THM_ERR_CH, "回路号越界应返回 THM_ERR_CH");
    CHECK(thm_get_status(0, NULL) == THM_ERR_PARAM, "空指针应返回 THM_ERR_PARAM");
    CHECK(thm_get_status(4, NULL) == THM_ERR_CH, "回路号检查要先于空指针检查");
    CHECK(thm_get_status(0, &s) == THM_OK, "正常读取应返回 THM_OK");
}

/* D-05 遥测帧：大端、状态位、累加和 */
static void t_pack(void)
{
    uint8_t buf[32];
    thm_init();
    CHECK(thm_pack_tm(NULL, 19) == THM_ERR_PARAM, "空指针应返回 THM_ERR_PARAM");
    CHECK(thm_pack_tm(NULL, 1) == THM_ERR_PARAM, "空指针检查要先于长度检查");
    CHECK(thm_pack_tm(buf, 18) == THM_ERR_BUF, "长度 18 < 19 应返回 THM_ERR_BUF");
    /* 回路 0：主份 -0.1 ℃，开加热；回路 1：主份故障、备份 -48.0 ℃；回路 2：两份无效；回路 3：主份 49.9 ℃ */
    stub_set_adc(0, 0, 1241); stub_set_adc(0, 1, 1241);
    stub_set_adc(1, 0, 0);    stub_set_adc(1, 1, 50);
    stub_set_adc(2, 0, 0);    stub_set_adc(2, 1, 0);
    stub_set_adc(3, 0, 2482); stub_set_adc(3, 1, 2482);
    thm_cycle(); thm_cycle(); thm_cycle();
    memset(buf, 0xEE, sizeof buf);
    int32_t n = thm_pack_tm(buf, sizeof buf);
    CHECK(n == 19, "应返回写入的字节数 19，实际 %d", (int)n);
    CHECK(buf[0] == 0xA5 && buf[1] == 4, "同步字 0xA5、回路数 4（实际 %02X %02X）", buf[0], buf[1]);
    CHECK(buf[2] == 0xFF && buf[3] == 0xFF, "回路 0 温度 -1 大端应为 FF FF（实际 %02X %02X）", buf[2], buf[3]);
    CHECK(buf[4] == 0x01 && buf[5] == 0x00, "回路 0 状态应为 0x01（加热）、保留 0（实际 %02X %02X）", buf[4], buf[5]);
    CHECK(buf[6] == 0xFE && buf[7] == 0x20, "回路 1 温度 -480 大端应为 FE 20（实际 %02X %02X）", buf[6], buf[7]);
    CHECK(buf[8] == (0x01 | 0x02 | 0x04), "回路 1 状态应为加热+备份+主份故障 0x07（实际 %02X）", buf[8]);
    CHECK(buf[10] == 0x7F && buf[11] == 0xFF, "回路 2 无效温度应为 7F FF（实际 %02X %02X）", buf[10], buf[11]);
    CHECK(buf[12] == (0x04 | 0x08), "回路 2 状态应为两份故障 0x0C（实际 %02X）", buf[12]);
    CHECK(buf[14] == 0x01 && buf[15] == 0xF3, "回路 3 温度 499 大端应为 01 F3（实际 %02X %02X）", buf[14], buf[15]);
    uint8_t sum = 0, x = 0;
    for (int i = 0; i < 18; i++) { sum = (uint8_t)(sum + buf[i]); x ^= buf[i]; }
    CHECK(buf[18] == sum, "校验应为前 18 字节累加和的低 8 位 %02X（实际 %02X%s）", sum, buf[18], buf[18] == x ? "，用了头文件注释里的异或，与设计不一致" : "");
    CHECK(buf[19] == 0xEE, "不应写超过 19 字节");
}

/* D-02 写入在临界区内（thm_cycle 在中断里调用，thm_set_limits 在任务里调用） */
static void t_limits_critical(void)
{
    thm_init();
    int before = stub_irq_saves();
    CHECK(thm_set_limits(1, 20, 80) == THM_OK, "正常设置应返回 THM_OK");
    CHECK(stub_irq_saves() > before, "thm_set_limits 写上下限时应进入临界区（调用 thm_irq_save/thm_irq_restore）");
}

int main(void)
{
    run("T01-D01-初始化", t_init);
    run("T02-D02-检查顺序和边界", t_limits_order);
    run("T03-D02-出错不改数据", t_limits_no_change);
    run("T04-D06-温度换算", t_convert);
    run("T05-D07-有效范围含两端", t_valid_range);
    run("T06-D07-连续3次判故障", t_fault_consecutive);
    run("T07-D07-连续5次恢复", t_fault_recover);
    run("T08-D03-选传感器", t_select);
    run("T09-D03-两份无效时保持", t_both_invalid_hold);
    run("T10-D03-回差边界", t_hysteresis);
    run("T11-D03-每周期输出", t_output_every_cycle);
    run("T12-D03-加热时限", t_heat_timeout);
    run("T13-D03-计数回绕", t_tick_wrap);
    run("T14-D04-读状态", t_get_status);
    run("T15-D05-遥测帧", t_pack);
    run("T16-D02-临界区", t_limits_critical);
    printf("SUMMARY pass=%d fail=%d\n", g_pass_n, g_fail_n);
    return g_fail_n ? 1 : 0;
}
