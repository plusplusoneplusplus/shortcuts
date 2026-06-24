/**
 * Tests for ConversationTurnBubble — right-click context menu with "Attach as context".
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

// Mock useDisplaySettings
vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: 0, groupSingleLineMessages: false }),
}));

// Mock markdown renderer
vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

// Mock useBreakpoint for ContextMenu
vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isDesktop: true }),
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Hello world',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — context menu', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('shows context menu on right click', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={0}
                onAttachContext={vi.fn()}
            />,
        );
        const bubble = container.querySelector('.chat-message')!;
        fireEvent.contextMenu(bubble);
        expect(screen.getByTestId('context-menu')).toBeTruthy();
    });

    it('shows "Attach as context" menu item when onAttachContext is provided', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={0}
                onAttachContext={vi.fn()}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.getByText('Attach as context')).toBeTruthy();
    });

    it('does not show "Attach as context" when onAttachContext is not provided', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} turnIndex={0} />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.queryByText('Attach as context')).toBeNull();
    });

    it('calls onAttachContext with turn content when "Attach as context" is clicked', () => {
        const onAttach = vi.fn();
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'assistant', content: 'Test snippet' })}
                turnIndex={5}
                onAttachContext={onAttach}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        fireEvent.click(screen.getByText('Attach as context'));
        expect(onAttach).toHaveBeenCalledWith(5, 'assistant', 'Test snippet');
    });

    it('always shows Copy and Copy as HTML items', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} turnIndex={0} />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.getByText('Copy')).toBeTruthy();
        expect(screen.getByText('Copy as HTML')).toBeTruthy();
    });

    it('attaches selected text instead of full content when text is selected', () => {
        const onAttach = vi.fn();
        // Mock window.getSelection to return selected text
        const mockSelection = {
            toString: () => 'selected portion',
        };
        vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as any);

        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'user', content: 'Full content here' })}
                turnIndex={2}
                onAttachContext={onAttach}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        fireEvent.click(screen.getByText('Attach as context'));
        expect(onAttach).toHaveBeenCalledWith(2, 'user', 'selected portion');
    });

    it('falls back to full content when selection is empty', () => {
        const onAttach = vi.fn();
        vi.spyOn(window, 'getSelection').mockReturnValue({
            toString: () => '',
        } as any);

        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'assistant', content: 'Full content' })}
                turnIndex={1}
                onAttachContext={onAttach}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        fireEvent.click(screen.getByText('Attach as context'));
        expect(onAttach).toHaveBeenCalledWith(1, 'assistant', 'Full content');
    });

    it('does not open the custom menu on shift+right-click (lets the browser show its native menu)', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={0}
                onAttachContext={vi.fn()}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!, { shiftKey: true });
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('does not call preventDefault on shift+right-click so the native menu appears', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={0}
                onAttachContext={vi.fn()}
            />,
        );
        // fireEvent.contextMenu returns false if a handler called preventDefault.
        const notPrevented = fireEvent.contextMenu(container.querySelector('.chat-message')!, { shiftKey: true });
        expect(notPrevented).toBe(true);
    });

    it('still calls preventDefault and opens the custom menu on a plain right-click', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={0}
                onAttachContext={vi.fn()}
            />,
        );
        const notPrevented = fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(notPrevented).toBe(false);
        expect(screen.getByTestId('context-menu')).toBeTruthy();
    });

    it('does not show "Copy image" when the turn has no images', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} turnIndex={0} />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.queryByText('Copy image')).toBeNull();
    });

    it('shows "Copy image" and writes to the clipboard when the turn has one image', async () => {
        class FakeClipboardItem { constructor(public data: Record<string, any>) {} }
        vi.stubGlobal('ClipboardItem', FakeClipboardItem as any);
        const pngBlob = new Blob(['png'], { type: 'image/png' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => pngBlob }));
        const write = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { write },
            writable: true,
            configurable: true,
        });

        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ images: ['data:image/png;base64,AAAA'] })}
                turnIndex={0}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        const item = screen.getByText('Copy image');
        expect(item).toBeTruthy();
        fireEvent.click(item);
        // onClick is async; flush microtasks.
        await Promise.resolve();
        await Promise.resolve();
        expect(write).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('renders a submenu with one entry per image when the turn has multiple images', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ images: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'] })}
                turnIndex={0}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        const parent = screen.getByText('Copy image');
        expect(parent).toBeTruthy();
        // Clicking the parent item toggles its submenu open.
        fireEvent.click(parent);
        expect(screen.getByText('Image 1')).toBeTruthy();
        expect(screen.getByText('Image 2')).toBeTruthy();
    });
});
