/**
 * chat-folder-tree — pure view-model helpers for the chat-folders section
 * (AC-04).
 *
 * The renderer in `ChatListPane` is already very large, so all of the folder
 * bucketing logic lives here as plain functions over plain data: no React, no
 * DOM, no network. Everything the section needs is derived from
 *
 *  - the folder list (`GET /api/workspaces/:id/chat-folders`), and
 *  - `folderId` as it already rides on each process index entry (AC-02).
 *
 * There is deliberately no client-side join against a folder-members endpoint:
 * membership is a property of the process, so a row's folder is read straight
 * off the row (or off the process summary that describes it).
 */

import type { ChatFolder, ChatFolderColor } from '@plusplusoneplusplus/coc-client';

/**
 * The 6 preset folder colors, as hex. These mirror the accent values already
 * used by the chat list rather than introducing a second palette; the server
 * stores the *name*, so theming stays possible.
 */
export const CHAT_FOLDER_COLOR_HEX: Record<ChatFolderColor, string> = {
    purple: '#c586c0',
    green: '#4ec9b0',
    amber: '#d7ba7d',
    blue: '#3794ff',
    red: '#f48771',
    pink: '#ce9178',
};

/** Fallback for a color name the client does not know (forward compatibility). */
export const CHAT_FOLDER_FALLBACK_HEX = CHAT_FOLDER_COLOR_HEX.blue;

/** Resolve a folder color name to its hex value, tolerating unknown names. */
export function chatFolderColorHex(color: string | undefined): string {
    if (!color) {return CHAT_FOLDER_FALLBACK_HEX;}
    return CHAT_FOLDER_COLOR_HEX[color as ChatFolderColor] ?? CHAT_FOLDER_FALLBACK_HEX;
}

/**
 * Order folders the way the server does: `sortIndex` ascending, ties broken on
 * `createdAt` descending. Kept in sync with `sortChatFolders` on the server so
 * the tree and the "Move to folder" submenu agree (AC-06).
 */
export function sortChatFolders<T extends { sortIndex?: number; createdAt?: string }>(folders: readonly T[]): T[] {
    return [...folders].sort((a, b) => {
        const ai = typeof a.sortIndex === 'number' ? a.sortIndex : 0;
        const bi = typeof b.sortIndex === 'number' ? b.sortIndex : 0;
        if (ai !== bi) {return ai - bi;}
        const at = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
        return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
    });
}

/**
 * Build a `processId -> folderId` lookup from the global process-summary index
 * (`GET /api/processes/summaries`, seeded into `AppContext.state.processes`).
 *
 * The list rows themselves come from the queue / history endpoints, which do
 * not carry `folderId`, so the summary index is the single source of truth the
 * client reads. It is still not a *join*: `folderId` is a field on the process,
 * not a member list hanging off the folder.
 */
export function buildFolderIdByProcess(processes: readonly any[] | undefined): Map<string, string> {
    const map = new Map<string, string>();
    if (!processes) {return map;}
    for (const proc of processes) {
        const folderId = proc?.folderId;
        if (typeof folderId !== 'string' || folderId.length === 0) {continue;}
        const id = typeof proc?.id === 'string' ? proc.id : undefined;
        if (id) {map.set(id, folderId);}
    }
    return map;
}

/**
 * Count how many processes sit in each folder across the whole workspace,
 * ignoring the current tab's scope predicate. Used to tell "this folder is
 * empty everywhere" (render it dimmed at count 0) apart from "this folder has
 * members, none of which belong on this tab" (hide it here).
 */
export function buildFolderMemberCounts(folderIdByProcess: ReadonlyMap<string, string>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const folderId of folderIdByProcess.values()) {
        counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
    }
    return counts;
}

/**
 * Resolve the folder a list entry belongs to, or `null`.
 *
 * Only individual process rows are filable — a for-each / map-reduce / ralph /
 * spawned-tree group entry is never filed as a unit, so any entry carrying a
 * `kind` discriminator resolves to `null`.
 */
export function resolveEntryFolderId(
    entry: any,
    folderIdByProcess: ReadonlyMap<string, string>,
): string | null {
    if (!entry || entry.kind) {return null;}
    if (typeof entry.folderId === 'string' && entry.folderId.length > 0) {return entry.folderId;}
    const byId = typeof entry.id === 'string' ? folderIdByProcess.get(entry.id) : undefined;
    if (byId) {return byId;}
    const byProcessId = typeof entry.processId === 'string' ? folderIdByProcess.get(entry.processId) : undefined;
    return byProcessId ?? null;
}

