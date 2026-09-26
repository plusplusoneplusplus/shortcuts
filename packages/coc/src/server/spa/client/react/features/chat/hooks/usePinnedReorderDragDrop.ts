/**
 * usePinnedReorderDragDrop — drag a pinned entry to a new slot in the Pinned
 * section.
 *
 * Each pinned entry renders inside a wrapper that gets `entryProps(key)`. The
 * wrapper adds no new desktop gesture: a row's own drag (session context,
 * folder move) bubbles its `dragstart` up to the wrapper, which adds the
 * pinned-reorder MIME last. A row that has no drag of its own (a pinned group
 * row with folders off) is dragged through the wrapper, which is `draggable`.
 *
 * Targets only answer drags that carry the pinned MIME *and* started in this
 * list, so folder filing, composer drops and queue reorder never see them, and
 * `getData` is only read on `drop` (it is blocked during `dragover`).
 *
 * Touch devices get a grip: `gripTouchStart(key)` starts a drag at once (no
 * long-press, which already opens the context menu) and the finger is tracked
 * with `elementFromPoint` over `[data-pinned-key]` wrappers.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PinOrderEntry } from '@plusplusoneplusplus/coc-client';
import {
    PINNED_REORDER_DRAG_KIND,
    dataTransferHasPinnedReorder,
    readPinnedReorderDragPayload,
    reorderPinnedEntries,
    resolvePinnedDropPosition,
    writePinnedReorderDragData,
    type PinnedDropPosition,
} from '../pinned-reorder-drag';

export interface PinnedDropTarget {
    key: string;
    position: PinnedDropPosition;
}

export interface UsePinnedReorderDragDropOptions {
    enabled: boolean;
    workspaceId: string | undefined;
    /** Every pinned entry, unfiltered, in display order. */
    fullOrder: readonly PinOrderEntry[];
    onReorder: (entries: PinOrderEntry[]) => void;
    /** Stop the edge auto-scroll when the gesture ends. */
    onDragFinished?: () => void;
}

export interface PinnedEntryProps {
    draggable: boolean;
    onDragStart: (e: React.DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent<HTMLElement>) => void;
    onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
    onDrop: (e: React.DragEvent<HTMLElement>) => void;
    'data-pinned-key': string;
    'data-pinned-drop'?: PinnedDropPosition;
    'data-pinned-dragging'?: 'true';
}

export interface UsePinnedReorderDragDropResult {
    draggedKey: string | null;
    dropTarget: PinnedDropTarget | null;
    /** Spread onto the wrapper of each entry rendered in the Pinned section. */
    entryProps: (key: string, options?: { multiSelected?: boolean }) => PinnedEntryProps | null;
    /** Touch grip: starts a finger drag of `key`. */
    gripTouchStart: (key: string) => (e: React.TouchEvent) => void;
    handleDragEnd: () => void;
}

