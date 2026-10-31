/**
 * FileLevelComments — whole-file review comments above a file's diff, with the
 * same thread card line comments use. Line viewers never receive these.
 */

import type { ReactNode } from 'react';
import { isFileDiffComment, isLineDiffComment, type DiffComment, type LineDiffComment } from '../../../../comments/diff-comment-types';

/**
 * Line comments for the diff viewers, file comments for this strip. A list
 * with no file comments is returned as is, so viewers keep a stable array.
 */
export function splitFileComments(comments: DiffComment[]): { lineComments: LineDiffComment[]; fileComments: DiffComment[] } {
    if (!comments.some(isFileDiffComment)) return { lineComments: comments as LineDiffComment[], fileComments: [] };
    return { lineComments: comments.filter(isLineDiffComment), fileComments: comments.filter(isFileDiffComment) };
}

/** Scrolls a file comment's card into view and flashes it; false when it is not a shown file comment. */
export function revealFileComment(container: HTMLElement | null, comment: DiffComment): boolean {
    if (!isFileDiffComment(comment)) return false;
    const card = container?.querySelector<HTMLElement>(`[data-file-comment-id="${comment.id.replace(/["\\]/g, '\\$&')}"]`);
    if (!card) return false;
    card.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    card.classList.add('ring-2', 'ring-yellow-400');
    setTimeout(() => card.classList.remove('ring-2', 'ring-yellow-400'), 1500);
    return true;
}

export function FileLevelComments({ comments, renderCommentThread }: {
    comments: readonly DiffComment[];
    renderCommentThread: (comment: DiffComment) => ReactNode;
}) {
    if (!comments.length) return null;
    return <section aria-label="File comments" data-testid="file-level-comments"
        className="mb-1 flex flex-col gap-1 border-b border-[#e0e0e0] pb-1 dark:border-[#3c3c3c]">
        <span className="px-1 text-[11px] font-medium text-[#616161] dark:text-[#999]">File comments ({comments.length})</span>
        {comments.map(comment => <div key={comment.id} data-file-comment-id={comment.id} className="rounded">{renderCommentThread(comment)}</div>)}
    </section>;
}
