/**
 * Git-based diff providers: commit, range, and working-tree.
 *
 * All operations use the Rust patch backend through local-patch.
 */

import type {
    CommitDiffSource,
    IDiffProvider,
    RangeDiffSource,
    WorkingTreeDiffSource,
} from './types';
import { loadCommitPatch, loadRangePatch, loadWorkingTreePatch } from './local-patch';
import { createPatchDiffProvider } from './diff-utils';

// ── Commit diff provider─────────────────────────────────────

/**
 * Create a diff provider for a single commit vs its parent.
 */
export function createCommitDiffProvider(
    repositoryRoot: string,
    commitHash: string,
): IDiffProvider {
    const source: CommitDiffSource = {
        kind: 'commit',
        repositoryRoot,
        commitHash,
    };

    return createPatchDiffProvider(source, (file, options) => loadCommitPatch(repositoryRoot, commitHash, file, options));
}

// ── Range diff provider ──────────────────────────────────────

/**
 * Create a diff provider for a commit range (e.g. feature branch vs base).
 * Uses three-dot diff (`base...head`) to show only the branch's changes.
 */
export function createRangeDiffProvider(
    repositoryRoot: string,
    baseRef: string,
    headRef: string,
): IDiffProvider {
    const source: RangeDiffSource = {
        kind: 'range',
        repositoryRoot,
        baseRef,
        headRef,
    };

    return createPatchDiffProvider(source, (file, options) => loadRangePatch(repositoryRoot, baseRef, headRef, file, options));
}

// ── Working tree diff provider ───────────────────────────────

export function createWorkingTreeDiffProvider(
    repositoryRoot: string,
    scope: 'all' | 'staged' | 'unstaged' = 'all',
): IDiffProvider {
    const source: WorkingTreeDiffSource = {
        kind: 'working-tree',
        repositoryRoot,
        scope,
    };

    return createPatchDiffProvider(source, (file, options) => loadWorkingTreePatch(repositoryRoot, scope, file, options));
}
