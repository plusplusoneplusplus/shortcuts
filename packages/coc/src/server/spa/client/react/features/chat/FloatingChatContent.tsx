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
    sourceSelectionId?: string;
    sourceBaseUrl?: string;
}

export function FloatingChatContent({ taskId, workspaceId, sourceSelectionId, sourceBaseUrl }: FloatingChatContentProps) {
    return (
        <ChatDetail
            key={taskId}
            taskId={taskId}
            workspaceId={workspaceId}
            sourceSelectionId={sourceSelectionId}
            sourceBaseUrl={sourceBaseUrl}
            variant="floating"
        />
    );
}
