/**
 * useQueueTouchDragDrop — touch-based drag-and-drop for reordering queued tasks on mobile.
 *
 * Uses a long-press gesture to initiate drag, then tracks the finger position
 * via document.elementFromPoint to determine drop target. Prevents scrolling
 * only once drag is active (via a non-passive touchmove listener).
 *
 * Drop target elements must carry a `data-queue-index` attribute.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseQueueTouchDragDropResult {
    /** ID of the task currently being dragged (null when idle). */
    draggedTaskId: string | null;
    /** Index of the item currently hovered as a drop target (null when none). */
    dropTargetIndex: number | null;
    /** Whether the drop indicator should appear above or below the target item. */
    dropPosition: 'above' | 'below' | null;

    /** Factory: creates an onTouchStart handler for a draggable queue item. */
    createTouchStartHandler: (
        taskId: string,
        index: number,
        onReorder: (taskId: string, newIndex: number) => void,
    ) => (e: React.TouchEvent) => void;
}

/** Milliseconds the user must hold before drag activates. */
export const LONG_PRESS_DELAY = 300;
/** Pixels the finger can move before the long-press is cancelled. */
export const MOVE_THRESHOLD = 10;

/**
 * Compute the new queue index after a drag-and-drop reorder.
 *
 * Exported for unit testing.
 */
export function computeDropIndex(
    srcIndex: number,
    hoverIndex: number,
    position: 'above' | 'below',
): number {
    let target: number;
    if (position === 'below') {
        target = srcIndex < hoverIndex ? hoverIndex : hoverIndex + 1;
    } else {
        target = srcIndex > hoverIndex ? hoverIndex : hoverIndex - 1;
    }
    return Math.max(0, target);
}

export function useQueueTouchDragDrop(): UseQueueTouchDragDropResult {
    // Render-triggering state for visual feedback
    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
    const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
    const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);

    // Mutable refs — always current inside event handlers
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const touchStartPosRef = useRef({ x: 0, y: 0 });
    const isDraggingRef = useRef(false);
    const draggedInfoRef = useRef({ taskId: '', index: -1 });
    const dropInfoRef = useRef<{ index: number; position: 'above' | 'below' } | null>(null);
    const onReorderRef = useRef<((taskId: string, newIndex: number) => void) | null>(null);
    const listenersRef = useRef<{ move: (e: TouchEvent) => void; end: (e: TouchEvent) => void } | null>(null);

    /** Remove document listeners and reset all state. */
    const cleanup = useCallback(() => {
        clearTimeout(longPressTimerRef.current);
        isDraggingRef.current = false;
        draggedInfoRef.current = { taskId: '', index: -1 };
        dropInfoRef.current = null;
        onReorderRef.current = null;
        setDraggedTaskId(null);
        setDropTargetIndex(null);
        setDropPosition(null);

        if (listenersRef.current) {
            document.removeEventListener('touchmove', listenersRef.current.move);
            document.removeEventListener('touchend', listenersRef.current.end);
            document.removeEventListener('touchcancel', listenersRef.current.end);
            listenersRef.current = null;
        }
    }, []);

    const createTouchStartHandler = useCallback(
        (taskId: string, index: number, onReorder: (taskId: string, newIndex: number) => void) =>
            (e: React.TouchEvent) => {
                // Only handle single-finger touches
                if (e.touches.length !== 1) return;

                const touch = e.touches[0];
                touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
                draggedInfoRef.current = { taskId, index };
                onReorderRef.current = onReorder;

                // Start long-press timer
                longPressTimerRef.current = setTimeout(() => {
                    isDraggingRef.current = true;
                    setDraggedTaskId(taskId);
                }, LONG_PRESS_DELAY);

                // ── Document-level listeners ──

                const removeListeners = () => {
                    if (listenersRef.current) {
                        document.removeEventListener('touchmove', listenersRef.current.move);
                        document.removeEventListener('touchend', listenersRef.current.end);
                        document.removeEventListener('touchcancel', listenersRef.current.end);
                        listenersRef.current = null;
                    }
                };

                const moveHandler = (ev: TouchEvent) => {
                    const t = ev.touches[0];
                    if (!t) return;

                    if (!isDraggingRef.current) {
                        // Before drag activates — cancel if finger moved too far
                        const dx = t.clientX - touchStartPosRef.current.x;
                        const dy = t.clientY - touchStartPosRef.current.y;
                        if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
                            clearTimeout(longPressTimerRef.current);
                            removeListeners();
                        }
                        return;
                    }

                    // Drag is active — prevent scrolling
                    ev.preventDefault();

                    // Hit-test the element under the finger
                    const el = document.elementFromPoint(t.clientX, t.clientY);
                    if (!el) {
                        dropInfoRef.current = null;
                        setDropTargetIndex(null);
                        setDropPosition(null);
                        return;
                    }

                    const itemEl = (el as HTMLElement).closest?.('[data-queue-index]') as HTMLElement | null;
                    if (!itemEl || !itemEl.dataset.queueIndex) {
                        dropInfoRef.current = null;
                        setDropTargetIndex(null);
                        setDropPosition(null);
                        return;
                    }

                    const targetIdx = parseInt(itemEl.dataset.queueIndex, 10);
                    if (isNaN(targetIdx)) return;

                    const rect = itemEl.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const pos: 'above' | 'below' = t.clientY < midY ? 'above' : 'below';

                    dropInfoRef.current = { index: targetIdx, position: pos };
                    setDropTargetIndex(targetIdx);
                    setDropPosition(pos);
                };

                const endHandler = () => {
                    if (isDraggingRef.current && draggedInfoRef.current.taskId) {
                        const srcIndex = draggedInfoRef.current.index;
                        const tid = draggedInfoRef.current.taskId;
                        const drop = dropInfoRef.current;
                        const reorder = onReorderRef.current;

                        cleanup();

                        if (drop && reorder) {
                            const targetIndex = computeDropIndex(srcIndex, drop.index, drop.position);
                            if (targetIndex !== srcIndex) {
                                reorder(tid, targetIndex);
                            }
                        }
                    } else {
                        cleanup();
                    }
                };

                listenersRef.current = { move: moveHandler, end: endHandler };
                document.addEventListener('touchmove', moveHandler, { passive: false });
                document.addEventListener('touchend', endHandler);
                document.addEventListener('touchcancel', endHandler);
            },
        [cleanup],
    );

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            clearTimeout(longPressTimerRef.current);
            if (listenersRef.current) {
                document.removeEventListener('touchmove', listenersRef.current.move);
                document.removeEventListener('touchend', listenersRef.current.end);
                document.removeEventListener('touchcancel', listenersRef.current.end);
            }
        };
    }, []);

    return {
        draggedTaskId,
        dropTargetIndex,
        dropPosition,
        createTouchStartHandler,
    };
}
