/**
 * Shared Comment Types
 *
 * Union types and helpers that allow comment UI components
 * (CommentCard, CommentPopover, CommentSidebar) to accept
 * both TaskComment and DiffComment without `as any` casts.
 */

import type { TaskComment, TaskCommentReply, TaskCommentCategory } from './task-comments-types';
import { CATEGORY_INFO, getCommentCategory } from './task-comments-types';
import type { DiffComment, DiffCommentReply, DiffCommentCategory } from './diff-comment-types';
import { getDiffCommentCategory } from './diff-comment-types';

// ============================================================================
// Union Types
// ============================================================================

/** A comment from either the task or diff system. */
export type AnyComment = TaskComment | DiffComment;

/** A reply from either comment system (structurally identical). */
export type AnyCommentReply = TaskCommentReply | DiffCommentReply;

/** Category values are identical across both systems. */
export type AnyCommentCategory = TaskCommentCategory | DiffCommentCategory;

// ============================================================================
// Type Guards
// ============================================================================

/** Narrow to TaskComment by checking for the `taskId` field. */
export function isTaskComment(comment: AnyComment): comment is TaskComment {
    return 'taskId' in comment;
}

/** Narrow to DiffComment by checking for the `context` field. */
export function isDiffComment(comment: AnyComment): comment is DiffComment {
    return 'context' in comment;
}

// ============================================================================
// Category Helpers
// ============================================================================

/** Get the category for any comment type. */
export function getAnyCommentCategory(comment: AnyComment): AnyCommentCategory {
    if (isTaskComment(comment)) return getCommentCategory(comment);
    return getDiffCommentCategory(comment);
}

/** Get display info (label + icon) for any comment's category. */
export function getAnyCommentCategoryInfo(comment: AnyComment): { label: string; icon: string } {
    const category = getAnyCommentCategory(comment);
    return CATEGORY_INFO[category];
}
