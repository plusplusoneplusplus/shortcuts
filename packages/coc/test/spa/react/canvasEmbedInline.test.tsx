/**
 * @vitest-environment jsdom
 *
 * Regression coverage for inline canvas:// references. The persisted canvas
 * descriptor is the source of truth: its type decides which viewer mounts.
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    getExtension: vi.fn(),
    client: null as unknown,
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => mocks.client,
}));

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
import { KustoEmbedGroupProvider } from '../../../src/server/spa/client/react/shared/KustoEmbedGroup';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';

mocks.client = {
    canvases: {
        get: mocks.get,
        getExtension: mocks.getExtension,
    },
};

const SCENE = JSON.stringify({
    elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
        { id: 'b', type: 'ellipse', x: 20, y: 0, width: 10, height: 10 },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
});

const EXTENSION = {
    manifest: {
        description: 'Notes Chat header redesign',
        capabilities: [{ name: 'set_scope', description: 'Change chat scope' }],
    },
    uiHtml: '<main><header><strong>Notes Chat</strong><button>This note</button><button>Workspace</button></header></main>',
    capabilitiesJs: 'capabilities = { set_scope: function (state) { return state; } };',
};

describe('inline canvas:// embed', () => {
    beforeEach(() => {
        mocks.get.mockReset();
        mocks.getExtension.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('preserves the Excalidraw preview for an Excalidraw canvas', async () => {
        mocks.get.mockResolvedValue({
            id: 'arch',
            workspaceId: 'ws-1',
            title: 'Architecture',
            type: 'excalidraw',
            content: SCENE,
            revision: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'ai',
        });

        const html = chatMarkdownToHtml('Here it is: canvas://arch', 'ws-1', { canvasEmbedEnabled: true });
        expect(html).toContain('data-canvas-id="arch"');
        expect(html).toContain('md-canvas-embed');

        render(<MarkdownView html={html} />);

        await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('ws-1', 'arch'));
        const viewer = await screen.findByTestId('mock-excalidraw');
        expect(viewer.getAttribute('data-element-count')).toBe('2');
    });

    it('renders an extension canvas through its sandboxed iframe instead of Excalidraw', async () => {
        mocks.get.mockResolvedValue({
            id: 'notes-chat-header-redesign-d68498',
            workspaceId: 'ws-1',
            title: 'Notes Chat Header Redesign',
            type: 'extension',
            content: JSON.stringify({ scope: 'note', pinned: false, compact: true }),
            revision: 11,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'user',
        });
        mocks.getExtension.mockResolvedValue(EXTENSION);

        const html = chatMarkdownToHtml(
            'canvas://notes-chat-header-redesign-d68498',
            'ws-1',
            { canvasEmbedEnabled: true },
        );
        render(<MarkdownView html={html} />);

        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        expect(mocks.get).toHaveBeenCalledWith('ws-1', 'notes-chat-header-redesign-d68498');
        expect(mocks.getExtension).toHaveBeenCalledWith('ws-1', 'notes-chat-header-redesign-d68498');
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
        expect(iframe.getAttribute('srcdoc')).toContain('window.CanvasHost');
        expect(iframe.getAttribute('srcdoc')).toContain('Notes Chat');
        expect(screen.queryByTestId('mock-excalidraw')).toBeNull();
    });

    it('renders a Kusto canvas through the interactive Kusto view', async () => {
        mocks.get.mockResolvedValue({
            id: 'expl-canvas',
            workspaceId: 'ws-1',
            title: 'Storm data',
            type: 'kusto',
            content: JSON.stringify({
                query: 'StormEvents | take 5',
                clusterUrl: 'https://help.kusto.windows.net',
                database: 'Samples',
                columns: [{ name: 'State', type: 'string' }],
                rows: [['Texas']],
                truncated: false,
                lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 1 },
            }),
            revision: 3,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'ai',
        });

        const html = chatMarkdownToHtml('canvas://expl-canvas', 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        const embed = await screen.findByTestId('canvas-embed-kusto');
        expect(mocks.get).toHaveBeenCalledWith('ws-1', 'expl-canvas');
        expect(embed.querySelector('[data-testid="kusto-query"]')).toBeTruthy();
        expect(screen.getByText('Texas')).toBeInTheDocument();
        expect(screen.queryByTestId('mock-excalidraw')).toBeNull();
    });

    it.each([
        { type: 'markdown', content: '# Project brief', label: 'markdown' },
        { type: 'code', content: 'const scope = "note";', label: 'typescript', language: 'typescript' },
    ])('renders a $type canvas as a document instead of an empty diagram', async ({ type, content, label, language }) => {
        mocks.get.mockResolvedValue({
            id: `${type}-canvas`,
            workspaceId: 'ws-1',
            title: 'Reference',
            type,
            content,
            language,
            revision: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'ai',
        });

        const html = chatMarkdownToHtml(`canvas://${type}-canvas`, 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        const preview = await screen.findByTestId('canvas-embed-document');
        expect(preview.textContent).toContain(content);
        expect(preview.textContent).toContain(label);
        expect(screen.queryByTestId('mock-excalidraw')).toBeNull();
    });

    function kustoCanvas(id: string) {
        return {
            id,
            workspaceId: 'ws-1',
            title: `Query ${id}`,
            type: 'kusto',
            content: JSON.stringify({
                query: 'StormEvents | take 5',
                clusterUrl: 'https://help.kusto.windows.net',
                database: 'Samples',
                columns: [{ name: 'State', type: 'string' }],
                rows: [['Texas']],
                truncated: false,
                lastRun: { timestamp: '2026-07-18T01:00:00.000Z', status: 'success', rowCount: 1 },
            }),
            revision: 3,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastEditor: 'ai',
        };
    }

    function renderGroupedKustoEmbeds() {
        mocks.get.mockImplementation((_ws: string, id: string) => Promise.resolve(kustoCanvas(id)));
        const html = chatMarkdownToHtml('canvas://k1\n\ncanvas://k2', 'ws-1', { canvasEmbedEnabled: true });
        return render(
            <KustoEmbedGroupProvider>
                <MarkdownView html={html} />
            </KustoEmbedGroupProvider>,
        );
    }

    it('keeps only the most recent Kusto embed expanded when several are grouped', async () => {
        renderGroupedKustoEmbeds();

        // The last embed in document order stays open; earlier ones collapse.
        await waitFor(() => {
            const embeds = screen.getAllByTestId('canvas-embed-kusto');
            expect(embeds).toHaveLength(2);
            expect(embeds[0].getAttribute('data-expanded')).toBe('false');
            expect(embeds[1].getAttribute('data-expanded')).toBe('true');
        });

        // Only the expanded (last) embed mounts the interactive query editor.
        expect(screen.getAllByTestId('kusto-query')).toHaveLength(1);
        const embeds = screen.getAllByTestId('canvas-embed-kusto');
        expect(embeds[1].querySelector('[data-testid="kusto-query"]')).toBeTruthy();
        expect(embeds[0].querySelector('[data-testid="kusto-query"]')).toBeNull();
        // The collapsed embed still shows its header + summary so it can be reopened.
        expect(embeds[0].querySelector('[data-testid="canvas-embed-kusto-summary"]')?.textContent).toBe('1 row');
    });

    it('expands a collapsed Kusto embed when the reader clicks its header', async () => {
        renderGroupedKustoEmbeds();

        await waitFor(() => {
            expect(screen.getAllByTestId('canvas-embed-kusto')[0].getAttribute('data-expanded')).toBe('false');
        });

        fireEvent.click(screen.getAllByTestId('canvas-embed-kusto-toggle')[0]);

        await waitFor(() => {
            expect(screen.getAllByTestId('canvas-embed-kusto')[0].getAttribute('data-expanded')).toBe('true');
        });
        // Both are now open — the last by default, the first by the reader's click.
        expect(screen.getAllByTestId('kusto-query')).toHaveLength(2);
    });

    it('stays expanded for a lone Kusto embed with no surrounding group', async () => {
        mocks.get.mockResolvedValue(kustoCanvas('solo'));
        const html = chatMarkdownToHtml('canvas://solo', 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        const embed = await screen.findByTestId('canvas-embed-kusto');
        expect(embed.getAttribute('data-expanded')).toBe('true');
        expect(embed.querySelector('[data-testid="kusto-query"]')).toBeTruthy();
    });

    it('hoists the cluster/database editors into the embed header to save space', async () => {
        mocks.get.mockResolvedValue(kustoCanvas('solo'));
        const html = chatMarkdownToHtml('canvas://solo', 'ws-1', { canvasEmbedEnabled: true });
        render(<MarkdownView html={html} />);

        // The editors mount into the header slot (portaled by KustoView)...
        await waitFor(() => {
            const slot = screen.getByTestId('canvas-embed-kusto-connection-slot');
            expect(slot.querySelector('[data-testid="kusto-cluster"]')).toBeTruthy();
            expect(slot.querySelector('[data-testid="kusto-database"]')).toBeTruthy();
        });
        // ...while the query editor remains in the body.
        const embed = screen.getByTestId('canvas-embed-kusto');
        expect(embed.querySelector('[data-testid="kusto-query"]')).toBeTruthy();
    });
});
