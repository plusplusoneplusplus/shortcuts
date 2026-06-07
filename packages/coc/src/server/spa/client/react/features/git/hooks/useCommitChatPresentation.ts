import { useCallback, useEffect, useState } from 'react';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { isCommitChatLensEnabled } from '../../../utils/config';
import {
    isCommitChatPinned,
    pinCommitChat,
    readCommitChatOpen,
    resolveCommitChatPresentation,
    unpinCommitChat,
    writeCommitChatOpen,
} from '../commits/commitChatPlacement';
import type { CommitChatPresentation } from '../commits/commitChatPlacement';

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
    const { isDesktop } = useBreakpoint();
    const lensFeatureEnabled = isCommitChatLensEnabled();
    const [chatOpen, setChatOpen] = useState(() => supportsChat ? readCommitChatOpen() : false);
    const [isPinned, setIsPinned] = useState(() => (
        lensFeatureEnabled && supportsChat && commitHash
            ? isCommitChatPinned(workspaceId, commitHash)
            : false
    ));

    useEffect(() => {
        if (!supportsChat || !lensFeatureEnabled || !commitHash) {
            setIsPinned(false);
            return;
        }
        setIsPinned(isCommitChatPinned(workspaceId, commitHash));
    }, [workspaceId, commitHash, supportsChat, lensFeatureEnabled]);

    const toggleChat = useCallback(() => {
        if (!supportsChat) return;
        setChatOpen(prev => {
            const next = !prev;
            writeCommitChatOpen(next);
            return next;
        });
    }, [supportsChat]);

    const closeChat = useCallback(() => {
        setChatOpen(false);
        writeCommitChatOpen(false);
    }, []);

    const pinChat = useCallback(() => {
        if (!commitHash) return;
        pinCommitChat(workspaceId, commitHash);
        setIsPinned(true);
    }, [workspaceId, commitHash]);

    const unpinChat = useCallback(() => {
        if (!commitHash) return;
        unpinCommitChat(workspaceId, commitHash);
        setIsPinned(false);
    }, [workspaceId, commitHash]);

    return {
        chatOpen,
        toggleChat,
        closeChat,
        pinChat,
        unpinChat,
        isPinned,
        presentation: resolveCommitChatPresentation({
            lensEnabled: lensFeatureEnabled,
            isDesktop,
            pinned: isPinned,
        }),
        lensEnabled: lensFeatureEnabled,
    };
}
