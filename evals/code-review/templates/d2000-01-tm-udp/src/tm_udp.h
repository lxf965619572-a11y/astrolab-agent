#ifndef TM_UDP_H
#define TM_UDP_H

#include <stdint.h>
#include <stddef.h>

/* 遥测报文头，与下位机（BM3803）发送端结构体定义保持一致 */
typedef struct {
    uint16_t sync;
    uint16_t length;      /* 数据区字节数 */
    long     timestamp;   /* 下位机秒计数 */    /*@D:udp-long-wire*/
} tm_hdr_t;

int  tm_open(void);
int  tm_recv(int fd, uint8_t *out, size_t out_size);
void tm_close(int fd);

#endif /* TM_UDP_H */
