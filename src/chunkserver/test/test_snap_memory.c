/*
 * test_snap_memory.c — Tests for SNAP memory descriptors and buffer views
 */

#include "../lib/snap_posix_memory.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static void test_memory_copy(void) {
    uint8_t src[] = "hello";
    uint8_t dst[10] = {0};
    Snap_Memory_Copy(dst, sizeof(dst), src, 5);
    assert(memcmp(dst, "hello", 5) == 0);
    printf("  test_memory_copy                PASS\n");
}

static void test_memory_copy_bounds(void) {
    uint8_t src[] = "toolong";
    uint8_t dst[4] = {0};
    Snap_Memory_Copy(dst, sizeof(dst), src, 7);
    assert(memcmp(dst, "tool", 4) == 0);
    printf("  test_memory_copy_bounds         PASS\n");
}

static void test_memory_zero(void) {
    uint8_t buf[8] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    Snap_Memory_Zero(buf, sizeof(buf));
    for (int i = 0; i < 8; i++) assert(buf[i] == 0);
    printf("  test_memory_zero                PASS\n");
}

static void test_descriptor_create_destroy(void) {
    SNAP_MEMORY_CONFIG cfg = {
        .Type = SNAP_MEMORY_TYPE_PRIMARY_MEMORY,
        .Size = 8192,
        .Alignment = 0
    };
    SNAP_MEMORY_DESCRIPTOR *desc = NULL;
    assert(SNAP_SUCCEEDED(Snap_MemoryDescriptor_Create(&cfg, &desc)));
    assert(desc != NULL);
    assert(desc->PageCount == 2);
    assert(desc->TotalSize == 8192);
    Snap_MemoryDescriptor_Destroy(desc);
    printf("  test_descriptor_create_destroy  PASS\n");
}

static void test_descriptor_create_invalid(void) {
    SNAP_MEMORY_DESCRIPTOR *desc = NULL;
    assert(SNAP_FAILED(Snap_MemoryDescriptor_Create(NULL, &desc)));

    SNAP_MEMORY_CONFIG cfg = { .Type = SNAP_MEMORY_TYPE_PRIMARY_MEMORY, .Size = 0 };
    assert(SNAP_FAILED(Snap_MemoryDescriptor_Create(&cfg, &desc)));
    printf("  test_descriptor_create_invalid  PASS\n");
}

static void test_descriptor_too_large(void) {
    SNAP_MEMORY_CONFIG cfg = {
        .Type = SNAP_MEMORY_TYPE_PRIMARY_MEMORY,
        .Size = (size_t)SNAP_MAX_DESCRIPTOR_PAGES * SNAP_PAGE_SIZE + 1
    };
    SNAP_MEMORY_DESCRIPTOR *desc = NULL;
    assert(Snap_MemoryDescriptor_Create(&cfg, &desc) == SNAP_STATUS_INSUFFICIENT_BUFFER);
    printf("  test_descriptor_too_large       PASS\n");
}

static void test_descriptor_write_read(void) {
    SNAP_MEMORY_CONFIG cfg = {
        .Type = SNAP_MEMORY_TYPE_PRIMARY_MEMORY,
        .Size = SNAP_PAGE_SIZE * 2
    };
    SNAP_MEMORY_DESCRIPTOR *desc = NULL;
    Snap_MemoryDescriptor_Create(&cfg, &desc);

    uint8_t data[100];
    for (int i = 0; i < 100; i++) data[i] = (uint8_t)i;

    assert(SNAP_SUCCEEDED(Snap_MemoryDescriptor_Write(desc, 0, data, 100)));

    uint8_t buf[100] = {0};
    assert(SNAP_SUCCEEDED(Snap_MemoryDescriptor_Read(desc, 0, buf, 100)));
    assert(memcmp(data, buf, 100) == 0);

    Snap_MemoryDescriptor_Destroy(desc);
    printf("  test_descriptor_write_read      PASS\n");
}

static void test_descriptor_cross_page(void) {
    SNAP_MEMORY_CONFIG cfg = {
        .Type = SNAP_MEMORY_TYPE_PRIMARY_MEMORY,
        .Size = SNAP_PAGE_SIZE * 2
    };
    SNAP_MEMORY_DESCRIPTOR *desc = NULL;
    Snap_MemoryDescriptor_Create(&cfg, &desc);

    /* Write across page boundary */
    uint8_t data[256];
    for (int i = 0; i < 256; i++) data[i] = (uint8_t)(i ^ 0xAA);

    size_t offset = SNAP_PAGE_SIZE - 128;
    assert(SNAP_SUCCEEDED(Snap_MemoryDescriptor_Write(desc, offset, data, 256)));

    uint8_t buf[256] = {0};
    assert(SNAP_SUCCEEDED(Snap_MemoryDescriptor_Read(desc, offset, buf, 256)));
    assert(memcmp(data, buf, 256) == 0);

    Snap_MemoryDescriptor_Destroy(desc);
    printf("  test_descriptor_cross_page      PASS\n");
}

static void test_descriptor_oob(void) {
    SNAP_MEMORY_CONFIG cfg = {
        .Type = SNAP_MEMORY_TYPE_PRIMARY_MEMORY,
        .Size = 4096
    };
    SNAP_MEMORY_DESCRIPTOR *desc = NULL;
    Snap_MemoryDescriptor_Create(&cfg, &desc);

    uint8_t buf[1] = {0};
    assert(SNAP_FAILED(Snap_MemoryDescriptor_Write(desc, 4096, buf, 1)));
    assert(SNAP_FAILED(Snap_MemoryDescriptor_Read(desc, 4096, buf, 1)));

    Snap_MemoryDescriptor_Destroy(desc);
    printf("  test_descriptor_oob             PASS\n");
}

