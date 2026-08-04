/**
 * useBranchRangeBaseMode — the branch diff's comparison base, remembered per workspace.
 *
 * `default-branch` (vs origin/main) is the default and stays the default; `upstream`
 * diffs against `@{upstream}` so only unpushed commits show.
 */

import { useCallback, useState } from 'react';
import type { GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';

const STORAGE_PREFIX = 'coc.branchRange.baseMode.';

export function loadBranchRangeBaseMode(workspaceId: string): GitRangeBaseMode {
    try {
        return localStorage.getItem(STORAGE_PREFIX + workspaceId) === 'upstream' ? 'upstream' : 'default-branch';
    } catch {
        return 'default-branch';
    }
}

export function saveBranchRangeBaseMode(workspaceId: string, mode: GitRangeBaseMode): void {
    try {
        localStorage.setItem(STORAGE_PREFIX + workspaceId, mode);
    } catch { /* ignore */ }
}

export function useBranchRangeBaseMode(workspaceId: string): [GitRangeBaseMode, (mode: GitRangeBaseMode) => void] {
    const [stored, setStored] = useState(() => ({ workspaceId, mode: loadBranchRangeBaseMode(workspaceId) }));

    // Adjust during render when the workspace changes, so the first fetch for the
    // new workspace already uses its own remembered mode (no double fetch).
    let baseMode = stored.mode;
    if (stored.workspaceId !== workspaceId) {
        baseMode = loadBranchRangeBaseMode(workspaceId);
        setStored({ workspaceId, mode: baseMode });
    }

    const setBaseMode = useCallback((mode: GitRangeBaseMode) => {
        saveBranchRangeBaseMode(workspaceId, mode);
        setStored({ workspaceId, mode });
    }, [workspaceId]);

    return [baseMode, setBaseMode];
}
