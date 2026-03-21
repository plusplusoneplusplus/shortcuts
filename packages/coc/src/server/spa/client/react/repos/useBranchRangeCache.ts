/**
 * Client-side cache for branch range data.
 *
 * Module-level Map keyed by workspaceId. Caches branch range metadata
 * so that WebSocket git-changed events don't trigger redundant refetches.
 * Only an explicit user Refresh clears the cache for a workspace.
 */

import type { BranchRangeInfo } from './BranchChanges';

export interface CachedBranchRange {
    data: BranchRangeInfo | null;
    files: any[];
    ahead: number;
    behind: number;
    branchName: string;
    onDefaultBranch: boolean;
}

/** Module-level cache — survives re-renders, cleared on page reload. */
const branchRangeCache = new Map<string, CachedBranchRange>();

export function getBranchRangeCache(workspaceId: string): CachedBranchRange | undefined {
    return branchRangeCache.get(workspaceId);
}

export function setBranchRangeCache(workspaceId: string, value: CachedBranchRange): void {
    branchRangeCache.set(workspaceId, value);
}

export function clearBranchRangeCache(workspaceId: string): void {
    branchRangeCache.delete(workspaceId);
}

/** Expose cache internals for testing. */
export function _clearBranchRangeCache(): void {
    branchRangeCache.clear();
}

export function _getBranchRangeCacheSize(): number {
    return branchRangeCache.size;
}
