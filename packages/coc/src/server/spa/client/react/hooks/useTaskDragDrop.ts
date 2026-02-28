/**
 * useTaskDragDrop — encapsulates HTML5 drag-and-drop state and logic for the task tree.
 *
 * Provides drag/drop event handler factories, validation (circular move, same-parent,
 * archive exclusion), and state management for visual feedback.
 */

import { useCallback, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

export interface DragItem {
    path: string;
    type: 'file' | 'folder';
    name: string;
}

export const DRAG_MIME_TYPE = 'application/x-task-drag';

// ── Validation ─────────────────────────────────────────────────────────

/**
 * Returns the parent folder path for a given item path.
 * E.g. "a/b/file.md" → "a/b", "file.md" → "", "a" → "".
 */
export function getParentPath(itemPath: string): string {
    const idx = itemPath.lastIndexOf('/');
    return idx === -1 ? '' : itemPath.substring(0, idx);
}

/**
 * Checks whether a drop is valid.
 * Returns false for:
 *   - dropping a folder into itself or a descendant (circular)
 *   - dropping an item into its current parent (no-op)
 *   - dropping into the archive folder
 */
export function canDrop(sources: DragItem[], targetFolderPath: string): boolean {
    if (sources.length === 0) return false;

    const normalizedTarget = targetFolderPath || '';

    // Cannot drop into archive
    if (normalizedTarget === 'archive' || normalizedTarget.startsWith('archive/')) {
        return false;
    }

    for (const source of sources) {
        // Cannot drop into current parent (no-op)
        const parentPath = getParentPath(source.path);
        if (parentPath === normalizedTarget) {
            return false;
        }

        // For folders: cannot drop into self or descendant (circular)
        if (source.type === 'folder') {
            if (normalizedTarget === source.path || normalizedTarget.startsWith(source.path + '/')) {
                return false;
            }
        }
    }

    return true;
}

// ── Serialization ──────────────────────────────────────────────────────

export function serializeDragData(items: DragItem[]): string {
    return JSON.stringify(items);
}

export function deserializeDragData(data: string): DragItem[] {
    try {
        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (item: any) =>
                typeof item.path === 'string' &&
                (item.type === 'file' || item.type === 'folder') &&
                typeof item.name === 'string',
        );
    } catch {
        return [];
    }
}

// ── Hook ───────────────────────────────────────────────────────────────

export interface UseTaskDragDropResult {
    /** The items currently being dragged (empty when not dragging). */
    draggedItems: DragItem[];
    /** The folder path currently hovered as a drop target (null when none). */
    dropTargetPath: string | null;
    /** Whether a drag operation is in progress. */
    isDragging: boolean;

    /** Create onDragStart handler for an item. Pass selected file paths for multi-select support. */
    createDragStartHandler: (
        item: DragItem,
        selectedPaths: Set<string>,
        allItemsResolver: (paths: Set<string>) => DragItem[],
    ) => (e: React.DragEvent) => void;

    /** Create onDragEnd handler to clean up drag state. */
    createDragEndHandler: () => (e: React.DragEvent) => void;

    /** Create onDragOver handler for a drop target folder. */
    createDragOverHandler: (targetFolderPath: string) => (e: React.DragEvent) => void;

    /** Create onDragEnter handler for visual feedback. */
    createDragEnterHandler: (targetFolderPath: string) => (e: React.DragEvent) => void;

    /** Create onDragLeave handler for visual feedback. */
    createDragLeaveHandler: (targetFolderPath: string) => (e: React.DragEvent) => void;

    /** Create onDrop handler for a drop target folder. */
    createDropHandler: (
        targetFolderPath: string,
        onMove: (items: DragItem[], targetFolder: string) => void,
    ) => (e: React.DragEvent) => void;
}

export function useTaskDragDrop(): UseTaskDragDropResult {
    const [draggedItems, setDraggedItems] = useState<DragItem[]>([]);
    const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    // Track drag enter/leave count per target to avoid flicker from child elements
    const enterCountRef = useRef<Map<string, number>>(new Map());

    const createDragStartHandler = useCallback(
        (
            item: DragItem,
            selectedPaths: Set<string>,
            allItemsResolver: (paths: Set<string>) => DragItem[],
        ) =>
            (e: React.DragEvent) => {
                // If the dragged item is part of a multi-selection, include all selected items
                let items: DragItem[];
                if (item.type === 'file' && selectedPaths.has(item.path)) {
                    items = allItemsResolver(selectedPaths);
                    // Ensure the dragged item is included
                    if (!items.some(i => i.path === item.path)) {
                        items = [item, ...items];
                    }
                } else {
                    items = [item];
                }

                const data = serializeDragData(items);
                e.dataTransfer.setData(DRAG_MIME_TYPE, data);
                e.dataTransfer.setData('text/plain', items.map(i => i.path).join('\n'));
                e.dataTransfer.effectAllowed = 'move';

                setDraggedItems(items);
                setIsDragging(true);
            },
        [],
    );

    const createDragEndHandler = useCallback(
        () => (e: React.DragEvent) => {
            e.preventDefault();
            setDraggedItems([]);
            setDropTargetPath(null);
            setIsDragging(false);
            enterCountRef.current.clear();
        },
        [],
    );

    const createDragOverHandler = useCallback(
        (targetFolderPath: string) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Check if we have task drag data
            if (!e.dataTransfer.types.includes(DRAG_MIME_TYPE)) {
                e.dataTransfer.dropEffect = 'none';
                return;
            }

            // We can't read the data during dragover (browser security), so we use
            // the items stored in state. If state is stale, allow the drop and
            // validate on the actual drop event.
            if (draggedItems.length > 0 && !canDrop(draggedItems, targetFolderPath)) {
                e.dataTransfer.dropEffect = 'none';
            } else {
                e.dataTransfer.dropEffect = 'move';
            }
        },
        [draggedItems],
    );

    const createDragEnterHandler = useCallback(
        (targetFolderPath: string) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (!e.dataTransfer.types.includes(DRAG_MIME_TYPE)) return;

            const count = (enterCountRef.current.get(targetFolderPath) ?? 0) + 1;
            enterCountRef.current.set(targetFolderPath, count);

            if (count === 1) {
                setDropTargetPath(targetFolderPath);
            }
        },
        [],
    );

    const createDragLeaveHandler = useCallback(
        (targetFolderPath: string) => (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const count = (enterCountRef.current.get(targetFolderPath) ?? 0) - 1;
            enterCountRef.current.set(targetFolderPath, Math.max(0, count));

            if (count <= 0) {
                enterCountRef.current.delete(targetFolderPath);
                if (dropTargetPath === targetFolderPath) {
                    setDropTargetPath(null);
                }
            }
        },
        [dropTargetPath],
    );

    const createDropHandler = useCallback(
        (
            targetFolderPath: string,
            onMove: (items: DragItem[], targetFolder: string) => void,
        ) =>
            (e: React.DragEvent) => {
                e.preventDefault();
                e.stopPropagation();

                const raw = e.dataTransfer.getData(DRAG_MIME_TYPE);
                const items = deserializeDragData(raw);

                // Clean up state
                setDraggedItems([]);
                setDropTargetPath(null);
                setIsDragging(false);
                enterCountRef.current.clear();

                if (items.length === 0) return;
                if (!canDrop(items, targetFolderPath)) return;

                onMove(items, targetFolderPath);
            },
        [],
    );

    return {
        draggedItems,
        dropTargetPath,
        isDragging,
        createDragStartHandler,
        createDragEndHandler,
        createDragOverHandler,
        createDragEnterHandler,
        createDragLeaveHandler,
        createDropHandler,
    };
}
