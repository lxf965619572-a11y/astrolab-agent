/*
 * 文件名：tm_udp.c
 * 功能：  D2000 地面测试设备：接收下位机经网关转发的遥测 UDP 报文
 * 说明：  下位机为 BM3803（大端）；报文头各字段均按大端发送。
 */
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>
#include "tm_udp.h"

#define TM_PORT      6000
#define TM_BUF_SIZE  1024
#define TM_SYNC      0xEB90u

/*@CLEAN*/
/* 创建并绑定 UDP 套接字；失败返回 -1 */
int tm_open(void)
{
    struct sockaddr_in addr;
    int fd = socket(AF_INET, SOCK_DGRAM, 0);

    if (fd < 0) {
        return -1;
    }
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_port        = htons(TM_PORT);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}
/*@END*/

/* 接收一帧遥测，把数据区复制到 out；返回数据区长度，出错返回 -1 */
int tm_recv(int fd, uint8_t *out, size_t out_size)
{
    uint8_t buf[TM_BUF_SIZE];
    tm_hdr_t hdr;
    ssize_t n;
    uint16_t len;

    if (out == NULL) {
        return -1;
    }
    n = recv(fd, buf, sizeof(buf), 0);
    if ((size_t)n < sizeof(tm_hdr_t)) {    /*@D:udp-recv-neg*/
        return -1;
    }
    memcpy(&hdr, buf, sizeof(hdr));
    if (hdr.sync != TM_SYNC) {    /*@D:udp-sync-endian*/
        return -1;
    }
    len = hdr.length;    /*@D:udp-len-endian*/
    memcpy(out, buf + sizeof(tm_hdr_t), len);    /*@D:udp-len-unchecked*/
    return (int)len;
}

/*@CLEAN*/
/* 关闭套接字 */
void tm_close(int fd)
{
    if (fd >= 0) {
        (void)close(fd);
    }
}
/*@END*/
