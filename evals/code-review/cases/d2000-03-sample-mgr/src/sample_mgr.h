#ifndef SAMPLE_MGR_H
#define SAMPLE_MGR_H

#include <pthread.h>
#include <stdint.h>

uint32_t sample_take(double *dst, uint32_t cap);
int      sample_start(pthread_t *tid);
double   sample_mean(const double *v, uint32_t count);

#endif /* SAMPLE_MGR_H */
