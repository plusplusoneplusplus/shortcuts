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
import {
    CANVAS_HOST_VERSION,
    CANVAS_HOST_REQUEST_TIMEOUT_MS,
} from '../../../../../src/server/spa/client/react/features/canvas/canvas-host-protocol';

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

    it('advertises the protocol version and the request/response plumbing', () => {
        const doc = buildExtensionSrcDoc('<h1>hi</h1>');
        expect(doc).toContain(`version: ${CANVAS_HOST_VERSION}`);
        expect(doc).toContain(`var TIMEOUT_MS = ${CANVAS_HOST_REQUEST_TIMEOUT_MS}`);
        expect(doc).toContain("data.type === 'response'");
        expect(doc).toContain('new Promise');
    });
});

/**
 * Run the real BOOTSTRAP_SCRIPT body against a fake frame so the bridge itself
 * (correlation map, promise wrappers, timeout) is exercised — not a re-implementation
 * of it. jsdom cannot execute an `srcdoc` iframe, so the script is extracted from
 * `buildExtensionSrcDoc` and evaluated with `window`/`parent` bound to stand-ins.
 */
function loadBootstrap() {
    const doc = buildExtensionSrcDoc('');
    const body = doc.slice(doc.indexOf('<script>') + '<script>'.length, doc.lastIndexOf('</script>'));

    const listeners: Array<(event: { data: unknown }) => void> = [];
    const posted: any[] = [];
    const frameWindow = {
        addEventListener: (type: string, cb: (event: { data: unknown }) => void) => {
            if (type === 'message') listeners.push(cb);
        },
        CanvasHost: undefined as any,
    };
    const parentWindow = { postMessage: (message: unknown) => { posted.push(message); } };

    // eslint-disable-next-line no-new-func
    new Function('window', 'parent', 'setTimeout', 'clearTimeout', 'Promise', body)(
        frameWindow, parentWindow, setTimeout, clearTimeout, Promise,
    );

    return {
        host: frameWindow.CanvasHost as {
            version: number;
            onState: (cb: (state: unknown, meta: unknown) => void) => void;
            invoke: (name: string, params?: unknown) => Promise<unknown>;
            setState: (state: unknown) => Promise<unknown>;
        },
        posted,
        /** Deliver a host→frame message to the bootstrap's listener. */
        deliver: (data: unknown) => listeners.forEach(cb => cb({ data })),
    };
}

