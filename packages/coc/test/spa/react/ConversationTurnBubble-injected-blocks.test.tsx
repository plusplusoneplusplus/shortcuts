import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
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
    renderMarkdownToHtml: (text: string) => `<p>${text}</p>`,
}));

const CHAT_STYLE_BLOCK = [
    '<chat-style>',
    'Selected style: Structured.',
    'Focus on clear sections.',
    '</chat-style>',
].join('\n');

const CHAT_MODE_BLOCK = [
    '<coc-chat-mode>',
    'Current mode: ask.',
    '</coc-chat-mode>',
].join('\n');

const REPO_GROUP_CONTEXT = [
    '<repo_group_context>',
    'Repo group "My Team" members:',
    '- Repo A: /home/me/repos/a',
    '</repo_group_context>',
].join('\n');

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Explain the change.',
        timestamp: '2026-01-15T14:19:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — injected block disclosures', () => {
    it('strips leading injected blocks from the user bubble while preserving the message', () => {
        const content = `${CHAT_STYLE_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\nKeep **my words** intact.`;
        const { getByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        const message = getByTestId('user-plain-text');
        expect(message.textContent).toBe('Keep my words intact.');
        expect(message.textContent).not.toContain('<chat-style>');
        expect(message.textContent).not.toContain('<coc-chat-mode>');
    });

    it('renders no injected-block toggle when the prefix has no supported block', () => {
        const { queryByTestId } = render(<ConversationTurnBubble turn={makeTurn()} />);

        expect(queryByTestId('chat-mode-block-disclosure')).toBeNull();
        expect(queryByTestId('chat-style-block-disclosure')).toBeNull();
    });

    it('renders each present block collapsed by default', () => {
        const content = `${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}\n\nExplain the change.`;
        const { getByTestId, queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        expect(getByTestId('chat-mode-block-toggle').textContent).toContain('Chat mode');
        expect(getByTestId('chat-mode-block-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(getByTestId('chat-style-block-toggle').textContent).toContain('Chat style');
        expect(getByTestId('chat-style-block-toggle').getAttribute('aria-expanded')).toBe('false');
        expect(queryByTestId('chat-mode-block-body')).toBeNull();
        expect(queryByTestId('chat-style-block-body')).toBeNull();
    });

    it('expands to the verbatim block and collapses again', () => {
        const content = `${CHAT_STYLE_BLOCK}\n\nExplain the change.`;
        const { getByTestId, queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);
        const toggle = getByTestId('chat-style-block-toggle');

        expect(queryByTestId('chat-mode-block-toggle')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle.textContent).toContain('Hide chat style');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(getByTestId('chat-style-block-body').textContent).toBe(CHAT_STYLE_BLOCK);

        fireEvent.click(toggle);
        expect(toggle.textContent).toContain('Chat style');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(queryByTestId('chat-style-block-body')).toBeNull();
    });

    it('expands chat mode and chat style independently', () => {
        const content = `${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}\n\nExplain the change.`;
        const { getByTestId, queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        fireEvent.click(getByTestId('chat-mode-block-toggle'));
        expect(getByTestId('chat-mode-block-toggle').textContent).toContain('Hide chat mode');
        expect(getByTestId('chat-mode-block-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(getByTestId('chat-mode-block-body').textContent).toBe(CHAT_MODE_BLOCK);
        expect(queryByTestId('chat-style-block-body')).toBeNull();

        fireEvent.click(getByTestId('chat-style-block-toggle'));
        expect(getByTestId('chat-mode-block-body').textContent).toBe(CHAT_MODE_BLOCK);
        expect(getByTestId('chat-style-block-body').textContent).toBe(CHAT_STYLE_BLOCK);

        fireEvent.click(getByTestId('chat-mode-block-toggle'));
        expect(queryByTestId('chat-mode-block-body')).toBeNull();
        expect(getByTestId('chat-style-block-body').textContent).toBe(CHAT_STYLE_BLOCK);
    });

    it('renders chat mode, chat style, and repo group context in stable order', () => {
        const content = `${CHAT_STYLE_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\nExplain the change.`;
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ content, repoGroupContext: REPO_GROUP_CONTEXT })} />,
        );

        const disclosures = Array.from(
            getByTestId('chat-mode-block-disclosure').parentElement!.querySelectorAll('[data-testid$="-disclosure"]'),
        ).map(element => element.getAttribute('data-testid'));
        expect(disclosures).toEqual([
            'chat-mode-block-disclosure',
            'chat-style-block-disclosure',
            'repo-group-context-disclosure',
        ]);
    });

    it('renders disclosures when the user content contains only injected blocks', () => {
        const content = `${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}`;
        const { getByTestId, queryByTestId } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        expect(queryByTestId('user-plain-text')).toBeNull();
        expect(getByTestId('chat-mode-block-toggle')).toBeTruthy();
        expect(getByTestId('chat-style-block-toggle')).toBeTruthy();
    });

    it('does not strip supported tags from assistant turns', () => {
        const content = `${CHAT_MODE_BLOCK}\n\nAssistant response.`;
        const { getByTestId, queryByTestId } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', content })} />,
        );

        expect(getByTestId('markdown-view').textContent).toContain('<coc-chat-mode>');
        expect(getByTestId('markdown-view').textContent).toContain('Assistant response.');
        expect(queryByTestId('chat-mode-block-toggle')).toBeNull();
    });

    it('keeps the complete original user content in raw view', () => {
        const content = `${CHAT_MODE_BLOCK}\n\nExplain the change.`;
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ content })} />);

        fireEvent.click(container.querySelector('.bubble-raw-btn') as HTMLButtonElement);
        expect(container.querySelector('.raw-content-view')?.textContent).toBe(content);
    });
});
