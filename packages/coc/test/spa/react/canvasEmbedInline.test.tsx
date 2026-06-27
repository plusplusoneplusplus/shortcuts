/**
 * AC-05 — inline-in-chat Excalidraw rendering via the canvas:// marker.
 *
 * Verifies the full round-trip: the marker that `write_canvas` returns for an
 * excalidraw canvas (`canvas://<id>`) is rewritten by `chatMarkdownToHtml` into
 * an embed placeholder, `MarkdownView` mounts `ExcalidrawPreview` on it, and the
 * preview reads the scene from the canvas store endpoint and renders it.
 */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// @excalidraw/excalidraw can't load in Node; the global setup stubs it to
// render nothing. Override locally so the rendered scene is observable.
vi.mock('@excalidraw/excalidraw', () => ({
    Excalidraw: ({ initialData }: { initialData: { elements?: unknown[] } }) => (
        <div
            data-testid="mock-excalidraw"
            data-element-count={Array.isArray(initialData?.elements) ? initialData.elements.length : 0}
        />
    ),
    restoreElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
    convertToExcalidrawElements: (elements: unknown) => (Array.isArray(elements) ? elements : []),
}));

import { MarkdownView } from '../../../src/server/spa/client/react/shared/MarkdownView';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';

const SCENE = JSON.stringify({
    elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
        { id: 'b', type: 'ellipse', x: 20, y: 0, width: 10, height: 10 },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
});

describe('inline canvas:// excalidraw embed', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ canvas: { id: 'arch', title: 'Architecture', type: 'excalidraw', content: SCENE } }),
        });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('renders the diagram inline from the canvas store endpoint', async () => {
        // The marker is exactly what write_canvas returns for an excalidraw canvas.
        const html = chatMarkdownToHtml('Here it is: canvas://arch', 'ws-1', { excalidrawEmbedEnabled: true });
        expect(html).toContain('data-canvas-id="arch"');

        render(<MarkdownView html={html} />);

        // The preview fetches the scene from the canvas store, not /api/diagrams.
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(fetchMock.mock.calls[0][0]).toContain('/workspaces/ws-1/canvases/arch');
        expect(fetchMock.mock.calls[0][0]).not.toContain('/diagrams');

        const viewer = await screen.findByTestId('mock-excalidraw');
        expect(viewer.getAttribute('data-element-count')).toBe('2');
    });

    it('does not mount a preview for legacy excalidraw:// embeds (no canvas id)', async () => {
        const html = chatMarkdownToHtml('Old: excalidraw://ws-1/old.excalidraw', 'ws-1', { excalidrawEmbedEnabled: true });
        // The legacy placeholder is still emitted, but it carries no canvas id...
        expect(html).toContain('data-diagram-path="old.excalidraw"');

        render(<MarkdownView html={html} />);

        // ...so nothing is fetched and no viewer mounts (the removed /api/diagrams
        // endpoint is intentionally unsupported after the hard cutover).
        await new Promise(r => setTimeout(r, 20));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByTestId('mock-excalidraw')).toBeNull();
    });
});
