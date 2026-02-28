/**
 * Tests for ConversationTurnBubble — image rendering in user bubbles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/processes/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/processes/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

const IMG_A = 'data:image/png;base64,aaaa';
const IMG_B = 'data:image/jpeg;base64,bbbb';

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

describe('ConversationTurnBubble — image rendering', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders ImageGallery when user turn has images', () => {
        render(<ConversationTurnBubble turn={makeTurn({ images: [IMG_A, IMG_B] })} />);
        expect(screen.getByTestId('image-gallery')).toBeTruthy();
        const imgs = screen.getAllByRole('img');
        expect(imgs).toHaveLength(2);
    });

    it('does not render ImageGallery when user turn has no images', () => {
        render(<ConversationTurnBubble turn={makeTurn()} />);
        expect(screen.queryByTestId('image-gallery')).toBeNull();
    });

    it('does not render ImageGallery when user turn has empty images array', () => {
        render(<ConversationTurnBubble turn={makeTurn({ images: [] })} />);
        expect(screen.queryByTestId('image-gallery')).toBeNull();
    });

    it('does not render ImageGallery for assistant turns even with images', () => {
        render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant', images: [IMG_A] })} />);
        expect(screen.queryByTestId('image-gallery')).toBeNull();
    });
});
