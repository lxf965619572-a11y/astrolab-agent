/*
 * 文件名：sample_mgr.c
 * 功能：  D2000 地面设备 AD 采样管理：采集线程周期采样入队，业务线程批量取走
 */
#define _DEFAULT_SOURCE    /* localtime_r、usleep */
#include <pthread.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <unistd.h>
#include "sample_mgr.h"

#define SAMPLE_CAP  256u

extern double ad_read(void);    /* AD 驱动提供，耗时约 50 us */

static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static double   g_samples[SAMPLE_CAP];
static uint32_t g_count;
static int      g_running;

/* 采集线程：每 1 ms 采样一次 */
static void *acq_thread(void *arg)
{
    (void)arg;
    while (g_running != 0) {
        double v = ad_read();
        (void)pthread_mutex_lock(&g_lock);
        if (g_count >= SAMPLE_CAP) {
            return NULL;
        }
        g_samples[g_count] = v;
        g_count++;
        (void)pthread_mutex_unlock(&g_lock);
        (void)usleep(1000);
    }
    return NULL;
}

/* 取走全部样本到 dst（最多 cap 个），返回实际个数 */
uint32_t sample_take(double *dst, uint32_t cap)
{
    uint32_t n;

    if (dst == NULL) {
        return 0u;
    }
    n = g_count;
    (void)pthread_mutex_lock(&g_lock);
    if (n > cap) {
        n = cap;
    }
    (void)memcpy(dst, g_samples, (size_t)n * sizeof(double));
    g_count = 0u;
    (void)pthread_mutex_unlock(&g_lock);
    return n;
}

/* 启动采集线程 */
int sample_start(pthread_t *tid)
{
    if (tid == NULL) {
        return -1;
    }
    g_running = 1;
    (void)pthread_create(tid, NULL, acq_thread, NULL);
    return 0;
}

/* 计算平均值；count 为 0 时返回 0.0 */
double sample_mean(const double *v, uint32_t count)
{
    double   sum = 0.0;
    uint32_t i;

    if ((v == NULL) || (count == 0u)) {
        return 0.0;
    }
    for (i = 0u; i < count; i++) {
        sum += v[i];
    }
    return sum / (double)count;
}
