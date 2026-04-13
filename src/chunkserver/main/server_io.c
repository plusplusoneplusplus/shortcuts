/*
 * server_io.c — TCP + admin I/O for the chunkserver
 *
 * The event loop uses select(2) to multiplex the TCP listening socket
 * and stdin.  Network clients speak the binary wire protocol; admin
 * commands are line-oriented text on stdin.
 */

#define _GNU_SOURCE
#include "server_io.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <sys/select.h>
#include <netinet/in.h>
#include <arpa/inet.h>

/* ── Helpers ──────────────────────────────────────────────────────── */

static int read_exact(int fd, void *buf, size_t n) {
    size_t total = 0;
    while (total < n) {
        ssize_t r = read(fd, (uint8_t *)buf + total, n - total);
        if (r <= 0) return -1;
        total += (size_t)r;
    }
    return 0;
}

static int write_exact(int fd, const void *buf, size_t n) {
    size_t total = 0;
    while (total < n) {
        ssize_t w = write(fd, (const uint8_t *)buf + total, n - total);
        if (w <= 0) return -1;
        total += (size_t)w;
    }
    return 0;
}

static void send_response(int fd, uint32_t status,
                           const void *data, uint32_t data_len) {
    WireResponse resp = { .status = status, .data_len = data_len };
    write_exact(fd, &resp, sizeof(resp));
    if (data && data_len > 0)
        write_exact(fd, data, data_len);
}

/* ── Hex helpers for admin channel ────────────────────────────────── */

static int hex_to_guid(const char *hex, SNAP_GUID *guid) {
    if (!hex || strlen(hex) != 32) return -1;
    for (int i = 0; i < 16; i++) {
        unsigned int byte;
        if (sscanf(hex + i * 2, "%2x", &byte) != 1) return -1;
        guid->bytes[i] = (uint8_t)byte;
    }
    return 0;
}

static void guid_to_hex(const SNAP_GUID *guid, char *out) {
    for (int i = 0; i < 16; i++)
        sprintf(out + i * 2, "%02x", guid->bytes[i]);
    out[32] = '\0';
}

static int hex_to_bytes(const char *hex, uint8_t *out, size_t max, size_t *len) {
    size_t hlen = strlen(hex);
    if (hlen % 2 != 0) return -1;
    *len = hlen / 2;
    if (*len > max) return -1;
    for (size_t i = 0; i < *len; i++) {
        unsigned int byte;
        if (sscanf(hex + i * 2, "%2x", &byte) != 1) return -1;
        out[i] = (uint8_t)byte;
    }
    return 0;
}

static void bytes_to_hex(const uint8_t *data, size_t len, char *out) {
    for (size_t i = 0; i < len; i++)
        sprintf(out + i * 2, "%02x", data[i]);
    out[len * 2] = '\0';
}

/* ── Init / Destroy ───────────────────────────────────────────────── */

int ServerIO_Init(ServerIO *io, int port) {
    if (!io) return -1;
    memset(io, 0, sizeof(*io));
    io->port      = port;
    io->listen_fd = -1;

    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;

    int opt = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port        = htons((uint16_t)port);

    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        close(fd);
        return -1;
    }
    if (listen(fd, 16) < 0) {
        close(fd);
        return -1;
    }

    io->listen_fd = fd;
    io->running   = 1;
    return 0;
}

void ServerIO_Destroy(ServerIO *io) {
    if (!io) return;
    io->running = 0;
    if (io->listen_fd >= 0) {
        close(io->listen_fd);
        io->listen_fd = -1;
    }
}

/* ── Binary protocol client handler ───────────────────────────────── */

