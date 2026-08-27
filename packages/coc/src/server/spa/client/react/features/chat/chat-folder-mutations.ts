/**
 * chat-folder-mutations — pure list transforms for optimistic folder edits
 * (AC-05).
 *
 * Every folder mutation is applied to local state first and reconciled by the
 * server response, so the arithmetic that decides where a folder lands after a
 * create / rename / recolor / delete lives here as plain functions over plain
 * data. `ChatListPane` only wires them up.
 *
 * The ordering rules mirror the server exactly (`sortIndex` ascending, ties on
 * `createdAt` descending) — see `sortChatFolders` in `chat-folder-tree.ts`.
 */

import type { ChatFolder } from '@plusplusoneplusplus/coc-client';
import { sortChatFolders } from './chat-folder-tree';

/**
 * Insert a newly created folder at the top and shift every existing folder
 * down, matching the server's "new folders land at sortIndex 0" rule.
 */
export function insertFolderAtTop(folders: readonly ChatFolder[], folder: ChatFolder): ChatFolder[] {
    const shifted = folders
        .filter(f => f.id !== folder.id)
        .map(f => ({ ...f, sortIndex: (f.sortIndex ?? 0) + 1 }));
    return sortChatFolders([{ ...folder, sortIndex: 0 }, ...shifted]);
}

/** Apply a partial folder update in place, keeping the list's manual order. */
export function applyFolderPatch(
    folders: readonly ChatFolder[],
    folderId: string,
    patch: Partial<ChatFolder>,
): ChatFolder[] {
    let changed = false;
    const next = folders.map(f => {
        if (f.id !== folderId) {return f;}
        changed = true;
        return { ...f, ...patch };
    });
    return changed ? sortChatFolders(next) : [...folders];
}

/** Drop a folder from the list (its members become unfiled by the tree rules). */
export function removeFolderFromList(folders: readonly ChatFolder[], folderId: string): ChatFolder[] {
    return folders.filter(f => f.id !== folderId);
}

/**
 * True when another folder already carries this name. Duplicate names are
 * ALLOWED — this only drives the soft "already exists" hint under the input.
 */
export function folderNameExists(
    folders: readonly ChatFolder[],
    name: string,
    excludeId?: string,
): boolean {
    const needle = name.trim().toLowerCase();
    if (needle.length === 0) {return false;}
    return folders.some(f => f.id !== excludeId && f.name.trim().toLowerCase() === needle);
}

/**
 * Everything needed to put a deleted folder back: the folder itself plus the
 * ids that were filed in it at deletion time. Undo is single-level, so one of
 * these is remembered at a time.
 */
export interface DeletedChatFolderSnapshot {
    folder: ChatFolder;
    memberIds: string[];
}

/**
 * Which process ids belonged to a folder, read off the same
 * `processId -> folderId` map the tree renders from.
 *
 * Used to snapshot membership BEFORE a delete, because the server's response
 * only lists what it unfiled and the undo has to re-file exactly that set.
 */
export function collectFolderMemberIds(
    folderIdByProcess: ReadonlyMap<string, string>,
    folderId: string,
): string[] {
    const ids: string[] = [];
    for (const [processId, id] of folderIdByProcess) {
        if (id === folderId) {ids.push(processId);}
    }
    return ids;
}
