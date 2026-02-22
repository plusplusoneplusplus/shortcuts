/**
 * Tests for ConversationTurnBubble — semantic CSS hook classes and copy button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

// Mock useDisplaySettings — module-level cache, no provider needed
vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

// Mock markdown renderer to avoid DOM-heavy dependencies
vi.mock('../../../src/server/spa/client/react/processes/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'user',
        content: 'Hello world',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — semantic hooks', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // --- chat-message class + role ---

    it('adds .chat-message.user on user turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const el = container.querySelector('.chat-message.user');
        expect(el).toBeTruthy();
        expect(container.querySelector('.chat-message.assistant')).toBeNull();
    });

    it('adds .chat-message.assistant on assistant turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const el = container.querySelector('.chat-message.assistant');
        expect(el).toBeTruthy();
        expect(container.querySelector('.chat-message.user')).toBeNull();
    });

    // --- streaming class ---

    it('adds .streaming class when turn.streaming is true', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ streaming: true })} />);
        const el = container.querySelector('.chat-message.streaming');
        expect(el).toBeTruthy();
    });

    it('does not add .streaming class when turn.streaming is false', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ streaming: false })} />);
        expect(container.querySelector('.chat-message.streaming')).toBeNull();
    });

    // --- role-label ---

    it('renders .role-label with "You" for user turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const label = container.querySelector('.role-label');
        expect(label).toBeTruthy();
        expect(label!.textContent).toBe('You');
    });

    it('renders .role-label with "Assistant" for assistant turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const label = container.querySelector('.role-label');
        expect(label).toBeTruthy();
        expect(label!.textContent).toBe('Assistant');
    });

    // --- timestamp ---

    it('renders .timestamp when turn.timestamp is set', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ timestamp: '2026-01-15T10:30:00Z' })} />);
        const ts = container.querySelector('.timestamp');
        expect(ts).toBeTruthy();
        expect(ts!.textContent!.length).toBeGreaterThan(0);
    });

    it('does not render .timestamp when turn.timestamp is undefined', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ timestamp: undefined })} />);
        expect(container.querySelector('.timestamp')).toBeNull();
    });

    // --- streaming-indicator ---

    it('renders .streaming-indicator on streaming turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ streaming: true })} />);
        const indicator = container.querySelector('.streaming-indicator');
        expect(indicator).toBeTruthy();
        expect(indicator!.textContent).toBe('Live');
    });

    it('does not render .streaming-indicator on non-streaming turns', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ streaming: false })} />);
        expect(container.querySelector('.streaming-indicator')).toBeNull();
    });

    // --- chat-message-content ---

    it('renders .chat-message-content wrapper', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn()} />);
        const content = container.querySelector('.chat-message-content');
        expect(content).toBeTruthy();
    });

    // --- bubble-copy-btn ---

    it('renders .bubble-copy-btn for assistant messages', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const btn = container.querySelector('.bubble-copy-btn');
        expect(btn).toBeTruthy();
    });

    it('does not render .bubble-copy-btn for user messages', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        expect(container.querySelector('.bubble-copy-btn')).toBeNull();
    });

    it('copies turn.content to clipboard when .bubble-copy-btn is clicked', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });

        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'assistant', content: 'Copy me!' })} />
        );
        const btn = container.querySelector('.bubble-copy-btn') as HTMLButtonElement;
        fireEvent.click(btn);
        expect(writeText).toHaveBeenCalledWith('Copy me!');
    });

    // --- group class on inner bubble (for group-hover) ---

    it('adds group class on inner bubble div for hover support', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const outer = container.querySelector('.chat-message');
        const inner = outer?.querySelector('.group');
        expect(inner).toBeTruthy();
    });

    // --- no Tailwind classes removed ---

    it('preserves existing Tailwind classes on outer wrapper', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        const outer = container.querySelector('.chat-message');
        expect(outer?.classList.contains('flex')).toBe(true);
        expect(outer?.classList.contains('justify-end')).toBe(true);
    });

    it('preserves justify-start on assistant outer wrapper', () => {
        const { container } = render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant' })} />);
        const outer = container.querySelector('.chat-message');
        expect(outer?.classList.contains('justify-start')).toBe(true);
    });
});
