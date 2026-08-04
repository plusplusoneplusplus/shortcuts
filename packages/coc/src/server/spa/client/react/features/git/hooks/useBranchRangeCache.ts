/**
 * Client-side cache for branch range data.
 *
 * Module-level Map keyed by `workspaceId:baseMode`. Caches branch range metadata
 * so that WebSocket git-changed events don't trigger redundant refetches.
 * Only an explicit user Refresh clears the cache for a workspace — and it drops
 * every base mode for that workspace, since a refresh means "re-read git".
 */

import type { BranchRangeInfo } from '../branches/BranchChanges';
import type { GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';

export interface CachedBranchRange {
    data: BranchRangeInfo | null;
    files: any[];
    ahead: number;
    behind: number;
    branchName: string;
    onDefaultBranch: boolean;
    /** Base ref reported by the server, even when there is no range. */
    baseRef?: string;
    /** True when 'upstream' was requested but the branch has no upstream. */
    baseModeFallback?: boolean;
}

/** Module-level cache — survives re-renders, cleared on page reload. */
const branchRangeCache = new Map<string, CachedBranchRange>();

function cacheKey(workspaceId: string, baseMode: GitRangeBaseMode): string {
    return `${workspaceId}:${baseMode}`;
}

export function getBranchRangeCache(workspaceId: string, baseMode: GitRangeBaseMode = 'default-branch'): CachedBranchRange | undefined {
    return branchRangeCache.get(cacheKey(workspaceId, baseMode));
}

export function setBranchRangeCache(workspaceId: string, value: CachedBranchRange, baseMode: GitRangeBaseMode = 'default-branch'): void {
    branchRangeCache.set(cacheKey(workspaceId, baseMode), value);
}

/** Drop every base mode's entry for the workspace. */
export function clearBranchRangeCache(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const key of [...branchRangeCache.keys()]) {
        if (key.startsWith(prefix)) {
            branchRangeCache.delete(key);
        }
    }
}

/** Expose cache internals for testing. */
export function _clearBranchRangeCache(): void {
    branchRangeCache.clear();
}

export function _getBranchRangeCacheSize(): number {
    return branchRangeCache.size;
}
