/**
 * fileCommentComposer — "Comment" on a changed-file row: a file-level review
 * comment on that file of that review, composed without selecting the file.
 *
 * The comment is a normal diff comment for the file's own comment context with
 * `scope: 'file'` and no selection, stored through the review owner's
 * diff-comments API. Open comment views of the review refresh through the
 * existing review comment channel.
 */

import { useRef, useState, type ReactNode } from 'react';
import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { InlineCommentPopup } from '../../../tasks/comments/InlineCommentPopup';
import type { DiffCommentContext } from '../../../../comments/diff-comment-types';
import { GIT_REVIEW_POPOUT_CHANNEL, type GitReviewPopOutMessage } from '../../../contexts/GitReviewPopOutContext';
import { getGitReviewClient } from './diffSource';
import type { ReviewRowMenuAnchor } from './ReviewFiles';

export interface FileCommentTarget {
    /** The review's raw workspace; the comment payload keeps it. */
    workspaceId: string;
    /** Concrete owner route, as the review's diff source passes to useDiffComments. */
    routingTarget?: string | null;
    /** The file's comment context, or null when the review has no comments for it. */
    context: DiffCommentContext | null;
    /** Why `context` is null, shown on the disabled action. */
    unavailableReason?: string;
    /** The path the row shows; defaults to the context's file path. */
    displayPath?: string;
}

interface Draft { target: FileCommentTarget & { context: DiffCommentContext }; path: string; row: HTMLElement; position: { top: number; left: number } }

export function useFileCommentComposer(): {
    menuItem: (anchor: ReviewRowMenuAnchor, target: FileCommentTarget) => ContextMenuItem;
    composer: ReactNode;
} {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [error, setError] = useState<string | null>(null);
    const saving = useRef(false);

    function close(row: HTMLElement) {
        setDraft(null);
        setError(null);
        if (row.isConnected) row.focus();
    }

    async function save(current: Draft, text: string, category: string) {
        if (saving.current) return;
        saving.current = true;
        setError(null);
        const { workspaceId, routingTarget, context } = current.target;
        try {
            await getGitReviewClient(workspaceId, routingTarget).git.createDiffComment(workspaceId, {
                context, scope: 'file', selectedText: '', comment: text, category,
            });
            notifyReviewComments(context);
            close(current.row);
        } catch (err) {
            setError(err instanceof Error && err.message ? `Comment not saved: ${err.message}` : 'Comment not saved');
        } finally {
            saving.current = false;
        }
    }

    return {
        menuItem: ({ x, y, row }, target) => {
            const context = target.context;
            return {
                label: 'Comment',
                icon: '💬',
                disabled: !context,
                title: context ? `Add a comment on the whole file ${target.displayPath ?? context.filePath}` : target.unavailableReason,
                onClick: () => {
                    if (!context) return;
                    setError(null);
                    setDraft({ target: { ...target, context }, path: target.displayPath ?? context.filePath, row, position: { top: y, left: x } });
                },
            };
        },
        composer: draft && <InlineCommentPopup
            label={`Comment on file ${draft.path}`}
            position={draft.position}
            error={error}
            onCancel={() => close(draft.row)}
            onSubmit={(text, category) => { void save(draft, text, category); }} />,
    };
}

/** Same-window and pop-out comment views of the review re-read their comments. */
function notifyReviewComments(context: DiffCommentContext) {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL);
    const message: GitReviewPopOutMessage = { type: 'git-review-comments-updated', key: `${context.repositoryId}:${context.oldRef}:${context.newRef}` };
    channel.postMessage(message);
    channel.close();
}
