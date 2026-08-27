/**
 * chat-folder-assignment — pure helpers for the row context menu's
 * "Move to folder" affordance (AC-06).
 *
 * The menu is built inside `ChatListPane`, but every rule that decides *what*
 * the menu says and *which* rows a move actually writes lives here, so it can
 * be asserted without rendering a 4600-line list.
 */

import type { ChatFolder } from '@plusplusoneplusplus/coc-client';

/**
 * Past this many folders the submenu grows a filter input. Below it the list
 * is short enough to scan, and an input would only add a focus trap.
 */
export const CHAT_FOLDER_FILTER_THRESHOLD = 10;

/** True when the Move-to submenu should render its filter input. */
export function shouldShowFolderFilter(folderCount: number): boolean {
    return folderCount > CHAT_FOLDER_FILTER_THRESHOLD;
}

/**
 * The parent menu item's label. It pluralizes with the selection count so a
 * batch move never looks like it applies to the one row under the cursor.
 */
export function buildMoveToFolderLabel(selectionCount: number): string {
    return selectionCount > 1
        ? `Move ${selectionCount} chats to folder`
        : 'Move to folder';
}

/** Case-insensitive substring match over folder names, order preserved. */
export function filterFoldersByQuery(
    folders: readonly ChatFolder[],
    query: string,
): ChatFolder[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {return [...folders];}
    return folders.filter(f => f.name.toLowerCase().includes(needle));
}

/**
 * Narrow a selection to the rows a move would actually change.
 *
 * A row already sitting in the target folder is a no-op, not an error, so it is
 * dropped here rather than round-tripped to the server. An empty result means
 * the caller should issue no request at all.
 */
export function resolveMoveTargets(
    ids: readonly string[],
    folderIdByProcess: ReadonlyMap<string, string>,
    targetFolderId: string | null,
): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
        if (seen.has(id)) {continue;}
        seen.add(id);
        const current = folderIdByProcess.get(id) ?? null;
        if (current === targetFolderId) {continue;}
        out.push(id);
    }
    return out;
}

/** True when at least one selected row is filed somewhere — gates "Remove from folder". */
export function anySelectionFiled(
    ids: readonly string[],
    folderIdByProcess: ReadonlyMap<string, string>,
): boolean {
    return ids.some(id => folderIdByProcess.has(id));
}