/** A folder as the section renders it, with its tab-filtered members resolved. */
export interface ChatFolderRow {
    folder: ChatFolder;
    /** Tab-filtered members, in the order they were supplied (recency-descending). */
    members: any[];
    /** `members.length` — the number the count badge shows. */
    memberCount: number;
    /** How many of those members are currently running (drives the live-run dot). */
    runningCount: number;
    /** True when the folder holds nothing anywhere, not merely nothing on this tab. */
    isEmpty: boolean;
    collapsed: boolean;
}

export interface BuildChatFolderRowsInput {
    folders: readonly ChatFolder[];
    /**
     * Candidate rows for the current tab, already scope-filtered and already
     * recency-sorted. Pinned and archived rows must NOT be included: pinned wins
     * over filed, and archived rows live in the Archived section.
     */
    entries: readonly any[];
    folderIdByProcess: ReadonlyMap<string, string>;
    /** Workspace-wide member counts, from {@link buildFolderMemberCounts}. */
    folderMemberCounts?: ReadonlyMap<string, number>;
    collapsedIds: ReadonlySet<string>;
    /** Ids of rows that are currently running, for the live-run dot. */
    runningIds?: ReadonlySet<string>;
}

/**
 * Build the ordered folder rows for one list surface.
 *
 * A folder is omitted when it has members in the workspace but none of them
 * pass the current tab's scope predicate — the count badge must always match
 * what expanding reveals, and a permanently-zero row on the Tasks tab is just
 * noise. A folder that is empty *everywhere* is still shown (dimmed, count 0)
 * so a freshly created folder does not vanish before anything is filed into it.
 */
export function buildChatFolderRows(input: BuildChatFolderRowsInput): ChatFolderRow[] {
    const { folders, entries, folderIdByProcess, collapsedIds } = input;
    const known = new Set(folders.map(f => f.id));
    const byFolder = new Map<string, any[]>();
    const runningByFolder = new Map<string, number>();

    for (const entry of entries) {
        const folderId = resolveEntryFolderId(entry, folderIdByProcess);
        // A folderId pointing at a deleted folder means "unfiled", not an error.
        if (!folderId || !known.has(folderId)) {continue;}
        const bucket = byFolder.get(folderId);
        if (bucket) {bucket.push(entry);} else {byFolder.set(folderId, [entry]);}
        if (input.runningIds?.has(entry.id)) {
            runningByFolder.set(folderId, (runningByFolder.get(folderId) ?? 0) + 1);
        }
    }

    const rows: ChatFolderRow[] = [];
    for (const folder of sortChatFolders(folders)) {
        const members = byFolder.get(folder.id) ?? [];
        const workspaceCount = input.folderMemberCounts?.get(folder.id) ?? members.length;
        const isEmpty = workspaceCount === 0;
        if (members.length === 0 && !isEmpty) {continue;}
        rows.push({
            folder,
            members,
            memberCount: members.length,
            runningCount: runningByFolder.get(folder.id) ?? 0,
            isEmpty,
            collapsed: collapsedIds.has(folder.id),
        });
    }
    return rows;
}

/**
 * Split entries into the ones that were pulled into a folder row and the ones
 * that stay in their normal date bucket. A filed row is removed from its date
 * bucket; a row whose folder is unknown (deleted underneath us) stays put.
 *
 * Rows that a folder row would drop — because the folder is hidden on this tab
 * — are NOT considered filed here, so nothing can disappear from the list.
 */
export function partitionFiledEntries(
    entries: readonly any[],
    folderIdByProcess: ReadonlyMap<string, string>,
    visibleFolderIds: ReadonlySet<string>,
): { filed: any[]; unfiled: any[] } {
    const filed: any[] = [];
    const unfiled: any[] = [];
    for (const entry of entries) {
        const folderId = resolveEntryFolderId(entry, folderIdByProcess);
        if (folderId && visibleFolderIds.has(folderId)) {filed.push(entry);}
        else {unfiled.push(entry);}
    }
    return { filed, unfiled };
}
