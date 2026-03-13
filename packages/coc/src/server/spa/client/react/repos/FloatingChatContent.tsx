/**
 * FloatingChatContent — compact ActivityChatDetail wrapper for floating mode.
 *
 * Rendered as children inside a FloatingDialog managed by FloatingChatManager.
 * Passes `variant="floating"` to ActivityChatDetail for compact styling.
 */

import { ActivityChatDetail } from './ActivityChatDetail';

export interface FloatingChatContentProps {
    taskId: string;
    workspaceId?: string;
}

export function FloatingChatContent({ taskId, workspaceId }: FloatingChatContentProps) {
    return (
        <ActivityChatDetail
            key={taskId}
            taskId={taskId}
            workspaceId={workspaceId}
            variant="floating"
        />
    );
}
