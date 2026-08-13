/**
 * PrChatPanel — AI chat panel for pull request review in the pop-out window.
 *
 * Sends (workspaceId, prId, currentFilePath) as context identifiers.
 * The AI determines what to read — no diff content in the prompt.
 */

import { usePrChatBinding } from '../hooks/usePrChatBinding';
import { ChatDetail } from '../../chat/ChatDetail';
import { ChatPreferencesProvider } from '../../../contexts/ChatPreferencesContext';
import { InitialChatComposer } from '../../chat/NewChatArea';
import type { InitialChatComposerSubmission } from '../../chat/NewChatArea';
import { getReviewChatTargetStorageId } from './commitChatPlacement';

export interface PrChatPanelProps {
    workspaceId: string;
    prId: string;
    /** Currently selected file path in the pop-out (for context). */
    filePath?: string;
    /** Repo identifier the PR belongs to (may differ from workspaceId). */
    repoId?: string;
    /** PR title — forwarded to the AI framing sentence. */
    prTitle?: string;
    onClose: () => void;
    hideEmptyHeader?: boolean;
}

export function PrChatPanel({ workspaceId, prId, filePath, repoId, prTitle, onClose, hideEmptyHeader = false }: PrChatPanelProps) {
    const { taskId, loading, error, createChat } = usePrChatBinding({ workspaceId, prId, filePath, repoId, prTitle });

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

    return (
        <div className="flex flex-col bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden h-full w-full"
             data-testid="pr-chat-panel">

            {/* Header */}
            {!hideEmptyHeader && !taskId && (
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">💬 PR Chat</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#e8e8e8] dark:bg-[#333] text-blue-600 dark:text-blue-400">
                            #{prId}
                        </span>
                        {filePath && (
                            <span className="text-[10px] text-[#848484] truncate max-w-[200px]" title={filePath}>
                                · {filePath.split('/').pop()}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="text-xs px-1 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                            data-testid="pr-chat-close-btn" title="Close">✕</button>
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
                        heroDescription="Ask questions about the changes"
                        placeholder="Ask about this PR, or type / for commands..."
                        testIdPrefix="pr-chat"
                        draftKey={draftKey}
                        sourceLabel="PR review chat composer"
                        enableRalphDirectGoal={false}
                        settingsLayout="compact"
                    />
                </div>
            )}

            {/* Active chat */}
            {taskId && !loading && (
                <ChatPreferencesProvider workspaceId={workspaceId}>
                    <ChatDetail
                        taskId={taskId}
                        workspaceId={workspaceId}
                        variant="floating"
                        standalone
                        title={`PR Chat · #${prId}`}
                        hideModeSelector
                        onBack={onClose}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}
