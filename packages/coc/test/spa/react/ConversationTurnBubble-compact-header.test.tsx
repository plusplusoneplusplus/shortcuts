/**
 * Tests for compact assistant message header:
 * - formatShortTimestamp helper
 * - AssistantStatsBadge merged badge
 * - Header layout classes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationTurnBubble, formatShortTimestamp, formatCostTime } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn, ClientTokenUsage } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/react/ui/JsonResponseView', () => ({
    JsonResponseView: () => <div />,
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Hello world',
        timestamp: '2026-04-20T07:32:43Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

const sampleTokenUsage: ClientTokenUsage = {
    inputTokens: 114800,
    outputTokens: 761,
    cacheReadTokens: 50000,
    cacheWriteTokens: 0,
    totalTokens: 115561,
};

// ---------- formatShortTimestamp ----------

describe('formatShortTimestamp', () => {
    it('formats a morning time correctly', () => {
        const d = new Date(2026, 3, 20, 7, 5, 43); // Apr 20, 7:05:43 AM
        expect(formatShortTimestamp(d)).toBe('04/20 7:05 AM');
    });

    it('formats an afternoon time correctly', () => {
        const d = new Date(2026, 11, 1, 14, 30, 0); // Dec 1, 2:30 PM
        expect(formatShortTimestamp(d)).toBe('12/01 2:30 PM');
    });

    it('formats noon as 12 PM', () => {
        const d = new Date(2026, 0, 15, 12, 0, 0);
        expect(formatShortTimestamp(d)).toBe('01/15 12:00 PM');
    });

    it('formats midnight as 12 AM', () => {
        const d = new Date(2026, 5, 10, 0, 0, 0);
        expect(formatShortTimestamp(d)).toBe('06/10 12:00 AM');
    });

    it('pads single-digit months and days', () => {
        const d = new Date(2026, 0, 5, 9, 3, 0); // Jan 5, 9:03 AM
        expect(formatShortTimestamp(d)).toBe('01/05 9:03 AM');
    });

    it('drops seconds from the output', () => {
        const d = new Date(2026, 3, 20, 7, 32, 43);
        const result = formatShortTimestamp(d);
        // Should not contain ":43" seconds portion
        expect(result).not.toContain(':43');
    });
});

// ---------- AssistantStatsBadge (via ConversationTurnBubble) ----------

describe('ConversationTurnBubble — merged assistant stats badge', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders a single .assistant-stats-badge instead of separate badges', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ tokenUsage: sampleTokenUsage, costTimeMs: 16800 })}
            />
        );
        expect(container.querySelector('.assistant-stats-badge')).toBeTruthy();
        expect(container.querySelector('.token-usage-badge')).toBeNull();
        expect(container.querySelector('.cost-time-badge')).toBeNull();
    });

    it('shows combined token + time summary in collapsed state', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ tokenUsage: sampleTokenUsage, costTimeMs: 16800 })}
            />
        );
        const badge = container.querySelector('.assistant-stats-badge');
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toContain('↓114.8k');
        expect(badge!.textContent).toContain('↑761');
        expect(badge!.textContent).toContain('16.8s');
        expect(badge!.querySelector('[title="Elapsed time: 16,800ms"]')?.className).toContain('border-l');
        expect(badge!.textContent).not.toContain('·');
    });

    it('expands to show full detail on click', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ tokenUsage: sampleTokenUsage, costTimeMs: 16800 })}
            />
        );
        const badge = container.querySelector('.assistant-stats-badge')!;
        fireEvent.click(badge);
        expect(badge.textContent).toContain('Input:');
        expect(badge.textContent).toContain('Output:');
        expect(badge.textContent).toContain('Cache read:');
        expect(badge.textContent).toContain('Total:');
        expect(badge.textContent).toContain('Time:');
    });

    it('collapses back on second click', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ tokenUsage: sampleTokenUsage, costTimeMs: 16800 })}
            />
        );
        const badge = container.querySelector('.assistant-stats-badge')!;
        fireEvent.click(badge); // expand
        fireEvent.click(badge); // collapse
        expect(badge.textContent).toContain('↓114.8k');
        expect(badge.textContent).not.toContain('Input:');
    });

    it('renders only token stats when costTimeMs is absent', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ tokenUsage: sampleTokenUsage })}
            />
        );
        const badge = container.querySelector('.assistant-stats-badge');
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toContain('↓114.8k');
        expect(badge!.textContent).not.toContain('·');
    });

    it('renders only cost time when tokenUsage is absent', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ costTimeMs: 5000 })}
            />
        );
        const badge = container.querySelector('.assistant-stats-badge');
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toContain('5.0s');
    });

    it('does not render stats badge on user turns', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'user', tokenUsage: sampleTokenUsage, costTimeMs: 16800 })}
            />
        );
        expect(container.querySelector('.assistant-stats-badge')).toBeNull();
    });

    it('does not render stats badge when streaming', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ streaming: true, tokenUsage: sampleTokenUsage, costTimeMs: 16800 })}
            />
        );
        expect(container.querySelector('.assistant-stats-badge')).toBeNull();
    });

    it('keeps the screenshot values compact, with explicit token tooltips and an accessible disclosure', () => {
        const { container, getByRole } = render(
            <ConversationTurnBubble turn={makeTurn({
                tokenUsage: { ...sampleTokenUsage, inputTokens: 329900, outputTokens: 387 },
                costTimeMs: 22400,
            })} />
        );
        const badge = getByRole('button', { name: /Token usage and elapsed time: Input: 329,900.*Output: 387.*Show details/ });
        expect(badge.textContent).toBe('↓329.9k↑38722.4s');
        expect(badge.getAttribute('aria-expanded')).toBe('false');
        expect(badge.querySelector('[title="Input tokens: 329,900"]')).toBeTruthy();
        expect(badge.querySelector('[title="Output tokens: 387"]')).toBeTruthy();
        expect(badge.className).toContain('bg-transparent');
        expect(badge.className).toContain('shrink-0');
        expect(badge.querySelectorAll('.whitespace-nowrap')).toHaveLength(2);
        expect(container.querySelector('.turn-header-actions')?.className).toContain('shrink-0');
    });

    it('supports keyboard expansion, Escape dismissal, and Space toggling without losing focus', async () => {
        const user = userEvent.setup();
        const { getByRole } = render(
            <ConversationTurnBubble turn={makeTurn({ tokenUsage: sampleTokenUsage, costTimeMs: 16800 })} />
        );
        const badge = getByRole('button', { name: /Token usage and elapsed time/ });
        badge.focus();
        await user.keyboard('{Enter}');
        expect(badge.getAttribute('aria-expanded')).toBe('true');
        expect(badge.textContent).toContain('Total: 115,561');
        await user.keyboard('{Escape}');
        expect(badge.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(badge);
        await user.keyboard(' ');
        expect(badge.getAttribute('aria-expanded')).toBe('true');
        await user.keyboard(' ');
        expect(badge.getAttribute('aria-expanded')).toBe('false');
    });

    it('omits missing metrics and preserves zero values', () => {
        const { container, rerender } = render(<ConversationTurnBubble turn={makeTurn()} />);
        expect(container.querySelector('.assistant-stats-badge')).toBeNull();
        rerender(<ConversationTurnBubble turn={makeTurn({ costTimeMs: 0 })} />);
        const badge = container.querySelector('.assistant-stats-badge')!;
        expect(badge.textContent).toBe('0ms');
        expect(badge.querySelector('.border-l')).toBeNull();
    });

    it.each([
        [999, 999, '999', '999ms'],
        [1000, 1000, '1.0k', '1.0s'],
        [1000000, 61200, '1.0M', '1m 1s'],
    ])('preserves token and duration precision for %i tokens and %i ms', (tokens, ms, tokenText, timeText) => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({
            tokenUsage: { ...sampleTokenUsage, inputTokens: tokens }, costTimeMs: ms,
        })} />);
        const badge = container.querySelector('.assistant-stats-badge')!;
        expect(badge.textContent).toContain(`↓${tokenText}`);
        expect(badge.textContent).toContain(timeText);
    });
});

// ---------- Compact timestamp ----------

describe('ConversationTurnBubble — compact timestamp', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders short timestamp format (no seconds)', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ timestamp: '2026-04-20T07:32:43Z' })} />
        );
        const ts = container.querySelector('.timestamp');
        expect(ts).toBeTruthy();
        // Should not contain seconds — locale-independent check:
        // The short format only has one colon (hh:mm), not two (hh:mm:ss)
        const colons = (ts!.textContent || '').match(/:/g) || [];
        expect(colons.length).toBe(1);
    });

    it('has a title attribute with full timestamp for accessibility', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ timestamp: '2026-04-20T07:32:43Z' })} />
        );
        const ts = container.querySelector('.timestamp');
        expect(ts).toBeTruthy();
        const title = ts!.getAttribute('title');
        expect(title).toBeTruthy();
        // Full locale string should include seconds
        expect(title!.length).toBeGreaterThan(10);
    });

    it('timestamp span has whitespace-nowrap', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ timestamp: '2026-04-20T07:32:43Z' })} />
        );
        const ts = container.querySelector('.timestamp');
        expect(ts).toBeTruthy();
        expect(ts!.className).toContain('whitespace-nowrap');
    });
});

// ---------- Header layout tightening ----------

describe('ConversationTurnBubble — compact header layout', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('header row uses mb-1 instead of mb-2', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} />
        );
        const bubble = container.querySelector('.group');
        const headerRow = bubble?.querySelector('.flex.items-center');
        expect(headerRow).toBeTruthy();
        expect(headerRow!.className).toContain('mb-1');
        expect(headerRow!.className).not.toContain('mb-2');
    });

    it('header row uses gap-1.5 instead of gap-2', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} />
        );
        const bubble = container.querySelector('.group');
        const headerRow = bubble?.querySelector('.flex.items-center');
        expect(headerRow).toBeTruthy();
        expect(headerRow!.className).toContain('gap-1.5');
        expect(headerRow!.className).not.toContain('gap-2');
    });

    it('assistant header wraps between complete metrics and action groups', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} />
        );
        const bubble = container.querySelector('.group');
        const headerRow = bubble?.querySelector('.flex.items-center');
        expect(headerRow).toBeTruthy();
        expect(headerRow!.className).toContain('flex-wrap');
        expect(headerRow!.className).not.toContain('flex-nowrap');
        const actions = headerRow!.querySelector('.turn-header-actions')!;
        expect(actions.querySelector('.bubble-raw-btn')).toBeTruthy();
        expect(actions.querySelector('.bubble-copy-btn')).toBeTruthy();
        expect(actions.querySelector('.bubble-copy-html-btn')).toBeTruthy();
        expect(actions.className).toContain('whitespace-nowrap');
        for (const button of actions.querySelectorAll('button')) {
            expect(button.className).toContain('group-focus-within:opacity-100');
        }
    });

    it('preserves the user hover strip as a single row', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        expect(container.querySelector('.turn-header')?.className).toContain('flex-nowrap');
    });

    it('role label has min-w-0 and truncate for overflow protection', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} />
        );
        const roleLabel = container.querySelector('.role-label');
        expect(roleLabel).toBeTruthy();
        expect(roleLabel!.className).toContain('min-w-0');
        expect(roleLabel!.className).toContain('truncate');
    });
});
