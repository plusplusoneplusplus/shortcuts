/*
 * snap_posix.h — SNAP types for POSIX simulation
 *
 * Core types that model the DPU SNAP hardware abstraction:
 *   SNAP_GUID      — 128-bit identifier
 *   SNAP_STATUS     — 32-bit status code (bit 31 = error flag)
 *   SNAP_STATUS_PLUS — Extended status with debug metadata
 */

#ifndef SNAP_POSIX_H
#define SNAP_POSIX_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

/* ── GUID ─────────────────────────────────────────────────────────── */

typedef struct {
    uint8_t bytes[16];
} SNAP_GUID;

static const SNAP_GUID SNAP_GUID_ZERO = {{0}};

static inline int Snap_Guid_IsZero(const SNAP_GUID *guid) {
    return memcmp(guid, &SNAP_GUID_ZERO, sizeof(SNAP_GUID)) == 0;
}

static inline int Snap_Guid_IsEqual(const SNAP_GUID *a, const SNAP_GUID *b) {
    return memcmp(a, b, sizeof(SNAP_GUID)) == 0;
}

/* ── Status codes ─────────────────────────────────────────────────── */

typedef uint32_t SNAP_STATUS;

#define SNAP_STATUS_OK                  ((SNAP_STATUS)0x00000000)
#define SNAP_STATUS_ERROR               ((SNAP_STATUS)0x80000001)
#define SNAP_STATUS_INVALID_ARGUMENT    ((SNAP_STATUS)0x80000002)
#define SNAP_STATUS_NOT_FOUND           ((SNAP_STATUS)0x80000003)
#define SNAP_STATUS_INSUFFICIENT_BUFFER ((SNAP_STATUS)0x80000004)

#define SNAP_SUCCEEDED(s) (((SNAP_STATUS)(s) & 0x80000000) == 0)
#define SNAP_FAILED(s)    (((SNAP_STATUS)(s) & 0x80000000) != 0)

/* ── Extended status ──────────────────────────────────────────────── */

typedef union {
    struct {
        SNAP_STATUS StatusCode;
        uint32_t    LocationInfo;
    };
    uint64_t StatusPlusOpaque;
} SNAP_STATUS_PLUS;

static inline SNAP_STATUS_PLUS Snap_StatusPlus_Create(SNAP_STATUS status) {
    SNAP_STATUS_PLUS sp;
    sp.StatusCode    = status;
    sp.LocationInfo  = 0;
    return sp;
}

static inline int Snap_StatusPlus_IsSet(const SNAP_STATUS_PLUS *sp) {
    return sp->StatusPlusOpaque != 0;
}

#endif /* SNAP_POSIX_H */
