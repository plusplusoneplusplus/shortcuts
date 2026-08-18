/**
 * Tests for the shared pop-out chat placement slots.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
    PopOutReviewChatLens,
    PopOutReviewChatSidePanel,
    usesFramedSidePanel,
    type PopOutChatPresentationState,
} from '../../../../../src/server/spa/client/react/layout/popoutGitReview/PopOutReviewChatSlot';

function chatState(overrides: Partial<PopOutChatPresentationState> = {}): PopOutChatPresentationState {
    return {
        chatOpen: true,
        presentation: 'side-panel',
        isPinned: false,
        lensEnabled: false,
        isDesktop: true,
        ...overrides,
    };
}

afterEach(cleanup);

describe('usesFramedSidePanel', () => {
    it('is true only when the lens is enabled, pinned, and on desktop', () => {
        expect(usesFramedSidePanel(chatState({ lensEnabled: true, isPinned: true }))).toBe(true);
        expect(usesFramedSidePanel(chatState({ lensEnabled: true, isPinned: true, isDesktop: false }))).toBe(false);
        expect(usesFramedSidePanel(chatState({ lensEnabled: true }))).toBe(false);
        expect(usesFramedSidePanel(chatState({ isPinned: true }))).toBe(false);
    });
});

describe('PopOutReviewChatSidePanel', () => {
    const slot = (chat: PopOutChatPresentationState) => (
        <PopOutReviewChatSidePanel
            chat={chat}
            containerTestId="popout-chat-container"
            framed={<div data-testid="framed" />}
            plain={<div data-testid="plain" />}
        />
    );

    it('renders nothing while the chat is closed', () => {
        render(slot(chatState({ chatOpen: false })));
        expect(screen.queryByTestId('popout-chat-container')).toBeNull();
    });

    it('renders nothing while the chat is a lens', () => {
        render(slot(chatState({ presentation: 'lens' })));
        expect(screen.queryByTestId('popout-chat-container')).toBeNull();
    });

    it('uses the legacy right column by default', () => {
        render(slot(chatState()));
        expect(screen.getByTestId('popout-chat-container')).toBeTruthy();
        expect(screen.getByTestId('plain')).toBeTruthy();
        expect(screen.queryByTestId('framed')).toBeNull();
    });

    it('uses the framed panel when the chat is pinned back from the lens', () => {
        render(slot(chatState({ lensEnabled: true, isPinned: true })));
        expect(screen.getByTestId('framed')).toBeTruthy();
        expect(screen.queryByTestId('plain')).toBeNull();
    });
});

describe('PopOutReviewChatLens', () => {
    it('renders only when the chat is open in lens presentation', () => {
        const { rerender } = render(
            <PopOutReviewChatLens chat={chatState({ presentation: 'lens', chatOpen: false })}>
                <div data-testid="lens" />
            </PopOutReviewChatLens>,
        );
        expect(screen.queryByTestId('lens')).toBeNull();

        rerender(
            <PopOutReviewChatLens chat={chatState({ presentation: 'side-panel' })}>
                <div data-testid="lens" />
            </PopOutReviewChatLens>,
        );
        expect(screen.queryByTestId('lens')).toBeNull();

        rerender(
            <PopOutReviewChatLens chat={chatState({ presentation: 'lens' })}>
                <div data-testid="lens" />
            </PopOutReviewChatLens>,
        );
        expect(screen.getByTestId('lens')).toBeTruthy();
    });
});
