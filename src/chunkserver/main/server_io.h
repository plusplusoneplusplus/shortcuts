/*
 * server_io.h — TCP listener and admin channel for the chunkserver
 *
 * Network channel: binary wire protocol (opcode|guid|data_len|data)
 * Admin channel:   text commands on stdin (PUT/GET/DELETE/LIST/STATS/QUIT)
 */

#ifndef SERVER_IO_H
#define SERVER_IO_H

#include "../lib/chunk_server.h"
#include <stdint.h>

/* ── Wire protocol ────────────────────────────────────────────────── */

/* Request:  opcode(4) | guid(16) | data_len(4) | data(data_len) */
/* Response: status(4) | data_len(4) | data(data_len) */

typedef struct __attribute__((packed)) {
    uint32_t  opcode;
    SNAP_GUID guid;
    uint32_t  data_len;
} WireRequest;

typedef struct __attribute__((packed)) {
    uint32_t status;
    uint32_t data_len;
} WireResponse;

/* ── Server I/O context ───────────────────────────────────────────── */

typedef struct {
    int listen_fd;
    int port;
    int running;
} ServerIO;

int  ServerIO_Init(ServerIO *io, int port);
void ServerIO_Destroy(ServerIO *io);

/* Run one iteration of the event loop (select with 1s timeout).
   Accepts network connections and reads admin commands from stdin. */
int  ServerIO_Run(ServerIO *io, ChunkServer *server);

/* Handle a single binary-protocol client session. */
int  ServerIO_HandleClient(ServerIO *io, ChunkServer *server, int client_fd);

/* Handle a single admin command line.  Returns 0 to continue, 1 for QUIT. */
int  ServerIO_HandleAdminLine(ChunkServer *server, const char *line,
                              int out_fd);

#endif /* SERVER_IO_H */
