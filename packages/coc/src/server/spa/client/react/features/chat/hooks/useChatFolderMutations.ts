/**
 * useChatFolderMutations — create / rename / recolor / delete for chat folders,
 * plus the single-level undo that backs a delete (AC-05).
 *
 * All of the inline-editing state (which folder is being renamed, whether the
 * create row is open, which delete is awaiting confirmation) lives here rather
 * than in the 4600-line list renderer, and every list transform is a pure
 * function from `chat-folder-mutations`.
 *
 * Mutations are optimistic and reconciled by `refresh()` — there are no
 * dedicated WebSocket events for folder changes, by decision.
 */
import { useCallback, useRef, useState } from 'react';
import type { ChatFolder, ChatFolderColor } from '@plusplusoneplusplus/coc-client';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import {
    applyFolderPatch,
    collectFolderMemberIds,
    insertFolderAtTop,
    removeFolderFromList,
    type DeletedChatFolderSnapshot,
} from '../chat-folder-mutations';
import { diffFolderSortIndexes, reorderChatFolders } from '../chat-folder-drag';

/** A delete waiting on the confirm dialog. Only non-empty folders get one. */
export interface PendingChatFolderDelete {
    folder: ChatFolder;
    /** Process ids filed in the folder right now — the confirm names the count. */
    memberIds: string[];
}

export interface UseChatFolderMutationsOptions {
    workspaceId: string | undefined;
    setFolders: React.Dispatch<React.SetStateAction<ChatFolder[]>>;
    /** Re-fetch from the server, discarding optimistic state. */
    refresh: () => void;
    /** `processId -> folderId`, used to snapshot membership before a delete. */
    folderIdByProcess: ReadonlyMap<string, string>;
    /** The folder list as rendered, read at drop time by `reorderFolders`. */
    folders: readonly ChatFolder[];
    /**
     * Patch the membership map so an optimistic membership change is
     * visible before the next summaries fetch lands.
     */
    onProcessFoldersChanged?: (processIds: string[], folderId: string | null) => void;
    /** Surfaces failures; the list itself never blanks on an error. */
    onError?: (message: string) => void;
}

export interface UseChatFolderMutationsResult {
    /** True while the inline create row is open. */
    creating: boolean;
    startCreate: () => void;
    cancelCreate: () => void;
    commitCreate: (name: string, color: ChatFolderColor) => Promise<ChatFolder | null>;

    renamingFolderId: string | null;
    startRename: (folderId: string) => void;
    cancelRename: () => void;
    commitRename: (folderId: string, name: string) => Promise<void>;

    recolorFolder: (folderId: string, color: ChatFolderColor) => Promise<void>;

    /**
     * Manual folder order, driven by dragging a folder row between folders
     * (AC-07). A drop that would not change the order issues no request.
     */
    reorderFolders: (draggedFolderId: string, targetFolderId: string, position: 'above' | 'below') => Promise<void>;

    /** Opens the confirm dialog for a non-empty folder; deletes an empty one outright. */
    requestDelete: (folderId: string, folders: readonly ChatFolder[]) => void;
    pendingDelete: PendingChatFolderDelete | null;
    cancelDelete: () => void;
    confirmDelete: () => Promise<void>;

    /** The most recent deletion, restorable exactly once. */
    undoSnapshot: DeletedChatFolderSnapshot | null;
    undoDelete: () => Promise<void>;
    dismissUndo: () => void;
}

/**
 * The processes API of the CoC server that owns `workspaceId`. Workspace-scoped
 * folder writes must follow the clone — a remote workspace lives on an
 * SSH-forwarded origin, and the page-origin client would 404 on its id.
 */
function processesApi(workspaceId: string | undefined): any {
    const client = getCocClientForWorkspace(workspaceId) as any;
    return client?.processes;
}

