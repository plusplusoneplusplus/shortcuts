// Re-export pure types from pipeline-core
export {
    GitChangeStatus,
    GitChangeStage,
    GitChangeCounts,
    GitCommit,
    CommitLoadOptions,
    CommitLoadResult,
    GitCommitFile,
    GitCommentCounts,
    GitCommitRange,
    GitCommitRangeFile,
} from '@plusplusoneplusplus/pipeline-core';

// VS Code-specific types (not in pipeline-core)
import * as vscode from 'vscode';
import { GitChangeStatus, GitChangeStage, GitChangeCounts, GitCommentCounts } from '@plusplusoneplusplus/pipeline-core';

/**
 * Represents a single git change (modified/added/deleted file).
 * VS Code-specific: includes vscode.Uri.
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
 * Section types in the Git view
 */
export type GitSectionType = 'changes' | 'commits' | 'comments';

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
    /** Number of diff comments */
    comments: GitCommentCounts;
}

