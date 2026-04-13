/*
 * test_chunk_meta.c — Tests for ChunkTable (metadata management)
 */

#include "../lib/chunk_meta.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static SNAP_GUID make_guid(uint8_t fill) {
    SNAP_GUID g;
    memset(g.bytes, fill, sizeof(g.bytes));
    return g;
}

static void test_init(void) {
    ChunkTable t;
    assert(SNAP_SUCCEEDED(ChunkTable_Init(&t)));
    assert(ChunkTable_Count(&t) == 0);
    printf("  test_init                       PASS\n");
}

static void test_init_null(void) {
    assert(SNAP_FAILED(ChunkTable_Init(NULL)));
    printf("  test_init_null                  PASS\n");
}

static void test_add_and_find(void) {
    ChunkTable t;
    ChunkTable_Init(&t);
    SNAP_GUID g = make_guid(0x11);
    assert(SNAP_SUCCEEDED(ChunkTable_Add(&t, &g, 1024, 0xDEAD)));
    assert(ChunkTable_Count(&t) == 1);

    const ChunkDescriptor *d = NULL;
    assert(SNAP_SUCCEEDED(ChunkTable_Find(&t, &g, &d)));
    assert(d->size == 1024);
    assert(d->checksum == 0xDEAD);
    printf("  test_add_and_find               PASS\n");
}

static void test_add_duplicate(void) {
    ChunkTable t;
    ChunkTable_Init(&t);
    SNAP_GUID g = make_guid(0x22);
    assert(SNAP_SUCCEEDED(ChunkTable_Add(&t, &g, 100, 1)));
    assert(SNAP_FAILED(ChunkTable_Add(&t, &g, 100, 1)));
    assert(ChunkTable_Count(&t) == 1);
    printf("  test_add_duplicate              PASS\n");
}

static void test_add_zero_guid(void) {
    ChunkTable t;
    ChunkTable_Init(&t);
    SNAP_GUID z = SNAP_GUID_ZERO;
    assert(SNAP_FAILED(ChunkTable_Add(&t, &z, 100, 0)));
    printf("  test_add_zero_guid              PASS\n");
}

static void test_find_not_found(void) {
    ChunkTable t;
    ChunkTable_Init(&t);
    SNAP_GUID g = make_guid(0xFF);
    const ChunkDescriptor *d = NULL;
    assert(ChunkTable_Find(&t, &g, &d) == SNAP_STATUS_NOT_FOUND);
    printf("  test_find_not_found             PASS\n");
}

static void test_remove(void) {
    ChunkTable t;
    ChunkTable_Init(&t);
    SNAP_GUID g = make_guid(0x33);
    ChunkTable_Add(&t, &g, 512, 0);
    assert(SNAP_SUCCEEDED(ChunkTable_Remove(&t, &g)));
    assert(ChunkTable_Count(&t) == 0);
    printf("  test_remove                     PASS\n");
}

static void test_remove_not_found(void) {
    ChunkTable t;
    ChunkTable_Init(&t);
    SNAP_GUID g = make_guid(0x44);
    assert(ChunkTable_Remove(&t, &g) == SNAP_STATUS_NOT_FOUND);
    printf("  test_remove_not_found           PASS\n");
}

static void test_swap_with_last(void) {
    ChunkTable t;
    ChunkTable_Init(&t);
    SNAP_GUID a = make_guid(0x01);
    SNAP_GUID b = make_guid(0x02);
    SNAP_GUID c = make_guid(0x03);
    ChunkTable_Add(&t, &a, 10, 0);
    ChunkTable_Add(&t, &b, 20, 0);
    ChunkTable_Add(&t, &c, 30, 0);

    /* Remove first — 'c' should swap into slot 0 */
    ChunkTable_Remove(&t, &a);
    assert(ChunkTable_Count(&t) == 2);

    const ChunkDescriptor *d = NULL;
    assert(SNAP_SUCCEEDED(ChunkTable_Find(&t, &b, &d)));
    assert(SNAP_SUCCEEDED(ChunkTable_Find(&t, &c, &d)));
    assert(ChunkTable_Find(&t, &a, &d) == SNAP_STATUS_NOT_FOUND);
    printf("  test_swap_with_last             PASS\n");
}

static void test_full_table(void) {
    ChunkTable t;
    ChunkTable_Init(&t);
    for (uint32_t i = 0; i < CHUNK_TABLE_MAX_ENTRIES; i++) {
        SNAP_GUID g;
        memset(g.bytes, 0, sizeof(g.bytes));
        /* Encode i into the first 4 bytes so each guid is unique */
        g.bytes[0] = (uint8_t)((i >> 24) & 0xFF);
        g.bytes[1] = (uint8_t)((i >> 16) & 0xFF);
        g.bytes[2] = (uint8_t)((i >> 8) & 0xFF);
        g.bytes[3] = (uint8_t)(i & 0xFF);
        /* Ensure non-zero — i=0 would be zero guid, set last byte */
        g.bytes[15] = 0xFF;
        assert(SNAP_SUCCEEDED(ChunkTable_Add(&t, &g, 1, 0)));
    }
    assert(ChunkTable_Count(&t) == CHUNK_TABLE_MAX_ENTRIES);

    /* One more should fail */
    SNAP_GUID extra = make_guid(0xEE);
    assert(ChunkTable_Add(&t, &extra, 1, 0) == SNAP_STATUS_INSUFFICIENT_BUFFER);
    printf("  test_full_table                 PASS\n");
}

int main(void) {
    printf("test_chunk_meta\n");
    test_init();
    test_init_null();
    test_add_and_find();
    test_add_duplicate();
    test_add_zero_guid();
    test_find_not_found();
    test_remove();
    test_remove_not_found();
    test_swap_with_last();
    test_full_table();
    printf("  10/10 passed\n");
    return 0;
}
