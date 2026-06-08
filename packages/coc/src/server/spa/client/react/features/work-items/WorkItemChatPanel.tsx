import { useWorkItemChatBinding } from './hooks/useWorkItemChatBinding';
import { ChatDetail } from '../chat/ChatDetail';
import { ChatPreferencesProvider } from '../../contexts/ChatPreferencesContext';
import { InitialChatComposer } from '../chat/NewChatArea';
import type { InitialChatComposerSubmission } from '../chat/NewChatArea';
import { getReviewChatTargetStorageId } from '../git/commits/commitChatPlacement';

export interface WorkItemChatPanelProps {
    workspaceId: string;
    workItemId: string;
    workItemNumber?: number;
    title?: string;
    status?: string;
    type?: string;
    hasUnsavedChanges?: boolean;
    onClose: () => void;
    hideEmptyHeader?: boolean;
}

const WORK_ITEM_TYPE_PREFIX: Record<string, string> = {
    epic: 'E',
    feature: 'F',
    pbi: 'PBI',
    bug: 'BUG',
    goal: 'GOAL',
    'work-item': 'WI',
};

export function getWorkItemChatIdentifier(workItemId: string, workItemNumber?: number, type?: string): string {
    if (workItemNumber != null) {
        return `${WORK_ITEM_TYPE_PREFIX[type ?? 'work-item'] ?? 'WI'}-${workItemNumber}`;
    }
    return workItemId;
}

export function WorkItemChatPanel({
    workspaceId,
    workItemId,
    workItemNumber,
    title,
    status,
    type,
    hasUnsavedChanges = false,
    onClose,
    hideEmptyHeader = false,
}: WorkItemChatPanelProps) {
    const { taskId, loading, error, createChat } = useWorkItemChatBinding({
        workspaceId,
        workItemId,
        title,
        status,
        type,
        workItemNumber,
    });

    const identifier = getWorkItemChatIdentifier(workItemId, workItemNumber, type);
    const draftKey = `review-chat:${getReviewChatTargetStorageId({ type: 'work-item', workspaceId, workItemId })}`;

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

    const warning = hasUnsavedChanges ? (
        <div
            className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-200"
            data-testid="work-item-chat-unsaved-warning"
        >
            Unsaved edits are not included until you save this Work Item. Chat sees the saved state only.
        </div>
    ) : null;

    return (
        <div
            className="flex h-full w-full flex-col overflow-hidden bg-[#f8f8f8] dark:bg-[#1e1e1e]"
            data-testid="work-item-chat-panel"
        >
            {!hideEmptyHeader && !taskId && (
                <div className="flex items-center justify-between border-b border-[#e0e0e0] px-3 py-2 dark:border-[#3c3c3c]">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">💬 Work Item Chat</span>
                        <span className="rounded bg-[#e8e8e8] px-1.5 py-0.5 font-mono text-[10px] text-blue-600 dark:bg-[#333] dark:text-blue-400">
                            {identifier}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-1 text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                        data-testid="work-item-chat-close-btn"
                        title="Close"
                    >
                        ✕
                    </button>
                </div>
            )}

            {warning}

            {loading && (
                <div className="flex flex-1 items-center justify-center">
                    <div className="text-sm text-[#848484]">Loading...</div>
                </div>
            )}

            {error && !loading && (
                <div className="flex flex-1 items-center justify-center">
                    <div className="text-sm text-[#f14c4c]">{error}</div>
                </div>
            )}

            {!taskId && !loading && !error && (
                <div className="min-h-0 flex-1">
                    <InitialChatComposer
                        workspaceId={workspaceId}
                        onSubmit={handleComposerSubmit}
                        heroTitle="Chat about this Work Item"
                        heroDescription={`${identifier}${title ? ` · ${title}` : ''}`}
                        placeholder="Ask about this Work Item, or type / for commands..."
                        testIdPrefix="work-item-chat"
                        draftKey={draftKey}
                        sourceLabel="Work Item chat composer"
                        enableRalphDirectGoal={false}
                    />
                </div>
            )}

            {taskId && !loading && (
                <ChatPreferencesProvider workspaceId={workspaceId}>
                    <ChatDetail
                        taskId={taskId}
                        workspaceId={workspaceId}
                        variant="floating"
                        standalone
                        title={`Work Item Chat · ${identifier}`}
                        hideModeSelector
                        onBack={onClose}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}
