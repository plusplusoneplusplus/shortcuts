import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { isCommitChatLensEnabled } from '../../../utils/config';
import {
    isReviewChatPinned,
    getReviewChatTargetStorageId,
    readCommitChatOpen,
    readReviewChatOpen,
    resolveReviewChatPresentation,
    pinReviewChat,
    unpinReviewChat,
    writeCommitChatOpen,
    writeReviewChatOpen,
} from '../commits/commitChatPlacement';
import type { ReviewChatPresentation, ReviewChatTarget } from '../commits/commitChatPlacement';

export interface UseReviewChatPresentationOptions {
    target: ReviewChatTarget | undefined;
    supportsChat?: boolean;
}

export interface UseReviewChatPresentationReturn {
    chatOpen: boolean;
    toggleChat: () => void;
    closeChat: () => void;
    pinChat: () => void;
    unpinChat: () => void;
    isPinned: boolean;
    presentation: ReviewChatPresentation;
    lensEnabled: boolean;
}

export function useReviewChatPresentation({
    target,
    supportsChat = true,
}: UseReviewChatPresentationOptions): UseReviewChatPresentationReturn {
    const { isDesktop } = useBreakpoint();
    const lensFeatureEnabled = isCommitChatLensEnabled();
    const targetStorageId = useMemo(() => {
        if (!target) return '';
        return getReviewChatTargetStorageId(target);
    }, [target]);

    const readOpenState = useCallback(() => {
        if (!supportsChat) return false;
        if (lensFeatureEnabled) {
            return target ? readReviewChatOpen(target) : false;
        }
        return readCommitChatOpen();
    }, [supportsChat, lensFeatureEnabled, target, targetStorageId]);

    const writeOpenState = useCallback((open: boolean) => {
        if (lensFeatureEnabled) {
            if (target) writeReviewChatOpen(target, open);
            return;
        }
        writeCommitChatOpen(open);
    }, [lensFeatureEnabled, target, targetStorageId]);

    const [chatOpen, setChatOpen] = useState(readOpenState);
    const [isPinned, setIsPinned] = useState(() => (
        lensFeatureEnabled && supportsChat && target
            ? isReviewChatPinned(target)
            : false
    ));

    useEffect(() => {
        setChatOpen(readOpenState());
    }, [readOpenState]);

    useEffect(() => {
        if (!supportsChat || !lensFeatureEnabled || !target) {
            setIsPinned(false);
            return;
        }
        setIsPinned(isReviewChatPinned(target));
    }, [supportsChat, lensFeatureEnabled, target, targetStorageId]);

    const toggleChat = useCallback(() => {
        if (!supportsChat) return;
        setChatOpen(prev => {
            const next = !prev;
            writeOpenState(next);
            return next;
        });
    }, [supportsChat, writeOpenState]);

    const closeChat = useCallback(() => {
        setChatOpen(false);
        writeOpenState(false);
    }, [writeOpenState]);

    const pinChat = useCallback(() => {
        if (!target) return;
        pinReviewChat(target);
        setIsPinned(true);
    }, [target, targetStorageId]);

    const unpinChat = useCallback(() => {
        if (!target) return;
        unpinReviewChat(target);
        setIsPinned(false);
    }, [target, targetStorageId]);

    return {
        chatOpen,
        toggleChat,
        closeChat,
        pinChat,
        unpinChat,
        isPinned,
        presentation: resolveReviewChatPresentation({
            lensEnabled: lensFeatureEnabled,
            isDesktop,
            pinned: isPinned,
        }),
        lensEnabled: lensFeatureEnabled,
    };
}
