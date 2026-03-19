/**
 * Base types and interfaces for the comments system
 * These types are shared between markdown comments and diff comments
 */

/**
 * Comment status - shared across all comment types
 */
export type BaseCommentStatus = 'open' | 'resolved' | 'pending';

/**
 * Base selection interface - implementations extend this
 */
export interface BaseSelection {
    /** 1-based column number where selection starts */
    startColumn: number;
    /** 1-based column number where selection ends */
    endColumn: number;
}

/**
 * Base anchor interface for robust comment location tracking
 */
export interface BaseAnchor {
    /** The exact selected/commented text */
    selectedText: string;
    /** Text appearing before the selection */
    contextBefore: string;
    /** Text appearing after the selection */
    contextAfter: string;
    /** Original line number when the comment was created (for fallback) */
    originalLine: number;
    /** Hash/fingerprint of the selected text for quick comparison */
    textHash: string;
}

/**
 * Base anchor relocation result
 */
export interface BaseAnchorRelocationResult<TSelection extends BaseSelection> {
    /** Whether the anchor was successfully relocated */
    found: boolean;
    /** The new selection if found */
    selection?: TSelection;
    /** Confidence score of the match (0-1) */
    confidence: number;
    /** Reason for the result */
    reason: 'exact_match' | 'fuzzy_match' | 'context_match' | 'line_fallback' | 'not_found';
}

/**
 * Base comment interface - implementations extend this
 */
export interface BaseComment<TSelection extends BaseSelection, TAnchor extends BaseAnchor> {
    /** Unique identifier (UUID) */
    id: string;
    /** Relative path to the file */
    filePath: string;
    /** Selection range in the file */
    selection: TSelection;
    /** The actual selected text (for reference) */
    selectedText: string;
    /** User's comment content */
    comment: string;
    /** Current status of the comment */
    status: BaseCommentStatus;
    /** ISO timestamp when created */
    createdAt: string;
    /** ISO timestamp when last updated */
    updatedAt: string;
    /** Optional author name */
    author?: string;
    /** Optional tags for categorization */
    tags?: string[];
    /** Optional anchor for robust location tracking */
    anchor?: TAnchor;
}

/**
 * Base settings interface for comments display
 */
export interface BaseCommentsSettings {
    /** Whether to show resolved comments */
    showResolved: boolean;
    /** Highlight color for open comments (CSS color) */
    highlightColor: string;
    /** Highlight color for resolved comments (CSS color) */
    resolvedHighlightColor: string;
}

/**
 * Base configuration structure for comments storage
 */
export interface BaseCommentsConfig<TComment, TSettings extends BaseCommentsSettings> {
    /** Configuration version number */
    version: number;
    /** Array of all comments */
    comments: TComment[];
    /** Display settings */
    settings?: TSettings;
}

/**
 * Base comment event types
 */
export type BaseCommentEventType =
    | 'comment-added'
    | 'comment-updated'
    | 'comment-deleted'
    | 'comment-resolved'
    | 'comment-reopened'
    | 'comments-loaded';

/**
 * Base comment event data
 */
export interface BaseCommentEvent<TComment> {
    type: BaseCommentEventType;
    comment?: TComment;
    comments?: TComment[];
    filePath?: string;
}
