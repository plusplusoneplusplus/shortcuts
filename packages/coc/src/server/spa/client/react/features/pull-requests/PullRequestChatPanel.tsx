/**
 * PullRequestChatPanel — side-by-side AI chat for a pull request.
 *
 * Mirrors `CommitChatPanel`: binds a PR to a chat task, then delegates to
 * the standard `ChatDetail` surface once the chat exists. This reuses the
 * same Ask-AI machinery that powers commit chat instead of relying on
 * deterministic mock fixtures.
 */

import { usePullRequestChatBinding } from './hooks/usePullRequestChatBinding';
import { ChatDetail } from '../chat/ChatDetail';
import { ChatPreferencesProvider } from '../../contexts/ChatPreferencesContext';
import { InitialChatComposer } from '../chat/NewChatArea';
import type { InitialChatComposerSubmission } from '../chat/NewChatArea';
import { getReviewChatTargetStorageId } from '../git/commits/commitChatPlacement';

export interface PullRequestChatPanelProps {
    workspaceId: string;
    /** Stringified PR identifier — stable per provider (GitHub PR number, ADO PR ID). */
    prId: string;
    prNumber?: number;
    prTitle?: string;
    /** Repo identifier the PR belongs to (typically equal to workspaceId). */
    repoId?: string;
    onClose: () => void;
}

export function PullRequestChatPanel({
    workspaceId,
    prId,
    prNumber,
    prTitle,
    repoId,
    onClose,
}: PullRequestChatPanelProps) {
    const { taskId, loading, error, createChat } = usePullRequestChatBinding({
        workspaceId,
        prId,
        prNumber,
        prTitle,
        repoId,
    });

    const draftKey = `review-chat:${getReviewChatTargetStorageId({
        type: 'pr',
        workspaceId,
        repoId,
        prId,
    })}`;

    const handleComposerSubmit = async (submission: InitialChatComposerSubmission) => createChat(submission.prompt, {
        mode: submission.mode,
        context: submission.context,
        attachments: submission.attachments,
        provider: submission.provider,
        model: submission.model,
        reasoningEffort: submission.reasoningEffort,
        config: submission.config,
        workingDirectory: submission.workingDirectory,
    });

    const prLabel = prNumber != null ? `#${prNumber}` : prId;

    return (
        <div
            className="flex flex-col bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden h-full w-full"
            data-testid="pr-chat-panel"
        >
            {/* Header — only shown in empty/loading state. ChatDetail has its own header. */}
            {!taskId && (
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">💬 PR Chat</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#e8e8e8] dark:bg-[#333] text-blue-600 dark:text-blue-400">
                            {prLabel}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-xs px-1 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                        data-testid="pr-chat-close-btn"
                        title="Close"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Loading state */}
            {loading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-sm text-[#848484]">Loading...</div>
                </div>
            )}

            {/* Error state */}
            {error && !loading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-sm text-[#f14c4c]">{error}</div>
                </div>
            )}

            {/* Empty state — no chat yet */}
            {!taskId && !loading && !error && (
                <div className="min-h-0 flex-1">
                    <InitialChatComposer
                        workspaceId={workspaceId}
                        onSubmit={handleComposerSubmit}
                        heroTitle="Chat about this PR"
                        heroDescription="Ask questions about risk, tests, files, or reviewer replies"
                        placeholder="Ask about this pull request, or type / for commands..."
                        testIdPrefix="pr-chat"
                        draftKey={draftKey}
                        sourceLabel="PR chat composer"
                        enableRalphDirectGoal={false}
                        settingsLayout="compact"
                    />
                </div>
            )}

            {/* Active chat — delegate entirely to ChatDetail */}
            {taskId && !loading && (
                <ChatPreferencesProvider workspaceId={workspaceId}>
                    <ChatDetail
                        taskId={taskId}
                        workspaceId={workspaceId}
                        variant="floating"
                        standalone
                        title={`PR Chat · ${prLabel}`}
                        hideModeSelector
                        onBack={onClose}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}
