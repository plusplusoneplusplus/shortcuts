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

/**
 * Resolve the effective category for any comment-like object.
 * Checks the stored category field first; falls back to parsing a
 * `[category]` prefix from the comment text; returns 'general' as default.
 */
export function resolveCommentCategory(
    category: CommentCategory | undefined,
    commentText: string,
): CommentCategory {
    if (category && ALL_COMMENT_CATEGORIES.includes(category)) {
        return category;
    }
    const match = commentText.match(COMMENT_CATEGORY_REGEX);
    if (match) return match[1].toLowerCase() as CommentCategory;
    return 'general';
}
