/*
 * chunk.c — Chunk checksum and size validation
 *
 * The checksum is a simple rotate-XOR hash; the real DPU would use
 * hardware-accelerated CRC.  Good enough for integrity checking.
 */

#include "chunk.h"

uint32_t chunk_checksum(const uint8_t *data, size_t size) {
    if (!data || size == 0) return 0;
    uint32_t sum = 0;
    for (size_t i = 0; i < size; i++) {
        sum = (sum << 1) ^ data[i];
    }
    return sum;
}

int chunk_validate_size(size_t size) {
    return (size > 0 && size <= CHUNK_MAX_SIZE) ? 1 : 0;
}
