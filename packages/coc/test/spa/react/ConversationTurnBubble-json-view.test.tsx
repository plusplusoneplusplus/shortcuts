/**
 * Tests for JSON response viewer integration in ConversationTurnBubble.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/chat/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

// Mock JsonResponseView to avoid importing the full @uiw/react-json-view library in tests
vi.mock('../../../src/server/spa/client/react/chat/JsonResponseView', () => ({
    JsonResponseView: ({ content }: { content: string }) => (
        <div data-testid="json-response-view" className="json-response-view">{content}</div>
    ),
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Hello world',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — JSON response viewer', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // --- JSON detection ---

    it('renders JsonResponseView for a pure JSON object response', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: '{"key": "value", "num": 42}' })} />
        );
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="markdown-view"]')).toBeNull();
    });

    it('renders JsonResponseView for a pure JSON array response', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: '[1, 2, 3]' })} />
        );
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeTruthy();
    });

    it('does NOT render JsonResponseView for non-JSON content', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: 'This is plain text' })} />
        );
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeNull();
        expect(container.querySelector('[data-testid="markdown-view"]')).toBeTruthy();
    });

    it('does NOT render JsonResponseView for markdown with embedded JSON', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: 'Result: ```json\n{"a":1}\n```' })} />
        );
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeNull();
    });

    it('does NOT render JsonResponseView while streaming', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: '{"key": "value"}', streaming: true })} />
        );
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeNull();
    });

    it('does NOT render JsonResponseView for user messages', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ role: 'user', content: '{"key": "value"}' })} />
        );
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeNull();
    });

    // --- Toggle button ---

    it('shows JSON toggle button when JSON is detected', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: '{"key": "value"}' })} />
        );
        const btn = container.querySelector('[data-testid="json-toggle-btn"]');
        expect(btn).toBeTruthy();
        expect(btn!.textContent).toBe('JSON');
    });

    it('does NOT show JSON toggle button for non-JSON content', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: 'plain text' })} />
        );
        expect(container.querySelector('[data-testid="json-toggle-btn"]')).toBeNull();
    });

    it('switches to rendered view when toggle is clicked', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: '{"key": "value"}' })} />
        );
        const btn = container.querySelector('[data-testid="json-toggle-btn"]') as HTMLButtonElement;
        fireEvent.click(btn);
        // Should now show markdown view, not JSON view
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeNull();
        expect(container.querySelector('[data-testid="markdown-view"]')).toBeTruthy();
        expect(btn.textContent).toBe('Rendered');
    });

    it('switches back to JSON view on second toggle click', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: '{"key": "value"}' })} />
        );
        const btn = container.querySelector('[data-testid="json-toggle-btn"]') as HTMLButtonElement;
        fireEvent.click(btn); // → rendered
        fireEvent.click(btn); // → json
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeTruthy();
        expect(btn.textContent).toBe('JSON');
    });

    // --- Raw view overrides JSON view ---

    it('raw view takes precedence over JSON view', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: '{"key": "value"}' })} />
        );
        // Activate raw mode
        const rawBtn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(rawBtn);
        expect(container.querySelector('[data-testid="json-response-view"]')).toBeNull();
        expect(container.querySelector('.raw-content-view')).toBeTruthy();
    });

    it('hides JSON toggle button when raw mode is active', () => {
        const { container } = render(
            <ConversationTurnBubble turn={makeTurn({ content: '{"key": "value"}' })} />
        );
        const rawBtn = container.querySelector('.bubble-raw-btn') as HTMLButtonElement;
        fireEvent.click(rawBtn);
        expect(container.querySelector('[data-testid="json-toggle-btn"]')).toBeNull();
    });
});
