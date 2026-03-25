/**
 * Client-side cache for commits list data.
 *
 * Module-level Map keyed by workspaceId. Caches the initial commits page so
 * that switching back to the git tab does not trigger a network round-trip.
 * Only an explicit user Refresh (refresh=true) or a WebSocket git-changed
 * event clears the cache for a workspace.
 */

import type { GitCommitItem } from './CommitList';

export interface CachedCommits {
    commits: GitCommitItem[];
    unpushedCount: number;
    hasMore: boolean;
}

/** Module-level cache — survives re-renders, cleared on page reload. */
const commitsCache = new Map<string, CachedCommits>();

export function getCommitsCache(workspaceId: string): CachedCommits | undefined {
    return commitsCache.get(workspaceId);
}

export function setCommitsCache(workspaceId: string, value: CachedCommits): void {
    commitsCache.set(workspaceId, value);
}

export function clearCommitsCache(workspaceId: string): void {
    commitsCache.delete(workspaceId);
}

/** Expose cache internals for testing. */
export function _clearCommitsCache(): void {
    commitsCache.clear();
}

export function _getCommitsCacheSize(): number {
    return commitsCache.size;
}
