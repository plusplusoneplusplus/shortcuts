/**
 * Task Comments Types
 *
 * Core TypeScript types for task comments in the web UI.
 * Browser-compatible — no Node.js or VS Code dependencies.
 *
 * Ported from the extension's markdown-comments/types.ts,
 * simplified to the subset needed by the SPA client.
 */

// ============================================================================
// Selection & Anchor Types
// ============================================================================

/**
 * Selection range within a document (all values are 1-based).
 */
export interface CommentSelection {
    /** 1-based line number where selection starts */
    startLine: number;
    /** 1-based column number where selection starts */
    startColumn: number;
    /** 1-based line number where selection ends */
    endLine: number;
    /** 1-based column number where selection ends */
    endColumn: number;
}

/**
 * Anchor context for robust comment location tracking.
 * Stores surrounding context to enable fuzzy matching after content changes.
 */
export interface CommentAnchor {
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
}

/**
 * Result of an anchor relocation attempt.
 */
export interface AnchorRelocationResult {
    /** Whether the anchor was successfully relocated */
    found: boolean;
    /** The new selection if found */
    selection?: CommentSelection;
    /** Confidence score of the match (0-1) */
    confidence: number;
    /** Reason for the result */
    reason: 'exact_match' | 'fuzzy_match' | 'context_match' | 'line_fallback' | 'not_found';
}

// ============================================================================
// Task Comment Types
// ============================================================================

/** Comment status values. */
export type TaskCommentStatus = 'open' | 'resolved';

/**
 * A single comment on a task document in the web UI.
 */
export interface TaskComment {
    /** Unique identifier (UUID) */
    id: string;
    /** Identifier of the task this comment belongs to */
    taskId: string;
    /** Selection range in the file */
    selection: CommentSelection;
    /** The actual selected text */
    selectedText: string;
    /** User's comment content */
    comment: string;
    /** Current status */
    status: TaskCommentStatus;
    /** ISO timestamp when created */
    createdAt: string;
    /** ISO timestamp when last updated */
    updatedAt: string;
    /** Optional author name */
    author?: string;
    /** Optional anchor for robust location tracking after content changes */
    anchor?: CommentAnchor;
}

/**
 * Container for all comments on a single task.
 */
export interface TaskCommentsData {
    /** Identifier of the task */
    taskId: string;
    /** Array of comments */
    comments: TaskComment[];
    /** Schema version for forward compatibility */
    version: number;
}
