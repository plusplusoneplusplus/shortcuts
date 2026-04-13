/*
 * chunk_meta.c — ChunkTable implementation
 */

#include "chunk_meta.h"
#include <string.h>

SNAP_STATUS ChunkTable_Init(ChunkTable *table) {
    if (!table) return SNAP_STATUS_INVALID_ARGUMENT;
    memset(table, 0, sizeof(*table));
    return SNAP_STATUS_OK;
}

SNAP_STATUS ChunkTable_Add(ChunkTable *table, const SNAP_GUID *id,
                           uint64_t size, uint32_t checksum) {
    if (!table || !id) return SNAP_STATUS_INVALID_ARGUMENT;
    if (Snap_Guid_IsZero(id)) return SNAP_STATUS_INVALID_ARGUMENT;
    if (table->count >= CHUNK_TABLE_MAX_ENTRIES)
        return SNAP_STATUS_INSUFFICIENT_BUFFER;

    /* Reject duplicates */
    for (uint32_t i = 0; i < table->count; i++) {
        if (Snap_Guid_IsEqual(&table->entries[i].id, id))
            return SNAP_STATUS_ERROR;
    }

    ChunkDescriptor *d = &table->entries[table->count];
    d->id       = *id;
    d->checksum = checksum;
    d->offset   = 0;
    d->size     = size;
    table->count++;
    return SNAP_STATUS_OK;
}

SNAP_STATUS ChunkTable_Find(const ChunkTable *table, const SNAP_GUID *id,
                            const ChunkDescriptor **out) {
    if (!table || !id || !out) return SNAP_STATUS_INVALID_ARGUMENT;

    for (uint32_t i = 0; i < table->count; i++) {
        if (Snap_Guid_IsEqual(&table->entries[i].id, id)) {
            *out = &table->entries[i];
            return SNAP_STATUS_OK;
        }
    }
    return SNAP_STATUS_NOT_FOUND;
}

SNAP_STATUS ChunkTable_Remove(ChunkTable *table, const SNAP_GUID *id) {
    if (!table || !id) return SNAP_STATUS_INVALID_ARGUMENT;

    for (uint32_t i = 0; i < table->count; i++) {
        if (Snap_Guid_IsEqual(&table->entries[i].id, id)) {
            /* Swap with last entry */
            uint32_t last = table->count - 1;
            if (i != last)
                table->entries[i] = table->entries[last];
            table->count--;
            return SNAP_STATUS_OK;
        }
    }
    return SNAP_STATUS_NOT_FOUND;
}

uint32_t ChunkTable_Count(const ChunkTable *table) {
    if (!table) return 0;
    return table->count;
}
