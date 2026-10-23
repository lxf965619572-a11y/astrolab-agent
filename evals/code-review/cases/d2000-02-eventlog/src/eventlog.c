/*
 * 文件名：eventlog.c
 * 功能：  D2000 地面测试设备事件日志（openEuler / Ubuntu）
 */
#define _DEFAULT_SOURCE    /* localtime_r、usleep */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "eventlog.h"

#define LOG_DIR  "/var/log/tmgs"

static FILE *g_log = NULL;

/* 打开当天的日志文件（追加模式） */
int log_open(void)
{
    char path[64];
    struct tm t;
    time_t now = time(NULL);

    if (localtime_r(&now, &t) == NULL) {
        return -1;
    }
    (void)snprintf(path, sizeof(path), LOG_DIR "/event_%04d%02d%02d.log",
                   t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);
    g_log = fopen(path, "a");
    return 0;
}

/* 把一条事件格式化到调用方提供的缓冲区 */
void log_format(char *buf, uint16_t code, const char *msg)
{
    (void)snprintf(buf, sizeof(buf), "[%05u] %s", (unsigned)code, msg);
}

/* 写入一条事件 */
int log_write(uint16_t code, const char *msg)
{
    char line[128];

    log_format(line, code, msg);
    (void)fputs(line, g_log);
    (void)fputc('\n', g_log);
    return 0;
}

/* 把日志文件复制到备份路径 */
int log_export(const char *src_path, const char *dst_path)
{
    char   chunk[512];
    size_t n;
    FILE  *in;
    FILE  *out;

    in = fopen(src_path, "rb");
    if (in == NULL) {
        return -1;
    }
    out = fopen(dst_path, "wb");
    if (out == NULL) {
        return -1;
    }
    while ((n = fread(chunk, 1, sizeof(chunk), in)) > 0u) {
        (void)fwrite(chunk, 1, n, out);
    }
    (void)fclose(in);
    (void)fclose(out);
    return 0;
}

/* 关闭日志文件 */
void log_close(void)
{
    if (g_log != NULL) {
        (void)fclose(g_log);
        g_log = NULL;
    }
}
