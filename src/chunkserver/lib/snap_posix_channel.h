/*
 * snap_posix_channel.h — SNAP channel and request types (POSIX shim)
 *
 * A SNAP_CHANNEL carries requests between an application and a dispatcher.
 * A SNAP_REQUEST holds opcode params in Params[128] plus a data buffer.
 * On POSIX the "async" path is synchronous (direct function call).
 */

#ifndef SNAP_POSIX_CHANNEL_H
#define SNAP_POSIX_CHANNEL_H

#include "snap_posix.h"

/* Forward declarations */
typedef struct _SNAP_CHANNEL SNAP_CHANNEL;
typedef struct _SNAP_REQUEST SNAP_REQUEST;

/* ── Function-pointer types ───────────────────────────────────────── */

typedef void (SNAP_DISPATCH_FN)(SNAP_CHANNEL *Channel, SNAP_REQUEST *Request);
typedef void (SNAP_REQUEST_COMPLETION_FN)(SNAP_CHANNEL *Channel,
                                         SNAP_REQUEST *Request,
                                         void *Context);

/* ── Request debug state ──────────────────────────────────────────── */

typedef enum {
    SNAP_REQUEST_STATE_UNSET = 0,
    SNAP_REQUEST_STATE_INITIALIZED,
    SNAP_REQUEST_STATE_SENT,
    SNAP_REQUEST_STATE_PROCESSING,
    SNAP_REQUEST_STATE_COMPLETE,
} SnapRequestDebugState;

/* ── SNAP_CHANNEL ─────────────────────────────────────────────────── */

struct _SNAP_CHANNEL {
    void     *UserContext;
    uint32_t  PendingRequests;
    uint32_t  CompletedRequests;
};

/* ── SNAP_REQUEST ─────────────────────────────────────────────────── */

struct _SNAP_REQUEST {
    /* Public fields */
    SNAP_STATUS_PLUS  RequestStatus;
    SNAP_GUID         CorrelationId;
    void             *RequestBuffer;
    size_t            RequestBufferLength;
    void             *CallerContext;
    uint8_t           Params[128];

    /* Private fields */
    struct {
        SNAP_DISPATCH_FN           *DispatchFn;
        SNAP_REQUEST_COMPLETION_FN *CompletionFn;
        void                       *CompletionContext;
        SnapRequestDebugState       DebugState;
    } Private;
};

/* ── Channel API ──────────────────────────────────────────────────── */

void  Snap_Channel_Init(SNAP_CHANNEL *Channel, void *UserContext);
void *Snap_Channel_GetContext(const SNAP_CHANNEL *Channel);

/* ── Request API ──────────────────────────────────────────────────── */

void Snap_Request_Init(SNAP_REQUEST *Request);
void Snap_Request_InitWithActivity(SNAP_REQUEST *Request,
                                   const SNAP_GUID *ActivityId);

void Snap_Request_SendSync(SNAP_CHANNEL *Channel,
                           SNAP_DISPATCH_FN *StartFunction,
                           SNAP_REQUEST *Request);

void Snap_Request_SendAsync(SNAP_CHANNEL *Channel,
                            SNAP_DISPATCH_FN *StartFunction,
                            SNAP_REQUEST *Request,
                            SNAP_REQUEST_COMPLETION_FN *CompleteFunction);

void Snap_Request_Complete(SNAP_CHANNEL *Channel,
                           SNAP_REQUEST *Request,
                           SNAP_STATUS Status);

SnapRequestDebugState Snap_Request_GetState(const SNAP_REQUEST *Request);
SNAP_STATUS           Snap_Request_GetStatus(const SNAP_REQUEST *Request);

#endif /* SNAP_POSIX_CHANNEL_H */
