import { useMemo } from 'react';
import { useReviewChatPresentation } from './useReviewChatPresentation';
import type { CommitChatPresentation, ReviewChatTarget } from '../commits/commitChatPlacement';

export interface UseCommitChatPresentationOptions {
    workspaceId: string;
    commitHash: string | undefined;
    supportsChat?: boolean;
}

export interface UseCommitChatPresentationReturn {
    chatOpen: boolean;
    toggleChat: () => void;
    closeChat: () => void;
    pinChat: () => void;
    unpinChat: () => void;
    isPinned: boolean;
    presentation: CommitChatPresentation;
    lensEnabled: boolean;
}

export function useCommitChatPresentation({
    workspaceId,
    commitHash,
    supportsChat = true,
}: UseCommitChatPresentationOptions): UseCommitChatPresentationReturn {
    const target = useMemo<ReviewChatTarget | undefined>(() => (
        commitHash ? { type: 'commit', workspaceId, commitHash } : undefined
    ), [workspaceId, commitHash]);

    return useReviewChatPresentation({ target, supportsChat });
}
