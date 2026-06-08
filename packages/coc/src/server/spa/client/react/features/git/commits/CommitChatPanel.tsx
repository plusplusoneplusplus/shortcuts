import { useCommitChatBinding } from '../hooks/useCommitChatBinding';
import { ChatDetail } from '../../chat/ChatDetail';
import { ChatPreferencesProvider } from '../../../contexts/ChatPreferencesContext';
import { InitialChatComposer } from '../../chat/NewChatArea';
import type { InitialChatComposerSubmission } from '../../chat/NewChatArea';
import { getReviewChatTargetStorageId } from './commitChatPlacement';

export interface CommitChatPanelProps {
    workspaceId: string;
    commitHash: string;
    commitMessage?: string;
    onClose: () => void;
    hideEmptyHeader?: boolean;
}

export function CommitChatPanel({ workspaceId, commitHash, commitMessage, onClose, hideEmptyHeader = false }: CommitChatPanelProps) {
    const { taskId, loading, error, createChat } = useCommitChatBinding({ workspaceId, commitHash, commitMessage });

    const draftKey = `review-chat:${getReviewChatTargetStorageId({ type: 'commit', workspaceId, commitHash })}`;

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
             data-testid="commit-chat-panel">

            {/* Header — only shown in empty/loading state. ChatDetail has its own header. */}
            {!hideEmptyHeader && !taskId && (
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">💬 Commit Chat</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#e8e8e8] dark:bg-[#333] text-blue-600 dark:text-blue-400">
                            {commitHash.slice(0, 7)}
                        </span>
                    </div>
                    <button onClick={onClose} className="text-xs px-1 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                            data-testid="commit-chat-close-btn" title="Close">✕</button>
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
                        heroTitle="Chat about this commit"
                        heroDescription="Ask questions about the changes"
                        placeholder="Ask about this commit, or type / for commands..."
                        testIdPrefix="commit-chat"
                        draftKey={draftKey}
                        sourceLabel="Commit chat composer"
                        enableRalphDirectGoal={false}
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
                        title={`Commit Chat · ${commitHash.slice(0, 7)}`}
                        hideModeSelector
                        onBack={onClose}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}
