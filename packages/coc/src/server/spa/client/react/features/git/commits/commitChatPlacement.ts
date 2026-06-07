export type ReviewChatPresentation = 'lens' | 'side-panel';
export type CommitChatPresentation = ReviewChatPresentation;

export type ReviewChatTarget =
    | { type: 'commit'; workspaceId: string; commitHash: string }
    | { type: 'pr'; workspaceId: string; repoId?: string; prId: string; headSha?: string };

const OPEN_STORAGE_KEY = 'coc.commitChat.open';
const PLACEMENT_STORAGE_PREFIX = 'coc.commitChat.placement';
const REVIEW_OPEN_STORAGE_PREFIX = 'coc.reviewChat.open';
const REVIEW_PLACEMENT_STORAGE_PREFIX = 'coc.reviewChat.placement';
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

function encodeStorageSegments(segments: string[]): string {
    return segments.map(segment => encodeURIComponent(segment)).join('.');
}

export function getReviewChatTargetStorageId(target: ReviewChatTarget): string {
    if (target.type === 'commit') {
        return encodeStorageSegments(['commit', target.workspaceId, target.commitHash]);
    }

    return encodeStorageSegments([
        'pr',
        target.workspaceId,
        target.repoId || target.workspaceId,
        target.prId,
        target.headSha || 'current',
    ]);
}

export function getReviewChatOpenStorageKey(target: ReviewChatTarget): string {
    return `${REVIEW_OPEN_STORAGE_PREFIX}.${getReviewChatTargetStorageId(target)}`;
}

export function getReviewChatPlacementStorageKey(target: ReviewChatTarget): string {
    return `${REVIEW_PLACEMENT_STORAGE_PREFIX}.${getReviewChatTargetStorageId(target)}`;
}

function getLegacyCommitPlacementStorageKey(target: ReviewChatTarget): string | null {
    return target.type === 'commit'
        ? getCommitChatPlacementStorageKey(target.workspaceId, target.commitHash)
        : null;
}

export function readReviewChatOpen(target: ReviewChatTarget): boolean {
    try {
        return storage()?.getItem(getReviewChatOpenStorageKey(target)) === 'true';
    } catch {
        return false;
    }
}

export function writeReviewChatOpen(target: ReviewChatTarget, open: boolean): void {
    try {
        storage()?.setItem(getReviewChatOpenStorageKey(target), String(open));
    } catch {
        /* ignore unavailable client storage */
    }
}

export function isCommitChatPinned(workspaceId: string, commitHash: string): boolean {
    return isReviewChatPinned({ type: 'commit', workspaceId, commitHash });
}

export function pinCommitChat(workspaceId: string, commitHash: string): void {
    pinReviewChat({ type: 'commit', workspaceId, commitHash });
}

export function unpinCommitChat(workspaceId: string, commitHash: string): void {
    unpinReviewChat({ type: 'commit', workspaceId, commitHash });
}

export function isReviewChatPinned(target: ReviewChatTarget): boolean {
    try {
        const clientStorage = storage();
        const placement = clientStorage?.getItem(getReviewChatPlacementStorageKey(target));
        if (placement === SIDE_PANEL_PLACEMENT) return true;
        const legacyCommitKey = getLegacyCommitPlacementStorageKey(target);
        return legacyCommitKey ? clientStorage?.getItem(legacyCommitKey) === SIDE_PANEL_PLACEMENT : false;
    } catch {
        return false;
    }
}

export function pinReviewChat(target: ReviewChatTarget): void {
    try {
        storage()?.setItem(getReviewChatPlacementStorageKey(target), SIDE_PANEL_PLACEMENT);
    } catch {
        /* ignore unavailable client storage */
    }
}

export function unpinReviewChat(target: ReviewChatTarget): void {
    try {
        const clientStorage = storage();
        clientStorage?.removeItem(getReviewChatPlacementStorageKey(target));
        const legacyCommitKey = getLegacyCommitPlacementStorageKey(target);
        if (legacyCommitKey) clientStorage?.removeItem(legacyCommitKey);
    } catch {
        /* ignore unavailable client storage */
    }
}

export function resolveReviewChatPresentation(opts: {
    lensEnabled: boolean;
    isDesktop: boolean;
    pinned: boolean;
}): ReviewChatPresentation {
    if (!opts.lensEnabled) return 'side-panel';
    if (!opts.isDesktop) return 'side-panel';
    return opts.pinned ? 'side-panel' : 'lens';
}

export const resolveCommitChatPresentation = resolveReviewChatPresentation;
