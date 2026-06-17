import { ReviewChatPlacementFrame } from '../git/reviewChat/ReviewChatPlacementFrame';
import type { ReviewChatPresentation } from '../git/commits/commitChatPlacement';
import { WorkItemChatPanel, getWorkItemChatIdentifier } from './WorkItemChatPanel';

export interface WorkItemChatPlacementFrameProps {
    workspaceId: string;
    originId?: string;
    workItemId: string;
    workItemNumber?: number;
    title?: string;
    status?: string;
    type?: string;
    hasUnsavedChanges?: boolean;
    presentation: ReviewChatPresentation;
    onClose: () => void;
    isMinimized?: boolean;
    onMinimize?: () => void;
    onRestore?: () => void;
    onPin?: () => void;
    onUnpin?: () => void;
}

export function WorkItemChatPlacementFrame({
    workspaceId,
    originId,
    workItemId,
    workItemNumber,
    title,
    status,
    type,
    hasUnsavedChanges,
    presentation,
    onClose,
    isMinimized,
    onMinimize,
    onRestore,
    onPin,
    onUnpin,
}: WorkItemChatPlacementFrameProps) {
    return (
        <ReviewChatPlacementFrame
            title="Work Item Chat"
            identifier={getWorkItemChatIdentifier(workItemId, workItemNumber, type)}
            presentation={presentation}
            onClose={onClose}
            isMinimized={isMinimized}
            onMinimize={onMinimize}
            onRestore={onRestore}
            onPin={onPin}
            onUnpin={onUnpin}
            testIdPrefix="work-item-chat"
        >
            <WorkItemChatPanel
                workspaceId={workspaceId}
                originId={originId}
                workItemId={workItemId}
                workItemNumber={workItemNumber}
                title={title}
                status={status}
                type={type}
                hasUnsavedChanges={hasUnsavedChanges}
                onClose={onClose}
                hideEmptyHeader
            />
        </ReviewChatPlacementFrame>
    );
}
