import { CommitChatPanel } from './CommitChatPanel';
import { ReviewChatPlacementFrame } from '../reviewChat/ReviewChatPlacementFrame';
import type { CommitChatPresentation } from './commitChatPlacement';

export interface CommitChatPlacementFrameProps {
    workspaceId: string;
    commitHash: string;
    commitMessage?: string;
    presentation: CommitChatPresentation;
    onClose: () => void;
    onPin?: () => void;
    onUnpin?: () => void;
}

export function CommitChatPlacementFrame({
    workspaceId,
    commitHash,
    commitMessage,
    presentation,
    onClose,
    onPin,
    onUnpin,
}: CommitChatPlacementFrameProps) {
    return (
        <ReviewChatPlacementFrame
            title="Commit Chat"
            identifier={commitHash.slice(0, 7)}
            presentation={presentation}
            onClose={onClose}
            onPin={onPin}
            onUnpin={onUnpin}
            testIdPrefix="commit-chat"
        >
            <CommitChatPanel
                workspaceId={workspaceId}
                commitHash={commitHash}
                commitMessage={commitMessage}
                onClose={onClose}
                hideEmptyHeader
            />
        </ReviewChatPlacementFrame>
    );
}
