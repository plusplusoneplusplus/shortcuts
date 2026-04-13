/*
 * snap_posix_channel.c — POSIX implementation of SNAP channel / request
 *
 * In the POSIX shim the "async" dispatch path is still synchronous:
 * SendSync and SendAsync both call the dispatcher directly, matching
 * the real DPU model where the caller blocks until completion.
 */

#include "snap_posix_channel.h"
#include <string.h>

/* ── Channel ──────────────────────────────────────────────────────── */

void Snap_Channel_Init(SNAP_CHANNEL *Channel, void *UserContext) {
    if (!Channel) return;
    memset(Channel, 0, sizeof(*Channel));
    Channel->UserContext = UserContext;
}

void *Snap_Channel_GetContext(const SNAP_CHANNEL *Channel) {
    if (!Channel) return NULL;
    return Channel->UserContext;
}

/* ── Request init ─────────────────────────────────────────────────── */

void Snap_Request_Init(SNAP_REQUEST *Request) {
    if (!Request) return;
    memset(Request, 0, sizeof(*Request));
    Request->Private.DebugState = SNAP_REQUEST_STATE_INITIALIZED;
    Request->RequestStatus = Snap_StatusPlus_Create(SNAP_STATUS_OK);
}

void Snap_Request_InitWithActivity(SNAP_REQUEST *Request,
                                   const SNAP_GUID *ActivityId) {
    Snap_Request_Init(Request);
    if (Request && ActivityId) {
        Request->CorrelationId = *ActivityId;
    }
}

/* ── Send ─────────────────────────────────────────────────────────── */

void Snap_Request_SendSync(SNAP_CHANNEL *Channel,
                           SNAP_DISPATCH_FN *StartFunction,
                           SNAP_REQUEST *Request) {
    if (!Channel || !StartFunction || !Request) return;

    Request->Private.DispatchFn       = StartFunction;
    Request->Private.CompletionFn     = NULL;
    Request->Private.CompletionContext = NULL;
    Request->Private.DebugState       = SNAP_REQUEST_STATE_SENT;

    Channel->PendingRequests++;

    /* POSIX: synchronous dispatch — direct call */
    StartFunction(Channel, Request);
}

void Snap_Request_SendAsync(SNAP_CHANNEL *Channel,
                            SNAP_DISPATCH_FN *StartFunction,
                            SNAP_REQUEST *Request,
                            SNAP_REQUEST_COMPLETION_FN *CompleteFunction) {
    if (!Channel || !StartFunction || !Request) return;

    Request->Private.DispatchFn       = StartFunction;
    Request->Private.CompletionFn     = CompleteFunction;
    Request->Private.CompletionContext = NULL;
    Request->Private.DebugState       = SNAP_REQUEST_STATE_SENT;

    Channel->PendingRequests++;

    /* POSIX: still synchronous — call dispatcher directly */
    StartFunction(Channel, Request);
}

/* ── Complete ─────────────────────────────────────────────────────── */

void Snap_Request_Complete(SNAP_CHANNEL *Channel,
                           SNAP_REQUEST *Request,
                           SNAP_STATUS Status) {
    if (!Channel || !Request) return;

    Request->RequestStatus = Snap_StatusPlus_Create(Status);
    Request->Private.DebugState = SNAP_REQUEST_STATE_COMPLETE;

    if (Channel->PendingRequests > 0)
        Channel->PendingRequests--;
    Channel->CompletedRequests++;

    /* Fire legacy completion callback if set (async path) */
    if (Request->Private.CompletionFn) {
        Request->Private.CompletionFn(Channel, Request,
                                      Request->Private.CompletionContext);
    }
}

/* ── Accessors ────────────────────────────────────────────────────── */

SnapRequestDebugState Snap_Request_GetState(const SNAP_REQUEST *Request) {
    if (!Request) return SNAP_REQUEST_STATE_UNSET;
    return Request->Private.DebugState;
}

SNAP_STATUS Snap_Request_GetStatus(const SNAP_REQUEST *Request) {
    if (!Request) return SNAP_STATUS_ERROR;
    return Request->RequestStatus.StatusCode;
}
