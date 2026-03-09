/**
 * ActivityDetailPane — right-side detail switcher for the Activity tab.
 *
 * Always renders ActivityChatDetail for any selected task.
 * When a deep-link selects a task before the queue list has loaded,
 * `selectedTask` may still be null.  In that case we show a loading
 * spinner while ActivityChatDetail fetches the task data.
 */

import { ActivityChatDetail } from './ActivityChatDetail';

export interface ActivityDetailPaneProps {
    selectedTaskId: string | null;
    selectedTask: any | null;
    onBack?: () => void;
    workspaceId?: string;
}

export function ActivityDetailPane({ selectedTaskId, onBack, workspaceId }: ActivityDetailPaneProps) {
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

    return <ActivityChatDetail taskId={selectedTaskId} onBack={onBack} workspaceId={workspaceId} />;
}
