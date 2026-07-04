/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    useCocClient: vi.fn(),
    getExtension: vi.fn(),
    invokeCapability: vi.fn(),
    save: vi.fn(),
}));

// The view must route every workspace-scoped canvas call through the clone-aware
// client so remote workspaces reach their OWNING server. The remote-routing
// regression tests below override this to assert a remote workspace never
// resolves to the shared local client.
vi.mock('../../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: mocks.useCocClient,
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
        // Default: a single shared client backed by the method mocks above.
        mocks.useCocClient.mockReset().mockReturnValue({
            canvases: {
                getExtension: mocks.getExtension,
                invokeCapability: mocks.invokeCapability,
                save: mocks.save,
            },
        });
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

/**
 * Regression: canvas data (incl. the extension docs) lives ONLY on the coc
 * server that owns the workspace and is never synced to other servers. The view
 * previously fetched via the bare page-origin client (getSpaCocClient), so for a
 * REMOTE workspace the extension GET/invoke/save hit the local server — which
 * has no clone at that id — and returned 404 ("Canvas extension not found")
 * even though the frame rendered (the parent CanvasPanel loads content through
 * the clone-aware client). All three calls must route via useCocClient(wsId).
 */
describe('ExtensionCanvasView — remote-aware routing', () => {
    function makeClient() {
        return {
            canvases: {
                getExtension: vi.fn().mockResolvedValue(EXTENSION),
                invokeCapability: vi.fn().mockResolvedValue(makeCanvas({ revision: 3 })),
                save: vi.fn().mockResolvedValue(makeCanvas({ revision: 3 })),
            },
        };
    }

    beforeEach(() => {
        mocks.useCocClient.mockReset();
    });

    it('regression: loads the extension from the workspace-owning (remote) server, never the local client', async () => {
        const REMOTE_WS = 'ws-remote-xyz';
        const remoteClient = makeClient();
        const localClient = makeClient();
        mocks.useCocClient.mockImplementation((wsId: string) => (wsId === REMOTE_WS ? remoteClient : localClient));

        render(<ExtensionCanvasView workspaceId={REMOTE_WS} canvas={makeCanvas({ workspaceId: REMOTE_WS })} onCanvasSaved={vi.fn()} />);
        await screen.findByTestId('extension-canvas-iframe');

        // Client is resolved by workspace id, and the fetch hit the remote server.
        expect(mocks.useCocClient).toHaveBeenCalledWith(REMOTE_WS);
        expect(remoteClient.canvases.getExtension).toHaveBeenCalledWith(REMOTE_WS, 'board-abc123');
        // The default/local client is never used for a remote workspace — the bug.
        expect(localClient.canvases.getExtension).not.toHaveBeenCalled();
    });

    it('regression: capability + set-state actions also route to the remote server', async () => {
        const REMOTE_WS = 'ws-remote-xyz';
        const remoteClient = makeClient();
        const localClient = makeClient();
        mocks.useCocClient.mockImplementation((wsId: string) => (wsId === REMOTE_WS ? remoteClient : localClient));

        render(<ExtensionCanvasView workspaceId={REMOTE_WS} canvas={makeCanvas({ workspaceId: REMOTE_WS })} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;

        postFromIframe(iframe, { __canvasHost: true, type: 'invoke-capability', name: 'add_card', params: { id: 'c1' } });
        postFromIframe(iframe, { __canvasHost: true, type: 'set-state', state: { cards: [] } });

        await waitFor(() => expect(remoteClient.canvases.invokeCapability).toHaveBeenCalledWith(REMOTE_WS, 'board-abc123', 'add_card', { id: 'c1' }));
        await waitFor(() => expect(remoteClient.canvases.save).toHaveBeenCalled());
        expect(localClient.canvases.invokeCapability).not.toHaveBeenCalled();
        expect(localClient.canvases.save).not.toHaveBeenCalled();
    });

    it('a local workspace resolves to the default client', async () => {
        const LOCAL_WS = 'ws-local';
        const localClient = makeClient();
        mocks.useCocClient.mockReturnValue(localClient);

        render(<ExtensionCanvasView workspaceId={LOCAL_WS} canvas={makeCanvas({ workspaceId: LOCAL_WS })} onCanvasSaved={vi.fn()} />);
        await screen.findByTestId('extension-canvas-iframe');

        expect(mocks.useCocClient).toHaveBeenCalledWith(LOCAL_WS);
        expect(localClient.canvases.getExtension).toHaveBeenCalledWith(LOCAL_WS, 'board-abc123');
    });
});
