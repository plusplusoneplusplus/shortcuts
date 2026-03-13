/**
 * ActivityDetailPane — right-side detail switcher for the Activity tab.
 *
 * Always renders ActivityChatDetail for any selected task.
 * When a deep-link selects a task before the queue list has loaded,
 * `selectedTask` may still be null.  In that case we show a loading
 * spinner while ActivityChatDetail fetches the task data.
 *
 * When a task is popped out into a separate window, shows a placeholder
 * with a "Restore inline" button.
 *
 * When a task is floated as an overlay dialog, shows a "Chat is floating"
 * placeholder with a "Restore inline" button that calls unfloatChat.
 */

import { ActivityChatDetail } from './ActivityChatDetail';
import { usePopOut } from '../context/PopOutContext';
import { useFloatingChats } from '../context/FloatingChatsContext';

export interface ActivityDetailPaneProps {
    selectedTaskId: string | null;
    selectedTask: any | null;
    onBack?: () => void;
    workspaceId?: string;
}

export function ActivityDetailPane({ selectedTaskId, onBack, workspaceId }: ActivityDetailPaneProps) {
    const { poppedOutTasks, markRestored } = usePopOut();
    const { floatingChats, unfloatChat } = useFloatingChats();

    if (!selectedTaskId) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                <div className="text-center">
                    <div className="text-2xl mb-2">📋</div>
                    <div>Select a task to view details</div>
                </div>
            </div>
        );
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

    return <ActivityChatDetail key={selectedTaskId} taskId={selectedTaskId} onBack={onBack} workspaceId={workspaceId} />;
}
