/*
 * chunk_server.c — ChunkServer implementation
 *
 * Init wires the ChunkStore as the channel's UserContext so that
 * ChunkOps_Dispatch can retrieve it.  HandleRequest dispatches
 * through Snap_Request_SendSync, keeping the POSIX synchronous model.
 */

#include "chunk_server.h"
#include <string.h>

SNAP_STATUS ChunkServer_Init(ChunkServer *server) {
    if (!server) return SNAP_STATUS_INVALID_ARGUMENT;
    memset(server, 0, sizeof(*server));

    SNAP_STATUS st = ChunkStore_Init(&server->store);
    if (SNAP_FAILED(st)) return st;

    Snap_Channel_Init(&server->channel, &server->store);
    return SNAP_STATUS_OK;
}

void ChunkServer_Destroy(ChunkServer *server) {
    if (!server) return;
    ChunkStore_Destroy(&server->store);
    memset(server, 0, sizeof(*server));
}

SNAP_STATUS ChunkServer_HandleRequest(ChunkServer *server,
                                      SNAP_REQUEST *request) {
    if (!server || !request) return SNAP_STATUS_INVALID_ARGUMENT;

    server->request_count++;

    Snap_Request_SendSync(&server->channel, ChunkOps_Dispatch, request);

    SNAP_STATUS result = Snap_Request_GetStatus(request);
    if (SNAP_FAILED(result))
        server->error_count++;

    return result;
}

void ChunkServer_GetStats(const ChunkServer *server, ChunkServerStats *stats) {
    if (!server || !stats) return;
    stats->request_count = server->request_count;
    stats->error_count   = server->error_count;
    stats->chunk_count   = ChunkStore_Count(&server->store);
}
