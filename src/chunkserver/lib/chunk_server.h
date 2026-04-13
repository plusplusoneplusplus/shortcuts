/*
 * chunk_server.h — Top-level server context
 *
 * Owns a ChunkStore and SNAP_CHANNEL, exposes HandleRequest
 * which dispatches through the SNAP model, and tracks stats.
 */

#ifndef CHUNK_SERVER_H
#define CHUNK_SERVER_H

#include "chunk_store.h"
#include "chunk_ops.h"
#include "snap_posix_channel.h"

typedef struct {
    uint64_t request_count;
    uint64_t error_count;
    uint32_t chunk_count;
} ChunkServerStats;

typedef struct {
    ChunkStore    store;
    SNAP_CHANNEL  channel;
    uint64_t      request_count;
    uint64_t      error_count;
} ChunkServer;

SNAP_STATUS ChunkServer_Init(ChunkServer *server);
void        ChunkServer_Destroy(ChunkServer *server);
SNAP_STATUS ChunkServer_HandleRequest(ChunkServer *server,
                                      SNAP_REQUEST *request);
void        ChunkServer_GetStats(const ChunkServer *server,
                                 ChunkServerStats *stats);

#endif /* CHUNK_SERVER_H */
