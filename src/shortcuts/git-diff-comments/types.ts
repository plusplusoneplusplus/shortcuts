/**
 * Types and interfaces for the Git Diff Comments feature
 * Provides inline commenting capability for Git diffs
 * Extends base types from markdown-comments for consistency
 */

import {
    BaseAnchor,
    BaseAnchorRelocationResult,
    BaseComment,
    BaseCommentEvent,
    BaseCommentEventType,
    BaseCommentsConfig,
    BaseCommentsSettings,
    BaseCommentStatus,
    BaseSelection
} from '../markdown-comments/base-types';

// Re-export base types for convenience
export type { BaseCommentEventType, BaseCommentStatus };

/**
 * Which side of the diff the selection/comment is on
 */
export type DiffSide = 'old' | 'new' | 'both';

/**
 * Comment status - uses base type for consistency
 */
export type DiffCommentStatus = BaseCommentStatus;

/**
 * Selection range within a diff view
 * Extends BaseSelection with diff-specific line tracking
 */
export interface DiffSelection extends BaseSelection {
    /** Side of the diff where selection was made */
    side: DiffSide;
    /** 1-based line number in the OLD file (null if selection is only in new) */
    oldStartLine: number | null;
    oldEndLine: number | null;
    /** 1-based line number in the NEW file (null if selection is only in old) */
    newStartLine: number | null;
    newEndLine: number | null;
}

/**
 * Anchor context for robust comment location tracking
 * Extends BaseAnchor with diff-specific side tracking
 */
export interface DiffAnchor extends BaseAnchor {
    /** Which side this anchor is for */
    side: DiffSide;
}

/**
 * Git context for a diff comment
 * Stores information about the Git state when comment was created
 */
export interface DiffGitContext {
    /** Repository root path */
    repositoryRoot: string;
    /** Repository name (for display) */
    repositoryName: string;
    /** Git ref for the OLD version (commit hash, HEAD, INDEX, etc.) */
    oldRef: string;
    /** Git ref for the NEW version */
    newRef: string;
    /** Whether the file was staged when commented */
    wasStaged: boolean;
    /** Commit hash if commenting on a committed file */
    commitHash?: string;
}

/**
 * A single diff comment
 * Extends BaseComment with diff-specific git context
 */
export interface DiffComment extends BaseComment<DiffSelection, DiffAnchor> {
    /** Git context when comment was created */
    gitContext: DiffGitContext;
}

/**
 * Result of anchor relocation attempt
 * Uses base type with DiffSelection
 */
export type DiffAnchorRelocationResult = BaseAnchorRelocationResult<DiffSelection>;

/**
 * Configuration for anchor creation and matching
 */
export interface DiffAnchorConfig {
    /** Number of characters to capture before the selection */
    contextCharsBefore: number;
    /** Number of characters to capture after the selection */
    contextCharsAfter: number;
    /** Minimum similarity threshold for fuzzy matching (0-1) */
    minSimilarityThreshold: number;
    /** Maximum line distance to search when relocating */
    maxLineSearchDistance: number;
}

/**
 * Default anchor configuration
 */
export const DEFAULT_DIFF_ANCHOR_CONFIG: DiffAnchorConfig = {
    contextCharsBefore: 100,
    contextCharsAfter: 100,
    minSimilarityThreshold: 0.6,
    maxLineSearchDistance: 50
};

/**
 * Settings for diff comments display
 * Uses base settings interface
 */
export type DiffCommentsSettings = BaseCommentsSettings;

/**
 * Default settings for diff comments
 */
export const DEFAULT_DIFF_COMMENTS_SETTINGS: DiffCommentsSettings = {
    showResolved: true,
    highlightColor: 'rgba(255, 235, 59, 0.3)',
    resolvedHighlightColor: 'rgba(76, 175, 80, 0.2)'
};

/**
 * Configuration structure for diff comments storage
 * Uses base config interface
 */
export type DiffCommentsConfig = BaseCommentsConfig<DiffComment, DiffCommentsSettings>;

/**
 * Default empty configuration
 */
export const DEFAULT_DIFF_COMMENTS_CONFIG: DiffCommentsConfig = {
    version: 1,
    comments: [],
    settings: DEFAULT_DIFF_COMMENTS_SETTINGS
};

/**
 * Diff comments configuration file name
 */
export const DIFF_COMMENTS_CONFIG_FILE = 'git-diff-comments.json';

/**
 * Comment event types for the event emitter
 * Uses base event type
 */
export type DiffCommentEventType = BaseCommentEventType;

/**
 * Comment event data
 * Uses base event interface
 */
export type DiffCommentEvent = BaseCommentEvent<DiffComment>;

/**
 * Parsed diff line information
 */
export interface DiffLine {
    /** Type of line: context, addition, deletion, or header */
    type: 'context' | 'addition' | 'deletion' | 'header';
    /** Content of the line (without +/- prefix) */
    content: string;
    /** Line number in the OLD file (null for additions) */
    oldLineNumber: number | null;
    /** Line number in the NEW file (null for deletions) */
    newLineNumber: number | null;
}

/**
 * A hunk in a diff (section of changes)
 */
export interface DiffHunk {
    /** Starting line in old file */
    oldStart: number;
    /** Number of lines in old file */
    oldCount: number;
    /** Starting line in new file */
    newStart: number;
    /** Number of lines in new file */
    newCount: number;
    /** Lines in this hunk */
    lines: DiffLine[];
    /** Optional header text (function name, etc.) */
    header?: string;
}

/**
 * Parsed diff structure
 */
export interface ParsedDiff {
    /** Old file path */
    oldPath: string;
    /** New file path */
    newPath: string;
    /** Hunks in this diff */
    hunks: DiffHunk[];
    /** Whether this is a binary file */
    isBinary: boolean;
    /** Whether this is a new file */
    isNew: boolean;
    /** Whether this is a deleted file */
    isDeleted: boolean;
    /** Whether this is a renamed file */
    isRenamed: boolean;
}

/**
 * Options for opening a diff review
 */
export interface DiffReviewOptions {
    /** File path */
    filePath: string;
    /** Git context */
    gitContext: DiffGitContext;
    /** Old file content */
    oldContent: string;
    /** New file content */
    newContent: string;
}

/**
 * Message types from webview to extension
 */
export interface DiffWebviewMessage {
    type: 'addComment' | 'editComment' | 'deleteComment' | 'resolveComment' |
          'reopenComment' | 'ready' | 'requestState';
    commentId?: string;
    selection?: DiffSelection;
    selectedText?: string;
    comment?: string;
}

/**
 * Message types from extension to webview
 */
export interface DiffExtensionMessage {
    type: 'update' | 'commentAdded' | 'commentUpdated' | 'commentDeleted';
    oldContent?: string;
    newContent?: string;
    comments?: DiffComment[];
    filePath?: string;
    settings?: DiffCommentsSettings;
    comment?: DiffComment;
}

