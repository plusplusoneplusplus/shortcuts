/*
 * test_chunk.c — Tests for chunk.h utilities (checksum, size validation)
 */

#include "../lib/chunk.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static void test_checksum_basic(void) {
    uint8_t data[] = { 0x01, 0x02, 0x03, 0x04 };
    uint32_t c = chunk_checksum(data, sizeof(data));
    assert(c != 0);
    printf("  test_checksum_basic             PASS\n");
}

static void test_checksum_deterministic(void) {
    uint8_t data[] = "hello world";
    uint32_t c1 = chunk_checksum(data, sizeof(data) - 1);
    uint32_t c2 = chunk_checksum(data, sizeof(data) - 1);
    assert(c1 == c2);
    printf("  test_checksum_deterministic     PASS\n");
}

static void test_checksum_different_data(void) {
    uint8_t a[] = "aaaa";
    uint8_t b[] = "bbbb";
    uint32_t ca = chunk_checksum(a, 4);
    uint32_t cb = chunk_checksum(b, 4);
    assert(ca != cb);
    printf("  test_checksum_different_data    PASS\n");
}

static void test_checksum_null(void) {
    assert(chunk_checksum(NULL, 10) == 0);
    uint8_t d = 0x42;
    assert(chunk_checksum(&d, 0) == 0);
    printf("  test_checksum_null              PASS\n");
}

static void test_validate_size(void) {
    assert(chunk_validate_size(0) == 0);
    assert(chunk_validate_size(1) == 1);
    assert(chunk_validate_size(CHUNK_MAX_SIZE) == 1);
    assert(chunk_validate_size(CHUNK_MAX_SIZE + 1) == 0);
    assert(chunk_validate_size((size_t)-1) == 0);
    printf("  test_validate_size              PASS\n");
}

int main(void) {
    printf("test_chunk\n");
    test_checksum_basic();
    test_checksum_deterministic();
    test_checksum_different_data();
    test_checksum_null();
    test_validate_size();
    printf("  5/5 passed\n");
    return 0;
}
