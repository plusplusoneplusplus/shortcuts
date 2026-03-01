/**
 * Pure Node.js git types — no VS Code dependencies.
 *
 * Extracted from `src/shortcuts/git/types.ts`.
 * `vscode.Uri` replaced with `filePath: string`.
 * UI-only types (`GitSectionType`, `GitViewCounts`) are omitted.
 */

/**
 * Git change status types matching git's porcelain output.
 */
export type GitChangeStatus =
    | 'modified'    // M - Modified
    | 'added'       // A - Added (staged new file)
    | 'deleted'     // D - Deleted
    | 'renamed'     // R - Renamed
    | 'copied'      // C - Copied
    | 'untracked'   // ? - Untracked
    | 'ignored'     // ! - Ignored
    | 'conflict';   // U - Unmerged/Conflict

/**
 * Stage of the git change.
 */
export type GitChangeStage = 'staged' | 'unstaged' | 'untracked';

/**
 * Represents a single git change (modified/added/deleted file).
 */
export interface GitChange {
    /** Absolute path to the changed file */
    filePath: string;
    /** Original path (for renames/copies) */
    originalPath?: string;
    /** Type of change */
    status: GitChangeStatus;
    /** Whether staged, unstaged, or untracked */
    stage: GitChangeStage;
    /** Repository root path this change belongs to */
    repositoryRoot: string;
    /** Repository display name (folder name or basePath alias) */
    repositoryName: string;
}

/**
 * Change counts for display.
 */
export interface GitChangeCounts {
    staged: number;
    unstaged: number;
    untracked: number;
    total: number;
}

/**
 * Represents a git commit.
 */
export interface GitCommit {
    /** Full commit hash */
    hash: string;
    /** Abbreviated commit hash (typically 7 characters) */
    shortHash: string;
    /** Commit subject (first line of message) */
    subject: string;
    /** Author name */
    authorName: string;
    /** Author email */
    authorEmail: string;
    /** ISO 8601 formatted date */
    date: string;
    /** Human-readable relative date (e.g., "2 hours ago") */
    relativeDate: string;
    /** Parent commit hashes (space-separated for merges) */
    parentHashes: string;
    /** Refs pointing to this commit (branches, tags) */
    refs: string[];
    /** Repository root path this commit belongs to */
    repositoryRoot: string;
    /** Repository display name */
    repositoryName: string;
    /** Whether this commit is ahead of the remote tracking branch (unpushed) */
    isAheadOfRemote?: boolean;
}

/**
 * Options for loading commits.
 */
export interface CommitLoadOptions {
    /** Maximum number of commits to load */
    maxCount: number;
    /** Number of commits to skip (for pagination) */
    skip: number;
}

/**
 * Result from loading commits.
 */
export interface CommitLoadResult {
    /** Loaded commits */
    commits: GitCommit[];
    /** Whether there are more commits available */
    hasMore: boolean;
}

/**
 * Represents a file changed in a commit.
 */
export interface GitCommitFile {
    /** Relative path to the file within the repository */
    path: string;
    /** Original path for renames/copies */
    originalPath?: string;
    /** Type of change */
    status: GitChangeStatus;
    /** Commit hash this file change belongs to */
    commitHash: string;
    /** Parent commit hash for diff comparison */
    parentHash: string;
    /** Repository root path */
    repositoryRoot: string;
    /** Number of lines added (from --numstat) */
    additions?: number;
    /** Number of lines deleted (from --numstat) */
    deletions?: number;
}

/**
 * Comment counts for display.
 */
export interface GitCommentCounts {
    open: number;
    resolved: number;
    total: number;
}

/**
 * Represents a range of commits (e.g., feature branch changes vs origin/main).
 */
export interface GitCommitRange {
    /** Base reference (usually origin/main or origin/master) */
    baseRef: string;
    /** Head reference (usually HEAD or branch name) */
    headRef: string;
    /** Number of commits in range */
    commitCount: number;
    /** Files changed in range */
    files: GitCommitRangeFile[];
    /** Total line additions */
    additions: number;
    /** Total line deletions */
    deletions: number;
    /** Merge base commit hash */
    mergeBase: string;
    /** Current branch name (if any) */
    branchName?: string;
    /** Repository root path */
    repositoryRoot: string;
    /** Repository display name */
    repositoryName: string;
}

/**
 * File within a commit range.
 */
export interface GitCommitRangeFile {
    /** File path relative to repository root */
    path: string;
    /** Change status */
    status: GitChangeStatus;
    /** Line additions for this file */
    additions: number;
    /** Line deletions for this file */
    deletions: number;
    /** Old path (for renames) */
    oldPath?: string;
    /** Repository root path */
    repositoryRoot: string;
}

/**
 * Configuration for GitRangeService (replaces vscode.workspace.getConfiguration).
 */
export interface GitRangeConfig {
    /** Maximum number of changed files to return from detectCommitRange (default: 100) */
    maxFiles?: number;
    /** Whether to return a range when current branch has 0 commits ahead (default: false) */
    showOnDefaultBranch?: boolean;
}

/**
 * Represents the status of a branch relative to its tracking branch.
 */
export interface BranchStatus {
    /** Current branch name */
    name: string;
    /** Whether HEAD is detached */
    isDetached: boolean;
    /** Detached HEAD commit hash (only if isDetached) */
    detachedHash?: string;
    /** Number of commits ahead of tracking branch */
    ahead: number;
    /** Number of commits behind tracking branch */
    behind: number;
    /** Remote tracking branch (e.g., 'origin/main') */
    trackingBranch?: string;
    /** Whether there are uncommitted changes */
    hasUncommittedChanges: boolean;
}

/**
 * Represents a git branch.
 */
export interface GitBranch {
    /** Branch name */
    name: string;
    /** Whether this is the current branch */
    isCurrent: boolean;
    /** Whether this is a remote branch */
    isRemote: boolean;
    /** Remote name for remote branches (e.g., 'origin') */
    remoteName?: string;
    /** Last commit subject */
    lastCommitSubject?: string;
    /** Last commit relative date */
    lastCommitDate?: string;
}

/**
 * Options for paginated branch listing.
 */
export interface BranchListOptions {
    /** Maximum number of branches to return */
    limit?: number;
    /** Number of branches to skip */
    offset?: number;
    /** Search pattern to filter branches (case-insensitive substring match) */
    searchPattern?: string;
}

/**
 * Result of paginated branch listing.
 */
export interface PaginatedBranchResult {
    /** Branches in this page */
    branches: GitBranch[];
    /** Total count of matching branches */
    totalCount: number;
    /** Whether there are more branches available */
    hasMore: boolean;
}

/**
 * Result of a git operation that may fail.
 */
export interface GitOperationResult {
    success: boolean;
    error?: string;
}
