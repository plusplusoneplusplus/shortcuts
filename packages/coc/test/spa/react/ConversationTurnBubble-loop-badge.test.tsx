/**
 * Tests for ConversationTurnBubble turnSource badge — verifies loop/wakeup badges
 * appear correctly on conversation turns.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/react/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Hello',
        timestamp: '2026-01-15T10:00:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble turnSource badge', () => {
    it('renders loop badge when turnSource.source is loop', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    turnSource: { source: 'loop', loopId: 'loop-123' },
                })}
            />,
        );
        const badge = container.querySelector('[data-testid="turn-source-badge"]');
        expect(badge).toBeTruthy();
        expect(badge?.textContent).toContain('loop');
        expect(badge?.querySelector('[data-testid="loop-icon"]')).toBeTruthy();
        expect(badge?.getAttribute('title')).toContain('Loop tick');
        expect(badge?.getAttribute('title')).toContain('loop-123');
    });

    it('renders wakeup badge when turnSource.source is wakeup', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    turnSource: { source: 'wakeup', wakeupId: 'wake-456' },
                })}
            />,
        );
        const badge = container.querySelector('[data-testid="turn-source-badge"]');
        expect(badge).toBeTruthy();
        expect(badge?.textContent).toContain('wakeup');
        expect(badge?.textContent).toContain('⏰');
        expect(badge?.getAttribute('title')).toContain('Scheduled wakeup');
        expect(badge?.getAttribute('title')).toContain('wake-456');
    });

    it('does not render turnSource badge when turnSource is absent', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} />,
        );
        expect(container.querySelector('[data-testid="turn-source-badge"]')).toBeNull();
    });

    it('does not render turnSource badge on assistant turns', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    role: 'assistant',
                    turnSource: { source: 'loop', loopId: 'loop-1' },
                })}
            />,
        );
        // The badge is only rendered for user turns (isUser check)
        expect(container.querySelector('[data-testid="turn-source-badge"]')).toBeNull();
    });
});
