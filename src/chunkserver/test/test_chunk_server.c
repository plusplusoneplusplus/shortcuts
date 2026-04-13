/*
 * test_chunk_server.c — Tests for the top-level ChunkServer
 */

#include "../lib/chunk_server.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static SNAP_GUID make_guid(uint8_t fill) {
    SNAP_GUID g;
    memset(g.bytes, fill, sizeof(g.bytes));
    return g;
}

/* Helper: send a PUT through the server */
static SNAP_STATUS send_put(ChunkServer *server, SNAP_GUID *id,
                            const uint8_t *data, uint32_t size) {
    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode    = CHUNK_OP_PUT;
    p->chunk_id  = *id;
    p->data_size = size;
    req.RequestBuffer       = (void *)data;
    req.RequestBufferLength = size;
    return ChunkServer_HandleRequest(server, &req);
}

/* Helper: send a GET through the server */
static SNAP_STATUS send_get(ChunkServer *server, SNAP_GUID *id,
                            uint8_t *buf, uint32_t buf_size,
                            uint32_t *actual_out) {
    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode    = CHUNK_OP_GET;
    p->chunk_id  = *id;
    p->data_size = buf_size;
    req.RequestBuffer       = buf;
    req.RequestBufferLength = buf_size;
    SNAP_STATUS st = ChunkServer_HandleRequest(server, &req);
    if (actual_out) *actual_out = p->actual_size;
    return st;
}

static void test_init_destroy(void) {
    ChunkServer server;
    assert(SNAP_SUCCEEDED(ChunkServer_Init(&server)));
    ChunkServer_Destroy(&server);
    printf("  test_init_destroy               PASS\n");
}

static void test_init_null(void) {
    assert(SNAP_FAILED(ChunkServer_Init(NULL)));
    printf("  test_init_null                  PASS\n");
}

static void test_put_get_roundtrip(void) {
    ChunkServer server;
    ChunkServer_Init(&server);

    SNAP_GUID id = make_guid(0x10);
    uint8_t data[] = "server test data";

    assert(SNAP_SUCCEEDED(send_put(&server, &id, data, sizeof(data))));

    uint8_t buf[64] = {0};
    uint32_t actual = 0;
    assert(SNAP_SUCCEEDED(send_get(&server, &id, buf, sizeof(buf), &actual)));
    assert(actual == sizeof(data));
    assert(memcmp(buf, data, sizeof(data)) == 0);

    ChunkServer_Destroy(&server);
    printf("  test_put_get_roundtrip          PASS\n");
}

static void test_stats_tracking(void) {
    ChunkServer server;
    ChunkServer_Init(&server);

    SNAP_GUID id = make_guid(0x20);
    uint8_t data[] = "stats";
    send_put(&server, &id, data, sizeof(data));

    uint8_t buf[64];
    uint32_t actual = 0;
    send_get(&server, &id, buf, sizeof(buf), &actual);

    /* Try a get that fails */
    SNAP_GUID bad = make_guid(0xFF);
    send_get(&server, &bad, buf, sizeof(buf), &actual);

    ChunkServerStats stats;
    ChunkServer_GetStats(&server, &stats);
    assert(stats.request_count == 3);
    assert(stats.error_count == 1);
    assert(stats.chunk_count == 1);

    ChunkServer_Destroy(&server);
    printf("  test_stats_tracking             PASS\n");
}

static void test_delete_via_request(void) {
    ChunkServer server;
    ChunkServer_Init(&server);

    SNAP_GUID id = make_guid(0x30);
    uint8_t data[] = "remove me";
    send_put(&server, &id, data, sizeof(data));

    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode   = CHUNK_OP_DELETE;
    p->chunk_id = id;
    assert(SNAP_SUCCEEDED(ChunkServer_HandleRequest(&server, &req)));

    ChunkServerStats stats;
    ChunkServer_GetStats(&server, &stats);
    assert(stats.chunk_count == 0);

    ChunkServer_Destroy(&server);
    printf("  test_delete_via_request         PASS\n");
}

