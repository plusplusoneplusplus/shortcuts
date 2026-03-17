/**
 * Shared comment-category constants.
 *
 * Both task comments and diff comments use the same set of categories.
 * Centralised here so the type, the array, and the regex are defined once.
 */

export type CommentCategory = 'bug' | 'question' | 'suggestion' | 'praise' | 'nitpick' | 'general';

export const ALL_COMMENT_CATEGORIES: CommentCategory[] = [
    'bug', 'question', 'suggestion', 'praise', 'nitpick', 'general',
];

/** Regex that matches a leading `[category]` prefix in a comment string (case-insensitive). */
export const COMMENT_CATEGORY_REGEX = /^\[(bug|question|suggestion|praise|nitpick|general)\]\s*/i;
