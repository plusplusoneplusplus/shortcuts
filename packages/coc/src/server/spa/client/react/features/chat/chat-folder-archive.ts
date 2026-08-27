/**
 * chat-folder-archive — pure helpers for "Archive all chats" on a folder (AC-09).
 *
 * Archiving is a *view* state in this list: a chat's membership row is never
 * touched, so an archived chat keeps its folder and unarchiving puts it right
 * back. All this module does is decide which of a folder's members an
 * archive-all should actually touch, and phrase the confirm and the undo toast.
 */

/** What an "Archive all chats" on one folder would do, resolved before asking. */
export interface FolderArchiveTargets {
    /** Members that will be archived. */
    archivableIds: string[];
    /**
     * Pinned members, deliberately skipped: pinning auto-unarchives a chat, so
     * archiving one would immediately undo itself. The toast reports the count.
     */
    pinnedSkippedIds: string[];
    /** Members that are already archived — nothing to do for these. */
    alreadyArchivedIds: string[];
}

export interface ResolveFolderArchiveTargetsOptions {
    pinnedIds?: ReadonlySet<string>;
    archivedIds?: ReadonlySet<string>;
}

/**
 * Split a folder's members into what an archive-all touches, skips and ignores.
 *
 * Membership is read from the same `processId -> folderId` map the tree renders
 * from, so this covers every member of the folder in the workspace — not just
 * the ones the current tab happens to show.
 */
export function resolveFolderArchiveTargets(
    folderIdByProcess: ReadonlyMap<string, string>,
    folderId: string,
    options: ResolveFolderArchiveTargetsOptions = {},
): FolderArchiveTargets {
    const { pinnedIds, archivedIds } = options;
    const archivableIds: string[] = [];
    const pinnedSkippedIds: string[] = [];
    const alreadyArchivedIds: string[] = [];
    for (const [processId, id] of folderIdByProcess) {
        if (id !== folderId) {continue;}
        if (archivedIds?.has(processId)) {alreadyArchivedIds.push(processId); continue;}
        if (pinnedIds?.has(processId)) {pinnedSkippedIds.push(processId); continue;}
        archivableIds.push(processId);
    }
    return { archivableIds, pinnedSkippedIds, alreadyArchivedIds };
}

/**
 * True when the menu item is worth offering. Everything already archived (or a
 * folder holding nothing but pinned rows) leaves nothing to archive, so the
 * item renders disabled rather than silently doing nothing.
 */
export function canArchiveFolder(targets: FolderArchiveTargets): boolean {
    return targets.archivableIds.length > 0;
}

/** `1 chat` / `12 chats` — the count the confirm and the toast both name. */
export function formatChatCount(count: number): string {
    return count === 1 ? '1 chat' : `${count} chats`;
}

/** The confirm's title: "Archive 12 chats?" — the count is the whole question. */
export function buildArchiveAllTitle(count: number): string {
    return `Archive ${formatChatCount(count)}?`;
}

/**
 * The undo toast's message. Pinned skips are reported here rather than in the
 * confirm, because the user cannot act on them beforehand.
 */
export function buildArchiveUndoMessage(folderName: string, archivedCount: number, pinnedSkipped: number): string {
    const base = `Archived ${formatChatCount(archivedCount)} in “${folderName}”`;
    if (pinnedSkipped === 0) {return base;}
    return `${base} · ${pinnedSkipped} pinned skipped`;
}
