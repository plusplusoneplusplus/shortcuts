/**
 * useNotesDragDrop — HTML5 drag-and-drop for the notes sidebar tree.
 *
 * Supports two modes based on where the item is dropped:
 *   - Reorder mode: same-parent drop → changes `.order.json` sibling order.
 *   - Move mode:    cross-parent drop → moves the file/folder to a new parent.
 *
 * Follows the factory-handler pattern established by useTaskDragDrop /
 * useQueueDragDrop (enter-count ref, custom MIME type, above/below indicator).
 */

import { useCallback, useRef, useState } from 'react';
import type { NoteTreeNode } from '../notesApi';

export const NOTE_DRAG_MIME = 'application/x-note-drag';

// ── Types ──────────────────────────────────────────────────────────────

export interface NoteDragItem {
    /** Relative path within the notes root (e.g. "Work/project.md"). */
    path: string;
    /** Basename of the item (last path segment). */
    name: string;
    type: NoteTreeNode['type'];
}

/** Where the drop indicator should appear relative to the hovered item. */
export type DropPosition = 'before' | 'after' | 'inside';

export interface UseNotesDragDropResult {
    /** The item currently being dragged (null when idle). */
    draggedItem: NoteDragItem | null;
    /** Whether a drag operation is active. */
    isDragging: boolean;
    /** Path of the item currently hovered as a drop target (null when none). */
    dropTargetPath: string | null;
    /** Drop position relative to the hovered item. */
    dropPosition: DropPosition | null;

    createDragStartHandler: (item: NoteDragItem) => (e: React.DragEvent) => void;
    createDragEndHandler: () => (e: React.DragEvent) => void;
    createDragOverHandler: (targetItem: NoteDragItem) => (e: React.DragEvent) => void;
    createDragEnterHandler: (targetItem: NoteDragItem) => (e: React.DragEvent) => void;
    createDragLeaveHandler: (targetItem: NoteDragItem) => (e: React.DragEvent) => void;
    createDropHandler: (
        targetItem: NoteDragItem,
        onReorder: (draggedItem: NoteDragItem, targetItem: NoteDragItem, position: DropPosition) => void,
    ) => (e: React.DragEvent) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Return the parent path for a given notes path ("a/b/c" → "a/b", "a" → ""). */
export function getNotesParentPath(itemPath: string): string {
    const idx = itemPath.lastIndexOf('/');
    return idx === -1 ? '' : itemPath.substring(0, idx);
}

/**
 * Determine the drop position based on the pointer Y vs element midpoint
 * and whether the target is a folder (adds 'inside' zone at centre).
 */
function computeDropPosition(e: React.DragEvent, isFolder: boolean): DropPosition {
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const height = rect.height;

    if (isFolder) {
        // Top quarter → before, bottom quarter → after, middle → inside
        if (relY < height * 0.25) return 'before';
        if (relY > height * 0.75) return 'after';
        return 'inside';
    }

    // Pages: just above/below midpoint
    return relY < height / 2 ? 'before' : 'after';
}

/**
 * Validate a potential drop.
 * Returns false for:
 *   - dropping an item onto itself
 *   - dropping a folder into itself or a descendant (circular)
 */
export function canNoteDrop(dragged: NoteDragItem, target: NoteDragItem, position: DropPosition): boolean {
    if (dragged.path === target.path) return false;

    // Folder cannot be dropped inside itself or a descendant
    const isFolder = dragged.type !== 'page';
    if (isFolder && position === 'inside') {
        if (target.path === dragged.path || target.path.startsWith(dragged.path + '/')) {
            return false;
        }
    }

    // Also prevent dropping a folder before/after itself (same path)
    if (isFolder) {
        if (target.path === dragged.path || target.path.startsWith(dragged.path + '/')) {
            return false;
        }
    }

    return true;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useNotesDragDrop(): UseNotesDragDropResult {
    const [draggedItem, setDraggedItem] = useState<NoteDragItem | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
    const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
    const enterCountRef = useRef<Map<string, number>>(new Map());
    const draggedItemRef = useRef<NoteDragItem | null>(null);

    const createDragStartHandler = useCallback(
        (item: NoteDragItem) => (e: React.DragEvent) => {
            e.dataTransfer.setData(NOTE_DRAG_MIME, JSON.stringify(item));
            e.dataTransfer.effectAllowed = 'move';
            setDraggedItem(item);
            setIsDragging(true);
            draggedItemRef.current = item;
        },
        [],
    );

    const createDragEndHandler = useCallback(
        () => (_e: React.DragEvent) => {
            setDraggedItem(null);
            setIsDragging(false);
            setDropTargetPath(null);
            setDropPosition(null);
            enterCountRef.current.clear();
            draggedItemRef.current = null;
        },
        [],
    );

    const createDragOverHandler = useCallback(
        (targetItem: NoteDragItem) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (!e.dataTransfer.types.includes(NOTE_DRAG_MIME)) {
                e.dataTransfer.dropEffect = 'none';
                return;
            }

            const isFolder = targetItem.type !== 'page';
            const pos = computeDropPosition(e, isFolder);

            const current = draggedItemRef.current;
            if (current && !canNoteDrop(current, targetItem, pos)) {
                e.dataTransfer.dropEffect = 'none';
                return;
            }

            e.dataTransfer.dropEffect = 'move';
            setDropTargetPath(targetItem.path);
            setDropPosition(pos);
        },
        [],
    );

    const createDragEnterHandler = useCallback(
        (targetItem: NoteDragItem) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!e.dataTransfer.types.includes(NOTE_DRAG_MIME)) return;

            const count = (enterCountRef.current.get(targetItem.path) ?? 0) + 1;
            enterCountRef.current.set(targetItem.path, count);
            if (count === 1) {
                setDropTargetPath(targetItem.path);
            }
        },
        [],
    );

    const createDragLeaveHandler = useCallback(
        (targetItem: NoteDragItem) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const count = (enterCountRef.current.get(targetItem.path) ?? 0) - 1;
            enterCountRef.current.set(targetItem.path, Math.max(0, count));
            if (count <= 0) {
                enterCountRef.current.delete(targetItem.path);
                if (dropTargetPath === targetItem.path) {
                    setDropTargetPath(null);
                    setDropPosition(null);
                }
            }
        },
        [dropTargetPath],
    );

    const createDropHandler = useCallback(
        (
            targetItem: NoteDragItem,
            onReorder: (draggedItem: NoteDragItem, targetItem: NoteDragItem, position: DropPosition) => void,
        ) =>
            (e: React.DragEvent) => {
                e.preventDefault();
                e.stopPropagation();

                const raw = e.dataTransfer.getData(NOTE_DRAG_MIME);
                let dragged: NoteDragItem;
                try {
                    dragged = JSON.parse(raw);
                } catch {
                    return;
                }

                const isFolder = targetItem.type !== 'page';
                const pos = computeDropPosition(e, isFolder);

                // Clean up
                setDraggedItem(null);
                setIsDragging(false);
                setDropTargetPath(null);
                setDropPosition(null);
                enterCountRef.current.clear();
                draggedItemRef.current = null;

                if (!canNoteDrop(dragged, targetItem, pos)) return;

                onReorder(dragged, targetItem, pos);
            },
        [],
    );

    return {
        draggedItem,
        isDragging,
        dropTargetPath,
        dropPosition,
        createDragStartHandler,
        createDragEndHandler,
        createDragOverHandler,
        createDragEnterHandler,
        createDragLeaveHandler,
        createDropHandler,
    };
}
