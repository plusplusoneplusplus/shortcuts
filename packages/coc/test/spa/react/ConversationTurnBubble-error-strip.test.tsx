/**
 * Tests for ConversationTurnBubble — error-strip redesign.
 *
 * Visual contract (per OpenDesign reference `coc-conversation-redesign-3.html`):
 *   - When `turn.isError` is true on an assistant turn, the bubble renders a
 *     dedicated `error-strip` panel inside its body (in place of the regular
 *     markdown content) containing:
 *       - red ⚠ icon (decorative, aria-hidden)
 *       - "Stream interrupted" red bold title
 *       - optional detail rendered from `turn.content` (markdown → HTML)
 *       - a `↺ Retry this turn` button when `onRetry` is provided
 *   - The strip is the SOLE error indicator: the meta row no longer shows the
 *     legacy `⚠ Error` text or a tiny inline retry chevron.
 *   - The strip is NOT shown for user turns or for non-error assistant turns.
 *   - Pre-existing CSS hooks (`.chat-message.error`, `.error-indicator`,
 *     `.bubble-retry-btn`, `data-testid="retry-turn-btn"`) remain stable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Upstream model returned `504 Gateway Timeout` while reading `useChatSSE`.',
        timestamp: '2026-01-15T14:19:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — error-strip', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the error-strip aside on isError assistant turns', () => {
        const { container, getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} />,
        );
        const strip = getByTestId('error-strip');
        expect(strip).toBeTruthy();
        expect(strip.tagName.toLowerCase()).toBe('aside');
        expect(strip.getAttribute('role')).toBe('alert');
        // strip lives inside chat-message-content
        expect(container.querySelector('.chat-message-content [data-testid="error-strip"]')).toBeTruthy();
    });

    it('does NOT render the error-strip when isError is false', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: false })} />,
        );
        expect(queryByTestId('error-strip')).toBeNull();
    });

    it('does NOT render the error-strip for user turns even with isError', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', isError: true })} />,
        );
        expect(queryByTestId('error-strip')).toBeNull();
    });

    it('renders "Stream interrupted" as the strip title in red bold', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} />,
        );
        const title = getByTestId('error-strip-title');
        expect(title.textContent).toBe('Stream interrupted');
        expect(title.className).toContain('font-semibold');
        expect(title.className).toContain('text-[#cf222e]');
    });

    it('renders the turn content as the err-detail (markdown rendered)', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ isError: true, content: 'Upstream model returned `504 Gateway Timeout` while reading `useChatSSE`.' })}
            />,
        );
        const detail = getByTestId('error-strip-detail');
        expect(detail.textContent).toContain('Upstream model returned');
        expect(detail.textContent).toContain('504 Gateway Timeout');
        expect(detail.textContent).toContain('useChatSSE');
        // MarkdownView wrapper present
        expect(detail.querySelector('[data-testid="markdown-view"]')).toBeTruthy();
    });

    it('omits the err-detail when turn.content is empty', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true, content: '' })} />,
        );
        expect(queryByTestId('error-strip-detail')).toBeNull();
    });

    it('renders the ↺ Retry this turn button when onRetry is provided', () => {
        const onRetry = vi.fn();
        const { container, getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} onRetry={onRetry} />,
        );
        const btn = getByTestId('retry-turn-btn');
        expect(btn.tagName.toLowerCase()).toBe('button');
        const btnText = (btn.textContent ?? '').replace(/\s+/g, '');
        expect(btnText).toBe('↺Retrythisturn');
        expect(btn.getAttribute('title')).toBe('Retry this turn');
        expect(btn.classList.contains('bubble-retry-btn')).toBe(true);
        // The button lives inside the strip, not the meta row
        const strip = container.querySelector('[data-testid="error-strip"]');
        expect(strip?.contains(btn)).toBe(true);
    });

    it('does NOT render the retry button when onRetry is omitted', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} />,
        );
        expect(queryByTestId('retry-turn-btn')).toBeNull();
    });

    it('invokes onRetry when the retry button is clicked', async () => {
        const onRetry = vi.fn();
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} onRetry={onRetry} />,
        );
        const btn = getByTestId('retry-turn-btn') as HTMLButtonElement;
        await act(async () => { fireEvent.click(btn); });
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders exactly ONE retry button (no legacy meta-row chevron)', () => {
        const onRetry = vi.fn();
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} onRetry={onRetry} />,
        );
        expect(container.querySelectorAll('[data-testid="retry-turn-btn"]').length).toBe(1);
        expect(container.querySelectorAll('.bubble-retry-btn').length).toBe(1);
    });

    it('drops the legacy ⚠ Error meta-row indicator text', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} />,
        );
        // The strip uses an aria-hidden ⚠ icon; the legacy "⚠ Error" label is gone.
        expect(container.textContent).not.toContain('⚠ Error');
    });

    it('keeps the .error-indicator hook on the strip for backward compatibility', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} />,
        );
        const indicator = container.querySelector('.error-indicator');
        expect(indicator).toBeTruthy();
        expect(indicator?.getAttribute('data-testid')).toBe('error-strip');
    });

    it('keeps the .chat-message.error outer-wrapper hook', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} />,
        );
        expect(container.querySelector('.chat-message.error')).toBeTruthy();
    });

    it('skips the regular markdown content render for error turns', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true, content: 'BODY' })} />,
        );
        const markdownViews = container.querySelectorAll('[data-testid="markdown-view"]');
        // Exactly one markdown view — the one inside the err-detail.
        expect(markdownViews.length).toBe(1);
        const detail = container.querySelector('[data-testid="error-strip-detail"]');
        expect(detail?.contains(markdownViews[0])).toBe(true);
    });

    it('still renders normal content for non-error assistant turns', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: false, content: 'BODY' })} />,
        );
        expect(container.querySelectorAll('[data-testid="markdown-view"]').length).toBeGreaterThanOrEqual(1);
        expect(container.querySelector('[data-testid="error-strip"]')).toBeNull();
    });

    it('renders the error avatar in the assistant tile (red palette)', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ isError: true })} />,
        );
        const avatar = container.querySelector('.turn-avatar');
        expect(avatar).toBeTruthy();
        expect(avatar?.className).toContain('bg-[#ffebe9]');
        expect(avatar?.getAttribute('title')).toBe('Assistant — error');
    });
});
