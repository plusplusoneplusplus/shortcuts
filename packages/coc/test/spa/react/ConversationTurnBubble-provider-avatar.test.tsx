/**
 * @vitest-environment jsdom
 *
 * Tests for ConversationTurnBubble — provider-driven assistant avatar palette.
 *
 * The assistant turn's circular avatar (the small letter "C" tile) now picks
 * its background/text/border colors based on the `provider` prop so the chat
 * surface mirrors the agent that produced the response:
 *
 *   - Copilot → green   (#15703a on #dafbe1)
 *   - Claude  → coral   (#b5532c on #fdece1)
 *   - Codex   → indigo  (#4f46e5 on #eef0ff)
 *
 * Missing/unknown providers must fall back to the Copilot palette so chats
 * that have no provider metadata keep their previous look.
 *
 * Error + run-script avatars must NOT inherit the provider palette — they
 * keep their existing dedicated palettes (red error tile and dark terminal
 * tile, respectively).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

function makeAssistantTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Sure, here is your answer.',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — provider-driven avatar palette', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('defaults to the Copilot green palette when no provider is supplied', () => {
        const { container } = render(<ConversationTurnBubble turn={makeAssistantTurn()} />);
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.className).toContain('bg-[#dafbe1]');
        expect(avatar.className).toContain('text-[#15703a]');
        expect(avatar.getAttribute('data-provider')).toBe('copilot');
    });

    it('uses the Copilot green palette when provider="copilot"', () => {
        const { container } = render(<ConversationTurnBubble turn={makeAssistantTurn()} provider="copilot" />);
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.className).toContain('bg-[#dafbe1]');
        expect(avatar.className).toContain('text-[#15703a]');
        expect(avatar.getAttribute('data-provider')).toBe('copilot');
    });

    it('uses the Claude coral palette when provider="claude"', () => {
        const { container } = render(<ConversationTurnBubble turn={makeAssistantTurn()} provider="claude" />);
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.className).toContain('bg-[#fdece1]');
        expect(avatar.className).toContain('text-[#b5532c]');
        expect(avatar.getAttribute('data-provider')).toBe('claude');
    });

    it('uses the Codex indigo palette when provider="codex"', () => {
        const { container } = render(<ConversationTurnBubble turn={makeAssistantTurn()} provider="codex" />);
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.className).toContain('bg-[#eef0ff]');
        expect(avatar.className).toContain('text-[#4f46e5]');
        expect(avatar.getAttribute('data-provider')).toBe('codex');
    });

    it('error assistant avatar keeps the red error palette and ignores provider', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeAssistantTurn({ isError: true })} provider="claude" />,
        );
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.className).toContain('bg-[#ffebe9]');
        // The Claude coral background must NOT leak into error avatars.
        expect(avatar.className).not.toContain('bg-[#fdece1]');
        expect(avatar.getAttribute('data-provider')).toBeNull();
    });

    it('script-output avatar keeps the dark terminal palette and ignores provider', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeAssistantTurn()} processType="run-script" provider="codex" />,
        );
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar.className).toContain('bg-[#1e1e1e]');
        // The Codex indigo background must NOT leak into script avatars.
        expect(avatar.className).not.toContain('bg-[#eef0ff]');
        expect(avatar.getAttribute('data-provider')).toBeNull();
    });
});