int ServerIO_HandleClient(ServerIO *io, ChunkServer *server, int client_fd) {
    (void)io;

    while (1) {
        WireRequest hdr;
        if (read_exact(client_fd, &hdr, sizeof(hdr)) != 0)
            break;

        uint8_t *data = NULL;
        if (hdr.data_len > 0) {
            if (hdr.data_len > CHUNK_MAX_SIZE) {
                send_response(client_fd, (uint32_t)SNAP_STATUS_INVALID_ARGUMENT,
                              NULL, 0);
                continue;
            }
            data = malloc(hdr.data_len);
            if (!data) {
                send_response(client_fd, (uint32_t)SNAP_STATUS_ERROR, NULL, 0);
                continue;
            }
            if (read_exact(client_fd, data, hdr.data_len) != 0) {
                free(data);
                break;
            }
        }

        SNAP_REQUEST request;
        Snap_Request_Init(&request);
        ChunkOpParams *p = (ChunkOpParams *)request.Params;
        p->opcode   = (ChunkOpCode)hdr.opcode;
        p->chunk_id = hdr.guid;

        switch (hdr.opcode) {
        case CHUNK_OP_PUT:
            p->data_size          = hdr.data_len;
            request.RequestBuffer = data;
            request.RequestBufferLength = hdr.data_len;
            ChunkServer_HandleRequest(server, &request);
            send_response(client_fd,
                          (uint32_t)Snap_Request_GetStatus(&request),
                          NULL, 0);
            break;

        case CHUNK_OP_GET: {
            /* First get the size */
            size_t sz = 0;
            SNAP_STATUS st = ChunkStore_Get(&server->store, &hdr.guid,
                                            NULL, 0, &sz);
            if (SNAP_FAILED(st)) {
                send_response(client_fd, (uint32_t)st, NULL, 0);
                break;
            }
            uint8_t *buf = malloc(sz);
            if (!buf) {
                send_response(client_fd, (uint32_t)SNAP_STATUS_ERROR,
                              NULL, 0);
                break;
            }
            p->data_size          = (uint32_t)sz;
            request.RequestBuffer = buf;
            request.RequestBufferLength = sz;
            ChunkServer_HandleRequest(server, &request);
            st = Snap_Request_GetStatus(&request);
            if (SNAP_SUCCEEDED(st))
                send_response(client_fd, (uint32_t)st, buf, p->actual_size);
            else
                send_response(client_fd, (uint32_t)st, NULL, 0);
            free(buf);
            break;
        }

        case CHUNK_OP_DELETE:
            ChunkServer_HandleRequest(server, &request);
            send_response(client_fd,
                          (uint32_t)Snap_Request_GetStatus(&request),
                          NULL, 0);
            break;

        case CHUNK_OP_LIST: {
            uint32_t count = ChunkStore_Count(&server->store);
            uint32_t cap = count > 0 ? count : 1;
            ChunkDescriptor *descs = calloc(cap, sizeof(ChunkDescriptor));
            if (!descs) {
                send_response(client_fd, (uint32_t)SNAP_STATUS_ERROR,
                              NULL, 0);
                break;
            }
            p->max_list_count     = cap;
            request.RequestBuffer = descs;
            request.RequestBufferLength = cap * sizeof(ChunkDescriptor);
            ChunkServer_HandleRequest(server, &request);

            /* Serialize as newline-separated hex GUIDs */
            uint32_t n = p->list_count;
            size_t buf_sz = n * 33 + 1;   /* 32 hex + \n each */
            char *txt = malloc(buf_sz);
            if (txt) {
                size_t off = 0;
                for (uint32_t i = 0; i < n; i++) {
                    guid_to_hex(&descs[i].id, txt + off);
                    off += 32;
                    txt[off++] = '\n';
                }
                send_response(client_fd,
                              (uint32_t)Snap_Request_GetStatus(&request),
                              txt, (uint32_t)off);
                free(txt);
            } else {
                send_response(client_fd, (uint32_t)SNAP_STATUS_ERROR,
                              NULL, 0);
            }
            free(descs);
            break;
        }

        default:
            send_response(client_fd,
                          (uint32_t)SNAP_STATUS_INVALID_ARGUMENT, NULL, 0);
            break;
        }

        free(data);
    }

    return 0;
}

/* ── Admin text command handler ───────────────────────────────────── */

