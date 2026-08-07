/**
 * Tests for ConversationTurnBubble — "Open link" / "Copy URL" entries that appear
 * at the top of the turn context menu when the right-click landed on an anchor.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: 0, groupSingleLineMessages: false }),
}));

// Render the chat HTML for real so the markdown link becomes a real <a href>.
vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isDesktop: true }),
}));

const mockOpenLink = vi.fn();
vi.mock('../../../src/server/spa/client/react/utils/link-handler', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    openLink: (...args: unknown[]) => mockOpenLink(...args),
}));

const mockCopyToClipboard = vi.fn(() => Promise.resolve());
vi.mock('../../../src/server/spa/client/react/utils/format', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

const HREF = 'https://example.com/a?b=1';

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: `See [docs](${HREF}) for details.`,
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

function renderBubble(overrides: Partial<ClientConversationTurn> = {}) {
    return render(
        <ConversationTurnBubble turn={makeTurn(overrides)} turnIndex={0} onAttachContext={vi.fn()} />,
    );
}

/** Labels of the rendered menu, in order (separators excluded). */
function menuLabels(): string[] {
    return Array.from(screen.getByTestId('context-menu').querySelectorAll('[role="menuitem"]'))
        .map((el) => el.textContent?.replace(/^[^\w]*\s*/, '').trim() ?? '');
}

describe('ConversationTurnBubble — link context menu', () => {
    beforeEach(() => {
        cleanup();
        mockOpenLink.mockClear();
        mockCopyToClipboard.mockClear();
    });

    it('renders a real anchor for a markdown link in an assistant turn', () => {
        const { container } = renderBubble();
        const anchor = container.querySelector('a[href]')!;
        expect(anchor).toBeTruthy();
        expect(anchor.getAttribute('href')).toBe(HREF);
    });

    it('puts "Open link" and "Copy URL" first when right-clicking a link', () => {
        const { container } = renderBubble();
        fireEvent.contextMenu(container.querySelector('a[href]')!);
        const labels = menuLabels();
        expect(labels[0]).toBe('Open link');
        expect(labels[1]).toBe('Copy URL');
        // Nothing is removed from the existing turn menu.
        expect(labels).toContain('Attach as context');
        expect(labels).toContain('Copy');
        expect(labels).toContain('Copy as HTML');
    });

    it('inserts a separator between the link items and the existing items', () => {
        const { container } = renderBubble();
        fireEvent.contextMenu(container.querySelector('a[href]')!);
        const menu = screen.getByTestId('context-menu');
        const children = Array.from(menu.children);
        expect(children[2].getAttribute('role')).toBe('separator');
    });

    it('shows no link items and no leading separator when the click is not on a link', () => {
        const { container } = renderBubble();
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.queryByText('Open link')).toBeNull();
        expect(screen.queryByText('Copy URL')).toBeNull();
        expect(menuLabels()[0]).toBe('Attach as context');
        expect(screen.getByTestId('context-menu').children[0].getAttribute('role')).not.toBe('separator');
    });

    it('copies the raw href via copyToClipboard when "Copy URL" is clicked', () => {
        const { container } = renderBubble();
        fireEvent.contextMenu(container.querySelector('a[href]')!);
        fireEvent.click(screen.getByText('Copy URL'));
        expect(mockCopyToClipboard).toHaveBeenCalledWith(HREF);
    });

    it('copies a relative href verbatim rather than a browser-resolved absolute URL', () => {
        const { container } = renderBubble({ content: 'See [docs](./notes/readme.md) here.' });
        fireEvent.contextMenu(container.querySelector('a[href]')!);
        fireEvent.click(screen.getByText('Copy URL'));
        expect(mockCopyToClipboard).toHaveBeenCalledWith('./notes/readme.md');
    });

    it('calls openLink with the raw href when "Open link" is clicked', () => {
        const { container } = renderBubble();
        fireEvent.contextMenu(container.querySelector('a[href]')!);
        fireEvent.click(screen.getByText('Open link'));
        expect(mockOpenLink).toHaveBeenCalledTimes(1);
        expect(mockOpenLink.mock.calls[0][0]).toBe(HREF);
        expect(typeof mockOpenLink.mock.calls[0][1]).toBe('object');
    });

    it('closes the menu after a link action', () => {
        const { container } = renderBubble();
        fireEvent.contextMenu(container.querySelector('a[href]')!);
        fireEvent.click(screen.getByText('Copy URL'));
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('does not open the custom menu on shift+right-click of a link', () => {
        const { container } = renderBubble();
        const notPrevented = fireEvent.contextMenu(container.querySelector('a[href]')!, { shiftKey: true });
        expect(notPrevented).toBe(true);
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });
});
