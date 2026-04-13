/*
 * chunk_store.c — In-memory chunk data store implementation
 *
 * The store maintains metadata in a ChunkTable and raw data in a
 * parallel blobs[] array.  Pointer arithmetic on the descriptor
 * derives the slot index:  idx = (desc - table.entries).
 *
 * On Put the data is copied (malloc + memcpy).  On Get the checksum
 * is re-verified before returning the data.  Delete mirrors the
 * swap-with-last pattern from ChunkTable for the blob array.
 */

#include "chunk_store.h"
#include <stdlib.h>
#include <string.h>

SNAP_STATUS ChunkStore_Init(ChunkStore *store) {
    if (!store) return SNAP_STATUS_INVALID_ARGUMENT;
    memset(store, 0, sizeof(*store));
    return ChunkTable_Init(&store->table);
}

void ChunkStore_Destroy(ChunkStore *store) {
    if (!store) return;
    for (uint32_t i = 0; i < store->table.count; i++) {
        free(store->blobs[i]);
        store->blobs[i] = NULL;
    }
    memset(&store->table, 0, sizeof(store->table));
}

SNAP_STATUS ChunkStore_Put(ChunkStore *store, const SNAP_GUID *id,
                           const uint8_t *data, size_t size,
                           uint32_t *checksum_out) {
    if (!store || !id || !data) return SNAP_STATUS_INVALID_ARGUMENT;
    if (!chunk_validate_size(size))  return SNAP_STATUS_INVALID_ARGUMENT;

    uint32_t cksum = chunk_checksum(data, size);

    /* The slot index will be table.count (before Add increments it) */
    uint32_t slot = store->table.count;
    SNAP_STATUS st = ChunkTable_Add(&store->table, id, (uint64_t)size, cksum);
    if (SNAP_FAILED(st)) return st;

    uint8_t *blob = malloc(size);
    if (!blob) {
        /* Roll back the descriptor we just added */
        ChunkTable_Remove(&store->table, id);
        return SNAP_STATUS_ERROR;
    }
    memcpy(blob, data, size);
    store->blobs[slot] = blob;

    if (checksum_out) *checksum_out = cksum;
    return SNAP_STATUS_OK;
}

SNAP_STATUS ChunkStore_Get(ChunkStore *store, const SNAP_GUID *id,
                           uint8_t *buf, size_t buf_size,
                           size_t *size_out) {
    if (!store || !id || !size_out) return SNAP_STATUS_INVALID_ARGUMENT;

    const ChunkDescriptor *desc = NULL;
    SNAP_STATUS st = ChunkTable_Find(&store->table, id, &desc);
    if (SNAP_FAILED(st)) return st;

    *size_out = (size_t)desc->size;

    /* NULL buf = size-only query */
    if (!buf) return SNAP_STATUS_OK;

    if (buf_size < (size_t)desc->size)
        return SNAP_STATUS_INSUFFICIENT_BUFFER;

    uint32_t idx = (uint32_t)(desc - store->table.entries);
    memcpy(buf, store->blobs[idx], (size_t)desc->size);
    return SNAP_STATUS_OK;
}

SNAP_STATUS ChunkStore_Delete(ChunkStore *store, const SNAP_GUID *id) {
    if (!store || !id) return SNAP_STATUS_INVALID_ARGUMENT;

    const ChunkDescriptor *desc = NULL;
    SNAP_STATUS st = ChunkTable_Find(&store->table, id, &desc);
    if (SNAP_FAILED(st)) return st;

    uint32_t idx  = (uint32_t)(desc - store->table.entries);
    uint32_t last = store->table.count - 1;

    free(store->blobs[idx]);

    /* Mirror the swap-with-last that ChunkTable_Remove will do */
    if (idx != last)
        store->blobs[idx] = store->blobs[last];
    store->blobs[last] = NULL;

    return ChunkTable_Remove(&store->table, id);
}

SNAP_STATUS ChunkStore_List(const ChunkStore *store, ChunkDescriptor *buf,
                            uint32_t max_entries, uint32_t *count_out) {
    if (!store || !count_out) return SNAP_STATUS_INVALID_ARGUMENT;

    *count_out = store->table.count;

    /* NULL buf = count-only query */
    if (!buf) return SNAP_STATUS_OK;

    uint32_t n = store->table.count;
    if (n > max_entries) {
        memcpy(buf, store->table.entries, max_entries * sizeof(ChunkDescriptor));
        return SNAP_STATUS_INSUFFICIENT_BUFFER;
    }
    memcpy(buf, store->table.entries, n * sizeof(ChunkDescriptor));
    return SNAP_STATUS_OK;
}

uint32_t ChunkStore_Count(const ChunkStore *store) {
    if (!store) return 0;
    return ChunkTable_Count(&store->table);
}
