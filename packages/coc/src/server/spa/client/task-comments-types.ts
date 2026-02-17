/**
 * Task Comments Types
 *
 * Core TypeScript types for task comments in the web UI.
 * Browser-compatible — no Node.js or VS Code dependencies.
 *
 * Selection, anchor, and relocation types are re-exported from pipeline-core.
 * CoC-specific types (TaskComment, TaskCommentsData) are defined here.
 */

// Re-export anchor/selection types from pipeline-core
export type { CommentSelection, CommentAnchor } from '@plusplusoneplusplus/pipeline-core/editor/types';

// ============================================================================
// Task Comment Types
// ============================================================================

/** Comment status values. */
export type TaskCommentStatus = 'open' | 'resolved';

/** Comment categories. */
export type TaskCommentCategory = 'bug' | 'question' | 'suggestion' | 'praise' | 'nitpick' | 'general';

/**
 * A single comment on a task document in the web UI.
 */
export interface TaskComment {
    /** Unique identifier (UUID) */
    id: string;
    /** Identifier of the task this comment belongs to */
    taskId: string;
    /** Selection range in the file */
    selection: import('@plusplusoneplusplus/pipeline-core/editor/types').CommentSelection;
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
    /** Optional comment category */
    category?: TaskCommentCategory;
    /** Optional anchor for robust location tracking after content changes */
    anchor?: import('@plusplusoneplusplus/pipeline-core/editor/types').CommentAnchor;
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
