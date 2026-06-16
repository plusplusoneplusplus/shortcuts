import { ReviewChatPlacementFrame } from '../git/reviewChat/ReviewChatPlacementFrame';
import { PullRequestChatPanel } from './PullRequestChatPanel';
import type { ReviewChatPresentation } from '../git/commits/commitChatPlacement';

export interface PullRequestChatPlacementFrameProps {
    workspaceId: string;
    remoteUrl?: string | null;
    prId: string;
    prNumber?: number;
    prTitle?: string;
    repoId?: string;
    presentation: ReviewChatPresentation;
    onClose: () => void;
    isMinimized?: boolean;
    onMinimize?: () => void;
    onRestore?: () => void;
    onPin?: () => void;
    onUnpin?: () => void;
}

export function PullRequestChatPlacementFrame({
    workspaceId,
    remoteUrl,
    prId,
    prNumber,
    prTitle,
    repoId,
    presentation,
    onClose,
    isMinimized,
    onMinimize,
    onRestore,
    onPin,
    onUnpin,
}: PullRequestChatPlacementFrameProps) {
    const prLabel = prNumber != null ? `#${prNumber}` : prId;

    return (
        <ReviewChatPlacementFrame
            title="PR Chat"
            identifier={prLabel}
            presentation={presentation}
            onClose={onClose}
            isMinimized={isMinimized}
            onMinimize={onMinimize}
            onRestore={onRestore}
            onPin={onPin}
            onUnpin={onUnpin}
            testIdPrefix="pr-chat"
        >
            <PullRequestChatPanel
                workspaceId={workspaceId}
                remoteUrl={remoteUrl}
                prId={prId}
                prNumber={prNumber}
                prTitle={prTitle}
                repoId={repoId}
                onClose={onClose}
                hideEmptyHeader
            />
        </ReviewChatPlacementFrame>
    );
}