static void test_segment_basic(void) {
    SNAP_MEMORY_CONFIG cfg = {
        .Type = SNAP_MEMORY_TYPE_PRIMARY_MEMORY,
        .Size = 4096
    };
    SNAP_MEMORY_DESCRIPTOR *desc = NULL;
    Snap_MemoryDescriptor_Create(&cfg, &desc);

    SNAP_MEMORY_SEGMENT seg;
    SNAP_STATUS_PLUS sp = Snap_MemoryDescriptor_GetMemorySegment(desc, 0, &seg);
    assert(SNAP_SUCCEEDED(sp.StatusCode));
    assert(seg.Buffer != NULL);
    assert(seg.BufferSize == 4096);

    Snap_MemoryDescriptor_Destroy(desc);
    printf("  test_segment_basic              PASS\n");
}

static void test_bufferview_raw(void) {
    uint8_t buf[128];
    memset(buf, 0xBB, sizeof(buf));

    SNAP_BUFFERVIEW view;
    assert(SNAP_SUCCEEDED(Snap_BufferView_InitRaw(&view, buf, sizeof(buf))));
    assert(Snap_BufferView_GetSize(&view) == 128);

    SNAP_MEMORY_SEGMENT seg;
    SNAP_STATUS_PLUS sp = Snap_BufferView_GetSegment(&view, 0, &seg);
    assert(SNAP_SUCCEEDED(sp.StatusCode));
    assert(seg.Buffer == buf);
    assert(seg.BufferSize == 128);
    printf("  test_bufferview_raw             PASS\n");
}

static void test_bufferview_slice(void) {
    uint8_t buf[256];
    for (int i = 0; i < 256; i++) buf[i] = (uint8_t)i;

    SNAP_BUFFERVIEW base;
    Snap_BufferView_InitRaw(&base, buf, 256);

    SNAP_BUFFERVIEW slice;
    assert(SNAP_SUCCEEDED(Snap_BufferView_Slice(&base, 64, 32, &slice)));
    assert(Snap_BufferView_GetSize(&slice) == 32);

    SNAP_MEMORY_SEGMENT seg;
    Snap_BufferView_GetSegment(&slice, 0, &seg);
    assert(((uint8_t *)seg.Buffer)[0] == 64);
    printf("  test_bufferview_slice           PASS\n");
}

static void test_bufferview_slice_oob(void) {
    uint8_t buf[100];
    SNAP_BUFFERVIEW base;
    Snap_BufferView_InitRaw(&base, buf, 100);

    SNAP_BUFFERVIEW slice;
    assert(SNAP_FAILED(Snap_BufferView_Slice(&base, 90, 20, &slice)));
    printf("  test_bufferview_slice_oob       PASS\n");
}

static void test_bufferview_copy_raw(void) {
    uint8_t src_buf[64], dst_buf[64];
    for (int i = 0; i < 64; i++) src_buf[i] = (uint8_t)i;
    memset(dst_buf, 0, 64);

    SNAP_BUFFERVIEW src, dst;
    Snap_BufferView_InitRaw(&src, src_buf, 64);
    Snap_BufferView_InitRaw(&dst, dst_buf, 64);

    assert(SNAP_SUCCEEDED(Snap_BufferView_Copy(&dst, &src)));
    assert(memcmp(src_buf, dst_buf, 64) == 0);
    printf("  test_bufferview_copy_raw        PASS\n");
}

static void test_bufferview_descriptor(void) {
    SNAP_MEMORY_CONFIG cfg = {
        .Type = SNAP_MEMORY_TYPE_PRIMARY_MEMORY,
        .Size = 8192
    };
    SNAP_MEMORY_DESCRIPTOR *desc = NULL;
    Snap_MemoryDescriptor_Create(&cfg, &desc);

    uint8_t data[100];
    for (int i = 0; i < 100; i++) data[i] = (uint8_t)(i + 1);
    Snap_MemoryDescriptor_Write(desc, 0, data, 100);

    SNAP_BUFFERVIEW view;
    assert(SNAP_SUCCEEDED(Snap_BufferView_InitDescriptor(&view, desc)));
    assert(Snap_BufferView_GetSize(&view) == 8192);

    SNAP_MEMORY_SEGMENT seg;
    SNAP_STATUS_PLUS sp = Snap_BufferView_GetSegment(&view, 0, &seg);
    assert(SNAP_SUCCEEDED(sp.StatusCode));
    assert(((uint8_t *)seg.Buffer)[0] == 1);

    Snap_MemoryDescriptor_Destroy(desc);
    printf("  test_bufferview_descriptor      PASS\n");
}

static void test_null_safety(void) {
    Snap_Memory_Copy(NULL, 0, NULL, 0);
    Snap_Memory_Zero(NULL, 0);
    assert(SNAP_FAILED(Snap_BufferView_InitRaw(NULL, NULL, 0)));
    assert(Snap_BufferView_GetSize(NULL) == 0);
    printf("  test_null_safety                PASS\n");
}

int main(void) {
    printf("test_snap_memory\n");
    test_memory_copy();
    test_memory_copy_bounds();
    test_memory_zero();
    test_descriptor_create_destroy();
    test_descriptor_create_invalid();
    test_descriptor_too_large();
    test_descriptor_write_read();
    test_descriptor_cross_page();
    test_descriptor_oob();
    test_segment_basic();
    test_bufferview_raw();
    test_bufferview_slice();
    test_bufferview_slice_oob();
    test_bufferview_copy_raw();
    test_bufferview_descriptor();
    test_null_safety();
    printf("  16/16 passed\n");
    return 0;
}
