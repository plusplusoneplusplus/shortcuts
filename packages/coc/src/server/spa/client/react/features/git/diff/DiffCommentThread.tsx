import type { DiffComment } from '../../../../comments/diff-comment-types';
import { CommentCard } from '../../../tasks/comments/CommentCard';
import { formatDiffCommentPrompt } from '../../../utils/diffCommentPrompt';
import { useCurrentChatInsertDraft } from '../../repo-detail/unified-right-panel/unifiedChatCanvasActions';
import type { useDiffComments } from '../hooks/useDiffComments';

type ThreadActions = Pick<ReturnType<typeof useDiffComments>,
    'resolveComment' | 'unresolveComment' | 'updateComment' | 'deleteComment' | 'askAI' |
    'aiLoadingIds' | 'aiErrors' | 'clearAiError' | 'resolvingIds' | 'deletingIds'>;

export function DiffCommentThread({ comment, actions, onFixWithAI }: {
    comment: DiffComment;
    actions: ThreadActions;
    onFixWithAI?: () => void;
}) {
    const insertDraftIntoCurrentChat = useCurrentChatInsertDraft();
    return (
        <CommentCard
            comment={comment}
            onResolve={() => { void actions.resolveComment(comment.id); }}
            onUnresolve={() => { void actions.unresolveComment(comment.id); }}
            onEdit={text => { void actions.updateComment(comment.id, { comment: text }); }}
            onDelete={() => { void actions.deleteComment(comment.id); }}
            onAskAI={(commandId, customQuestion) => { void actions.askAI(comment.id, { commandId, customQuestion }); }}
            onFixWithAI={onFixWithAI}
            onClick={() => undefined}
            aiLoading={actions.aiLoadingIds.has(comment.id)}
            aiError={actions.aiErrors.get(comment.id) ?? null}
            onClearAiError={() => actions.clearAiError(comment.id)}
            isResolving={actions.resolvingIds.has(comment.id)}
            isDeleting={actions.deletingIds.has(comment.id)}
            getResolvePrompt={() => formatDiffCommentPrompt(comment)}
            onSendResolvePrompt={insertDraftIntoCurrentChat}
        />
    );
}