int ServerIO_HandleAdminLine(ChunkServer *server, const char *line,
                             int out_fd) {
    if (!server || !line) return 0;

    char cmd[32] = {0};
    char arg1[128] = {0};

    sscanf(line, "%31s %127s", cmd, arg1);

    /* Find start of third argument */
    const char *arg2 = "";
    const char *p = line;
    while (*p == ' ') p++;
    while (*p && *p != ' ') p++;   /* skip cmd */
    while (*p == ' ') p++;
    while (*p && *p != ' ') p++;   /* skip arg1 */
    while (*p == ' ') p++;
    if (*p) arg2 = p;

    if (strcasecmp(cmd, "PUT") == 0) {
        SNAP_GUID guid;
        if (hex_to_guid(arg1, &guid) != 0) {
            dprintf(out_fd, "ERROR: PUT <32-hex-guid> <hex-data>\n");
            return 0;
        }
        if (arg2[0] == '\0') {
            dprintf(out_fd, "ERROR: PUT <32-hex-guid> <hex-data>\n");
            return 0;
        }
        /* Copy arg2 to strip trailing whitespace */
        size_t alen = strlen(arg2);
        char *hex_copy = malloc(alen + 1);
        if (!hex_copy) { dprintf(out_fd, "ERROR: alloc failed\n"); return 0; }
        memcpy(hex_copy, arg2, alen + 1);
        while (alen > 0 && (hex_copy[alen-1] == '\n' || hex_copy[alen-1] == '\r'))
            hex_copy[--alen] = '\0';

        size_t data_len = 0;
        if (alen % 2 != 0 || alen == 0) {
            dprintf(out_fd, "ERROR: invalid hex data\n");
            free(hex_copy);
            return 0;
        }
        data_len = alen / 2;
        uint8_t *data_buf = malloc(data_len);
        if (!data_buf) {
            dprintf(out_fd, "ERROR: alloc failed\n");
            free(hex_copy);
            return 0;
        }
        if (hex_to_bytes(hex_copy, data_buf, data_len, &data_len) != 0) {
            dprintf(out_fd, "ERROR: invalid hex data\n");
            free(data_buf);
            free(hex_copy);
            return 0;
        }
        free(hex_copy);

        SNAP_REQUEST req;
        Snap_Request_Init(&req);
        ChunkOpParams *op = (ChunkOpParams *)req.Params;
        op->opcode    = CHUNK_OP_PUT;
        op->chunk_id  = guid;
        op->data_size = (uint32_t)data_len;
        req.RequestBuffer       = data_buf;
        req.RequestBufferLength = data_len;

        SNAP_STATUS st = ChunkServer_HandleRequest(server, &req);
        if (SNAP_SUCCEEDED(st))
            dprintf(out_fd, "OK checksum=%u\n", op->checksum);
        else
            dprintf(out_fd, "ERROR: put failed (0x%08x)\n", st);
        free(data_buf);

    } else if (strcasecmp(cmd, "GET") == 0) {
        SNAP_GUID guid;
        if (hex_to_guid(arg1, &guid) != 0) {
            dprintf(out_fd, "ERROR: GET <32-hex-guid>\n");
            return 0;
        }

        /* Query size first */
        size_t sz = 0;
        SNAP_STATUS st = ChunkStore_Get(&server->store, &guid, NULL, 0, &sz);
        if (SNAP_FAILED(st)) {
            dprintf(out_fd, "ERROR: not found\n");
            return 0;
        }

        uint8_t *buf = malloc(sz);
        if (!buf) {
            dprintf(out_fd, "ERROR: alloc failed\n");
            return 0;
        }

        SNAP_REQUEST req;
        Snap_Request_Init(&req);
        ChunkOpParams *op = (ChunkOpParams *)req.Params;
        op->opcode    = CHUNK_OP_GET;
        op->chunk_id  = guid;
        op->data_size = (uint32_t)sz;
        req.RequestBuffer       = buf;
        req.RequestBufferLength = sz;

        st = ChunkServer_HandleRequest(server, &req);
        if (SNAP_SUCCEEDED(st)) {
            char *hex = malloc(op->actual_size * 2 + 1);
            if (hex) {
                bytes_to_hex(buf, op->actual_size, hex);
                dprintf(out_fd, "OK %u %s\n", op->actual_size, hex);
                free(hex);
            }
        } else {
            dprintf(out_fd, "ERROR: get failed (0x%08x)\n", st);
        }
        free(buf);

    } else if (strcasecmp(cmd, "DELETE") == 0) {
        SNAP_GUID guid;
        if (hex_to_guid(arg1, &guid) != 0) {
            dprintf(out_fd, "ERROR: DELETE <32-hex-guid>\n");
            return 0;
        }

        SNAP_REQUEST req;
        Snap_Request_Init(&req);
        ChunkOpParams *op = (ChunkOpParams *)req.Params;
        op->opcode   = CHUNK_OP_DELETE;
        op->chunk_id = guid;

        SNAP_STATUS st = ChunkServer_HandleRequest(server, &req);
        if (SNAP_SUCCEEDED(st))
            dprintf(out_fd, "OK\n");
        else
            dprintf(out_fd, "ERROR: not found\n");

    } else if (strcasecmp(cmd, "LIST") == 0) {
        uint32_t count = ChunkStore_Count(&server->store);
        if (count == 0) {
            dprintf(out_fd, "OK 0 chunks\n");
            return 0;
        }

        SNAP_REQUEST req;
        Snap_Request_Init(&req);
        ChunkOpParams *op = (ChunkOpParams *)req.Params;
        op->opcode         = CHUNK_OP_LIST;
        op->max_list_count = count;

        ChunkDescriptor *descs = calloc(count, sizeof(ChunkDescriptor));
        if (!descs) {
            dprintf(out_fd, "ERROR: alloc failed\n");
            return 0;
        }
        req.RequestBuffer       = descs;
        req.RequestBufferLength = count * sizeof(ChunkDescriptor);

        ChunkServer_HandleRequest(server, &req);

        dprintf(out_fd, "OK %u chunks\n", op->list_count);
        char hex[33];
        for (uint32_t i = 0; i < op->list_count; i++) {
            guid_to_hex(&descs[i].id, hex);
            dprintf(out_fd, "  %s  size=%lu  cksum=%u\n",
                    hex, (unsigned long)descs[i].size, descs[i].checksum);
        }
        free(descs);

    } else if (strcasecmp(cmd, "STATS") == 0) {
        ChunkServerStats stats;
        ChunkServer_GetStats(server, &stats);
        dprintf(out_fd, "chunks:   %u\n", stats.chunk_count);
        dprintf(out_fd, "requests: %lu\n", (unsigned long)stats.request_count);
        dprintf(out_fd, "errors:   %lu\n", (unsigned long)stats.error_count);

    } else if (strcasecmp(cmd, "QUIT") == 0) {
        dprintf(out_fd, "BYE\n");
        return 1;

    } else if (cmd[0] != '\0') {
        dprintf(out_fd, "ERROR: unknown command '%s'\n", cmd);
    }

    return 0;
}

