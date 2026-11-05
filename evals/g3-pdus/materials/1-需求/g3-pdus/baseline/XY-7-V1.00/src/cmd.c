/*
 * 文件名：cmd.c
 * 功能：  遥控指令接收、校验和执行（cmd 模块）
 * 平台：  BM3803（SPARC V8），裸机
 * 设计：  软件详细设计说明 4.3
 * 修改记录：
 *   2025-06-10  V1.00 初版（XY-7）
 * */
#include "pdu_types.h"
#include "pdu_bsp.h"
#include "ocp.h"
#include "cmd.h"

#define CMD_HEAD1     (0xEBU)   /* 帧头第 1 字节 */
#define CMD_HEAD2     (0x90U)   /* 帧头第 2 字节 */
#define CMD_BUF_MAX   (16U)     /* 接收缓冲区长度 */
#define CMD_DATA_MAX  (4U)      /* 数据域最大长度 */
#define CMD_FIX_LEN   (5U)      /* 帧头 2 + 指令码 1 + 长度 1 + 校验和 1 */
#define CMD_SW_ON     (0x31U)   /* 通道接通 */
#define CMD_SW_OFF    (0x32U)   /* 通道断开 */
#define CMD_OCP_EN    (0x33U)   /* 过流保护使能设置 */
#define CMD_OCP_CLR   (0x34U)   /* 清除过流标志 */
#define CMD_EN_CODE   (0x55U)   /* 使能码 */
#define CMD_DIS_CODE  (0xAAU)   /* 禁止码 */
#define CMD_CNT_MASK  (0xFFU)   /* 计数模 256 */

U32 g_cmd_ok_cnt = 0U;
U32 g_cmd_err_cnt = 0U;
U32 g_cmd_last = 0U;

static U8 s_buf[CMD_BUF_MAX];

/*
 * 函数名：cmd_sum
 * 功能：  计算累加和（模 256）
 * 设计：  4.3.2
 * 输入：  p  数据首地址；n  字节数，0～CMD_BUF_MAX
 * 输出：  无
 * 返回：  累加和
 */
static U8 cmd_sum(const U8 *p, U32 n)
{
    U32 i;
    U32 sum = 0U;

    for (i = 0U; i < n; i++)
    {
        sum += (U32)p[i];
    }
    return (U8)(sum & 0xFFU);
}

/*
 * 函数名：cmd_ch_ok
 * 功能：  检查通道号是否为 1～4
 * 设计：  4.3.3
 * 输入：  ch  通道号（协议编号）
 * 输出：  无
 * 返回：  1 有效，0 无效
 */
static U32 cmd_ch_ok(U32 ch)
{
    U32 ret = 0U;

    if ((ch >= 1U) && (ch <= PDU_CH_NUM))
    {
        ret = 1U;
    }
    return ret;
}

/*
 * 函数名：cmd_dispatch
 * 功能：  按指令码执行遥控指令
 * 设计：  4.3.4
 * 输入：  code  指令码；d  数据域；len  数据域长度 0～4
 * 输出：  通道开关、过流使能、过流标志
 * 返回：  PDU_OK 执行成功；PDU_ERR 指令码未定义、长度或参数错误
 */
static U32 cmd_dispatch(U32 code, const U8 *d, U32 len)
{
    U32 ret = PDU_ERR;

    /* 每条指令先检查数据域长度和通道号，再执行；不满足时返回 PDU_ERR */
    switch (code)
    {
    case CMD_SW_ON:
        /* 0x31 通道接通：数据域 1 字节通道号 */
        if ((len == 1U) && (cmd_ch_ok((U32)d[0]) != 0U))
        {
            ocp_switch_set((U32)d[0] - 1U, 1U);
            ret = PDU_OK;
        }
        break;
    case CMD_SW_OFF:
        /* 0x32 通道断开：数据域 1 字节通道号 */
        if ((len == 1U) && (cmd_ch_ok((U32)d[0]) != 0U))
        {
            ocp_switch_set((U32)d[0] - 1U, 0U);
            ret = PDU_OK;
        }
        break;
    case CMD_OCP_EN:
        /* 0x33 过流保护使能设置：通道号 + 使能码 0x55 / 禁止码 0xAA */
        if ((len == 2U) && (cmd_ch_ok((U32)d[0]) != 0U))
        {
            if ((U32)d[1] == CMD_EN_CODE)
            {
                ocp_set_enable((U32)d[0] - 1U, 1U);
                ret = PDU_OK;
            }
            else if ((U32)d[1] == CMD_DIS_CODE)
            {
                ocp_set_enable((U32)d[0] - 1U, 0U);
                ret = PDU_OK;
            }
            else
            {
                /* 使能码既不是 0x55 也不是 0xAA */
                ret = PDU_ERR;
            }
        }
        break;
    case CMD_OCP_CLR:
        /* 0x34 清除过流标志：数据域 1 字节通道号 */
        if ((len == 1U) && (cmd_ch_ok((U32)d[0]) != 0U))
        {
            ocp_clear((U32)d[0] - 1U);
            ret = PDU_OK;
        }
        break;
    default:
        /* 未定义的指令码 */
        ret = PDU_ERR;
        break;
    }
    return ret;
}

/*
 * 函数名：cmd_init
 * 功能：  遥控计数清零
 * 设计：  4.3.5
 * 输入：  无
 * 输出：  g_cmd_ok_cnt、g_cmd_err_cnt、g_cmd_last
 * 返回：  无
 */
void cmd_init(void)
{
    g_cmd_ok_cnt = 0U;
    g_cmd_err_cnt = 0U;
    g_cmd_last = 0U;
}

/*
 * 函数名：cmd_poll
 * 功能：  取一帧遥控数据，校验帧头、长度、累加和后执行，更新遥控计数
 * 设计：  4.3.6
 * 输入：  无
 * 输出：  g_cmd_ok_cnt、g_cmd_err_cnt、g_cmd_last
 * 返回：  无
 * 说明：  主循环每 50 ms 调用一次；没有新帧时直接返回
 */
void cmd_poll(void)
{
    U32 n;
    U32 len;
    U32 valid = 0U;

    /* 取一帧；没有新帧时不处理 */
    n = bsp_uart_read_frame(s_buf, CMD_BUF_MAX);
    if (n != 0U)
    {
        /* 依次检查：帧头、数据域长度与帧长、累加和（指令码到数据域末尾），通过后执行 */
        if ((n >= CMD_FIX_LEN) && ((U32)s_buf[0] == CMD_HEAD1) && ((U32)s_buf[1] == CMD_HEAD2))
        {
            len = (U32)s_buf[3];
            if ((len <= CMD_DATA_MAX) && (n == (len + CMD_FIX_LEN)))
            {
                if (cmd_sum(&s_buf[2], len + 2U) == s_buf[len + 4U])
                {
                    if (cmd_dispatch((U32)s_buf[2], &s_buf[4], len) == PDU_OK)
                    {
                        valid = 1U;
                    }
                }
            }
        }
        /* 执行成功的计入正确计数并记录指令码，其余（含执行失败）计入错误计数 */
        if (valid != 0U)
        {
            g_cmd_ok_cnt = (g_cmd_ok_cnt + 1U) & CMD_CNT_MASK;
            g_cmd_last = (U32)s_buf[2];
        }
        else
        {
            g_cmd_err_cnt = (g_cmd_err_cnt + 1U) & CMD_CNT_MASK;
        }
    }
}
