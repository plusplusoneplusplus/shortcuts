// @vitest-environment jsdom
/**
 * Regression coverage for keeping the turn metadata/action row out of native
 * text selection while leaving the message body selectable.
 *
 * The metadata row (timestamp, pin/script/live indicators, token/timing stats,
 * and the Raw/JSON/Copy/Copy-as-HTML controls) carries `select-none` so a drag
 * across a response never highlights or copies interface chrome. The message
 * body region stays selectable, and every control in the row remains operable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
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

/** The metadata/action row is the flex header that directly precedes the body. */
function metaRow(container: HTMLElement): HTMLElement {
    const bubble = container.querySelector('.group');
    const row = bubble?.querySelector('.flex.items-center') as HTMLElement | null;
    expect(row).toBeTruthy();
    return row!;
}

describe('ConversationTurnBubble — metadata row excluded from selection', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('marks the assistant metadata/action row as non-selectable', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ tokenUsage: sampleTokenUsage, costTimeMs: 16800 })} />
        );
        const row = metaRow(container);
        expect(row.className).toContain('select-none');
        // The controls that live inside the row inherit the non-selectable region.
        expect(row.querySelector('.timestamp')).toBeTruthy();
        expect(row.querySelector('.assistant-stats-badge')).toBeTruthy();
        expect(row.querySelector('.bubble-copy-btn')).toBeTruthy();
        expect(row.querySelector('.bubble-raw-btn')).toBeTruthy();
    });

    it('marks the user metadata/action row as non-selectable', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user' })} />
        );
        const row = metaRow(container);
        expect(row.className).toContain('select-none');
    });

    it('keeps the message body region selectable (no select-none)', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn()} />
        );
        const body = container.querySelector('.chat-message-content') as HTMLElement | null;
        expect(body).toBeTruthy();
        expect(body!.className).not.toContain('select-none');
    });

    it('keeps the expanded token/timing detail inside the non-selectable row', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ tokenUsage: sampleTokenUsage, costTimeMs: 16800 })} />
        );
        const row = metaRow(container);
        const badge = row.querySelector('.assistant-stats-badge') as HTMLElement;
        fireEvent.click(badge); // expand
        expect(badge.textContent).toContain('Input:');
        // Still contained within the select-none row after expanding.
        expect(row.className).toContain('select-none');
        expect(row.contains(badge)).toBe(true);
    });

    it('leaves the copy control clickable within the non-selectable row', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: 'copy me' })} />
        );
        const row = metaRow(container);
        const copyBtn = row.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        expect(copyBtn).toBeTruthy();
        fireEvent.click(copyBtn);
        // The button is a real, operable control despite the select-none region.
        expect(copyBtn.tagName).toBe('BUTTON');
    });
});
