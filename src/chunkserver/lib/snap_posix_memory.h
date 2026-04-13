/*
 * snap_posix_memory.h — SNAP page-based memory management (POSIX shim)
 *
 * Provides page-aligned memory descriptors, segment iteration,
 * and a unified BufferView abstraction over raw and paged memory.
 */

#ifndef SNAP_POSIX_MEMORY_H
#define SNAP_POSIX_MEMORY_H

#include "snap_posix.h"

#define SNAP_PAGE_SIZE            4096U
#define SNAP_MAX_DESCRIPTOR_PAGES 256

/* ── Memory types ─────────────────────────────────────────────────── */

typedef enum {
    SNAP_MEMORY_TYPE_PRIMARY_IO_BUFFER = 100,
    SNAP_MEMORY_TYPE_PRIMARY_MEMORY,
    SNAP_MEMORY_TYPE_SECONDARY_IO_BUFFER,
    SNAP_MEMORY_TYPE_SECONDARY_MEMORY,
} SNAP_MEMORY_TYPE;

/* ── Config ───────────────────────────────────────────────────────── */

typedef struct {
    SNAP_MEMORY_TYPE Type;
    size_t           Size;
    size_t           Alignment;   /* 0 = default (16 bytes) */
} SNAP_MEMORY_CONFIG;

/* ── Segment (contiguous span ≤ 1 page) ──────────────────────────── */

typedef struct {
    void   *Buffer;
    size_t  BufferSize;
} SNAP_MEMORY_SEGMENT;

/* ── Descriptor (page-based scatter/gather) ───────────────────────── */

typedef struct {
    SNAP_MEMORY_TYPE Type;
    size_t           TotalSize;
    uint32_t         PageCount;
    void            *Pages[SNAP_MAX_DESCRIPTOR_PAGES];
} SNAP_MEMORY_DESCRIPTOR;

/* ── BufferView (raw or descriptor, with offset/size window) ──────── */

typedef enum {
    SNAP_BUFFERVIEW_TYPE_RAW        = 1,
    SNAP_BUFFERVIEW_TYPE_DESCRIPTOR = 2,
} SnapBufferViewType;

typedef struct {
    SnapBufferViewType Type;
    size_t             Offset;
    size_t             Size;
    union {
        struct { void *Buffer; }                    Raw;
        struct { SNAP_MEMORY_DESCRIPTOR *Descriptor; } Desc;
    };
} SNAP_BUFFERVIEW;

/* ── Primitive helpers ────────────────────────────────────────────── */

void Snap_Memory_Copy(void *Destination, size_t DestinationSize,
                      const void *Source, size_t CopySize);
void Snap_Memory_Zero(void *Buffer, size_t Size);

/* ── Descriptor API ───────────────────────────────────────────────── */

SNAP_STATUS      Snap_MemoryDescriptor_Create(const SNAP_MEMORY_CONFIG *Config,
                                              SNAP_MEMORY_DESCRIPTOR **Descriptor);
void             Snap_MemoryDescriptor_Destroy(SNAP_MEMORY_DESCRIPTOR *Descriptor);
SNAP_STATUS_PLUS Snap_MemoryDescriptor_GetMemorySegment(
                     const SNAP_MEMORY_DESCRIPTOR *Descriptor,
                     size_t Offset,
                     SNAP_MEMORY_SEGMENT *Segment);
SNAP_STATUS      Snap_MemoryDescriptor_Write(SNAP_MEMORY_DESCRIPTOR *Descriptor,
                                             size_t Offset,
                                             const void *Data, size_t Size);
SNAP_STATUS      Snap_MemoryDescriptor_Read(const SNAP_MEMORY_DESCRIPTOR *Descriptor,
                                            size_t Offset,
                                            void *Buffer, size_t Size);

/* ── BufferView API ───────────────────────────────────────────────── */

SNAP_STATUS      Snap_BufferView_InitRaw(SNAP_BUFFERVIEW *View,
                                         void *Buffer, size_t Size);
SNAP_STATUS      Snap_BufferView_InitDescriptor(SNAP_BUFFERVIEW *View,
                                                SNAP_MEMORY_DESCRIPTOR *Descriptor);
SNAP_STATUS      Snap_BufferView_Slice(const SNAP_BUFFERVIEW *BaseView,
                                       size_t Offset, size_t Size,
                                       SNAP_BUFFERVIEW *SliceView);
size_t           Snap_BufferView_GetSize(const SNAP_BUFFERVIEW *View);
SNAP_STATUS_PLUS Snap_BufferView_GetSegment(const SNAP_BUFFERVIEW *View,
                                            size_t Offset,
                                            SNAP_MEMORY_SEGMENT *Segment);
SNAP_STATUS      Snap_BufferView_Copy(SNAP_BUFFERVIEW *Destination,
                                      const SNAP_BUFFERVIEW *Source);

#endif /* SNAP_POSIX_MEMORY_H */
