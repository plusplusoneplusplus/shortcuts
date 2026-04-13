/*
 * test_snap_channel.c — Tests for SNAP channel and request lifecycle
 */

#include "../lib/snap_posix_channel.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

/* ── Test dispatcher ──────────────────────────────────────────────── */

static int g_dispatch_called = 0;
static SNAP_STATUS g_dispatch_status = SNAP_STATUS_OK;

static void test_dispatch_fn(SNAP_CHANNEL *ch, SNAP_REQUEST *req) {
    g_dispatch_called = 1;
    Snap_Request_Complete(ch, req, g_dispatch_status);
}

/* ── Completion callback tracker ──────────────────────────────────── */

static int g_complete_called = 0;

static void test_complete_fn(SNAP_CHANNEL *ch, SNAP_REQUEST *req, void *ctx) {
    (void)ch; (void)req; (void)ctx;
    g_complete_called = 1;
}

/* ── Tests ────────────────────────────────────────────────────────── */

static void test_channel_init(void) {
    SNAP_CHANNEL ch;
    int ctx = 42;
    Snap_Channel_Init(&ch, &ctx);
    assert(Snap_Channel_GetContext(&ch) == &ctx);
    assert(ch.PendingRequests == 0);
    assert(ch.CompletedRequests == 0);
    printf("  test_channel_init               PASS\n");
}

static void test_request_init(void) {
    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    assert(Snap_Request_GetState(&req) == SNAP_REQUEST_STATE_INITIALIZED);
    assert(Snap_Request_GetStatus(&req) == SNAP_STATUS_OK);
    assert(req.RequestBuffer == NULL);
    assert(req.RequestBufferLength == 0);
    printf("  test_request_init               PASS\n");
}

static void test_request_init_with_activity(void) {
    SNAP_GUID id;
    memset(id.bytes, 0xAA, sizeof(id.bytes));
    SNAP_REQUEST req;
    Snap_Request_InitWithActivity(&req, &id);
    assert(Snap_Guid_IsEqual(&req.CorrelationId, &id));
    printf("  test_request_init_with_activity PASS\n");
}

static void test_send_sync(void) {
    SNAP_CHANNEL ch;
    Snap_Channel_Init(&ch, NULL);
    SNAP_REQUEST req;
    Snap_Request_Init(&req);

    g_dispatch_called = 0;
    g_dispatch_status = SNAP_STATUS_OK;
    Snap_Request_SendSync(&ch, test_dispatch_fn, &req);

    assert(g_dispatch_called == 1);
    assert(Snap_Request_GetState(&req) == SNAP_REQUEST_STATE_COMPLETE);
    assert(Snap_Request_GetStatus(&req) == SNAP_STATUS_OK);
    assert(ch.PendingRequests == 0);
    assert(ch.CompletedRequests == 1);
    printf("  test_send_sync                  PASS\n");
}

static void test_send_sync_error(void) {
    SNAP_CHANNEL ch;
    Snap_Channel_Init(&ch, NULL);
    SNAP_REQUEST req;
    Snap_Request_Init(&req);

    g_dispatch_called = 0;
    g_dispatch_status = SNAP_STATUS_NOT_FOUND;
    Snap_Request_SendSync(&ch, test_dispatch_fn, &req);

    assert(g_dispatch_called == 1);
    assert(SNAP_FAILED(Snap_Request_GetStatus(&req)));
    printf("  test_send_sync_error            PASS\n");
}

static void test_send_async(void) {
    SNAP_CHANNEL ch;
    Snap_Channel_Init(&ch, NULL);
    SNAP_REQUEST req;
    Snap_Request_Init(&req);

    g_dispatch_called = 0;
    g_complete_called = 0;
    g_dispatch_status = SNAP_STATUS_OK;
    Snap_Request_SendAsync(&ch, test_dispatch_fn, &req, test_complete_fn);

    assert(g_dispatch_called == 1);
    assert(g_complete_called == 1);  /* POSIX: completion fires synchronously */
    assert(Snap_Request_GetState(&req) == SNAP_REQUEST_STATE_COMPLETE);
    printf("  test_send_async                 PASS\n");
}

static void test_params_storage(void) {
    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    /* Write structured data into Params */
    uint32_t opcode = 42;
    memcpy(req.Params, &opcode, sizeof(opcode));
    uint32_t read_back;
    memcpy(&read_back, req.Params, sizeof(read_back));
    assert(read_back == 42);
    printf("  test_params_storage             PASS\n");
}

static void test_request_buffer(void) {
    SNAP_REQUEST req;
    Snap_Request_Init(&req);
    uint8_t data[] = "test data";
    req.RequestBuffer       = data;
    req.RequestBufferLength = sizeof(data);
    assert(req.RequestBuffer == data);
    assert(req.RequestBufferLength == sizeof(data));
    printf("  test_request_buffer             PASS\n");
}

static void test_multiple_requests(void) {
    SNAP_CHANNEL ch;
    Snap_Channel_Init(&ch, NULL);
    g_dispatch_status = SNAP_STATUS_OK;

    for (int i = 0; i < 10; i++) {
        SNAP_REQUEST req;
        Snap_Request_Init(&req);
        Snap_Request_SendSync(&ch, test_dispatch_fn, &req);
    }
    assert(ch.CompletedRequests == 10);
    assert(ch.PendingRequests == 0);
    printf("  test_multiple_requests          PASS\n");
}

static void test_null_safety(void) {
    Snap_Channel_Init(NULL, NULL);
    Snap_Request_Init(NULL);
    Snap_Request_SendSync(NULL, NULL, NULL);
    Snap_Request_Complete(NULL, NULL, SNAP_STATUS_OK);
    assert(Snap_Request_GetState(NULL) == SNAP_REQUEST_STATE_UNSET);
    assert(Snap_Request_GetStatus(NULL) == SNAP_STATUS_ERROR);
    assert(Snap_Channel_GetContext(NULL) == NULL);
    printf("  test_null_safety                PASS\n");
}

int main(void) {
    printf("test_snap_channel\n");
    test_channel_init();
    test_request_init();
    test_request_init_with_activity();
    test_send_sync();
    test_send_sync_error();
    test_send_async();
    test_params_storage();
    test_request_buffer();
    test_multiple_requests();
    test_null_safety();
    printf("  10/10 passed\n");
    return 0;
}
