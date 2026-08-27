/**
 * useChatFolderArchive — "Archive all chats" for one folder, with a
 * single-level undo (AC-09).
 *
 * Archiving in this list is a chat *preference*, not a process mutation: it
 * goes through `useChatPreferences`' batch `archiveChats` / `unarchiveChats`,
 * which write the workspace's `archivedChats` preference. Membership rows are
 * never involved, so a folder's chats keep their folder while archived and
 * unarchiving returns them to it with no extra work.
 */
import { useCallback, useRef, useState } from 'react';
import type { ChatFolder } from '@plusplusoneplusplus/coc-client';
import {
    resolveFolderArchiveTargets,
    type FolderArchiveTargets,
} from '../chat-folder-archive';

/** An archive-all waiting on its confirm dialog. */
export interface PendingChatFolderArchive {
    folder: ChatFolder;
    targets: FolderArchiveTargets;
}

/** The most recent archive-all, restorable exactly once. */
export interface ChatFolderArchiveUndo {
    folderName: string;
    /** Exactly the ids that were archived — pinned skips are not in here. */
    archivedIds: string[];
    pinnedSkipped: number;
}

export interface UseChatFolderArchiveOptions {
    /** `processId -> folderId`, the same map the tree renders from. */
    folderIdByProcess: ReadonlyMap<string, string>;
    pinnedChatIds?: ReadonlySet<string>;
    archivedChatIds?: ReadonlySet<string>;
    archiveChats?: (ids: string[]) => void;
    unarchiveChats?: (ids: string[]) => void;
}

export interface UseChatFolderArchiveResult {
    /** What an archive-all on this folder would touch, for the menu item's state. */
    resolveTargets: (folderId: string) => FolderArchiveTargets;
    requestArchiveAll: (folder: ChatFolder) => void;
    pendingArchive: PendingChatFolderArchive | null;
    cancelArchive: () => void;
    confirmArchive: () => void;
    undoArchive: ChatFolderArchiveUndo | null;
    performUndoArchive: () => void;
    dismissUndoArchive: () => void;
}

export function useChatFolderArchive(options: UseChatFolderArchiveOptions): UseChatFolderArchiveResult {
    const { folderIdByProcess, pinnedChatIds, archivedChatIds, archiveChats, unarchiveChats } = options;

    const [pendingArchive, setPendingArchive] = useState<PendingChatFolderArchive | null>(null);
    const [undoArchive, setUndoArchive] = useState<ChatFolderArchiveUndo | null>(null);

    // Membership and pin/archive state are read at click time, so a background
    // refresh between opening the menu and confirming cannot stale the target set.
    const stateRef = useRef({ folderIdByProcess, pinnedChatIds, archivedChatIds });
    stateRef.current = { folderIdByProcess, pinnedChatIds, archivedChatIds };

    const resolveTargets = useCallback((folderId: string): FolderArchiveTargets => {
        const { folderIdByProcess: map, pinnedChatIds: pinned, archivedChatIds: archived } = stateRef.current;
        return resolveFolderArchiveTargets(map, folderId, { pinnedIds: pinned, archivedIds: archived });
    }, []);

    const requestArchiveAll = useCallback((folder: ChatFolder) => {
        const targets = resolveTargets(folder.id);
        // Nothing to archive is a disabled menu item, not an empty confirm.
        if (targets.archivableIds.length === 0) {return;}
        setPendingArchive({ folder, targets });
    }, [resolveTargets]);

    const cancelArchive = useCallback(() => setPendingArchive(null), []);

    const confirmArchive = useCallback(() => {
        const pending = pendingArchive;
        setPendingArchive(null);
        if (!pending || !archiveChats) {return;}
        const ids = pending.targets.archivableIds;
        if (ids.length === 0) {return;}
        archiveChats(ids);
        setUndoArchive({
            folderName: pending.folder.name,
            archivedIds: ids,
            pinnedSkipped: pending.targets.pinnedSkippedIds.length,
        });
    }, [pendingArchive, archiveChats]);

    const dismissUndoArchive = useCallback(() => setUndoArchive(null), []);

    const performUndoArchive = useCallback(() => {
        const snapshot = undoArchive;
        setUndoArchive(null);
        if (!snapshot || !unarchiveChats || snapshot.archivedIds.length === 0) {return;}
        // Membership was never touched, so unarchiving is the whole undo — each
        // chat reappears inside the folder it never left.
        unarchiveChats(snapshot.archivedIds);
    }, [undoArchive, unarchiveChats]);

    return {
        resolveTargets,
        requestArchiveAll,
        pendingArchive,
        cancelArchive,
        confirmArchive,
        undoArchive,
        performUndoArchive,
        dismissUndoArchive,
    };
}
