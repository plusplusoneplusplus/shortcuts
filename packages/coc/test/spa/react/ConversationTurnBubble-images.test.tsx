/**
 * Tests for ConversationTurnBubble — user image gallery behavior.
 * User text remains plain/linkified (no MarkdownView).
 * Image galleries are restored for user turns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const mockQueueImages = vi.fn();
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ queue: { images: mockQueueImages } }),
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

describe('ConversationTurnBubble — user image gallery', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockQueueImages.mockReset();
    });

    it('renders ImageGallery when a user turn has inline images', () => {
        render(<ConversationTurnBubble turn={makeTurn({ images: ['data:image/png;base64,aaaa', 'data:image/jpeg;base64,bbbb'] })} />);
        expect(screen.getByTestId('image-gallery')).toBeTruthy();
    });

    it('does not render ImageGallery when a user turn has no images', () => {
        render(<ConversationTurnBubble turn={makeTurn({ images: undefined })} />);
        expect(screen.queryByTestId('image-gallery')).toBeNull();
    });

    it('does not render ImageGallery when a user turn has an empty images array', () => {
        render(<ConversationTurnBubble turn={makeTurn({ images: [] })} />);
        expect(screen.queryByTestId('image-gallery')).toBeNull();
    });

    it('does not render ImageGallery for assistant turns even if images is present', () => {
        render(<ConversationTurnBubble turn={makeTurn({ role: 'assistant', content: 'Hi', images: ['data:image/png;base64,aaaa'] })} />);
        expect(screen.queryByTestId('image-gallery')).toBeNull();
    });

    it('renders the lazy "Load N images" button when imagesCount exists, no inline images, and taskId provided', () => {
        render(<ConversationTurnBubble turn={makeTurn({ imagesCount: 3, images: undefined })} taskId="task-1" />);
        const btn = screen.getByTestId('load-images-btn');
        expect(btn.textContent).toContain('Load 3 images');
    });

    it('does not render the lazy load button when taskId is missing', () => {
        render(<ConversationTurnBubble turn={makeTurn({ imagesCount: 3, images: undefined })} />);
        expect(screen.queryByTestId('load-images-btn')).toBeNull();
    });

    it('uses singular "image" when imagesCount is 1', () => {
        render(<ConversationTurnBubble turn={makeTurn({ imagesCount: 1, images: undefined })} taskId="task-1" />);
        const btn = screen.getByTestId('load-images-btn');
        expect(btn.textContent).toContain('Load 1 image');
        expect(btn.textContent).not.toContain('images');
    });

    it('keeps user content as plain/linkified text and does not render MarkdownView', () => {
        render(<ConversationTurnBubble turn={makeTurn({ content: 'Hello **world**' })} />);
        const plainText = screen.getByTestId('user-plain-text');
        expect(plainText.textContent).toBe('Hello **world**');
        expect(screen.queryByTestId('markdown-view')).toBeNull();
    });
});

describe('ConversationTurnBubble — lazy image fetch', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockQueueImages.mockReset();
    });

    it('fetches and displays images after clicking load button', async () => {
        mockQueueImages.mockResolvedValue({ images: ['data:image/png;base64,fetched1', 'data:image/png;base64,fetched2'] });
        render(<ConversationTurnBubble turn={makeTurn({ imagesCount: 2, images: undefined })} taskId="task-1" />);

        const btn = screen.getByTestId('load-images-btn');
        fireEvent.click(btn);

        await waitFor(() => {
            expect(screen.getByTestId('image-gallery')).toBeTruthy();
        });
        expect(mockQueueImages).toHaveBeenCalledWith('task-1');
    });

    it('shows loading skeleton while fetching', async () => {
        let resolve: (v: any) => void;
        mockQueueImages.mockReturnValue(new Promise(r => { resolve = r; }));
        render(<ConversationTurnBubble turn={makeTurn({ imagesCount: 2, images: undefined })} taskId="task-1" />);

        fireEvent.click(screen.getByTestId('load-images-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('image-gallery-loading')).toBeTruthy();
        });

        resolve!({ images: ['data:image/png;base64,done'] });
        await waitFor(() => {
            expect(screen.getByTestId('image-gallery')).toBeTruthy();
        });
    });

    it('shows retry button on fetch error', async () => {
        mockQueueImages.mockRejectedValue(new Error('network'));
        render(<ConversationTurnBubble turn={makeTurn({ imagesCount: 2, images: undefined })} taskId="task-1" />);

        fireEvent.click(screen.getByTestId('load-images-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('retry-images-btn')).toBeTruthy();
        });
    });
});