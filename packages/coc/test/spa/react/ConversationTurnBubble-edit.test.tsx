/**
 * Tests for ConversationTurnBubble — the "Edit message" pencil (AC-01).
 *
 * The pencil lives in the user-turn hover strip alongside the copy buttons and
 * is gated by exactly the same rules as "Rewind to here" (saving an edit *is* a
 * rewind + resend): hidden on providers with no native rewind primitive, shown
 * disabled with a tooltip when the turn carries no `sdkEventId` anchor, enabled
 * otherwise. The busy guard differs — it disables rather than hides, so the
 * button does not flicker in and out while the agent streams.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import { EDIT_BUSY_TOOLTIP, REWIND_NO_ANCHOR_TOOLTIP } from '../../../src/server/spa/client/react/features/chat/hooks/rewindCapability';
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

const editBtn = () => screen.queryByTestId('bubble-edit-btn') as HTMLButtonElement | null;

describe('ConversationTurnBubble — Edit message pencil', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders an enabled pencil on a user turn with an anchor', () => {
        const onEditTurn = vi.fn();
        render(<ConversationTurnBubble turn={makeTurn()} turnIndex={2} provider="claude" onEditTurn={onEditTurn} />);
        const btn = editBtn();
        expect(btn).toBeTruthy();
        expect(btn!.disabled).toBe(false);
        expect(btn!.getAttribute('aria-label')).toBe('Edit message');
        fireEvent.click(btn!);
        expect(onEditTurn).toHaveBeenCalledWith(2);
    });

    it('hides the pencil on codex (no native rewind primitive)', () => {
        render(<ConversationTurnBubble turn={makeTurn()} turnIndex={2} provider="codex" onEditTurn={vi.fn()} />);
        expect(editBtn()).toBeNull();
    });

    it('prefers rewindProvider over provider when shaping the pencil', () => {
        render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={2}
                provider="codex"
                rewindProvider="opencode"
                onEditTurn={vi.fn()}
            />,
        );
        expect(editBtn()).toBeTruthy();
    });

    it('hides the pencil on assistant turns', () => {
        render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'assistant', content: 'An answer' })}
                turnIndex={3}
                provider="claude"
                onEditTurn={vi.fn()}
            />,
        );
        expect(editBtn()).toBeNull();
    });

    it('hides the pencil when no onEditTurn handler is provided', () => {
        render(<ConversationTurnBubble turn={makeTurn()} turnIndex={2} provider="claude" />);
        expect(editBtn()).toBeNull();
    });

    it('renders the pencil disabled with a tooltip when the turn has no anchor', () => {
        const onEditTurn = vi.fn();
        render(
            <ConversationTurnBubble
                turn={makeTurn({ sdkEventId: undefined })}
                turnIndex={2}
                provider="claude"
                onEditTurn={onEditTurn}
            />,
        );
        const btn = editBtn();
        expect(btn!.disabled).toBe(true);
        expect(btn!.getAttribute('title')).toBe(REWIND_NO_ANCHOR_TOOLTIP);
        fireEvent.click(btn!);
        expect(onEditTurn).not.toHaveBeenCalled();
    });

    it('renders the pencil disabled with a busy tooltip while the conversation is not idle', () => {
        const onEditTurn = vi.fn();
        render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={2}
                provider="claude"
                onEditTurn={onEditTurn}
                editTurnDisabledReason={EDIT_BUSY_TOOLTIP}
            />,
        );
        const btn = editBtn();
        expect(btn).toBeTruthy();
        expect(btn!.disabled).toBe(true);
        expect(btn!.getAttribute('title')).toBe(EDIT_BUSY_TOOLTIP);
        fireEvent.click(btn!);
        expect(onEditTurn).not.toHaveBeenCalled();
    });

    it('keeps the pencil hidden on codex even when a busy reason is supplied', () => {
        render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={2}
                provider="codex"
                onEditTurn={vi.fn()}
                editTurnDisabledReason={EDIT_BUSY_TOOLTIP}
            />,
        );
        expect(editBtn()).toBeNull();
    });

    it('swaps the rendered content for the inline editor node when one is supplied', () => {
        render(
            <ConversationTurnBubble
                turn={makeTurn({ content: 'Hello world' })}
                turnIndex={2}
                provider="claude"
                onEditTurn={vi.fn()}
                inlineEditor={<div data-testid="fake-editor">editor</div>}
            />,
        );
        expect(screen.getByTestId('fake-editor')).toBeTruthy();
        expect(screen.queryByTestId('user-plain-text')).toBeNull();
    });

    it('hides the pencil on the turn that is already being edited', () => {
        render(
            <ConversationTurnBubble
                turn={makeTurn()}
                turnIndex={2}
                provider="claude"
                onEditTurn={vi.fn()}
                inlineEditor={<div data-testid="fake-editor">editor</div>}
            />,
        );
        expect(editBtn()).toBeNull();
    });

    it('renders the turn normally when no inline editor is supplied', () => {
        render(
            <ConversationTurnBubble
                turn={makeTurn({ content: 'Hello world' })}
                turnIndex={2}
                provider="claude"
                onEditTurn={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('fake-editor')).toBeNull();
        expect(screen.getByTestId('user-plain-text')).toBeTruthy();
    });
});