export function useChatFolderMutations(options: UseChatFolderMutationsOptions): UseChatFolderMutationsResult {
    const { workspaceId, setFolders, refresh, folderIdByProcess, folders, onProcessFoldersChanged, onError } = options;

    const [creating, setCreating] = useState(false);
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<PendingChatFolderDelete | null>(null);
    const [undoSnapshot, setUndoSnapshot] = useState<DeletedChatFolderSnapshot | null>(null);
    // Membership is read at click time, not at render time, so a background
    // refresh between opening the menu and confirming cannot stale the snapshot.
    const folderIdByProcessRef = useRef(folderIdByProcess);
    folderIdByProcessRef.current = folderIdByProcess;
    const foldersRef = useRef(folders);
    foldersRef.current = folders;

    const fail = useCallback((message: string) => {
        onError?.(message);
        refresh();
    }, [onError, refresh]);

    // ── Create ──────────────────────────────────────────────────────────────
    const startCreate = useCallback(() => {
        // Opening a create row while a rename is in flight ends the rename; two
        // inline editors at once has no meaning in a single-selection tree.
        setRenamingFolderId(null);
        setCreating(true);
    }, []);
    const cancelCreate = useCallback(() => setCreating(false), []);

    const commitCreate = useCallback(async (name: string, color: ChatFolderColor): Promise<ChatFolder | null> => {
        setCreating(false);
        if (!workspaceId) {return null;}
        const api = processesApi(workspaceId);
        if (typeof api?.createChatFolder !== 'function') {return null;}
        try {
            const res = await api.createChatFolder(workspaceId, { name, color });
            const folder = res?.folder as ChatFolder | undefined;
            if (!folder) {return null;}
            setFolders(prev => insertFolderAtTop(prev, folder));
            return folder;
        } catch {
            fail('Could not create folder');
            return null;
        }
    }, [workspaceId, setFolders, fail]);

    // ── Rename ──────────────────────────────────────────────────────────────
    const startRename = useCallback((folderId: string) => {
        setCreating(false);
        setRenamingFolderId(folderId);
    }, []);
    const cancelRename = useCallback(() => setRenamingFolderId(null), []);

    const commitRename = useCallback(async (folderId: string, name: string): Promise<void> => {
        setRenamingFolderId(null);
        if (!workspaceId) {return;}
        const api = processesApi(workspaceId);
        if (typeof api?.updateChatFolder !== 'function') {return;}
        setFolders(prev => applyFolderPatch(prev, folderId, { name }));
        try {
            await api.updateChatFolder(workspaceId, folderId, { name });
        } catch {
            fail('Could not rename folder');
        }
    }, [workspaceId, setFolders, fail]);

    // ── Recolor ─────────────────────────────────────────────────────────────
    const recolorFolder = useCallback(async (folderId: string, color: ChatFolderColor): Promise<void> => {
        if (!workspaceId) {return;}
        const api = processesApi(workspaceId);
        if (typeof api?.updateChatFolder !== 'function') {return;}
        setFolders(prev => applyFolderPatch(prev, folderId, { color }));
        try {
            await api.updateChatFolder(workspaceId, folderId, { color });
        } catch {
            fail('Could not change folder color');
        }
    }, [workspaceId, setFolders, fail]);

    // ── Reorder (AC-07) ─────────────────────────────────────────────────────
    /**
     * Optimistic, then persisted one PATCH per folder whose `sortIndex` moved —
     * usually two. `sortIndex` has no dedicated column (it lives in the group's
     * `extra` blob), so there is no batch endpoint to reach for.
     */
    const reorderFolders = useCallback(async (
        draggedFolderId: string,
        targetFolderId: string,
        position: 'above' | 'below',
    ): Promise<void> => {
        if (!workspaceId) {return;}
        const before = [...foldersRef.current];
        const next = reorderChatFolders(before, draggedFolderId, targetFolderId, position);
        // A drop that lands the folder back where it started is not a request.
        if (!next) {return;}
        const changed = diffFolderSortIndexes(before, next);
        if (changed.length === 0) {return;}
        const api = processesApi(workspaceId);
        if (typeof api?.updateChatFolder !== 'function') {return;}
        setFolders(next);
        try {
            for (const entry of changed) {
                await api.updateChatFolder(workspaceId, entry.id, { sortIndex: entry.sortIndex });
            }
        } catch {
            setFolders(before);
            fail('Could not reorder folders');
        }
    }, [workspaceId, setFolders, fail]);

    // ── Delete + undo ───────────────────────────────────────────────────────
    const deleteNow = useCallback(async (folder: ChatFolder, memberIds: string[]): Promise<void> => {
        if (!workspaceId) {return;}
        const api = processesApi(workspaceId);
        if (typeof api?.deleteChatFolder !== 'function') {return;}
        setFolders(prev => removeFolderFromList(prev, folder.id));
        // The tree already treats a folderId with no matching folder as unfiled,
        // so the members drop back into their date buckets with no extra work.
        setUndoSnapshot({ folder, memberIds });
        try {
            await api.deleteChatFolder(workspaceId, folder.id);
        } catch {
            setUndoSnapshot(null);
            fail('Could not delete folder');
        }
    }, [workspaceId, setFolders, fail]);

    const requestDelete = useCallback((folderId: string, folders: readonly ChatFolder[]) => {
        const folder = folders.find(f => f.id === folderId);
        if (!folder) {return;}
        const memberIds = collectFolderMemberIds(folderIdByProcessRef.current, folderId);
        // An empty folder holds nothing to lose, so it deletes without a prompt.
        if (memberIds.length === 0) {
            void deleteNow(folder, memberIds);
            return;
        }
        setPendingDelete({ folder, memberIds });
    }, [deleteNow]);

    const cancelDelete = useCallback(() => setPendingDelete(null), []);

    const confirmDelete = useCallback(async (): Promise<void> => {
        const pending = pendingDelete;
        setPendingDelete(null);
        if (!pending) {return;}
        await deleteNow(pending.folder, pending.memberIds);
    }, [pendingDelete, deleteNow]);

    const dismissUndo = useCallback(() => setUndoSnapshot(null), []);

    /**
     * Restore a deleted folder. The original `group_id` is gone, so this creates
     * a fresh folder with the same name and color and re-files the remembered
     * members into it — which is also the correct behaviour when the id has been
     * re-created elsewhere in the meantime.
     */
    const undoDelete = useCallback(async (): Promise<void> => {
        const snapshot = undoSnapshot;
        setUndoSnapshot(null);
        if (!snapshot || !workspaceId) {return;}
        const api = processesApi(workspaceId);
        if (typeof api?.createChatFolder !== 'function') {return;}
        try {
            const res = await api.createChatFolder(workspaceId, {
                name: snapshot.folder.name,
                color: snapshot.folder.color,
            });
            const folder = res?.folder as ChatFolder | undefined;
            if (!folder) {return;}
            setFolders(prev => insertFolderAtTop(prev, folder));
            if (snapshot.memberIds.length > 0 && typeof api.setProcessFolderBatch === 'function') {
                await api.setProcessFolderBatch(snapshot.memberIds, folder.id);
                onProcessFoldersChanged?.(snapshot.memberIds, folder.id);
            }
        } catch {
            fail('Could not restore folder');
        }
    }, [undoSnapshot, workspaceId, setFolders, onProcessFoldersChanged, fail]);

    return {
        creating,
        startCreate,
        cancelCreate,
        commitCreate,
        renamingFolderId,
        startRename,
        cancelRename,
        commitRename,
        recolorFolder,
        reorderFolders,
        requestDelete,
        pendingDelete,
        cancelDelete,
        confirmDelete,
        undoSnapshot,
        undoDelete,
        dismissUndo,
    };
}
