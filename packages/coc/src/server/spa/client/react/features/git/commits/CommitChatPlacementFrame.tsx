import { useCallback, useRef } from 'react';
import { CommitChatPanel, type BindExistingChatFn } from './CommitChatPanel';
import { ReviewChatPlacementFrame } from '../reviewChat/ReviewChatPlacementFrame';
import { isSessionContextAttachmentsEnabled } from '../../../utils/config';
import type { CommitChatPresentation } from './commitChatPlacement';

export interface CommitChatPlacementFrameProps {
    workspaceId: string;
    commitHash: string;
    commitMessage?: string;
    presentation: CommitChatPresentation;
    onClose: () => void;
    isMinimized?: boolean;
    onMinimize?: () => void;
    onRestore?: () => void;
    onPin?: () => void;
    onUnpin?: () => void;
}

export function CommitChatPlacementFrame({
    workspaceId,
    commitHash,
    commitMessage,
    presentation,
    onClose,
    isMinimized,
    onMinimize,
    onRestore,
    onPin,
    onUnpin,
}: CommitChatPlacementFrameProps) {
    const bindExistingChatRef = useRef<BindExistingChatFn | null>(null);
    // Same flag that gates the drag sources; without it there is nothing to drag
    // and advertising a drop target would be a dead end.
    const dropEnabled = isSessionContextAttachmentsEnabled();

    const handleDropExistingChat = useCallback(async (processId: string) => {
        await bindExistingChatRef.current?.(processId);
    }, []);

    return (
        <ReviewChatPlacementFrame
            title="Commit Chat"
            identifier={commitHash.slice(0, 7)}
            presentation={presentation}
            onClose={onClose}
            isMinimized={isMinimized}
            onMinimize={onMinimize}
            onRestore={onRestore}
            onPin={onPin}
            onUnpin={onUnpin}
            testIdPrefix="commit-chat"
            onDropExistingChat={dropEnabled ? handleDropExistingChat : undefined}
            dropWorkspaceId={dropEnabled ? workspaceId : undefined}
        >
            <CommitChatPanel
                workspaceId={workspaceId}
                commitHash={commitHash}
                commitMessage={commitMessage}
                onClose={onClose}
                hideEmptyHeader
                bindExistingChatRef={dropEnabled ? bindExistingChatRef : undefined}
            />
        </ReviewChatPlacementFrame>
    );
}
