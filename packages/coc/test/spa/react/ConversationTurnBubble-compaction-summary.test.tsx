/**
 * Tests for ConversationTurnBubble — the "Show summary" disclosure on a
 * compaction result turn (AC-02 / AC-03).
 *
 *   - A display-only assistant turn carrying `compactionSummary` renders a
 *     collapsed toggle under the counts line; clicking it expands the summary
 *     inline in the SAME turn, rendered as markdown.
 *   - A compaction turn with no summary (the Codex path, and every turn
 *     recorded before the field existed) renders exactly as before: no toggle,
 *     no disabled control, no "not supported" text.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

const COUNTS_LINE = 'Context compacted — removed 7 messages, freed ~4200 tokens';

function makeCompactionTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: COUNTS_LINE,
        timestamp: '2026-01-15T14:19:00Z',
        streaming: false,
        displayOnly: true,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — compaction summary disclosure', () => {
    it('renders a collapsed toggle when the turn carries a summary', () => {
        const { getByTestId, queryByTestId } = render(
            <ConversationTurnBubble turn={makeCompactionTurn({ compactionSummary: '## Recap\n\nWe fixed the parser.' })} />,
        );

        const toggle = getByTestId('compaction-summary-toggle');
        expect(toggle.textContent).toContain('Show summary');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        // Collapsed by default — the body is not in the DOM.
        expect(queryByTestId('compaction-summary-body')).toBeNull();
    });

    it('expands the summary inline in the same turn when the toggle is clicked', () => {
        const { container, getByTestId } = render(
            <ConversationTurnBubble turn={makeCompactionTurn({ compactionSummary: '## Recap\n\nWe fixed the parser.' })} />,
        );

        fireEvent.click(getByTestId('compaction-summary-toggle'));

        const body = getByTestId('compaction-summary-body');
        expect(body.textContent).toContain('We fixed the parser.');
        // Markdown-rendered, not raw text.
        expect(body.querySelector('[data-testid="markdown-view"]')).toBeTruthy();
        expect(body.innerHTML).toContain('Recap</h2>');
        // Same turn — the disclosure lives inside this bubble, not a sibling turn.
        expect(container.querySelectorAll('.chat-message').length).toBe(1);
        expect(container.textContent).toContain(COUNTS_LINE);
        // Toggle flips to the collapse affordance.
        expect(getByTestId('compaction-summary-toggle').textContent).toContain('Hide summary');
        expect(getByTestId('compaction-summary-toggle').getAttribute('aria-expanded')).toBe('true');
    });

    it('collapses again on a second click', () => {
        const { getByTestId, queryByTestId } = render(
            <ConversationTurnBubble turn={makeCompactionTurn({ compactionSummary: 'Some summary text.' })} />,
        );

        fireEvent.click(getByTestId('compaction-summary-toggle'));
        expect(queryByTestId('compaction-summary-body')).toBeTruthy();
        fireEvent.click(getByTestId('compaction-summary-toggle'));
        expect(queryByTestId('compaction-summary-body')).toBeNull();
    });

    it('caps the expanded body height with internal scroll', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeCompactionTurn({ compactionSummary: 'line\n'.repeat(500) })} />,
        );

        fireEvent.click(getByTestId('compaction-summary-toggle'));
        const body = getByTestId('compaction-summary-body');
        expect(body.className).toContain('max-h-');
        expect(body.className).toContain('overflow-auto');
    });

    it('renders no toggle at all when the compaction turn has no summary (Codex path)', () => {
        const { container, queryByTestId } = render(
            <ConversationTurnBubble turn={makeCompactionTurn()} />,
        );

        expect(queryByTestId('compaction-summary-disclosure')).toBeNull();
        expect(queryByTestId('compaction-summary-toggle')).toBeNull();
        expect(container.textContent).toContain(COUNTS_LINE);
        expect(container.textContent).not.toContain('summary');
    });

    it('renders no toggle for a legacy compaction turn stored before the field existed', () => {
        const legacy = makeCompactionTurn();
        delete (legacy as Record<string, unknown>).compactionSummary;

        const { queryByTestId } = render(<ConversationTurnBubble turn={legacy} />);
        expect(queryByTestId('compaction-summary-disclosure')).toBeNull();
    });

    it('ignores the disclosure on user turns', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble
                turn={makeCompactionTurn({ role: 'user', compactionSummary: 'should not render' })}
            />,
        );
        expect(queryByTestId('compaction-summary-disclosure')).toBeNull();
    });
});
