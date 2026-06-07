export type CommitChatPresentation = 'lens' | 'side-panel';

const OPEN_STORAGE_KEY = 'coc.commitChat.open';
const PLACEMENT_STORAGE_PREFIX = 'coc.commitChat.placement';
const SIDE_PANEL_PLACEMENT = 'side-panel';

function storage(): Storage | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
}

export function readCommitChatOpen(): boolean {
    try {
        return storage()?.getItem(OPEN_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function writeCommitChatOpen(open: boolean): void {
    try {
        storage()?.setItem(OPEN_STORAGE_KEY, String(open));
    } catch {
        /* ignore unavailable client storage */
    }
}

export function getCommitChatPlacementStorageKey(workspaceId: string, commitHash: string): string {
    return `${PLACEMENT_STORAGE_PREFIX}.${encodeURIComponent(workspaceId)}.${encodeURIComponent(commitHash)}`;
}

export function isCommitChatPinned(workspaceId: string, commitHash: string): boolean {
    try {
        return storage()?.getItem(getCommitChatPlacementStorageKey(workspaceId, commitHash)) === SIDE_PANEL_PLACEMENT;
    } catch {
        return false;
    }
}

export function pinCommitChat(workspaceId: string, commitHash: string): void {
    try {
        storage()?.setItem(getCommitChatPlacementStorageKey(workspaceId, commitHash), SIDE_PANEL_PLACEMENT);
    } catch {
        /* ignore unavailable client storage */
    }
}

export function unpinCommitChat(workspaceId: string, commitHash: string): void {
    try {
        storage()?.removeItem(getCommitChatPlacementStorageKey(workspaceId, commitHash));
    } catch {
        /* ignore unavailable client storage */
    }
}

export function resolveCommitChatPresentation(opts: {
    lensEnabled: boolean;
    isDesktop: boolean;
    pinned: boolean;
}): CommitChatPresentation {
    if (!opts.lensEnabled) return 'side-panel';
    if (!opts.isDesktop) return 'side-panel';
    return opts.pinned ? 'side-panel' : 'lens';
}
