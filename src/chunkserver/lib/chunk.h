/*
 * chunk.h — Chunk data utilities (checksum, size validation)
 */

#ifndef CHUNK_H
#define CHUNK_H

#include <stdint.h>
#include <stddef.h>

#define CHUNK_MAX_SIZE (64U * 1024 * 1024)   /* 64 MiB */

uint32_t chunk_checksum(const uint8_t *data, size_t size);
int      chunk_validate_size(size_t size);

#endif /* CHUNK_H */
