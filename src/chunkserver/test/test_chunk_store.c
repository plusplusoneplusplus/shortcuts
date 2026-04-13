/*
 * test_chunk_store.c — Tests for the in-memory ChunkStore
 */

#include "../lib/chunk_store.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static SNAP_GUID make_guid(uint8_t fill) {
    SNAP_GUID g;
    memset(g.bytes, fill, sizeof(g.bytes));
    return g;
}

static void test_init(void) {
    ChunkStore store;
    assert(SNAP_SUCCEEDED(ChunkStore_Init(&store)));
    assert(ChunkStore_Count(&store) == 0);
    ChunkStore_Destroy(&store);
    printf("  test_init                       PASS\n");
}

static void test_init_null(void) {
    assert(SNAP_FAILED(ChunkStore_Init(NULL)));
    printf("  test_init_null                  PASS\n");
}

static void test_put_get_roundtrip(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x10);
    uint8_t data[] = "Hello, ChunkStore!";
    uint32_t cksum = 0;

    assert(SNAP_SUCCEEDED(ChunkStore_Put(&store, &id, data, sizeof(data), &cksum)));
    assert(cksum != 0);
    assert(ChunkStore_Count(&store) == 1);

    /* Query size */
    size_t sz = 0;
    assert(SNAP_SUCCEEDED(ChunkStore_Get(&store, &id, NULL, 0, &sz)));
    assert(sz == sizeof(data));

    /* Retrieve data */
    uint8_t buf[64] = {0};
    assert(SNAP_SUCCEEDED(ChunkStore_Get(&store, &id, buf, sizeof(buf), &sz)));
    assert(sz == sizeof(data));
    assert(memcmp(buf, data, sizeof(data)) == 0);

    ChunkStore_Destroy(&store);
    printf("  test_put_get_roundtrip          PASS\n");
}

static void test_checksum_integrity(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x20);
    uint8_t data[] = {0xDE, 0xAD, 0xBE, 0xEF};
    uint32_t cksum = 0;

    ChunkStore_Put(&store, &id, data, sizeof(data), &cksum);

    /* Verify the stored checksum matches chunk_checksum */
    uint32_t expected = chunk_checksum(data, sizeof(data));
    assert(cksum == expected);

    ChunkStore_Destroy(&store);
    printf("  test_checksum_integrity         PASS\n");
}

static void test_put_duplicate(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x30);
    uint8_t data[] = "data";

    assert(SNAP_SUCCEEDED(ChunkStore_Put(&store, &id, data, sizeof(data), NULL)));
    assert(SNAP_FAILED(ChunkStore_Put(&store, &id, data, sizeof(data), NULL)));
    assert(ChunkStore_Count(&store) == 1);

    ChunkStore_Destroy(&store);
    printf("  test_put_duplicate              PASS\n");
}

static void test_put_invalid_size(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x40);
    uint8_t data[] = "x";

    /* Zero size */
    assert(SNAP_FAILED(ChunkStore_Put(&store, &id, data, 0, NULL)));
    assert(ChunkStore_Count(&store) == 0);

    ChunkStore_Destroy(&store);
    printf("  test_put_invalid_size           PASS\n");
}

static void test_get_not_found(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x50);
    size_t sz = 0;

    assert(ChunkStore_Get(&store, &id, NULL, 0, &sz) == SNAP_STATUS_NOT_FOUND);

    ChunkStore_Destroy(&store);
    printf("  test_get_not_found              PASS\n");
}

static void test_get_buffer_too_small(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x60);
    uint8_t data[100];
    memset(data, 0xAA, sizeof(data));

    ChunkStore_Put(&store, &id, data, sizeof(data), NULL);

    uint8_t buf[10];
    size_t sz = 0;
    assert(ChunkStore_Get(&store, &id, buf, sizeof(buf), &sz)
           == SNAP_STATUS_INSUFFICIENT_BUFFER);

    ChunkStore_Destroy(&store);
    printf("  test_get_buffer_too_small       PASS\n");
}

static void test_delete(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x70);
    uint8_t data[] = "delete me";

    ChunkStore_Put(&store, &id, data, sizeof(data), NULL);
    assert(ChunkStore_Count(&store) == 1);
    assert(SNAP_SUCCEEDED(ChunkStore_Delete(&store, &id)));
    assert(ChunkStore_Count(&store) == 0);

    /* Verify it's gone */
    size_t sz = 0;
    assert(ChunkStore_Get(&store, &id, NULL, 0, &sz) == SNAP_STATUS_NOT_FOUND);

    ChunkStore_Destroy(&store);
    printf("  test_delete                     PASS\n");
}

