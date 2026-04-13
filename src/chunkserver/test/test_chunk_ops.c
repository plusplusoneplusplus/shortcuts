/*
 * test_chunk_ops.c — Tests for the SNAP request dispatcher
 */

#include "../lib/chunk_ops.h"
#include "../lib/snap_posix_channel.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/* ── Fixture ──────────────────────────────────────────────────────── */

typedef struct {
    ChunkStore   store;
    SNAP_CHANNEL channel;
} OpsFixture;

static void fixture_init(OpsFixture *f) {
    ChunkStore_Init(&f->store);
    Snap_Channel_Init(&f->channel, &f->store);
}

static void fixture_destroy(OpsFixture *f) {
    ChunkStore_Destroy(&f->store);
}

static SNAP_GUID make_guid(uint8_t fill) {
    SNAP_GUID g;
    memset(g.bytes, fill, sizeof(g.bytes));
    return g;
}

/* ── Tests ────────────────────────────────────────────────────────── */

static void test_put(void) {
    OpsFixture f;
    fixture_init(&f);

    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode   = CHUNK_OP_PUT;
    p->chunk_id = make_guid(0x10);
    p->data_size = 5;

    uint8_t data[] = "hello";
    req.RequestBuffer       = data;
    req.RequestBufferLength = 5;

    Snap_Request_SendSync(&f.channel, ChunkOps_Dispatch, &req);
    assert(SNAP_SUCCEEDED(Snap_Request_GetStatus(&req)));
    assert(p->checksum != 0);
    assert(ChunkStore_Count(&f.store) == 1);

    fixture_destroy(&f);
    printf("  test_put                        PASS\n");
}

static void test_get(void) {
    OpsFixture f;
    fixture_init(&f);

    /* Pre-load data */
    SNAP_GUID id = make_guid(0x20);
    uint8_t data[] = "world";
    ChunkStore_Put(&f.store, &id, data, 5, NULL);

    /* GET via dispatch */
    uint8_t buf[32] = {0};
    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode    = CHUNK_OP_GET;
    p->chunk_id  = id;
    p->data_size = sizeof(buf);
    req.RequestBuffer       = buf;
    req.RequestBufferLength = sizeof(buf);

    Snap_Request_SendSync(&f.channel, ChunkOps_Dispatch, &req);
    assert(SNAP_SUCCEEDED(Snap_Request_GetStatus(&req)));
    assert(p->actual_size == 5);
    assert(memcmp(buf, "world", 5) == 0);

    fixture_destroy(&f);
    printf("  test_get                        PASS\n");
}

static void test_delete(void) {
    OpsFixture f;
    fixture_init(&f);

    SNAP_GUID id = make_guid(0x30);
    uint8_t data[] = "gone";
    ChunkStore_Put(&f.store, &id, data, 4, NULL);

    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode   = CHUNK_OP_DELETE;
    p->chunk_id = id;

    Snap_Request_SendSync(&f.channel, ChunkOps_Dispatch, &req);
    assert(SNAP_SUCCEEDED(Snap_Request_GetStatus(&req)));
    assert(ChunkStore_Count(&f.store) == 0);

    fixture_destroy(&f);
    printf("  test_delete                     PASS\n");
}

static void test_list(void) {
    OpsFixture f;
    fixture_init(&f);

    SNAP_GUID a = make_guid(0x01);
    SNAP_GUID b = make_guid(0x02);
    uint8_t data[] = "x";
    ChunkStore_Put(&f.store, &a, data, 1, NULL);
    ChunkStore_Put(&f.store, &b, data, 1, NULL);

    ChunkDescriptor descs[10];
    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode         = CHUNK_OP_LIST;
    p->max_list_count = 10;
    req.RequestBuffer       = descs;
    req.RequestBufferLength = sizeof(descs);

    Snap_Request_SendSync(&f.channel, ChunkOps_Dispatch, &req);
    assert(SNAP_SUCCEEDED(Snap_Request_GetStatus(&req)));
    assert(p->list_count == 2);

    fixture_destroy(&f);
    printf("  test_list                       PASS\n");
}

static void test_invalid_opcode(void) {
    OpsFixture f;
    fixture_init(&f);

    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode = 99;

    Snap_Request_SendSync(&f.channel, ChunkOps_Dispatch, &req);
    assert(SNAP_FAILED(Snap_Request_GetStatus(&req)));

    fixture_destroy(&f);
    printf("  test_invalid_opcode             PASS\n");
}

static void test_put_no_data(void) {
    OpsFixture f;
    fixture_init(&f);

    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode   = CHUNK_OP_PUT;
    p->chunk_id = make_guid(0x40);
    p->data_size = 0;
    req.RequestBuffer = NULL;

    Snap_Request_SendSync(&f.channel, ChunkOps_Dispatch, &req);
    assert(SNAP_FAILED(Snap_Request_GetStatus(&req)));

    fixture_destroy(&f);
    printf("  test_put_no_data                PASS\n");
}

static void test_async_path(void) {
    OpsFixture f;
    fixture_init(&f);

    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode   = CHUNK_OP_PUT;
    p->chunk_id = make_guid(0x50);
    p->data_size = 4;

    uint8_t data[] = "asyn";
    req.RequestBuffer       = data;
    req.RequestBufferLength = 4;

    /* Use SendAsync — on POSIX it should still complete synchronously */
    Snap_Request_SendAsync(&f.channel, ChunkOps_Dispatch, &req, NULL);
    assert(SNAP_SUCCEEDED(Snap_Request_GetStatus(&req)));
    assert(Snap_Request_GetState(&req) == SNAP_REQUEST_STATE_COMPLETE);
    assert(ChunkStore_Count(&f.store) == 1);

    fixture_destroy(&f);
    printf("  test_async_path                 PASS\n");
}

int main(void) {
    printf("test_chunk_ops\n");
    test_put();
    test_get();
    test_delete();
    test_list();
    test_invalid_opcode();
    test_put_no_data();
    test_async_path();
    printf("  7/7 passed\n");
    return 0;
}
