/**
 * FloatingChatContent — compact ChatDetail wrapper for floating mode.
 *
 * Rendered as children inside a FloatingDialog managed by FloatingChatManager.
 * Passes `variant="floating"` to ChatDetail for compact styling.
 */

import { ChatDetail } from './ChatDetail';

export interface FloatingChatContentProps {
    taskId: string;
    workspaceId?: string;
}

export function FloatingChatContent({ taskId, workspaceId }: FloatingChatContentProps) {
    return (
        <ChatDetail
            key={taskId}
            taskId={taskId}
            workspaceId={workspaceId}
            variant="floating"
        />
    );
}