static void test_delete_not_found(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x80);
    assert(SNAP_FAILED(ChunkStore_Delete(&store, &id)));
    ChunkStore_Destroy(&store);
    printf("  test_delete_not_found           PASS\n");
}

static void test_list(void) {
    ChunkStore store;
    ChunkStore_Init(&store);

    SNAP_GUID a = make_guid(0x01);
    SNAP_GUID b = make_guid(0x02);
    SNAP_GUID c = make_guid(0x03);
    uint8_t data[] = "x";
    ChunkStore_Put(&store, &a, data, 1, NULL);
    ChunkStore_Put(&store, &b, data, 1, NULL);
    ChunkStore_Put(&store, &c, data, 1, NULL);

    /* Count-only query */
    uint32_t count = 0;
    assert(SNAP_SUCCEEDED(ChunkStore_List(&store, NULL, 0, &count)));
    assert(count == 3);

    /* Full list */
    ChunkDescriptor descs[10];
    assert(SNAP_SUCCEEDED(ChunkStore_List(&store, descs, 10, &count)));
    assert(count == 3);

    ChunkStore_Destroy(&store);
    printf("  test_list                       PASS\n");
}

static void test_list_insufficient_buffer(void) {
    ChunkStore store;
    ChunkStore_Init(&store);

    SNAP_GUID a = make_guid(0x11);
    SNAP_GUID b = make_guid(0x12);
    uint8_t data[] = "x";
    ChunkStore_Put(&store, &a, data, 1, NULL);
    ChunkStore_Put(&store, &b, data, 1, NULL);

    ChunkDescriptor descs[1];
    uint32_t count = 0;
    SNAP_STATUS st = ChunkStore_List(&store, descs, 1, &count);
    assert(st == SNAP_STATUS_INSUFFICIENT_BUFFER);
    assert(count == 2);   /* Still reports total count */

    ChunkStore_Destroy(&store);
    printf("  test_list_insufficient_buffer   PASS\n");
}

static void test_list_empty(void) {
    ChunkStore store;
    ChunkStore_Init(&store);

    uint32_t count = 99;
    assert(SNAP_SUCCEEDED(ChunkStore_List(&store, NULL, 0, &count)));
    assert(count == 0);

    ChunkStore_Destroy(&store);
    printf("  test_list_empty                 PASS\n");
}

static void test_large_chunk(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0x90);

    /* 1 MiB chunk */
    size_t sz = 1024 * 1024;
    uint8_t *data = malloc(sz);
    assert(data != NULL);
    for (size_t i = 0; i < sz; i++) data[i] = (uint8_t)(i & 0xFF);

    uint32_t cksum = 0;
    assert(SNAP_SUCCEEDED(ChunkStore_Put(&store, &id, data, sz, &cksum)));

    uint8_t *buf = malloc(sz);
    assert(buf != NULL);
    size_t out = 0;
    assert(SNAP_SUCCEEDED(ChunkStore_Get(&store, &id, buf, sz, &out)));
    assert(out == sz);
    assert(memcmp(data, buf, sz) == 0);

    free(data);
    free(buf);
    ChunkStore_Destroy(&store);
    printf("  test_large_chunk                PASS\n");
}

static void test_delete_with_reinsert(void) {
    ChunkStore store;
    ChunkStore_Init(&store);
    SNAP_GUID id = make_guid(0xA0);
    uint8_t data1[] = "version1";
    uint8_t data2[] = "version2!";

    ChunkStore_Put(&store, &id, data1, sizeof(data1), NULL);
    ChunkStore_Delete(&store, &id);
    assert(ChunkStore_Count(&store) == 0);

    /* Re-insert with different data */
    ChunkStore_Put(&store, &id, data2, sizeof(data2), NULL);
    assert(ChunkStore_Count(&store) == 1);

    uint8_t buf[64] = {0};
    size_t sz = 0;
    ChunkStore_Get(&store, &id, buf, sizeof(buf), &sz);
    assert(sz == sizeof(data2));
    assert(memcmp(buf, data2, sizeof(data2)) == 0);

    ChunkStore_Destroy(&store);
    printf("  test_delete_with_reinsert       PASS\n");
}

int main(void) {
    printf("test_chunk_store\n");
    test_init();
    test_init_null();
    test_put_get_roundtrip();
    test_checksum_integrity();
    test_put_duplicate();
    test_put_invalid_size();
    test_get_not_found();
    test_get_buffer_too_small();
    test_delete();
    test_delete_not_found();
    test_list();
    test_list_insufficient_buffer();
    test_list_empty();
    test_large_chunk();
    test_delete_with_reinsert();
    printf("  15/15 passed\n");
    return 0;
}