export function usePinnedReorderDragDrop(options: UsePinnedReorderDragDropOptions): UsePinnedReorderDragDropResult {
    const { enabled, workspaceId, fullOrder, onReorder, onDragFinished } = options;
    const [draggedKey, setDraggedKey] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<PinnedDropTarget | null>(null);
    const [touchActive, setTouchActive] = useState(false);
    // Refs so drop/touch handlers read what is true now, not a render-time snapshot.
    const draggedKeyRef = useRef<string | null>(null);
    const dropTargetRef = useRef<PinnedDropTarget | null>(null);
    const fullOrderRef = useRef(fullOrder);
    fullOrderRef.current = fullOrder;
    const onReorderRef = useRef(onReorder);
    onReorderRef.current = onReorder;

    const updateDropTarget = useCallback((next: PinnedDropTarget | null) => {
        const prev = dropTargetRef.current;
        if (prev?.key === next?.key && prev?.position === next?.position) return;
        dropTargetRef.current = next;
        setDropTarget(next);
    }, []);

    const handleDragEnd = useCallback(() => {
        draggedKeyRef.current = null;
        setDraggedKey(null);
        updateDropTarget(null);
        setTouchActive(false);
        onDragFinished?.();
    }, [updateDropTarget, onDragFinished]);

    const commit = useCallback((target: PinnedDropTarget | null, sourceKey: string | null) => {
        if (!target || !sourceKey) return;
        const next = reorderPinnedEntries(fullOrderRef.current, sourceKey, target.key, target.position);
        if (next) onReorderRef.current(next);
    }, []);

    const entryProps = useCallback((key: string, entryOptions?: { multiSelected?: boolean }): PinnedEntryProps | null => {
        if (!enabled || !workspaceId) return null;
        return {
            draggable: true,
            onDragStart: (e) => {
                // A child row of an expanded group drags itself, not the group.
                const origin = e.target as Element | null;
                if (entryOptions?.multiSelected || origin?.closest?.('[data-group-child="true"]')) return;
                writePinnedReorderDragData(e.dataTransfer, { kind: PINNED_REORDER_DRAG_KIND, workspaceId, key });
                draggedKeyRef.current = key;
                setDraggedKey(key);
            },
            onDragEnd: handleDragEnd,
            onDragOver: (e) => {
                if (!draggedKeyRef.current || !dataTransferHasPinnedReorder(e.dataTransfer)) return;
                e.preventDefault();
                // Claim the event so an enclosing "unfile" region doesn't also light up.
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                updateDropTarget({ key, position: resolvePinnedDropPosition(e.clientY, rect) });
            },
            onDragLeave: (e) => {
                const related = e.relatedTarget as Node | null;
                if (related && e.currentTarget.contains(related)) return;
                if (dropTargetRef.current?.key === key) updateDropTarget(null);
            },
            onDrop: (e) => {
                if (!draggedKeyRef.current || !dataTransferHasPinnedReorder(e.dataTransfer)) return;
                e.preventDefault();
                e.stopPropagation();
                const payload = readPinnedReorderDragPayload(e.dataTransfer);
                const target = dropTargetRef.current?.key === key
                    ? dropTargetRef.current
                    : { key, position: resolvePinnedDropPosition(e.clientY, e.currentTarget.getBoundingClientRect()) };
                if (payload && payload.workspaceId === workspaceId) commit(target, payload.key);
                handleDragEnd();
            },
            'data-pinned-key': key,
            'data-pinned-drop': dropTarget?.key === key ? dropTarget.position : undefined,
            'data-pinned-dragging': draggedKey === key ? 'true' : undefined,
        };
    }, [enabled, workspaceId, handleDragEnd, updateDropTarget, commit, dropTarget, draggedKey]);

    const gripTouchStart = useCallback((key: string) => (e: React.TouchEvent) => {
        if (!enabled) return;
        // Keep the row's long-press (context menu) and swipe out of it.
        e.stopPropagation();
        draggedKeyRef.current = key;
        setDraggedKey(key);
        setTouchActive(true);
    }, [enabled]);

    useEffect(() => {
        if (!touchActive) return undefined;
        const handleMove = (event: TouchEvent) => {
            const touch = event.touches[0];
            if (!touch) return;
            event.preventDefault();
            const hit = document.elementFromPoint(touch.clientX, touch.clientY) as Element | null;
            const row = hit?.closest?.('[data-pinned-key]') as HTMLElement | null;
            const key = row?.getAttribute('data-pinned-key');
            if (!row || !key) {
                updateDropTarget(null);
                return;
            }
            updateDropTarget({ key, position: resolvePinnedDropPosition(touch.clientY, row.getBoundingClientRect()) });
        };
        const handleEnd = () => {
            commit(dropTargetRef.current, draggedKeyRef.current);
            handleDragEnd();
        };
        document.addEventListener('touchmove', handleMove, { passive: false });
        document.addEventListener('touchend', handleEnd);
        document.addEventListener('touchcancel', handleDragEnd);
        return () => {
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('touchend', handleEnd);
            document.removeEventListener('touchcancel', handleDragEnd);
        };
    }, [touchActive, updateDropTarget, commit, handleDragEnd]);

    return { draggedKey, dropTarget, entryProps, gripTouchStart, handleDragEnd };
}
