/**
 * ChatDetailPane — right-side detail switcher for the Activity tab.
 *
 * Routes purely on the selected task id, so a deep link works before the queue
 * list has loaded — ChatDetail fetches the task itself. With no id, renders
 * NewChatArea (or an empty-state prompt when read-only). A task that is popped
 * out into its own window, or floated as an overlay, gets a placeholder with a
 * "Restore inline" button instead of a second copy of the chat.
 */

import { ChatDetail } from './ChatDetail';
import { NewChatArea } from './NewChatArea';
import { usePopOut } from '../../contexts/PopOutContext';
import { useFloatingChats } from '../../contexts/FloatingChatsContext';

export interface ChatDetailPaneProps {
    selectedTaskId: string | null;
    selectedTask: any | null;
    onBack?: () => void;
    workspaceId?: string;
    /** Clone-qualified identity for Ralph launches opened from this workspace. */
    sourceSelectionId?: string;
    /** When true, hides the follow-up input area (read-only view). */
    readOnly?: boolean;
    /** When true, hides the ask/autopilot mode selector in the follow-up input. */
    hideModeSelector?: boolean;
    /** Opens the existing For Each run pane. */
    onOpenForEachRun?: (runId: string) => void;
    /** Opens the existing Map Reduce run pane. */
    onOpenMapReduceRun?: (runId: string) => void;
    /**
     * Active chat-list search query (AC-04/AC-05) — forwarded to ChatDetail so
     * the open conversation highlights matches while the search box is open.
     */
    searchHighlightQuery?: string;
}

export function ChatDetailPane({ selectedTaskId, onBack, workspaceId, sourceSelectionId, readOnly, hideModeSelector, onOpenForEachRun, onOpenMapReduceRun, searchHighlightQuery }: ChatDetailPaneProps) {
    const { poppedOutTasks, markRestored } = usePopOut();
    const { floatingChats, unfloatChat } = useFloatingChats();

    if (!selectedTaskId) {
        if (readOnly) {
            return (
                <div className="flex items-center justify-center h-full text-sm text-[#848484]" data-testid="activity-tasks-empty">
                    <div className="text-center space-y-2">
                        <div className="text-2xl opacity-40">☑</div>
                        <div>Select a task to view its execution details</div>
                    </div>
                </div>
            );
        }
        return <NewChatArea workspaceId={workspaceId} sourceSelectionId={sourceSelectionId} onBack={onBack} />;
    }

    if (poppedOutTasks.has(selectedTaskId)) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-[#848484]" data-testid="activity-popped-out-placeholder">
                <div className="text-center space-y-3">
                    <div className="text-2xl">↗</div>
                    <div>Chat is open in a separate window</div>
                    <button
                        className="text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff] underline"
                        onClick={() => markRestored(selectedTaskId)}
                        data-testid="activity-chat-restore-btn"
                    >
                        Restore inline
                    </button>
                </div>
            </div>
        );
    }

    if (floatingChats.has(selectedTaskId)) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-[#848484]" data-testid="activity-floating-placeholder">
                <div className="text-center space-y-3">
                    <div className="text-2xl">💬</div>
                    <div>Chat is floating</div>
                    <button
                        className="text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff] underline"
                        onClick={() => unfloatChat(selectedTaskId)}
                        data-testid="activity-chat-restore-inline-btn"
                    >
                        Restore inline
                    </button>
                </div>
            </div>
        );
    }

    return <ChatDetail key={selectedTaskId} taskId={selectedTaskId} onBack={onBack} workspaceId={workspaceId} sourceSelectionId={sourceSelectionId} readOnly={readOnly} hideModeSelector={hideModeSelector} onOpenForEachRun={onOpenForEachRun} onOpenMapReduceRun={onOpenMapReduceRun} searchHighlightQuery={searchHighlightQuery} />;
}