static void test_list_via_request(void) {
    ChunkServer server;
    ChunkServer_Init(&server);

    SNAP_GUID a = make_guid(0x01);
    SNAP_GUID b = make_guid(0x02);
    uint8_t data[] = "x";
    send_put(&server, &a, data, 1);
    send_put(&server, &b, data, 1);

    ChunkDescriptor descs[10];
    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode         = CHUNK_OP_LIST;
    p->max_list_count = 10;
    req.RequestBuffer       = descs;
    req.RequestBufferLength = sizeof(descs);

    assert(SNAP_SUCCEEDED(ChunkServer_HandleRequest(&server, &req)));
    assert(p->list_count == 2);

    ChunkServer_Destroy(&server);
    printf("  test_list_via_request           PASS\n");
}

static void test_multiple_chunks(void) {
    ChunkServer server;
    ChunkServer_Init(&server);

    for (int i = 1; i <= 50; i++) {
        SNAP_GUID id = make_guid((uint8_t)i);
        uint8_t data[256];
        memset(data, (uint8_t)i, sizeof(data));
        assert(SNAP_SUCCEEDED(send_put(&server, &id, data, sizeof(data))));
    }

    ChunkServerStats stats;
    ChunkServer_GetStats(&server, &stats);
    assert(stats.chunk_count == 50);

    /* Verify a random one */
    SNAP_GUID id = make_guid(25);
    uint8_t buf[256];
    uint32_t actual = 0;
    assert(SNAP_SUCCEEDED(send_get(&server, &id, buf, sizeof(buf), &actual)));
    assert(actual == 256);
    for (int i = 0; i < 256; i++) assert(buf[i] == 25);

    ChunkServer_Destroy(&server);
    printf("  test_multiple_chunks            PASS\n");
}

static void test_request_lifecycle(void) {
    ChunkServer server;
    ChunkServer_Init(&server);

    SNAP_GUID id = make_guid(0x40);
    uint8_t data[] = "lifecycle";

    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    assert(Snap_Request_GetState(&req) == SNAP_REQUEST_STATE_INITIALIZED);

    ChunkOpParams *p = (ChunkOpParams *)req.Params;
    p->opcode   = CHUNK_OP_PUT;
    p->chunk_id = id;
    p->data_size = sizeof(data);
    req.RequestBuffer       = data;
    req.RequestBufferLength = sizeof(data);

    ChunkServer_HandleRequest(&server, &req);
    assert(Snap_Request_GetState(&req) == SNAP_REQUEST_STATE_COMPLETE);
    assert(SNAP_SUCCEEDED(Snap_Request_GetStatus(&req)));

    ChunkServer_Destroy(&server);
    printf("  test_request_lifecycle          PASS\n");
}

static void test_double_destroy(void) {
    ChunkServer server;
    ChunkServer_Init(&server);
    ChunkServer_Destroy(&server);
    ChunkServer_Destroy(&server);  /* Should not crash */
    printf("  test_double_destroy             PASS\n");
}

static void test_handle_null(void) {
    ChunkServer server;
    ChunkServer_Init(&server);
    assert(SNAP_FAILED(ChunkServer_HandleRequest(&server, NULL)));
    assert(SNAP_FAILED(ChunkServer_HandleRequest(NULL, NULL)));
    ChunkServer_Destroy(&server);
    printf("  test_handle_null                PASS\n");
}

int main(void) {
    printf("test_chunk_server\n");
    test_init_destroy();
    test_init_null();
    test_put_get_roundtrip();
    test_stats_tracking();
    test_delete_via_request();
    test_list_via_request();
    test_multiple_chunks();
    test_request_lifecycle();
    test_double_destroy();
    test_handle_null();
    printf("  10/10 passed\n");
    return 0;
}
