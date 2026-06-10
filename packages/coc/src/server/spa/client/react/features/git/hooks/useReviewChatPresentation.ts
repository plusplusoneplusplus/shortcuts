import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBreakpoint } from '../../../hooks/ui/useBreakpoint';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isCommitChatLensEnabled } from '../../../utils/config';
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
    forceLensOnNonDesktop?: boolean;
    legacyOpenStorageKey?: string;
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
    forceLensOnNonDesktop = false,
    legacyOpenStorageKey,
}: UseReviewChatPresentationOptions): UseReviewChatPresentationReturn {
    const { isDesktop } = useBreakpoint();
    const [configRevision, setConfigRevision] = useState(0);
    const lensFeatureEnabled = useMemo(() => isCommitChatLensEnabled(), [configRevision]);
    const targetStorageId = useMemo(() => {
        if (!target) return '';
        return getReviewChatTargetStorageId(target);
    }, [target]);

    useEffect(() => {
        const onConfigUpdated = () => setConfigRevision(value => value + 1);
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);

    const readLegacyOpenState = useCallback(() => {
        if (!legacyOpenStorageKey) return false;
        try {
            return localStorage.getItem(legacyOpenStorageKey) === 'true';
        } catch {
            return false;
        }
    }, [legacyOpenStorageKey]);

    const writeLegacyOpenState = useCallback((nextOpen: boolean) => {
        if (!legacyOpenStorageKey) return;
        try {
            localStorage.setItem(legacyOpenStorageKey, String(nextOpen));
        } catch {
            /* ignore unavailable client storage */
        }
    }, [legacyOpenStorageKey]);

    const readOpenState = useCallback(() => {
        if (!supportsChat) return false;
        if (lensFeatureEnabled) {
            return target ? readReviewChatOpen(target) : false;
        }
        if (legacyOpenStorageKey) return readLegacyOpenState();
        return target?.type === 'commit' ? readCommitChatOpen() : false;
    }, [supportsChat, lensFeatureEnabled, target, targetStorageId, legacyOpenStorageKey, readLegacyOpenState]);

    const writeOpenState = useCallback((open: boolean) => {
        if (lensFeatureEnabled) {
            if (target) writeReviewChatOpen(target, open);
            return;
        }
        if (legacyOpenStorageKey) {
            writeLegacyOpenState(open);
            return;
        }
        if (target?.type === 'commit') writeCommitChatOpen(open);
    }, [lensFeatureEnabled, target, targetStorageId, legacyOpenStorageKey, writeLegacyOpenState]);

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
        forceLensOnNonDesktop,
    });

    useEffect(() => {
        if (!supportsChat) {
            setChatOpen(false);
            return;
        }
        setChatOpen(readOpenState());
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
