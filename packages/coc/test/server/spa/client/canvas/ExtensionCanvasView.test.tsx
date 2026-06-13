/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    getExtension: vi.fn(),
    invokeCapability: vi.fn(),
    save: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        canvases: {
            getExtension: mocks.getExtension,
            invokeCapability: mocks.invokeCapability,
            save: mocks.save,
        },
    }),
}));

import { ExtensionCanvasView, buildExtensionSrcDoc } from '../../../../../src/server/spa/client/react/features/canvas/ExtensionCanvasView';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'board-abc123',
        workspaceId: 'ws-1',
        title: 'Kanban',
        type: 'extension' as const,
        revision: 2,
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
        processId: 'proc-1',
        lastEditor: 'ai' as const,
        content: '{"cards":[]}',
        ...overrides,
    };
}

const EXTENSION = {
    manifest: { description: 'Kanban', capabilities: [{ name: 'add_card', description: 'Add a card' }] },
    uiHtml: '<div id="board"></div>',
    capabilitiesJs: 'capabilities = { add_card: function (s) { return s; } };',
};

/** Dispatch a message as if it came from the iframe's content window. */
function postFromIframe(iframe: HTMLIFrameElement, data: unknown) {
    const event = new MessageEvent('message', { data });
    Object.defineProperty(event, 'source', { value: iframe.contentWindow, enumerable: true });
    act(() => { window.dispatchEvent(event); });
}

describe('buildExtensionSrcDoc', () => {
    it('prepends the CanvasHost bootstrap to the extension HTML', () => {
        const doc = buildExtensionSrcDoc('<h1>hi</h1>');
        expect(doc).toContain('window.CanvasHost');
        expect(doc).toContain('onState');
        expect(doc).toContain('invoke-capability');
        expect(doc).toContain('<h1>hi</h1>');
        // Bootstrap comes first so CanvasHost exists before the extension runs
        expect(doc.indexOf('CanvasHost')).toBeLessThan(doc.indexOf('<h1>hi</h1>'));
    });
});

describe('ExtensionCanvasView', () => {
    beforeEach(() => {
        mocks.getExtension.mockReset().mockResolvedValue(EXTENSION);
        mocks.invokeCapability.mockReset();
        mocks.save.mockReset();
    });

    it('loads the extension and renders a sandboxed iframe', async () => {
        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);

        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
        expect(iframe.getAttribute('srcdoc')).toContain('window.CanvasHost');
        expect(mocks.getExtension).toHaveBeenCalledWith('ws-1', 'board-abc123');
    });

    it('posts current state to the iframe when it signals ready', async () => {
        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;

        const postMessage = vi.fn();
        Object.defineProperty(iframe.contentWindow, 'postMessage', { value: postMessage, configurable: true });

        postFromIframe(iframe, { __canvasHost: true, type: 'ready' });

        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ __canvasHost: true, type: 'canvas-state', revision: 2, state: { cards: [] } }),
            '*',
        );
    });

    it('routes a capability invocation through the canvases client and reports the new canvas', async () => {
        const onCanvasSaved = vi.fn();
        const saved = makeCanvas({ revision: 3, content: '{"cards":[{"id":"c1"}]}' });
        mocks.invokeCapability.mockResolvedValue(saved);

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={onCanvasSaved} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;

        postFromIframe(iframe, { __canvasHost: true, type: 'invoke-capability', name: 'add_card', params: { id: 'c1' } });

        await waitFor(() => expect(mocks.invokeCapability).toHaveBeenCalledWith('ws-1', 'board-abc123', 'add_card', { id: 'c1' }));
        await waitFor(() => expect(onCanvasSaved).toHaveBeenCalledWith(saved));
    });

    it('surfaces a capability error in the action banner', async () => {
        mocks.invokeCapability.mockRejectedValue(new Error('Unknown capability "x"'));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;

        postFromIframe(iframe, { __canvasHost: true, type: 'invoke-capability', name: 'x' });

        await waitFor(() => {
            expect(screen.getByTestId('extension-canvas-action-error').textContent).toContain('Unknown capability');
        });
    });

    it('routes a set-state escape hatch through the revision-checked save', async () => {
        const onCanvasSaved = vi.fn();
        mocks.save.mockResolvedValue(makeCanvas({ revision: 3 }));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={onCanvasSaved} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;

        postFromIframe(iframe, { __canvasHost: true, type: 'set-state', state: { cards: [{ id: 'z' }] } });

        await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('ws-1', 'board-abc123', {
            content: JSON.stringify({ cards: [{ id: 'z' }] }, null, 2),
            expectedRevision: 2,
        }));
        await waitFor(() => expect(onCanvasSaved).toHaveBeenCalled());
    });

    it('ignores messages that are not from its own iframe', async () => {
        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        await screen.findByTestId('extension-canvas-iframe');

        // No source set → not from the iframe → ignored
        act(() => {
            window.dispatchEvent(new MessageEvent('message', { data: { __canvasHost: true, type: 'invoke-capability', name: 'add_card' } }));
        });

        expect(mocks.invokeCapability).not.toHaveBeenCalled();
    });
});
