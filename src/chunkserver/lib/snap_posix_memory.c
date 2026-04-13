/*
 * snap_posix_memory.c — POSIX implementation of SNAP memory primitives
 *
 * Uses posix_memalign for page-aligned allocations.  The descriptor
 * models a scatter/gather list; the BufferView unifies raw and paged
 * access behind a single abstraction.
 */

#define _POSIX_C_SOURCE 200112L
#include "snap_posix_memory.h"
#include <stdlib.h>
#include <string.h>

/* ── Primitive helpers ────────────────────────────────────────────── */

void Snap_Memory_Copy(void *Destination, size_t DestinationSize,
                      const void *Source, size_t CopySize) {
    if (!Destination || !Source) return;
    size_t n = CopySize < DestinationSize ? CopySize : DestinationSize;
    memcpy(Destination, Source, n);
}

void Snap_Memory_Zero(void *Buffer, size_t Size) {
    if (!Buffer) return;
    memset(Buffer, 0, Size);
}

/* ── Descriptor ───────────────────────────────────────────────────── */

SNAP_STATUS Snap_MemoryDescriptor_Create(const SNAP_MEMORY_CONFIG *Config,
                                         SNAP_MEMORY_DESCRIPTOR **Descriptor) {
    if (!Config || !Descriptor || Config->Size == 0)
        return SNAP_STATUS_INVALID_ARGUMENT;

    uint32_t pages = (uint32_t)((Config->Size + SNAP_PAGE_SIZE - 1) / SNAP_PAGE_SIZE);
    if (pages > SNAP_MAX_DESCRIPTOR_PAGES)
        return SNAP_STATUS_INSUFFICIENT_BUFFER;

    SNAP_MEMORY_DESCRIPTOR *desc = calloc(1, sizeof(*desc));
    if (!desc) return SNAP_STATUS_ERROR;

    desc->Type      = Config->Type;
    desc->TotalSize = Config->Size;
    desc->PageCount = pages;

    size_t alignment = Config->Alignment ? Config->Alignment : 16;
    for (uint32_t i = 0; i < pages; i++) {
        void *page = NULL;
        if (posix_memalign(&page, alignment, SNAP_PAGE_SIZE) != 0) {
            /* Roll back */
            for (uint32_t j = 0; j < i; j++) free(desc->Pages[j]);
            free(desc);
            return SNAP_STATUS_ERROR;
        }
        memset(page, 0, SNAP_PAGE_SIZE);
        desc->Pages[i] = page;
    }

    *Descriptor = desc;
    return SNAP_STATUS_OK;
}

void Snap_MemoryDescriptor_Destroy(SNAP_MEMORY_DESCRIPTOR *Descriptor) {
    if (!Descriptor) return;
    for (uint32_t i = 0; i < Descriptor->PageCount; i++)
        free(Descriptor->Pages[i]);
    free(Descriptor);
}

SNAP_STATUS_PLUS Snap_MemoryDescriptor_GetMemorySegment(
        const SNAP_MEMORY_DESCRIPTOR *Descriptor,
        size_t Offset,
        SNAP_MEMORY_SEGMENT *Segment) {
    SNAP_STATUS_PLUS sp = Snap_StatusPlus_Create(SNAP_STATUS_OK);
    if (!Descriptor || !Segment || Offset >= Descriptor->TotalSize) {
        sp.StatusCode = SNAP_STATUS_INVALID_ARGUMENT;
        return sp;
    }

    uint32_t page_idx    = (uint32_t)(Offset / SNAP_PAGE_SIZE);
    size_t   page_offset = Offset % SNAP_PAGE_SIZE;
    size_t   remaining   = SNAP_PAGE_SIZE - page_offset;

    /* Clamp to total size */
    if (Offset + remaining > Descriptor->TotalSize)
        remaining = Descriptor->TotalSize - Offset;

    Segment->Buffer     = (uint8_t *)Descriptor->Pages[page_idx] + page_offset;
    Segment->BufferSize = remaining;
    return sp;
}

SNAP_STATUS Snap_MemoryDescriptor_Write(SNAP_MEMORY_DESCRIPTOR *Descriptor,
                                        size_t Offset,
                                        const void *Data, size_t Size) {
    if (!Descriptor || !Data)
        return SNAP_STATUS_INVALID_ARGUMENT;
    if (Offset + Size > Descriptor->TotalSize)
        return SNAP_STATUS_INSUFFICIENT_BUFFER;

    size_t written = 0;
    while (written < Size) {
        SNAP_MEMORY_SEGMENT seg;
        SNAP_STATUS_PLUS sp =
            Snap_MemoryDescriptor_GetMemorySegment(Descriptor,
                                                   Offset + written, &seg);
        if (SNAP_FAILED(sp.StatusCode)) return sp.StatusCode;

        size_t chunk = Size - written;
        if (chunk > seg.BufferSize) chunk = seg.BufferSize;
        memcpy(seg.Buffer, (const uint8_t *)Data + written, chunk);
        written += chunk;
    }
    return SNAP_STATUS_OK;
}