describe('CanvasHost bootstrap (in-frame side)', () => {
    it('exposes the version marker and announces itself as ready', () => {
        const { host, posted } = loadBootstrap();
        expect(host.version).toBe(CANVAS_HOST_VERSION);
        expect(posted).toContainEqual({ __canvasHost: true, type: 'ready' });
    });

    it('tags each request with a distinct id and resolves the matching reply with its result', async () => {
        const { host, posted, deliver } = loadBootstrap();

        const first = host.invoke('bump', { by: 1 });
        const second = host.setState({ n: 9 });

        const requests = posted.filter(m => m.type !== 'ready');
        expect(requests[0]).toMatchObject({ __canvasHost: true, type: 'invoke-capability', name: 'bump', params: { by: 1 } });
        expect(requests[1]).toMatchObject({ __canvasHost: true, type: 'set-state', state: { n: 9 } });
        expect(requests[0].id).toEqual(expect.any(Number));
        expect(requests[1].id).not.toBe(requests[0].id);

        // Reply out of order — each promise settles by id, not by arrival order.
        deliver({ __canvasHost: true, type: 'response', id: requests[1].id, ok: true, result: { revision: 4 } });
        deliver({ __canvasHost: true, type: 'response', id: requests[0].id, ok: true, result: { revision: 3 } });

        await expect(first).resolves.toEqual({ revision: 3 });
        await expect(second).resolves.toEqual({ revision: 4 });
    });

    it('rejects with the structured { code, message } the host sent', async () => {
        const { host, posted, deliver } = loadBootstrap();
        const promise = host.invoke('boom');
        const id = posted.filter(m => m.type !== 'ready')[0].id;

        deliver({ __canvasHost: true, type: 'response', id, ok: false, error: { code: 'capability-error', message: 'Unknown capability "boom"' } });

        await expect(promise).rejects.toMatchObject({ code: 'capability-error', message: 'Unknown capability "boom"' });
    });

    it('rejects with code "timeout" when the host never replies, instead of leaking a pending promise', async () => {
        vi.useFakeTimers();
        try {
            const { host } = loadBootstrap();
            const promise = host.invoke('slow');
            const settled = promise.then(() => 'resolved', (err: any) => err);

            await vi.advanceTimersByTimeAsync(CANVAS_HOST_REQUEST_TIMEOUT_MS - 1);
            // Still pending just before the bound.
            let raced: unknown = 'pending';
            await Promise.race([settled.then(v => { raced = v; }), Promise.resolve()]);
            expect(raced).toBe('pending');

            await vi.advanceTimersByTimeAsync(2);
            await expect(promise).rejects.toMatchObject({ code: 'timeout' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('ignores a reply for an unknown or already-settled id', async () => {
        const { host, posted, deliver } = loadBootstrap();
        const promise = host.invoke('bump');
        const id = posted.filter(m => m.type !== 'ready')[0].id;

        deliver({ __canvasHost: true, type: 'response', id, ok: true, result: 1 });
        // A duplicate/unknown reply must not throw or re-settle anything.
        expect(() => deliver({ __canvasHost: true, type: 'response', id, ok: false, error: { code: 'capability-error', message: 'late' } })).not.toThrow();
        expect(() => deliver({ __canvasHost: true, type: 'response', id: 9999, ok: true, result: 1 })).not.toThrow();

        await expect(promise).resolves.toBe(1);
    });

    it('still delivers canvas-state updates to onState', () => {
        const { host, deliver } = loadBootstrap();
        const seen: Array<[unknown, unknown]> = [];
        host.onState((state, meta) => { seen.push([state, meta]); });

        deliver({ __canvasHost: true, type: 'canvas-state', state: { cards: [1] }, revision: 5, title: 'Board' });

        expect(seen).toEqual([[{ cards: [1] }, { revision: 5, title: 'Board' }]]);
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

    it('replies to an invoke request with the new revision, correlated by id', async () => {
        const saved = makeCanvas({ revision: 3, content: '{"cards":[{"id":"c1"}]}' });
        mocks.invokeCapability.mockResolvedValue(saved);

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const postMessage = vi.fn();
        Object.defineProperty(iframe.contentWindow, 'postMessage', { value: postMessage, configurable: true });

        postFromIframe(iframe, { __canvasHost: true, id: 7, type: 'invoke-capability', name: 'add_card', params: { id: 'c1' } });

        await waitFor(() => expect(postMessage).toHaveBeenCalledWith({
            __canvasHost: true,
            type: 'response',
            id: 7,
            ok: true,
            result: { revision: 3, state: { cards: [{ id: 'c1' }] } },
        }, '*'));
    });

    it('replies with a structured error AND still shows the banner when a capability rejects', async () => {
        mocks.invokeCapability.mockRejectedValue(new Error('Unknown capability "x"'));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const postMessage = vi.fn();
        Object.defineProperty(iframe.contentWindow, 'postMessage', { value: postMessage, configurable: true });

        postFromIframe(iframe, { __canvasHost: true, id: 11, type: 'invoke-capability', name: 'x' });

        // The extension's promise rejects…
        await waitFor(() => expect(postMessage).toHaveBeenCalledWith({
            __canvasHost: true,
            type: 'response',
            id: 11,
            ok: false,
            error: { code: 'capability-error', message: 'Unknown capability "x"' },
        }, '*'));
        // …and a human still sees the failure in the banner.
        expect(screen.getByTestId('extension-canvas-action-error').textContent).toContain('Unknown capability');
    });

    it('replies to a set-state request, and reports a failed save as a revision conflict', async () => {
        mocks.save.mockResolvedValue(makeCanvas({ revision: 3 }));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const postMessage = vi.fn();
        Object.defineProperty(iframe.contentWindow, 'postMessage', { value: postMessage, configurable: true });

        postFromIframe(iframe, { __canvasHost: true, id: 21, type: 'set-state', state: { cards: [{ id: 'z' }] } });
        await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'response', id: 21, ok: true, result: { revision: 3, state: { cards: [{ id: 'z' }] } },
        }), '*'));

        mocks.save.mockRejectedValue(new Error('409'));
        postFromIframe(iframe, { __canvasHost: true, id: 22, type: 'set-state', state: { cards: [] } });
        await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'response', id: 22, ok: false, error: expect.objectContaining({ code: 'revision-conflict' }),
        }), '*'));
    });

    it('answers an unsupported request type instead of leaving the extension to time out', async () => {
        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const postMessage = vi.fn();
        Object.defineProperty(iframe.contentWindow, 'postMessage', { value: postMessage, configurable: true });

        postFromIframe(iframe, { __canvasHost: true, id: 31, type: 'read-file', path: 'a.txt' });

        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'response', id: 31, ok: false, error: expect.objectContaining({ code: 'capability-error' }),
        }), '*');
    });

    /**
     * Backwards compatibility: a pre-v2 sender omits `id`. The request must still
     * be serviced in full — only the reply is skipped. Dropping it would silently
     * break every extension written against v1.
     */
    it('services an id-less legacy request in full and posts no reply for it', async () => {
        const onCanvasSaved = vi.fn();
        mocks.invokeCapability.mockResolvedValue(makeCanvas({ revision: 3 }));
        mocks.save.mockResolvedValue(makeCanvas({ revision: 4 }));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={onCanvasSaved} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const postMessage = vi.fn();
        Object.defineProperty(iframe.contentWindow, 'postMessage', { value: postMessage, configurable: true });

        postFromIframe(iframe, { __canvasHost: true, type: 'invoke-capability', name: 'add_card', params: { id: 'c1' } });
        postFromIframe(iframe, { __canvasHost: true, type: 'set-state', state: { cards: [] } });

        await waitFor(() => expect(mocks.invokeCapability).toHaveBeenCalledWith('ws-1', 'board-abc123', 'add_card', { id: 'c1' }));
        await waitFor(() => expect(mocks.save).toHaveBeenCalled());
        await waitFor(() => expect(onCanvasSaved).toHaveBeenCalledTimes(2));

        expect(postMessage.mock.calls.some(([msg]) => msg?.type === 'response')).toBe(false);
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
