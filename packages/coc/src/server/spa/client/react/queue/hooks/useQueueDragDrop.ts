/**
 * useQueueDragDrop — HTML5 drag-and-drop for reordering queued tasks.
 *
 * Follows the same factory-handler pattern as useTaskDragDrop.ts with
 * enter-count ref for flicker prevention and a custom MIME type.
 */

import { useCallback, useRef, useState } from 'react';

export const QUEUE_DRAG_MIME = 'application/x-queue-drag';

export interface UseQueueDragDropResult {
    /** ID of the task currently being dragged (null when idle). */
    draggedTaskId: string | null;
    /** Index of the item currently hovered as a drop target (null when none). */
    dropTargetIndex: number | null;
    /** Whether the drop indicator should appear above or below the target item. */
    dropPosition: 'above' | 'below' | null;

    createDragStartHandler: (taskId: string, index: number) => (e: React.DragEvent) => void;
    createDragEndHandler: () => (e: React.DragEvent) => void;
    createDragOverHandler: (index: number) => (e: React.DragEvent) => void;
    createDragEnterHandler: (index: number) => (e: React.DragEvent) => void;
    createDragLeaveHandler: (index: number) => (e: React.DragEvent) => void;
    createDropHandler: (index: number, onReorder: (taskId: string, newIndex: number) => void) => (e: React.DragEvent) => void;
}

export function useQueueDragDrop(): UseQueueDragDropResult {
    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
    const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
    const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);
    // Track enter/leave count per index to prevent child-element flicker
    const enterCountRef = useRef<Map<number, number>>(new Map());
    // Store dragged index so we can compute target on drop
    const draggedIndexRef = useRef<number>(-1);

    const createDragStartHandler = useCallback(
        (taskId: string, index: number) => (e: React.DragEvent) => {
            e.dataTransfer.setData(QUEUE_DRAG_MIME, taskId);
            e.dataTransfer.effectAllowed = 'move';
            setDraggedTaskId(taskId);
            draggedIndexRef.current = index;
        },
        [],
    );

    const createDragEndHandler = useCallback(
        () => (_e: React.DragEvent) => {
            setDraggedTaskId(null);
            setDropTargetIndex(null);
            setDropPosition(null);
            enterCountRef.current.clear();
            draggedIndexRef.current = -1;
        },
        [],
    );

    const createDragOverHandler = useCallback(
        (index: number) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (!e.dataTransfer.types.includes(QUEUE_DRAG_MIME)) {
                e.dataTransfer.dropEffect = 'none';
                return;
            }

            e.dataTransfer.dropEffect = 'move';

            // Compute above/below based on mouse position relative to element midpoint
            const rect = e.currentTarget.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const pos = e.clientY < midY ? 'above' : 'below';
            setDropTargetIndex(index);
            setDropPosition(pos);
        },
        [],
    );

    const createDragEnterHandler = useCallback(
        (index: number) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (!e.dataTransfer.types.includes(QUEUE_DRAG_MIME)) return;

            const count = (enterCountRef.current.get(index) ?? 0) + 1;
            enterCountRef.current.set(index, count);

            if (count === 1) {
                setDropTargetIndex(index);
            }
        },
        [],
    );

    const createDragLeaveHandler = useCallback(
        (index: number) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const count = (enterCountRef.current.get(index) ?? 0) - 1;
            enterCountRef.current.set(index, Math.max(0, count));

            if (count <= 0) {
                enterCountRef.current.delete(index);
                if (dropTargetIndex === index) {
                    setDropTargetIndex(null);
                    setDropPosition(null);
                }
            }
        },
        [dropTargetIndex],
    );

    const createDropHandler = useCallback(
        (index: number, onReorder: (taskId: string, newIndex: number) => void) =>
            (e: React.DragEvent) => {
                e.preventDefault();
                e.stopPropagation();

                const taskId = e.dataTransfer.getData(QUEUE_DRAG_MIME);

                // Clean up state
                setDraggedTaskId(null);
                setDropTargetIndex(null);
                setDropPosition(null);
                enterCountRef.current.clear();

                if (!taskId) return;

                // Compute target index based on drop position relative to the hovered item
                const rect = e.currentTarget.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const droppedBelow = e.clientY >= midY;
                const srcIndex = draggedIndexRef.current;

                let targetIndex: number;
                if (droppedBelow) {
                    // Dropping below item at `index`
                    targetIndex = srcIndex < index ? index : index + 1;
                } else {
                    // Dropping above item at `index`
                    targetIndex = srcIndex > index ? index : index - 1;
                }
                targetIndex = Math.max(0, targetIndex);

                draggedIndexRef.current = -1;

                if (targetIndex === srcIndex) return;

                onReorder(taskId, targetIndex);
            },
        [],
    );

    return {
        draggedTaskId,
        dropTargetIndex,
        dropPosition,
        createDragStartHandler,
        createDragEndHandler,
        createDragOverHandler,
        createDragEnterHandler,
        createDragLeaveHandler,
        createDropHandler,
    };
}
