/**
 * Shared types for the RepoGitTab controller family.
 *
 * The Git tab is assembled from focused hooks (data, selection, operations,
 * auto-pull, skills) plus presentational panes. These types are the contract
 * between them, so no hook has to import the shell component.
 */

import type { GitCommitItem } from '../commits/CommitList';

/** Which detail surface the right panel is showing. */
export type RightPanelView =
    | { type: 'commit'; commit: GitCommitItem }
    | { type: 'commit-file'; hash: string; filePath: string }
    | { type: 'branch-range' }
    | { type: 'branch-file'; filePath: string }
    | { type: 'working-tree-file'; filePath: string; stage: 'staged' | 'unstaged' | 'untracked' }
    | { type: 'working-tree-comments' }
    | { type: 'branch-range-comments' }
    | { type: 'multi-commit'; commits: GitCommitItem[] };

/**
 * The serializable part of a `RightPanelView` — what a host may persist and
 * hand back to restore the detail after a reload. Commits are named by hash
 * only; their data (and every diff) is refetched on restore.
 */
export type PersistedGitView =
    | { type: 'commit'; hash: string }
    | { type: 'commit-file'; hash: string; filePath: string }
    | { type: 'branch-range' }
    | { type: 'branch-file'; filePath: string }
    | { type: 'working-tree-file'; filePath: string; stage: 'staged' | 'unstaged' | 'untracked' }
    | { type: 'working-tree-comments' }
    | { type: 'branch-range-comments' }
    | { type: 'multi-commit'; hashes: string[] };

/** The commit-menu target a skill run applies to. Mirrors the contextMenu state shape. */
export type SkillMenuContext = {
    type: 'commit' | 'branch-range' | 'multi-commit';
    commit?: GitCommitItem;
    commits?: GitCommitItem[];
};

/** Open context-menu state: a screen position plus the target it acts on. */
export type GitContextMenuState = SkillMenuContext & { x: number; y: number };

/** Which hunk a file-diff navigation should land on. */
export type HunkTarget = 'first' | 'last' | undefined;

/** In-progress merge/rebase/cherry-pick reported by the server. */
export interface GitRepoStateInfo {
    operation: string;
    conflictFiles: string[];
}

/** Options controlling which commit `refreshAll` re-selects. */
export interface RefreshSelectionOptions {
    /** Prefer this hash if it survives the refresh. */
    selectHash?: string;
    /** Fall back to HEAD when the preferred hash is gone. */
    selectFallbackToHead?: boolean;
}
