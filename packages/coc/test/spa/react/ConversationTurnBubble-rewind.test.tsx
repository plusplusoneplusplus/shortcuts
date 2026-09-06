/**
 * Tests for ConversationTurnBubble — the "Rewind to here" context-menu item.
 *
 * AC-04: the action is offered only on `role: 'user'` turns, only when an
 * `onRewindTurn` handler is provided, and clicking it calls the handler with the
 * turn index.
 *
 * AC-07: the affordance is shaped client-side from the provider plus the turn's
 * captured anchor — hidden on codex (no native rewind primitive), shown but
 * disabled with a tooltip when the turn has no `sdkEventId`, enabled otherwise.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: 0, groupSingleLineMessages: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isDesktop: true }),
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Hello world',
        sdkEventId: 'evt_1',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — Rewind to here', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('shows "Rewind to here" on a user turn when onRewindTurn is provided', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} turnIndex={2} onRewindTurn={vi.fn()} />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.getByText('Rewind to here')).toBeTruthy();
    });

    it('does not show "Rewind to here" on an assistant turn', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'assistant', content: 'An answer' })}
                turnIndex={3}
                onRewindTurn={vi.fn()}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.queryByText('Rewind to here')).toBeNull();
    });

    it('does not show "Rewind to here" when onRewindTurn is not provided', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} turnIndex={2} />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.queryByText('Rewind to here')).toBeNull();
    });

    it('calls onRewindTurn with the turn index when clicked', () => {
        const onRewind = vi.fn();
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} turnIndex={4} onRewindTurn={onRewind} />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        fireEvent.click(screen.getByText('Rewind to here'));
        expect(onRewind).toHaveBeenCalledWith(4);
    });

    it.each(['copilot', 'claude', 'opencode'] as const)('is enabled on an anchored %s turn', (provider) => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} turnIndex={1} provider={provider} onRewindTurn={vi.fn()} />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        const item = screen.getByText('Rewind to here').closest('button')!;
        expect(item.hasAttribute('disabled')).toBe(false);
    });

    it('hides the action entirely on a codex turn', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} turnIndex={1} provider="codex" onRewindTurn={vi.fn()} />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        expect(screen.queryByText('Rewind to here')).toBeNull();
    });

    it('shows the action disabled with a tooltip when the turn has no anchor', () => {
        const onRewind = vi.fn();
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ sdkEventId: undefined })}
                turnIndex={1}
                provider="claude"
                onRewindTurn={onRewind}
            />,
        );
        fireEvent.contextMenu(container.querySelector('.chat-message')!);
        const item = screen.getByText('Rewind to here').closest('button')!;
        expect(item.hasAttribute('disabled')).toBe(true);
        expect(item.closest('[title]')?.getAttribute('title')).toBe('This turn predates rewind support');
        fireEvent.click(item);
        expect(onRewind).not.toHaveBeenCalled();
    });
});
