/**
 * Regression tests for ConversationTurnBubble's AssistantStatsBadge.
 *
 * A partially-populated tokenUsage (e.g. an SSE token-usage event or an SDK
 * result that only carries context-window fields, without totalTokens / cache
 * counts) must NOT crash the render. Previously the badge called
 * `tokenUsage.totalTokens.toLocaleString()` unconditionally, throwing
 * "Cannot read properties of undefined (reading 'toLocaleString')" and taking
 * down the entire dashboard via the root error boundary.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn, ClientTokenUsage } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/react/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeAssistantTurn(tokenUsage: Partial<ClientTokenUsage>): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Done.',
        timestamp: '2026-01-15T10:00:00Z',
        streaming: false,
        timeline: [],
        tokenUsage: tokenUsage as ClientTokenUsage,
    } as ClientConversationTurn;
}

describe('ConversationTurnBubble AssistantStatsBadge — partial tokenUsage', () => {
    it('does not crash when tokenUsage omits totalTokens / cache counts', () => {
        // Mirrors the context-window-focused shape emitted by the token-usage
        // SSE path: only input/output (+ context window) present.
        const partial = { inputTokens: 1000, outputTokens: 500, tokenLimit: 100_000, currentTokens: 50_000 } as Partial<ClientTokenUsage>;

        const { container } = render(<ConversationTurnBubble turn={makeAssistantTurn(partial)} />);

        const badge = container.querySelector('.assistant-stats-badge');
        expect(badge).toBeTruthy();
        // Summary derives input/output without throwing.
        expect(badge?.textContent).toContain('1.0k');
        expect(badge?.textContent).toContain('500');
    });

    it('falls back totalTokens to input + output when absent', () => {
        const partial = { inputTokens: 1200, outputTokens: 300 } as Partial<ClientTokenUsage>;

        const { container } = render(<ConversationTurnBubble turn={makeAssistantTurn(partial)} />);

        const badge = container.querySelector('.assistant-stats-badge');
        expect(badge).toBeTruthy();
        // Detail string (title attr) should report Total: 1,500 (1200 + 300).
        const title = badge?.getAttribute('title') ?? '';
        expect(title).toContain('Total: 1,500');
    });

    it('renders a fully-populated tokenUsage unchanged', () => {
        const full: ClientTokenUsage = {
            inputTokens: 2000,
            outputTokens: 800,
            cacheReadTokens: 100,
            cacheWriteTokens: 50,
            totalTokens: 2800,
            turnCount: 1,
        };

        const { container } = render(<ConversationTurnBubble turn={makeAssistantTurn(full)} />);

        const badge = container.querySelector('.assistant-stats-badge');
        expect(badge).toBeTruthy();
        const title = badge?.getAttribute('title') ?? '';
        expect(title).toContain('Total: 2,800');
        expect(title).toContain('Cache read: 100');
        expect(title).toContain('Cache write: 50');
    });
});
