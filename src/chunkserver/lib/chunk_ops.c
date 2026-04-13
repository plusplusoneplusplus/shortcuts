/*
 * chunk_ops.c — SNAP request dispatcher implementation
 *
 * ChunkOps_Dispatch is the SNAP_DISPATCH_FN that the channel calls
 * for every request.  It extracts ChunkOpParams from Params[128],
 * dispatches to ChunkStore_Put/Get/Delete/List, writes out-params,
 * then calls Snap_Request_Complete.
 */

#include "chunk_ops.h"
#include <string.h>

void ChunkOps_Dispatch(SNAP_CHANNEL *Channel, SNAP_REQUEST *Request) {
    if (!Channel || !Request) return;

    ChunkStore *store = (ChunkStore *)Snap_Channel_GetContext(Channel);
    if (!store) {
        Snap_Request_Complete(Channel, Request, SNAP_STATUS_ERROR);
        return;
    }

    ChunkOpParams *p = (ChunkOpParams *)Request->Params;
    SNAP_STATUS status = SNAP_STATUS_OK;

    switch (p->opcode) {
    case CHUNK_OP_PUT: {
        if (!Request->RequestBuffer || p->data_size == 0) {
            status = SNAP_STATUS_INVALID_ARGUMENT;
            break;
        }
        uint32_t cksum = 0;
        status = ChunkStore_Put(store, &p->chunk_id,
                                (const uint8_t *)Request->RequestBuffer,
                                p->data_size, &cksum);
        if (SNAP_SUCCEEDED(status))
            p->checksum = cksum;
        break;
    }

    case CHUNK_OP_GET: {
        size_t actual = 0;
        status = ChunkStore_Get(store, &p->chunk_id,
                                (uint8_t *)Request->RequestBuffer,
                                p->data_size, &actual);
        if (SNAP_SUCCEEDED(status))
            p->actual_size = (uint32_t)actual;
        break;
    }

    case CHUNK_OP_DELETE:
        status = ChunkStore_Delete(store, &p->chunk_id);
        break;

    case CHUNK_OP_LIST: {
        uint32_t count = 0;
        status = ChunkStore_List(store,
                                 (ChunkDescriptor *)Request->RequestBuffer,
                                 p->max_list_count, &count);
        p->list_count = count;
        break;
    }

    default:
        status = SNAP_STATUS_INVALID_ARGUMENT;
        break;
    }

    Snap_Request_Complete(Channel, Request, status);
}
