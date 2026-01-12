/**
 * Predefined Comment Types
 *
 * Type definitions for configurable predefined comments
 * used in both Markdown Review and Git Diff Review editors.
 */

/**
 * A predefined comment template
 */
export interface PredefinedComment {
    /** Unique identifier */
    id: string;
    /** Display label in the context menu */
    label: string;
    /** Text to pre-fill in the comment input */
    text: string;
    /** Sort order (lower numbers appear first, default: 100) */
    order?: number;
    /** Optional tooltip description */
    description?: string;
}

/**
 * Serialized version for webview communication
 */
export interface SerializedPredefinedComment {
    id: string;
    label: string;
    text: string;
    order: number;
    description?: string;
}

/**
 * Default predefined comments for Markdown Review Editor
 * Designed for reviewing implementation plans before AI coding
 */
export const DEFAULT_MARKDOWN_PREDEFINED_COMMENTS: PredefinedComment[] = [
    { id: 'reuse', label: 'Check Existing', text: '[Check Existing] Before implementing this, explore the codebase for existing utilities or patterns that can be reused. ', order: 1 },
    { id: 'verify-ref', label: 'Verify Reference', text: '[Verify Reference] This reference may not exist in the codebase. Please verify it exists or clarify that it needs to be created: ', order: 2 },
    { id: 'more-detail', label: 'More Detail', text: '[More Detail] This lacks sufficient detail for implementation. Please specify: ', order: 3 }
];

/**
 * Default predefined comments for Git Diff Review Editor
 */
export const DEFAULT_DIFF_PREDEFINED_COMMENTS: PredefinedComment[] = [
    { id: 'todo', label: 'TODO', text: 'TODO: ', order: 1 },
    { id: 'fixme', label: 'FIXME', text: 'FIXME: ', order: 2 },
    { id: 'question', label: 'Question', text: 'Question: ', order: 3 }
];

/**
 * Serialize predefined comments for webview
 */
export function serializePredefinedComments(comments: PredefinedComment[]): SerializedPredefinedComment[] {
    return comments.map(c => ({
        id: c.id,
        label: c.label,
        text: c.text,
        order: c.order ?? 100,
        description: c.description
    }));
}
