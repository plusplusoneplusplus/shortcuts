// @vitest-environment jsdom
/**
 * Quoted conversation-turn references: the leading `<context from="user|assistant" turn="N">`
 * blocks written by formatAttachedContext render as quote cards (not raw markup), the
 * stored/raw content is untouched, and "Go to message" reports unavailable targets.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    parseTurnReferenceBlocks,
    turnMatchesReference,
    turnReferenceExcerpt,
} from '../../../src/server/spa/client/react/features/chat/conversation/turnReference';
import { formatAttachedContext, type AttachedContextItem } from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />,
}));

afterEach(() => cleanup());

const QUOTE = '**The key difference is where sign-in happens:** GitHub Desktop opens your system browser.\n\n[Investigation report](file:///tmp/r.md) · No code changed.';

function turnItem(turnIndex: number, role: 'user' | 'assistant', snippet: string): AttachedContextItem {
    return { kind: 'turn', id: `ctx-${turnIndex}`, turnIndex, role, snippet, preview: snippet };
}

function makeTurn(content: string, extra: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return { role: 'user', content, timestamp: '2026-10-17T09:28:00Z', streaming: false, timeline: [], ...extra };
}

describe('parseTurnReferenceBlocks', () => {
    it('round-trips the exact blocks formatAttachedContext writes', () => {
        const content = `${formatAttachedContext([turnItem(1575, 'assistant', QUOTE), turnItem(3, 'user', 'hi')])}no, I mean the embedded browser`;
        const parsed = parseTurnReferenceBlocks(content);
        expect(parsed.references).toEqual([
            { role: 'assistant', turnIndex: 1575, snippet: QUOTE },
            { role: 'user', turnIndex: 3, snippet: 'hi' },
        ]);
        expect(parsed.remainingContent).toBe('no, I mean the embedded browser');
    });

    it('accepts CRLF line endings', () => {
        expect(parseTurnReferenceBlocks('<context from="user" turn="2">\r\nabc\r\n</context>\r\n\r\nreply').references)
            .toEqual([{ role: 'user', turnIndex: 2, snippet: 'abc' }]);
    });

    it('leaves non-leading, fenced and non-turn <context> markup as ordinary text', () => {
        for (const content of [
            'Look at this:\n<context from="assistant" turn="2">\nx\n</context>',
            '```xml\n<context from="assistant" turn="2">\nx\n</context>\n```',
            '<context from="diff-selection" path="a.ts">\nx\n</context>\n\nhi',
            '<context from="system" turn="2">\nx\n</context>\n\nhi',
            '<context from="assistant" turn="-1">\nx\n</context>\n\nhi',
            '<context from="assistant" turn="2">\nunterminated',
            'No references here.',
        ]) {
            expect(parseTurnReferenceBlocks(content)).toEqual({ references: [], remainingContent: content });
        }
    });
});

describe('turnReferenceExcerpt', () => {
    it('strips Markdown syntax and keeps link text', () => {
        expect(turnReferenceExcerpt(QUOTE)).toBe('The key difference is where sign-in happens: GitHub Desktop opens your system browser. Investigation report · No code changed.');
        expect(turnReferenceExcerpt('# Title\n- `code` and _em_ text')).toBe('Title code and em text');
    });

    it('caps long snippets with an ellipsis', () => {
        const excerpt = turnReferenceExcerpt('word '.repeat(100), 40);
        expect(excerpt.length).toBeLessThanOrEqual(40);
        expect(excerpt.endsWith('…')).toBe(true);
    });
});

describe('turnMatchesReference', () => {
    const reference = { role: 'assistant' as const, turnIndex: 4, snippet: 'The key difference is where sign-in happens: GitHub Desktop opens' };
    it('matches rendered-text selections against Markdown source of the same role', () => {
        expect(turnMatchesReference(makeTurn(QUOTE, { role: 'assistant' }), reference)).toBe(true);
        expect(turnMatchesReference(makeTurn('', { role: 'assistant', timeline: [{ type: 'content', timestamp: '', content: QUOTE }] }), reference)).toBe(true);
    });
    it('rejects a different role, different text or a missing turn', () => {
        expect(turnMatchesReference(makeTurn(QUOTE), reference)).toBe(false);
        expect(turnMatchesReference(makeTurn('Unrelated answer', { role: 'assistant' }), reference)).toBe(false);
        expect(turnMatchesReference(undefined, reference)).toBe(false);
    });
});

describe('quoted turn reference card in the user bubble', () => {
    const content = `${formatAttachedContext([turnItem(1575, 'assistant', QUOTE)])}no, i am asking for its embedded browser`;

    it('renders a quote card instead of the <context> wrapper and keeps the reply separate', () => {
        render(<ConversationTurnBubble turn={makeTurn(content)} turnIndex={1576} onGoToTurnReference={vi.fn()} />);
        const card = screen.getByTestId('turn-reference-card');
        expect(card.getAttribute('aria-label')).toBe('Quoted assistant message');
        expect(screen.getByTestId('turn-reference-source').textContent).toContain('Assistant message');
        expect(screen.getByTestId('turn-reference-excerpt').textContent).toContain('The key difference is where sign-in happens');
        const reply = screen.getByTestId('user-plain-text');
        expect(reply.textContent).toContain('no, i am asking for its embedded browser');
        expect(reply.textContent).not.toContain('context from');
        expect(document.body.textContent).not.toContain('</context>');
    });

    it('keeps the exact stored content in the raw view', () => {
        render(<ConversationTurnBubble turn={makeTurn(content)} turnIndex={1576} />);
        fireEvent.click(screen.getByTitle('View raw content'));
        expect(document.querySelector('.raw-content-view code')!.textContent).toBe(content);
        expect(screen.queryByTestId('turn-reference-card')).toBeNull();
    });

    it('navigates with the parsed reference and the quoting turn index', async () => {
        const onGo = vi.fn().mockResolvedValue(true);
        render(<ConversationTurnBubble turn={makeTurn(content)} turnIndex={1576} onGoToTurnReference={onGo} />);
        await act(async () => { fireEvent.click(screen.getByTestId('turn-reference-go')); });
        expect(onGo).toHaveBeenCalledWith({ role: 'assistant', turnIndex: 1575, snippet: QUOTE }, 1576);
        expect(screen.queryByTestId('turn-reference-unavailable')).toBeNull();
    });

    it('shows a visible unavailable notice when the original cannot be verified', async () => {
        const onGo = vi.fn().mockResolvedValue(false);
        render(<ConversationTurnBubble turn={makeTurn(content)} turnIndex={1576} onGoToTurnReference={onGo} />);
        await act(async () => { fireEvent.click(screen.getByTestId('turn-reference-go')); });
        expect(screen.getByTestId('turn-reference-unavailable').getAttribute('role')).toBe('status');
    });

    it('renders the card without a jump button when no navigator is available', () => {
        render(<ConversationTurnBubble turn={makeTurn(content)} turnIndex={1576} />);
        expect(screen.getByTestId('turn-reference-card')).toBeTruthy();
        expect(screen.queryByTestId('turn-reference-go')).toBeNull();
    });
});
