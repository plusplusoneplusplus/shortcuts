/**
 * useChatFolderDragDrop — the drop-target state machine for filing chats by
 * drag and reordering folders (AC-07).
 *
 * The gesture is the one the list already has: a chat row drag. This hook only
 * adds *targets*. Every handler bails unless the drag advertises a folder MIME,
 * so the queue's reorder drag (which carries `application/x-queue-drag` and
 * nothing else) can never light up a folder row, and a folder drag can never
 * satisfy the queue's reorder handler — that one reads `QUEUE_DRAG_MIME` and
 * returns early when it is absent.
 *
 * Two browser rules shape the code:
 *  - `dataTransfer.getData()` is blocked during `dragover`/`dragenter`; only
 *    `types` is readable. So highlighting is decided from the MIME list plus
 *    this list's own dragstart bookkeeping, and the payload is parsed on `drop`.
 *  - a target that never calls `preventDefault` on `dragover` never receives a
 *    `drop`. Declining is therefore just "do nothing", which leaves the event
 *    intact for whatever target the drag was really meant for.
 */

import { useCallback, useRef, useState } from 'react';
import {
    createChatFolderMoveDragPayload,
    createChatFolderReorderDragPayload,
    dataTransferHasChatFolderMove,
    dataTransferHasChatFolderReorder,
    readChatFolderMoveDragPayload,
    readChatFolderReorderDragPayload,
    resolveFolderDropMoveIds,
    resolveFolderDropTarget,
    writeChatFolderMoveDragData,
    writeChatFolderReorderDragData,
    type ChatFolderDropTarget,
    type ChatFolderDropZone,
} from '../chat-folder-drag';

export interface UseChatFolderDragDropOptions {
    enabled: boolean;
    workspaceId: string | undefined;
    /** `processId -> folderId`, so a drop onto the current folder is a no-op. */
    folderIdByProcess: ReadonlyMap<string, string>;
    /** File (or, with `null`, unfile) rows. Reuses AC-06's assignment hook. */
    moveToFolder: (ids: readonly string[], folderId: string | null) => Promise<void>;
    /** Persist a folder reorder. */
    reorderFolders: (draggedFolderId: string, targetFolderId: string, position: 'above' | 'below') => Promise<void>;
    /** Stop the edge auto-scroll when the gesture ends. */
    onDragFinished?: () => void;
}

export interface UseChatFolderDragDropResult {
    /** The folder currently offering a drop, and what it would do. */
    dropTarget: ChatFolderDropTarget | null;
    /** The folder row being dragged, so it can render at reduced opacity. */
    draggingFolderId: string | null;
    /** True while an unfile drop would land, for the date-bucket highlight. */
    unfiledDropActive: boolean;

    /** Chat-row drag source: writes the move MIME alongside session context. */
    writeChatRowMoveData: (dataTransfer: DataTransfer, processIds: readonly string[]) => boolean;
    /** Folder-row drag source. */
    handleFolderDragStart: (folderId: string, event: React.DragEvent) => void;
    /** Ends any drag started in the list: clears highlights and the scroll timer. */
    handleDragEnd: () => void;

