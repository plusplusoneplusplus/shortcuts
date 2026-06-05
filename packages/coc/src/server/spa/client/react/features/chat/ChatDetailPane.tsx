/**
 * ChatDetailPane — right-side detail switcher for the Activity tab.
 *
 * Always renders ChatDetail for any selected task.
 * When a deep-link selects a task before the queue list has loaded,
 * `selectedTask` may still be null.  In that case we show a loading
 * spinner while ChatDetail fetches the task data.
 *
 * When a task is popped out into a separate window, shows a placeholder
 * with a "Restore inline" button.
 *
 * When a task is floated as an overlay dialog, shows a "Chat is floating"
 * placeholder with a "Restore inline" button that calls unfloatChat.
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
    /** When true, hides the follow-up input area (read-only view). */
    readOnly?: boolean;
    /** When true, hides the ask/autopilot mode selector in the follow-up input. */
    hideModeSelector?: boolean;
    /** Opens the existing For Each run pane. */
    onOpenForEachRun?: (runId: string) => void;
}

export function ChatDetailPane({ selectedTaskId, onBack, workspaceId, readOnly, hideModeSelector, onOpenForEachRun }: ChatDetailPaneProps) {
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
        return <NewChatArea workspaceId={workspaceId} onBack={onBack} />;
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

    return <ChatDetail key={selectedTaskId} taskId={selectedTaskId} onBack={onBack} workspaceId={workspaceId} readOnly={readOnly} hideModeSelector={hideModeSelector} onOpenForEachRun={onOpenForEachRun} />;
}