SNAP_STATUS Snap_MemoryDescriptor_Read(const SNAP_MEMORY_DESCRIPTOR *Descriptor,
                                       size_t Offset,
                                       void *Buffer, size_t Size) {
    if (!Descriptor || !Buffer)
        return SNAP_STATUS_INVALID_ARGUMENT;
    if (Offset + Size > Descriptor->TotalSize)
        return SNAP_STATUS_INSUFFICIENT_BUFFER;

    size_t done = 0;
    while (done < Size) {
        SNAP_MEMORY_SEGMENT seg;
        SNAP_STATUS_PLUS sp =
            Snap_MemoryDescriptor_GetMemorySegment(Descriptor,
                                                   Offset + done, &seg);
        if (SNAP_FAILED(sp.StatusCode)) return sp.StatusCode;

        size_t chunk = Size - done;
        if (chunk > seg.BufferSize) chunk = seg.BufferSize;
        memcpy((uint8_t *)Buffer + done, seg.Buffer, chunk);
        done += chunk;
    }
    return SNAP_STATUS_OK;
}

/* ── BufferView ───────────────────────────────────────────────────── */

SNAP_STATUS Snap_BufferView_InitRaw(SNAP_BUFFERVIEW *View,
                                    void *Buffer, size_t Size) {
    if (!View || !Buffer) return SNAP_STATUS_INVALID_ARGUMENT;
    View->Type       = SNAP_BUFFERVIEW_TYPE_RAW;
    View->Offset     = 0;
    View->Size       = Size;
    View->Raw.Buffer = Buffer;
    return SNAP_STATUS_OK;
}

SNAP_STATUS Snap_BufferView_InitDescriptor(SNAP_BUFFERVIEW *View,
                                           SNAP_MEMORY_DESCRIPTOR *Descriptor) {
    if (!View || !Descriptor) return SNAP_STATUS_INVALID_ARGUMENT;
    View->Type            = SNAP_BUFFERVIEW_TYPE_DESCRIPTOR;
    View->Offset          = 0;
    View->Size            = Descriptor->TotalSize;
    View->Desc.Descriptor = Descriptor;
    return SNAP_STATUS_OK;
}

SNAP_STATUS Snap_BufferView_Slice(const SNAP_BUFFERVIEW *BaseView,
                                  size_t Offset, size_t Size,
                                  SNAP_BUFFERVIEW *SliceView) {
    if (!BaseView || !SliceView) return SNAP_STATUS_INVALID_ARGUMENT;
    if (Offset + Size > BaseView->Size) return SNAP_STATUS_INSUFFICIENT_BUFFER;

    *SliceView        = *BaseView;
    SliceView->Offset = BaseView->Offset + Offset;
    SliceView->Size   = Size;
    return SNAP_STATUS_OK;
}

size_t Snap_BufferView_GetSize(const SNAP_BUFFERVIEW *View) {
    return View ? View->Size : 0;
}

SNAP_STATUS_PLUS Snap_BufferView_GetSegment(const SNAP_BUFFERVIEW *View,
                                            size_t Offset,
                                            SNAP_MEMORY_SEGMENT *Segment) {
    SNAP_STATUS_PLUS sp = Snap_StatusPlus_Create(SNAP_STATUS_OK);
    if (!View || !Segment || Offset >= View->Size) {
        sp.StatusCode = SNAP_STATUS_INVALID_ARGUMENT;
        return sp;
    }

    if (View->Type == SNAP_BUFFERVIEW_TYPE_RAW) {
        Segment->Buffer     = (uint8_t *)View->Raw.Buffer + View->Offset + Offset;
        Segment->BufferSize = View->Size - Offset;
        return sp;
    }

    /* Descriptor path */
    sp = Snap_MemoryDescriptor_GetMemorySegment(
             View->Desc.Descriptor, View->Offset + Offset, Segment);
    if (SNAP_SUCCEEDED(sp.StatusCode)) {
        size_t remaining = View->Size - Offset;
        if (Segment->BufferSize > remaining)
            Segment->BufferSize = remaining;
    }
    return sp;
}

SNAP_STATUS Snap_BufferView_Copy(SNAP_BUFFERVIEW *Destination,
                                 const SNAP_BUFFERVIEW *Source) {
    if (!Destination || !Source) return SNAP_STATUS_INVALID_ARGUMENT;
    if (Source->Size > Destination->Size) return SNAP_STATUS_INSUFFICIENT_BUFFER;

    size_t copied = 0;
    while (copied < Source->Size) {
        SNAP_MEMORY_SEGMENT src_seg;
        SNAP_STATUS_PLUS sp = Snap_BufferView_GetSegment(Source, copied, &src_seg);
        if (SNAP_FAILED(sp.StatusCode)) return sp.StatusCode;

        size_t to_copy = Source->Size - copied;
        if (to_copy > src_seg.BufferSize) to_copy = src_seg.BufferSize;

        /* Write into destination segment by segment */
        size_t written = 0;
        while (written < to_copy) {
            SNAP_MEMORY_SEGMENT dst_seg;
            sp = Snap_BufferView_GetSegment(Destination,
                                            copied + written, &dst_seg);
            if (SNAP_FAILED(sp.StatusCode)) return sp.StatusCode;

            size_t n = to_copy - written;
            if (n > dst_seg.BufferSize) n = dst_seg.BufferSize;
            memcpy(dst_seg.Buffer, (uint8_t *)src_seg.Buffer + written, n);
            written += n;
        }
        copied += to_copy;
    }
    return SNAP_STATUS_OK;
}
