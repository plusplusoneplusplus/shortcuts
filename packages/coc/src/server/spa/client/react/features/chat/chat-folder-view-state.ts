/**
 * chat-folder-view-state — localStorage-backed collapse state for the chat
 * folders section (AC-04).
 *
 * Mirrors `spawned-tree-view-state`: a folder absent from the persisted set
 * renders expanded, so a folder the user has never touched defaults open. The
 * set is keyed per workspace, because folders themselves are per-workspace and
 * a repo group's virtual workspace gets its own folder set.
 *
 * Collapse state is deliberately client-side: it is a view preference, not
 * folder data, and persisting it server-side would mean a write on every
 * chevron click.
 */

const COLLAPSED_KEY_PREFIX = 'coc-chat-folder-collapsed:';

function storageKey(workspaceId: string | undefined): string {
    return `${COLLAPSED_KEY_PREFIX}${workspaceId ?? 'default'}`;
}

function readStorage(key: string): string | null {
    try {
        if (typeof localStorage === 'undefined') {return null;}
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string): void {
    try {
        if (typeof localStorage === 'undefined') {return;}
        localStorage.setItem(key, value);
    } catch {
        /* ignore (private mode / quota / SSR) */
    }
}

/** Load the collapsed folder ids for a workspace. Tolerates malformed JSON. */
export function loadCollapsedChatFolderIds(workspaceId: string | undefined): Set<string> {
    const raw = readStorage(storageKey(workspaceId));
    if (!raw) {return new Set();}
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
        }
    } catch {
        /* malformed — treat as empty */
    }
    return new Set();
}

/** Persist the collapsed folder ids for a workspace. */
export function persistCollapsedChatFolderIds(workspaceId: string | undefined, ids: ReadonlySet<string>): void {
    writeStorage(storageKey(workspaceId), JSON.stringify([...ids]));
}

/**
 * Return a new set with `folderId`'s collapsed state flipped, and persist it.
 * Pure with respect to the input set (does not mutate it).
 */
export function toggleCollapsedChatFolder(
    workspaceId: string | undefined,
    ids: ReadonlySet<string>,
    folderId: string,
): Set<string> {
    const next = new Set(ids);
    if (next.has(folderId)) {next.delete(folderId);} else {next.add(folderId);}
    persistCollapsedChatFolderIds(workspaceId, next);
    return next;
}

/** Collapse every supplied folder id at once (the ⇱ "collapse all" toolbar button). */
export function collapseAllChatFolders(
    workspaceId: string | undefined,
    folderIds: readonly string[],
): Set<string> {
    const next = new Set(folderIds);
    persistCollapsedChatFolderIds(workspaceId, next);
    return next;
}