/* ── Event loop ───────────────────────────────────────────────────── */

int ServerIO_Run(ServerIO *io, ChunkServer *server) {
    if (!io || !server) return -1;

    fd_set readfds;
    FD_ZERO(&readfds);
    FD_SET(io->listen_fd, &readfds);
    FD_SET(STDIN_FILENO, &readfds);

    int maxfd = io->listen_fd > STDIN_FILENO ? io->listen_fd : STDIN_FILENO;

    struct timeval tv = { .tv_sec = 1, .tv_usec = 0 };
    int ready = select(maxfd + 1, &readfds, NULL, NULL, &tv);
    if (ready <= 0) return 0;

    /* TCP connection */
    if (FD_ISSET(io->listen_fd, &readfds)) {
        int client = accept(io->listen_fd, NULL, NULL);
        if (client >= 0) {
            ServerIO_HandleClient(io, server, client);
            close(client);
        }
    }

    /* Admin command from stdin */
    if (FD_ISSET(STDIN_FILENO, &readfds)) {
        char line[4096];
        if (fgets(line, sizeof(line), stdin)) {
            /* Strip trailing newline */
            size_t len = strlen(line);
            while (len > 0 && (line[len-1] == '\n' || line[len-1] == '\r'))
                line[--len] = '\0';
            if (ServerIO_HandleAdminLine(server, line, STDOUT_FILENO))
                io->running = 0;
        } else {
            io->running = 0;   /* stdin closed */
        }
    }

    return 0;
}
