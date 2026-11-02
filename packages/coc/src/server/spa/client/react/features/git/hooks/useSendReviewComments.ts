import type { DiffComment } from '../../../../comments/diff-comment-types';
import { formatDiffCommentsPrompt, formatReviewCommentsPrompt, unresolvedReviewComments, type DiffCommentPromptContext, type ReviewCommentScope } from '../../../utils/diffCommentPrompt';
import { useCurrentChatSend } from '../../repo-detail/unified-right-panel/currentChatSend';

/** Reuse the copy formatters, retaining the source repo when reviewing a group member. */
export function useSendReviewComments(
    workspaceId: string,
    comments: readonly DiffComment[],
    context: DiffCommentPromptContext | ReviewCommentScope,
) {
    const chat = useCurrentChatSend();
    return {
        sendDisabledReason: chat.disabledReason,
        confirmAutopilotBeforeSend: chat.requiresAutopilotConfirmation,
        onSendPrompt: async (switchToAutopilot = false) => {
            if (!unresolvedReviewComments(comments).length) throw new Error('No unresolved comments to send.');
            const prompt = 'kind' in context
                ? formatReviewCommentsPrompt(context, comments)
                : formatDiffCommentsPrompt(context, unresolvedReviewComments(comments));
            await chat.send(`Repository workspace: ${workspaceId}\n\n${prompt}`, switchToAutopilot);
        },
    };
}
