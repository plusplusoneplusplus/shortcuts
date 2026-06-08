import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { isCommitChatLensEnabled } from '../../../utils/config';
import {
    clearReviewChatMinimized,
    isReviewChatPinned,
    getReviewChatTargetStorageId,
    readCommitChatOpen,
    readReviewChatMinimized,
    readReviewChatOpen,
    resolveReviewChatPresentation,
    pinReviewChat,
    unpinReviewChat,
    writeCommitChatOpen,
    writeReviewChatMinimized,
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
    minimizeChat: () => void;
    restoreChat: () => void;
    pinChat: () => void;
    unpinChat: () => void;
    isPinned: boolean;
    isMinimized: boolean;
    presentation: ReviewChatPresentation;
    lensEnabled: boolean;
    isDesktop: boolean;
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
        return target?.type === 'commit' ? readCommitChatOpen() : false;
    }, [supportsChat, lensFeatureEnabled, target, targetStorageId]);

    const writeOpenState = useCallback((open: boolean) => {
        if (lensFeatureEnabled) {
            if (target) writeReviewChatOpen(target, open);
            return;
        }
        if (target?.type === 'commit') writeCommitChatOpen(open);
    }, [lensFeatureEnabled, target, targetStorageId]);

    const [chatOpen, setChatOpen] = useState(readOpenState);
    const [isPinned, setIsPinned] = useState(() => (
        lensFeatureEnabled && supportsChat && target
            ? isReviewChatPinned(target)
            : false
    ));
    const [isMinimized, setIsMinimized] = useState(() => (
        lensFeatureEnabled && supportsChat && target
            ? readReviewChatMinimized(target)
            : false
    ));

    const presentation = resolveReviewChatPresentation({
        lensEnabled: lensFeatureEnabled,
        isDesktop,
        pinned: isPinned,
    });

    useEffect(() => {
        if (!supportsChat) {
            setChatOpen(false);
            return;
        }
        if (lensFeatureEnabled || target?.type === 'commit') {
            setChatOpen(readOpenState());
        }
    }, [supportsChat, lensFeatureEnabled, target?.type, readOpenState]);

    useEffect(() => {
        if (!supportsChat || !lensFeatureEnabled || !target) {
            setIsPinned(false);
            return;
        }
        setIsPinned(isReviewChatPinned(target));
    }, [supportsChat, lensFeatureEnabled, target, targetStorageId]);

    useEffect(() => {
        if (!supportsChat || !lensFeatureEnabled || !target) {
            setIsMinimized(false);
            return;
        }
        setIsMinimized(readReviewChatMinimized(target));
    }, [supportsChat, lensFeatureEnabled, target, targetStorageId]);

    const toggleChat = useCallback(() => {
        if (!supportsChat) return;
        const next = !chatOpen;
        writeOpenState(next);
        setChatOpen(next);
        if (!next) {
            if (target) clearReviewChatMinimized(target);
            setIsMinimized(false);
        }
    }, [chatOpen, supportsChat, target, targetStorageId, writeOpenState]);

    const closeChat = useCallback(() => {
        setChatOpen(false);
        writeOpenState(false);
        if (target) clearReviewChatMinimized(target);
        setIsMinimized(false);
    }, [target, targetStorageId, writeOpenState]);

    const minimizeChat = useCallback(() => {
        if (!target || presentation !== 'lens') return;
        writeReviewChatMinimized(target, true);
        setIsMinimized(true);
    }, [presentation, target, targetStorageId]);

    const restoreChat = useCallback(() => {
        if (target) clearReviewChatMinimized(target);
        setIsMinimized(false);
    }, [target, targetStorageId]);

    const pinChat = useCallback(() => {
        if (!target) return;
        pinReviewChat(target);
        setIsPinned(true);
        setIsMinimized(false);
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
        minimizeChat,
        restoreChat,
        pinChat,
        unpinChat,
        isPinned,
        isMinimized: presentation === 'lens' && isMinimized,
        presentation,
        lensEnabled: lensFeatureEnabled,
        isDesktop,
    };
}