    handleFolderDragOver: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;
    handleFolderDragLeave: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;
    handleFolderDrop: (folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => void;

    /** The date-bucket / unfiled region: dropping here removes from folder. */
    handleUnfiledDragOver: (event: React.DragEvent) => void;
    handleUnfiledDrop: (event: React.DragEvent) => void;
}

export function useChatFolderDragDrop(options: UseChatFolderDragDropOptions): UseChatFolderDragDropResult {
    const { enabled, workspaceId, folderIdByProcess, moveToFolder, reorderFolders, onDragFinished } = options;

    const [dropTarget, setDropTarget] = useState<ChatFolderDropTarget | null>(null);
    const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
    const [unfiledDropActive, setUnfiledDropActive] = useState(false);
    // Membership is read at drop time, not render time — the list refreshes
    // underneath a drag, and a drop must resolve by row id against what is true
    // now, never against an index or a snapshot taken at dragstart.
    const folderIdByProcessRef = useRef(folderIdByProcess);
    folderIdByProcessRef.current = folderIdByProcess;
    // Where the dragged rows currently live. Only known for a drag that started
    // in this list, and only used to suppress a pointless highlight — the drop
    // itself re-derives everything from the payload.
    const sourceFolderIdsRef = useRef<Set<string> | null>(null);

    const clear = useCallback(() => {
        setDropTarget(null);
        setUnfiledDropActive(false);
    }, []);

    const handleDragEnd = useCallback(() => {
        clear();
        setDraggingFolderId(null);
        sourceFolderIdsRef.current = null;
        onDragFinished?.();
    }, [clear, onDragFinished]);

    const writeChatRowMoveData = useCallback((dataTransfer: DataTransfer, processIds: readonly string[]): boolean => {
        if (!enabled) {return false;}
        const payload = createChatFolderMoveDragPayload(workspaceId, processIds);
        if (!payload) {return false;}
        writeChatFolderMoveDragData(dataTransfer, payload);
        const source = new Set<string>();
        for (const id of payload.processIds) {
            source.add(folderIdByProcessRef.current.get(id) ?? '');
        }
        sourceFolderIdsRef.current = source;
        return true;
    }, [enabled, workspaceId]);

    const handleFolderDragStart = useCallback((folderId: string, event: React.DragEvent) => {
        if (!enabled) {return;}
        const payload = createChatFolderReorderDragPayload(workspaceId, folderId);
        if (!payload) {
            event.preventDefault();
            return;
        }
        writeChatFolderReorderDragData(event.dataTransfer, payload);
        setDraggingFolderId(folderId);
    }, [enabled, workspaceId]);

    const resolve = useCallback((folderId: string, zone: ChatFolderDropZone, event: React.DragEvent): ChatFolderDropTarget | null => {
        const currentTarget = event.currentTarget as HTMLElement | null;
        const rect = typeof currentTarget?.getBoundingClientRect === 'function'
            ? currentTarget.getBoundingClientRect()
            : null;
        return resolveFolderDropTarget({
            folderId,
            zone,
            hasMove: dataTransferHasChatFolderMove(event.dataTransfer),
            hasReorder: dataTransferHasChatFolderReorder(event.dataTransfer),
            draggingFolderId,
            sourceFolderIds: sourceFolderIdsRef.current,
            clientY: event.clientY,
            rect,
        });
    }, [draggingFolderId]);

    const handleFolderDragOver = useCallback((folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => {
        if (!enabled) {return;}
        const target = resolve(folderId, zone, event);
        if (!target) {
            // Not a folder drag (a queue reorder, an OS file, a text selection):
            // leave the event entirely alone so its own target still sees it.
            return;
        }
        // preventDefault is what makes the browser fire `drop` here at all.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setUnfiledDropActive(false);
        setDropTarget(prev => (
            prev && prev.folderId === target.folderId && prev.mode === target.mode ? prev : target
        ));
    }, [enabled, resolve]);

    const handleFolderDragLeave = useCallback((folderId: string, _zone: ChatFolderDropZone, _event: React.DragEvent) => {
        if (!enabled) {return;}
        setDropTarget(prev => (prev && prev.folderId === folderId ? null : prev));
    }, [enabled]);

    const handleFolderDrop = useCallback((folderId: string, zone: ChatFolderDropZone, event: React.DragEvent) => {
        if (!enabled) {return;}
        const target = resolve(folderId, zone, event);
        if (!target) {return;}
        event.preventDefault();
        // A folder drop must not bubble into any ancestor target either.
        event.stopPropagation();

        const reorder = readChatFolderReorderDragPayload(event.dataTransfer);
        const move = readChatFolderMoveDragPayload(event.dataTransfer);
        handleDragEnd();

        // Folders are per-workspace: a payload minted by another workspace's
        // list is refused here rather than sent to the server to 400.
        if (reorder && target.mode !== 'into') {
            if (reorder.workspaceId !== workspaceId) {return;}
            void reorderFolders(reorder.folderId, target.folderId, target.mode);
            return;
        }
        if (move && target.mode === 'into') {
            if (move.workspaceId !== workspaceId) {return;}
            const ids = resolveFolderDropMoveIds(move, folderIdByProcessRef.current, target.folderId);
            if (ids.length === 0) {return;}
            void moveToFolder(ids, target.folderId);
        }
    }, [enabled, resolve, handleDragEnd, reorderFolders, moveToFolder, workspaceId]);

    const handleUnfiledDragOver = useCallback((event: React.DragEvent) => {
        if (!enabled) {return;}
        // A folder reorder dropped on a date bucket means nothing — only chats
        // can be unfiled.
        if (!dataTransferHasChatFolderMove(event.dataTransfer) || dataTransferHasChatFolderReorder(event.dataTransfer)) {return;}
        // Every dragged row is already unfiled: nothing to offer.
        const source = sourceFolderIdsRef.current;
        if (source && source.size === 1 && source.has('')) {return;}
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(null);
        setUnfiledDropActive(true);
    }, [enabled]);

    const handleUnfiledDrop = useCallback((event: React.DragEvent) => {
        if (!enabled) {return;}
        const move = readChatFolderMoveDragPayload(event.dataTransfer);
        if (!move || move.workspaceId !== workspaceId) {return;}
        event.preventDefault();
        event.stopPropagation();
        const ids = resolveFolderDropMoveIds(move, folderIdByProcessRef.current, null);
        handleDragEnd();
        if (ids.length === 0) {return;}
        void moveToFolder(ids, null);
    }, [enabled, workspaceId, handleDragEnd, moveToFolder]);

    return {
        dropTarget,
        draggingFolderId,
        unfiledDropActive,
        writeChatRowMoveData,
        handleFolderDragStart,
        handleDragEnd,
        handleFolderDragOver,
        handleFolderDragLeave,
        handleFolderDrop,
        handleUnfiledDragOver,
        handleUnfiledDrop,
    };
}
