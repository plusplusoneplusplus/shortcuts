/**
 * Types and interfaces for the Git Diff Comments feature
 * Provides inline commenting capability for Git diffs
 */

/**
 * Which side of the diff the selection/comment is on
 */
export type DiffSide = 'old' | 'new' | 'both';

/**
 * Comment status - same as markdown comments for consistency
 */
export type DiffCommentStatus = 'open' | 'resolved' | 'pending';

/**
 * Selection range within a diff view
 * Tracks positions on both old and new sides
 */
export interface DiffSelection {
    /** Side of the diff where selection was made */
    side: DiffSide;
    /** 1-based line number in the OLD file (null if selection is only in new) */
    oldStartLine: number | null;
    oldEndLine: number | null;
    /** 1-based line number in the NEW file (null if selection is only in old) */
    newStartLine: number | null;
    newEndLine: number | null;
    /** Column positions (1-based) */
    startColumn: number;
    endColumn: number;
}

/**
 * Anchor context for robust comment location tracking
 * Stores surrounding context to enable fuzzy matching after content changes
 */
export interface DiffAnchor {
    /** The exact selected/commented text */
    selectedText: string;
    /** Text appearing before the selection (up to N characters) */
    contextBefore: string;
    /** Text appearing after the selection (up to N characters) */
    contextAfter: string;
    /** Original line number when the comment was created (for fallback) */
    originalLine: number;
    /** Hash/fingerprint of the selected text for quick comparison */
    textHash: string;
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
 */
export interface DiffComment {
    /** Unique identifier (UUID) */
    id: string;
    /** Relative path to the file */
    filePath: string;
    /** Selection range in the diff */
    selection: DiffSelection;
    /** The actual selected text (for reference) */
    selectedText: string;
    /** User's comment content */
    comment: string;
    /** Current status of the comment */
    status: DiffCommentStatus;
    /** ISO timestamp when created */
    createdAt: string;
    /** ISO timestamp when last updated */
    updatedAt: string;
    /** Optional author name */
    author?: string;
    /** Optional tags for categorization */
    tags?: string[];
    /** Git context when comment was created */
    gitContext: DiffGitContext;
    /** Optional anchor for robust location tracking */
    anchor?: DiffAnchor;
}

/**
 * Result of anchor relocation attempt
 */
export interface DiffAnchorRelocationResult {
    /** Whether the anchor was successfully relocated */
    found: boolean;
    /** The new selection if found */
    selection?: DiffSelection;
    /** Confidence score of the match (0-1) */
    confidence: number;
    /** Reason for the result */
    reason: 'exact_match' | 'fuzzy_match' | 'context_match' | 'line_fallback' | 'not_found';
}

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
 */
export interface DiffCommentsSettings {
    /** Whether to show resolved comments */
    showResolved: boolean;
    /** Highlight color for open comments (CSS color) */
    highlightColor: string;
    /** Highlight color for resolved comments (CSS color) */
    resolvedHighlightColor: string;
}

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
 */
export interface DiffCommentsConfig {
    /** Configuration version number */
    version: number;
    /** Array of all diff comments */
    comments: DiffComment[];
    /** Display settings */
    settings?: DiffCommentsSettings;
}

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
 */
export type DiffCommentEventType =
    | 'comment-added'
    | 'comment-updated'
    | 'comment-deleted'
    | 'comment-resolved'
    | 'comment-reopened'
    | 'comments-loaded';

/**
 * Comment event data
 */
export interface DiffCommentEvent {
    type: DiffCommentEventType;
    comment?: DiffComment;
    comments?: DiffComment[];
    filePath?: string;
}

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

