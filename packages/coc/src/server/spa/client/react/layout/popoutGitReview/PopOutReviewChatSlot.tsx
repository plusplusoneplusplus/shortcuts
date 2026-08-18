/**
 * Chat placement slots shared by the pop-out review types.
 *
 * The side panel lives inside the review row and the lens floats over it, so
 * the two placements are separate components — but the open/pin/minimize rules
 * that decide which one renders live here, once.
 */

import type { ReactNode } from 'react';
import type { ReviewChatPresentation } from '../../features/git/commits/commitChatPlacement';

/** Structural view of the chat presentation hooks (commit and review flavors). */
export interface PopOutChatPresentationState {
    chatOpen: boolean;
    presentation: ReviewChatPresentation;
    isPinned: boolean;
    lensEnabled: boolean;
    isDesktop: boolean;
}

/** True when the pinned, framed variant of the side panel should be used. */
export function usesFramedSidePanel(chat: PopOutChatPresentationState): boolean {
    return chat.lensEnabled && chat.isPinned && chat.isDesktop;
}

export interface PopOutReviewChatSidePanelProps {
    chat: PopOutChatPresentationState;
    /** e.g. `commit-popout-chat-container`. */
    containerTestId: string;
    /** Rendered when the chat is pinned back from the lens. */
    framed: ReactNode;
    /** Rendered for the legacy right-column placement. */
    plain: ReactNode;
}

export function PopOutReviewChatSidePanel({
    chat,
    containerTestId,
    framed,
    plain,
}: PopOutReviewChatSidePanelProps) {
    if (!chat.chatOpen || chat.presentation !== 'side-panel') return null;
    return (
        <div
            className="w-[340px] shrink-0 border-l border-[#e0e0e0] dark:border-[#3c3c3c]"
            data-testid={containerTestId}
        >
            {usesFramedSidePanel(chat) ? framed : plain}
        </div>
    );
}

export interface PopOutReviewChatLensProps {
    chat: PopOutChatPresentationState;
    children: ReactNode;
}

export function PopOutReviewChatLens({ chat, children }: PopOutReviewChatLensProps) {
    if (!chat.chatOpen || chat.presentation !== 'lens') return null;
    return <>{children}</>;
}
