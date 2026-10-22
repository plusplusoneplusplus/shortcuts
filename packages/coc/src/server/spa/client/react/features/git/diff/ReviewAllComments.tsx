/**
 * ReviewAllComments — full-panel list of every comment in one review (branch
 * range or working tree), grouped by file, with CRUD and Copy as prompt.
 * CommitDetail shows the same list as a toolbar sidebar.
 */

import { Spinner } from '../../../ui';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import { useReviewComments, type ReviewCommentScope } from '../hooks/useReviewComments';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';

export interface ReviewAllCommentsProps {
    workspaceId: string;
    /** Concrete review owner; omitted uses the workspace's own clone route. */
    attachmentDestinationId?: string;
    scope: ReviewCommentScope;
    title: string;
    /** Prefix for the view's test ids (`-loading`, `-error`, `-sidebar`). */
    testId: string;
}

export function ReviewAllComments(props: ReviewAllCommentsProps) {
    const owner = props.attachmentDestinationId;
    if (owner && owner !== props.workspaceId && resolveCloneRoute(owner).kind === 'unresolved-remote') {
        return <div role="alert" className="px-4 py-4 text-xs" data-testid={`${props.testId}-error`}>Git review owner is unavailable</div>;
    }
    return <ReviewAllCommentsBody {...props} />;
}

function ReviewAllCommentsBody({ workspaceId, attachmentDestinationId, scope, title, testId }: ReviewAllCommentsProps) {
    const review = useReviewComments(workspaceId, scope, attachmentDestinationId === workspaceId ? null : attachmentDestinationId);
    const withComment = (id: string, action: (comment: typeof review.comments[number]) => Promise<void>) => {
        const comment = review.comments.find(c => c.id === id);
        if (comment) void action(comment);
    };

    if (review.loading && review.comments.length === 0) {
        return (
            <div className="flex items-center gap-2 px-4 py-4 text-xs text-[#848484]" data-testid={`${testId}-loading`}>
                <Spinner size="sm" /> Loading comments…
            </div>
        );
    }

    if (review.error) {
        return (
            <div role="alert" className="px-4 py-4 text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid={`${testId}-error`}>
                {review.error}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden" data-testid={testId}>
            <div className="px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526] text-xs font-semibold text-[#616161] dark:text-[#999]">
                {title}
            </div>
            <CommentSidebar
                comments={review.comments}
                loading={false}
                showFilePath
                groupByFile
                fullWidth
                onResolve={id => withComment(id, review.resolveComment)}
                onUnresolve={id => withComment(id, review.unresolveComment)}
                onDelete={id => withComment(id, review.deleteComment)}
                onEdit={(id, text) => withComment(id, c => review.updateComment(c, { comment: text }))}
                onAskAI={() => undefined}
                onCommentClick={() => undefined}
                onCopyPrompt={review.copyAllCommentsAsPrompt}
                data-testid={`${testId}-sidebar`}
            />
        </div>
    );
}
