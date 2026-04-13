/*
 * chunk_ops.h — SNAP request dispatcher for chunk operations
 *
 * Opcodes are packed into SNAP_REQUEST.Params[128] as a ChunkOpParams
 * struct.  The dispatcher reads the opcode, delegates to ChunkStore,
 * and writes results back into the params before completing the request.
 */

#ifndef CHUNK_OPS_H
#define CHUNK_OPS_H

#include "snap_posix_channel.h"
#include "chunk_store.h"

/* ── Opcodes ──────────────────────────────────────────────────────── */

typedef enum {
    CHUNK_OP_PUT    = 1,
    CHUNK_OP_GET    = 2,
    CHUNK_OP_DELETE = 3,
    CHUNK_OP_LIST   = 4,
} ChunkOpCode;

/* ── Parameters (packed into Params[128]) ─────────────────────────── */

typedef struct {
    /* IN */
    ChunkOpCode opcode;
    uint32_t    data_size;          /* PUT: data bytes, GET: buf capacity */
    SNAP_GUID   chunk_id;
    uint32_t    max_list_count;     /* LIST: buffer capacity */

    /* OUT */
    uint32_t    checksum;           /* PUT: computed checksum */
    uint32_t    list_count;         /* LIST: descriptors written */
    uint32_t    actual_size;        /* GET: bytes written */
} ChunkOpParams;

/* ── Dispatch (SNAP_DISPATCH_FN signature) ────────────────────────── */

void ChunkOps_Dispatch(SNAP_CHANNEL *Channel, SNAP_REQUEST *Request);

#endif /* CHUNK_OPS_H */
