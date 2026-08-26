/**
 * Tests for ConversationTurnBubble — the "Repo group context" disclosure on a
 * user turn in a repo-group chat.
 *
 *   - A user turn carrying `repoGroupContext` renders a collapsed toggle;
 *     clicking it reveals the injected block verbatim, as preformatted text.
 *   - The turn's own message text is untouched — the block is never spliced
 *     into what the user typed.
 *   - A turn without a context renders no toggle at all — non-group chats,
 *     turns recorded before the field existed, and every follow-up turn that
 *     dispatch decided did not need the block re-injected.
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

const BLOCK = [
    '<repo_group_context>',
    'Repo group "My Team" members:',
    '- Repo A: /home/me/repos/a',
    '- Repo B: /home/me/repos/b',
    '</repo_group_context>',
].join('\n');

function makeUserTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Compare the auth flow across both repos',
        timestamp: '2026-01-15T14:19:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — repo group context disclosure', () => {
    it('renders a collapsed toggle when the user turn carries an injected context', () => {
        const { getByTestId, queryByTestId } = render(
            <ConversationTurnBubble turn={makeUserTurn({ repoGroupContext: BLOCK })} />,
        );

        const toggle = getByTestId('repo-group-context-toggle');
        expect(toggle.textContent).toContain('Repo group context');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(queryByTestId('repo-group-context-body')).toBeNull();
    });

    it('reveals the injected member listing verbatim when expanded', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeUserTurn({ repoGroupContext: BLOCK })} />,
        );

        fireEvent.click(getByTestId('repo-group-context-toggle'));

        const body = getByTestId('repo-group-context-body');
        expect(body.textContent).toBe(BLOCK);
        expect(body.textContent).toContain('- Repo A: /home/me/repos/a');
        expect(body.textContent).toContain('- Repo B: /home/me/repos/b');
        expect(getByTestId('repo-group-context-toggle').getAttribute('aria-expanded')).toBe('true');
    });

    it('sets its own text colour in both themes rather than inheriting the bubble', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeUserTurn({ repoGroupContext: BLOCK })} />,
        );

        fireEvent.click(getByTestId('repo-group-context-toggle'));

        const cls = getByTestId('repo-group-context-body').className;
        expect(cls).toContain('text-[#1e1e1e]');
        expect(cls).toContain('dark:text-[#cccccc]');
    });

    it('collapses again on a second click', () => {
        const { getByTestId, queryByTestId } = render(
            <ConversationTurnBubble turn={makeUserTurn({ repoGroupContext: BLOCK })} />,
        );

        fireEvent.click(getByTestId('repo-group-context-toggle'));
        fireEvent.click(getByTestId('repo-group-context-toggle'));

        expect(queryByTestId('repo-group-context-body')).toBeNull();
    });

    it('shows only live members — a dropped stale member never appears', () => {
        const liveOnly = BLOCK.replace('- Repo B: /home/me/repos/b\n', '');
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeUserTurn({ repoGroupContext: liveOnly })} />,
        );

        fireEvent.click(getByTestId('repo-group-context-toggle'));

        expect(getByTestId('repo-group-context-body').textContent).not.toContain('Repo B');
    });

    it('leaves the message text itself untouched', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeUserTurn({ repoGroupContext: BLOCK })} />,
        );

        expect(container.textContent).toContain('Compare the auth flow across both repos');
        // Collapsed by default, so the block is not part of the visible transcript.
        expect(container.textContent).not.toContain('repo_group_context');
    });

    it('renders no toggle for a turn without an injected context', () => {
        const { queryByTestId } = render(<ConversationTurnBubble turn={makeUserTurn()} />);

        expect(queryByTestId('repo-group-context-disclosure')).toBeNull();
        expect(queryByTestId('repo-group-context-toggle')).toBeNull();
    });

    it('renders no toggle on an assistant turn even if the field is set', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble turn={makeUserTurn({ role: 'assistant', repoGroupContext: BLOCK })} />,
        );

        expect(queryByTestId('repo-group-context-toggle')).toBeNull();
    });
});
