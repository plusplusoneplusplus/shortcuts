/**
 * Tests for ConversationTurnBubble — user turns render as plain text, no images.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
        content: 'Hello world',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

describe('ConversationTurnBubble — user turns render plain text, no images', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('does not render ImageGallery for user turns even when images are present', () => {
        render(<ConversationTurnBubble turn={makeTurn({ images: ['data:image/png;base64,aaaa', 'data:image/jpeg;base64,bbbb'] })} />);
        expect(screen.queryByTestId('image-gallery')).toBeNull();
    });

    it('does not render "Load N images" button for user turns', () => {
        render(<ConversationTurnBubble turn={makeTurn({ imagesCount: 3, images: undefined })} taskId="task-1" />);
        expect(screen.queryByTestId('load-images-btn')).toBeNull();
    });

    it('renders user content as plain text, not markdown', () => {
        render(<ConversationTurnBubble turn={makeTurn({ content: 'Hello **world**' })} />);
        const plainText = screen.getByTestId('user-plain-text');
        expect(plainText.textContent).toBe('Hello **world**');
        expect(screen.queryByTestId('markdown-view')).toBeNull();
    });

    it('preserves newlines in user content via plain text rendering', () => {
        render(<ConversationTurnBubble turn={makeTurn({ content: 'line1\nline2\nline3' })} />);
        const plainText = screen.getByTestId('user-plain-text');
        expect(plainText.textContent).toBe('line1\nline2\nline3');
    });

    it('does not render markdown-view for user turns with markdown syntax', () => {
        render(<ConversationTurnBubble turn={makeTurn({ content: '# Heading\n- bullet' })} />);
        expect(screen.queryByTestId('markdown-view')).toBeNull();
        expect(screen.getByTestId('user-plain-text').textContent).toBe('# Heading\n- bullet');
    });
});