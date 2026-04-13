/*
 * chunk_meta.h — ChunkTable: fixed-size metadata table for chunk descriptors
 *
 * Uses swap-with-last deletion for O(1) remove, linear search (fine for
 * the 1024-entry cap — production would use a hash map).
 */

#ifndef CHUNK_META_H
#define CHUNK_META_H

#include "snap_posix.h"

#define CHUNK_TABLE_MAX_ENTRIES 1024

typedef struct {
    SNAP_GUID id;
    uint32_t  checksum;
    uint64_t  offset;       /* Reserved for future NVMe backing */
    uint64_t  size;
} ChunkDescriptor;

typedef struct {
    ChunkDescriptor entries[CHUNK_TABLE_MAX_ENTRIES];
    uint32_t        count;
} ChunkTable;

SNAP_STATUS ChunkTable_Init(ChunkTable *table);
SNAP_STATUS ChunkTable_Add(ChunkTable *table, const SNAP_GUID *id,
                           uint64_t size, uint32_t checksum);
SNAP_STATUS ChunkTable_Find(const ChunkTable *table, const SNAP_GUID *id,
                            const ChunkDescriptor **out);
SNAP_STATUS ChunkTable_Remove(ChunkTable *table, const SNAP_GUID *id);
uint32_t    ChunkTable_Count(const ChunkTable *table);

#endif /* CHUNK_META_H */
