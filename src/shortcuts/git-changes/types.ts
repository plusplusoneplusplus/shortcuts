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
