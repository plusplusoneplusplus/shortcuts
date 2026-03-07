/**
 * ActivityDetailPane — right-side detail switcher for the Activity tab.
 *
 * Renders ActivityChatDetail for top-level chat tasks and
 * QueueTaskDetail for everything else.
 */

import { ActivityChatDetail } from './ActivityChatDetail';
import { QueueTaskDetail } from '../queue/QueueTaskDetail';

export interface ActivityDetailPaneProps {
    selectedTaskId: string | null;
    selectedTask: any | null;
    onBack?: () => void;
}

function isTopLevelChatTask(task: any): boolean {
    return task?.type === 'chat' && !(task as any).payload?.processId;
}

export function ActivityDetailPane({ selectedTaskId, selectedTask, onBack }: ActivityDetailPaneProps) {
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

    if (isTopLevelChatTask(selectedTask)) {
        return <ActivityChatDetail taskId={selectedTaskId} onBack={onBack} />;
    }

    return <QueueTaskDetail onBack={onBack} />;
}
