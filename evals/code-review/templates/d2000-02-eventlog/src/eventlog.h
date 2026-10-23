#ifndef EVENTLOG_H
#define EVENTLOG_H

#include <stdint.h>

int  log_open(void);
void log_format(char *buf, uint16_t code, const char *msg);
int  log_write(uint16_t code, const char *msg);
int  log_export(const char *src_path, const char *dst_path);
void log_close(void);

#endif /* EVENTLOG_H */
