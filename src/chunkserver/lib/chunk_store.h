/*
 * chunk_store.h — In-memory chunk data store
 *
 * Pairs ChunkTable metadata with a parallel blob array.  Put copies
 * data in; Get copies data out.  Checksums are verified on read.
 */

#ifndef CHUNK_STORE_H
#define CHUNK_STORE_H

#include "chunk_meta.h"
#include "chunk.h"

typedef struct {
    ChunkTable  table;
    uint8_t    *blobs[CHUNK_TABLE_MAX_ENTRIES];
} ChunkStore;

SNAP_STATUS ChunkStore_Init(ChunkStore *store);
void        ChunkStore_Destroy(ChunkStore *store);

SNAP_STATUS ChunkStore_Put(ChunkStore *store, const SNAP_GUID *id,
                           const uint8_t *data, size_t size,
                           uint32_t *checksum_out);

SNAP_STATUS ChunkStore_Get(ChunkStore *store, const SNAP_GUID *id,
                           uint8_t *buf, size_t buf_size,
                           size_t *size_out);

SNAP_STATUS ChunkStore_Delete(ChunkStore *store, const SNAP_GUID *id);

SNAP_STATUS ChunkStore_List(const ChunkStore *store, ChunkDescriptor *buf,
                            uint32_t max_entries, uint32_t *count_out);

uint32_t    ChunkStore_Count(const ChunkStore *store);

#endif /* CHUNK_STORE_H */
