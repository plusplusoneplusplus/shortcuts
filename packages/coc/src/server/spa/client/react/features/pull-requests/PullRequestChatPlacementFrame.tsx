import { ReviewChatPlacementFrame } from '../git/reviewChat/ReviewChatPlacementFrame';
import { PullRequestChatPanel } from './PullRequestChatPanel';
import type { ReviewChatPresentation } from '../git/commits/commitChatPlacement';

export interface PullRequestChatPlacementFrameProps {
    workspaceId: string;
    prId: string;
    prNumber?: number;
    prTitle?: string;
    repoId?: string;
    presentation: ReviewChatPresentation;
    onClose: () => void;
    onPin?: () => void;
    onUnpin?: () => void;
}

export function PullRequestChatPlacementFrame({
    workspaceId,
    prId,
    prNumber,
    prTitle,
    repoId,
    presentation,
    onClose,
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
            onPin={onPin}
            onUnpin={onUnpin}
            testIdPrefix="pr-chat"
        >
            <PullRequestChatPanel
                workspaceId={workspaceId}
                prId={prId}
                prNumber={prNumber}
                prTitle={prTitle}
                repoId={repoId}
                onClose={onClose}
            />
        </ReviewChatPlacementFrame>
    );
}
