import * as vscode from 'vscode';

/**
 * Git change status types matching VSCode's git extension
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
 * Stage of the git change
 */
export type GitChangeStage = 'staged' | 'unstaged' | 'untracked';

/**
 * Represents a single git change (modified/added/deleted file)
 */
export interface GitChange {
    /** Absolute path to the changed file */
    path: string;
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
    /** URI for the file */
    uri: vscode.Uri;
}

/**
 * Change counts for display
 */
export interface GitChangeCounts {
    staged: number;
    unstaged: number;
    untracked: number;
    total: number;
}

/**
 * Represents a git commit
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
}

/**
 * Options for loading commits
 */
export interface CommitLoadOptions {
    /** Maximum number of commits to load */
    maxCount: number;
    /** Number of commits to skip (for pagination) */
    skip: number;
}

/**
 * Result from loading commits
 */
export interface CommitLoadResult {
    /** Loaded commits */
    commits: GitCommit[];
    /** Whether there are more commits available */
    hasMore: boolean;
}

/**
 * Represents a file changed in a commit
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
}

/**
 * Section types in the Git view
 */
export type GitSectionType = 'changes' | 'commits';

/**
 * Combined counts for the Git view description
 */
export interface GitViewCounts {
    /** Number of changes */
    changes: GitChangeCounts;
    /** Number of loaded commits */
    commitCount: number;
    /** Whether there are more commits to load */
    hasMoreCommits: boolean;
}

