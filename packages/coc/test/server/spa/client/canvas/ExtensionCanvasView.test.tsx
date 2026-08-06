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
import { EXTENSION_ROOT_ID } from '../../../../../src/server/spa/client/react/features/canvas/extension-runtime';

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
        const doc = buildExtensionSrcDoc({ uiHtml: '<h1>hi</h1>' });
        expect(doc).toContain('window.CanvasHost');
        expect(doc).toContain('onState');
        expect(doc).toContain('invoke-capability');
        expect(doc).toContain('<h1>hi</h1>');
        // Bootstrap comes first so CanvasHost exists before the extension runs
        expect(doc.indexOf('CanvasHost')).toBeLessThan(doc.indexOf('<h1>hi</h1>'));
    });

    it('advertises the protocol version and the request/response plumbing', () => {
        const doc = buildExtensionSrcDoc({ uiHtml: '<h1>hi</h1>' });
        expect(doc).toContain(`version: ${CANVAS_HOST_VERSION}`);
        expect(doc).toContain(`var TIMEOUT_MS = ${CANVAS_HOST_REQUEST_TIMEOUT_MS}`);
        expect(doc).toContain("data.type === 'response'");
        expect(doc).toContain('new Promise');
    });
});

describe('buildExtensionSrcDoc — JSX extensions', () => {
    const UI_JS = 'window.CanvasExtension = { mount: function () {} };';

    it('emits a root element and a runtime script instead of raw HTML', () => {
        const doc = buildExtensionSrcDoc({ uiJs: UI_JS, libraries: ['react'] }, 'http://coc.test:4000');
        expect(doc).toContain('window.CanvasHost');
        expect(doc).toContain(`id="${EXTENSION_ROOT_ID}"`);
        expect(doc).toContain('CanvasExtension');
        // Bootstrap first: CanvasHost must exist before mount() is handed it.
        expect(doc.indexOf('window.CanvasHost')).toBeLessThan(doc.indexOf(EXTENSION_ROOT_ID));
    });

    it('uses ABSOLUTE vendored asset URLs so the srcdoc frame resolves nothing', () => {
        const doc = buildExtensionSrcDoc({ uiJs: UI_JS, libraries: ['tailwind', 'react', 'recharts'] }, 'http://coc.test:4000');
        expect(doc).toContain('http://coc.test:4000/canvas-vendor/react.js');
        expect(doc).toContain('http://coc.test:4000/canvas-vendor/recharts.js');
        expect(doc).toContain('http://coc.test:4000/canvas-vendor/tailwind.css');
    });

    it('drops library names outside the allowlist rather than emitting a bogus URL', () => {
        const doc = buildExtensionSrcDoc({ uiJs: UI_JS, libraries: ['react', 'd3'] }, 'http://coc.test:4000');
        expect(doc).toContain('/canvas-vendor/react.js');
        expect(doc).not.toContain('d3');
    });

    it('cannot be broken out of by a </script> inside the compiled UI', () => {
        const doc = buildExtensionSrcDoc(
            { uiJs: 'window.CanvasExtension = { mount() { document.title = "</script><img>"; } };', libraries: [] },
            'http://coc.test:4000',
        );
        expect(doc).not.toContain('</script><img>');
        expect(doc).toContain('\\u003c/script');
    });

    it('prefers uiJs over uiHtml when a canvas somehow carries both', () => {
        const doc = buildExtensionSrcDoc({ uiHtml: '<h1>legacy</h1>', uiJs: UI_JS }, 'http://coc.test:4000');
        expect(doc).not.toContain('<h1>legacy</h1>');
        expect(doc).toContain(EXTENSION_ROOT_ID);
    });

    it('leaves a legacy uiHtml canvas byte for byte as before', () => {
        const doc = buildExtensionSrcDoc({ uiHtml: '<h1>legacy</h1>' }, 'http://coc.test:4000');
        expect(doc).not.toContain('canvas-vendor');
        expect(doc).not.toContain(EXTENSION_ROOT_ID);
        expect(doc.endsWith('<h1>legacy</h1>')).toBe(true);
    });
});

/**
 * Execute a generated runtime script against a fake DOM so the loader itself is
 * exercised — the ordering, the global check, and the failure paths — rather
 * than a re-implementation of it. jsdom will not run an `srcdoc` iframe, so the
 * `<script>` body is extracted and evaluated with stand-ins bound in.
 */
function runRuntimeScript(
    srcDoc: string,
    options: { failingUrls?: string[]; skipGlobals?: string[] } = {},
) {
    const failingUrls = new Set(options.failingUrls ?? []);
    const skipGlobals = new Set(options.skipGlobals ?? []);
    // The runtime script is the LAST <script> in the document (the bootstrap is first).
    const start = srcDoc.lastIndexOf('<script>') + '<script>'.length;
    const body = srcDoc.slice(start, srcDoc.lastIndexOf('</script>'));

    const loadOrder: string[] = [];
    const errorBanners: string[] = [];
    const posted: any[] = [];
    const mountCalls: any[] = [];
    const pending: Array<() => void> = [];

    const frameWindow: any = {
        addEventListener: () => { /* the error trap is not needed by these cases */ },
        CanvasHost: { version: CANVAS_HOST_VERSION },
        CanvasExtension: undefined,
    };
    const rootEl = { id: EXTENSION_ROOT_ID };

    const fakeDocument: any = {
        createElement: (tag: string) => ({ tagName: tag, style: {}, setAttribute: () => {} }),
        getElementById: (id: string) => (id === EXTENSION_ROOT_ID ? rootEl : null),
        head: {
            appendChild: (el: any) => {
                const url = el.src ?? el.href;
                // Subresource loads are async — queue them so ordering is real.
                pending.push(() => {
                    if (failingUrls.has(url)) {
                        el.onerror?.();
                        return;
                    }
                    loadOrder.push(url);
                    const globalName = { 'react.js': 'React', 'recharts.js': 'Recharts', 'papaparse.js': 'Papa' }[
                        url.split('/').pop() as string
                    ];
                    if (globalName && !skipGlobals.has(globalName)) frameWindow[globalName] = {};
                    el.onload?.();
                });
            },
        },
        body: {
            appendChild: (el: any) => {
                if (el.tagName === 'script' && typeof el.textContent === 'string') {
                    // The compiled UI, executed with the frame's window bound in.
                    // eslint-disable-next-line no-new-func
                    new Function('window', 'document', el.textContent)(frameWindow, fakeDocument);
                    return;
                }
                if (typeof el.textContent === 'string') errorBanners.push(el.textContent);
            },
        },
    };
    const parentWindow = { postMessage: (m: unknown) => { posted.push(m); } };

    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'parent', 'Promise', body)(
        frameWindow, fakeDocument, parentWindow, Promise,
    );

    /** Drain queued subresource loads and let the promise chain settle. */
    const settle = async () => {
        for (let i = 0; i < 20; i++) {
            const next = pending.shift();
            if (next) next();
            await Promise.resolve();
            await Promise.resolve();
        }
        // mount() records here once the chain reaches it.
        if (frameWindow.CanvasExtension?.mounted) mountCalls.push(...frameWindow.CanvasExtension.mounted);
    };

    return { loadOrder, errorBanners, posted, mountCalls, settle, frameWindow, rootEl };
}

describe('extension runtime loader (in-frame side)', () => {
    /** A compiled UI that records what mount() was handed. */
    const RECORDING_UI_JS = [
        'window.CanvasExtension = {',
        '  mounted: [],',
        '  mount: function (rootEl, host) {',
        '    window.CanvasExtension.mounted.push({ rootId: rootEl && rootEl.id, hostVersion: host && host.version, React: typeof window.React, Recharts: typeof window.Recharts });',
        '  },',
        '};',
    ].join('\n');

    it('loads libraries in declared order and only then calls mount()', async () => {
        const doc = buildExtensionSrcDoc(
            { uiJs: RECORDING_UI_JS, libraries: ['tailwind', 'react', 'recharts'] },
            'http://coc.test:4000',
        );
        const run = runRuntimeScript(doc);
        await run.settle();

        expect(run.loadOrder).toEqual([
            'http://coc.test:4000/canvas-vendor/tailwind.css',
            'http://coc.test:4000/canvas-vendor/react.js',
            'http://coc.test:4000/canvas-vendor/recharts.js',
        ]);
        // mount() saw the root element, the host bridge, and both globals.
        expect(run.mountCalls).toEqual([
            { rootId: EXTENSION_ROOT_ID, hostVersion: CANVAS_HOST_VERSION, React: 'object', Recharts: 'object' },
        ]);
        expect(run.errorBanners).toEqual([]);
    });

    it('surfaces an error banner — not a blank frame — when a library fails to load', async () => {
        const doc = buildExtensionSrcDoc(
            { uiJs: RECORDING_UI_JS, libraries: ['react', 'recharts'] },
            'http://coc.test:4000',
        );
        const run = runRuntimeScript(doc, { failingUrls: ['http://coc.test:4000/canvas-vendor/recharts.js'] });
        await run.settle();

        expect(run.errorBanners).toHaveLength(1);
        expect(run.errorBanners[0]).toContain('Canvas libraries failed to load');
        expect(run.errorBanners[0]).toContain('recharts.js');
        expect(run.mountCalls).toEqual([]);
        // The panel outside the sandbox hears about it too.
        expect(run.posted).toContainEqual(
            expect.objectContaining({ __canvasHost: true, type: 'extension-error' }),
        );
    });

    it('rejects a bundle that responds 200 but defines no global (the SPA HTML fallback)', async () => {
        const doc = buildExtensionSrcDoc({ uiJs: RECORDING_UI_JS, libraries: ['react'] }, 'http://coc.test:4000');
        const run = runRuntimeScript(doc, { skipGlobals: ['React'] });
        await run.settle();

        expect(run.errorBanners[0]).toContain('did not define window.React');
        expect(run.mountCalls).toEqual([]);
    });

    it('reports a UI that never assigns window.CanvasExtension', async () => {
        const doc = buildExtensionSrcDoc({ uiJs: 'var unused = 1;', libraries: ['react'] }, 'http://coc.test:4000');
        const run = runRuntimeScript(doc);
        await run.settle();

        expect(run.errorBanners[0]).toContain('did not assign window.CanvasExtension');
    });

    it('reports a mount() that throws', async () => {
        const doc = buildExtensionSrcDoc(
            { uiJs: 'window.CanvasExtension = { mount: function () { throw new Error("boom"); } };', libraries: [] },
            'http://coc.test:4000',
        );
        const run = runRuntimeScript(doc);
        await run.settle();

        expect(run.errorBanners[0]).toContain('Extension mount() failed: boom');
    });
});

/**
 * Run the real BOOTSTRAP_SCRIPT body against a fake frame so the bridge itself
 * (correlation map, promise wrappers, timeout) is exercised — not a re-implementation
 * of it. jsdom cannot execute an `srcdoc` iframe, so the script is extracted from
 * `buildExtensionSrcDoc` and evaluated with `window`/`parent` bound to stand-ins.
 */
function loadBootstrap() {
    const doc = buildExtensionSrcDoc({ uiHtml: '' });
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

    it('renders a JSX extension through the runtime loader with the PAGE origin as asset base', async () => {
        mocks.getExtension.mockResolvedValue({
            manifest: { ...EXTENSION.manifest, libraries: ['react', 'recharts'] },
            uiHtml: '',
            capabilitiesJs: EXTENSION.capabilitiesJs,
            uiJs: 'window.CanvasExtension = { mount: function () {} };',
        });

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const srcDoc = iframe.getAttribute('srcdoc') ?? '';

        expect(srcDoc).toContain(`id="${EXTENSION_ROOT_ID}"`);
        // Vendored assets come from the page origin, absolute — the one
        // deliberate exception to clone-aware routing.
        expect(srcDoc).toContain(`${window.location.origin}/canvas-vendor/react.js`);
        expect(srcDoc).toContain(`${window.location.origin}/canvas-vendor/recharts.js`);
    });

    it('shows the frame-reported extension error in the action banner', async () => {
        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;

        postFromIframe(iframe, {
            __canvasHost: true,
            type: 'extension-error',
            message: 'Canvas libraries failed to load — Could not load /canvas-vendor/recharts.js',
        });

        expect((await screen.findByTestId('extension-canvas-action-error')).textContent)
            .toContain('Canvas libraries failed to load');
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

    // An async capability has a 30 s budget, so "nothing visible happened" is a
    // realistic half-minute without this indicator.
    it('shows a pending indicator while a long capability runs, and clears it on success', async () => {
        let settle: (canvas: unknown) => void = () => {};
        mocks.invokeCapability.mockReturnValue(new Promise(resolve => { settle = resolve; }));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        expect(screen.queryByTestId('extension-canvas-pending')).toBeNull();

        postFromIframe(iframe, { __canvasHost: true, id: 1, type: 'invoke-capability', name: 'slow' });
        await waitFor(() => expect(screen.getByTestId('extension-canvas-pending')).toBeTruthy());

        await act(async () => {
            settle(makeCanvas({ revision: 3 }));
        });
        await waitFor(() => expect(screen.queryByTestId('extension-canvas-pending')).toBeNull());
    });

    it('clears the pending indicator when a capability fails, leaving the error banner', async () => {
        let fail: (err: Error) => void = () => {};
        mocks.invokeCapability.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const postMessage = vi.fn();
        Object.defineProperty(iframe.contentWindow, 'postMessage', { value: postMessage, configurable: true });

        postFromIframe(iframe, { __canvasHost: true, id: 5, type: 'invoke-capability', name: 'slow' });
        await waitFor(() => expect(screen.getByTestId('extension-canvas-pending')).toBeTruthy());

        await act(async () => {
            fail(new Error('exceeded the 30000ms async budget and was terminated'));
        });

        // Pending clears, the banner shows the failure…
        await waitFor(() => expect(screen.queryByTestId('extension-canvas-pending')).toBeNull());
        expect(screen.getByTestId('extension-canvas-action-error').textContent).toContain('async budget');
        // …and the extension's own promise rejects with the structured shape.
        expect(postMessage).toHaveBeenCalledWith({
            __canvasHost: true,
            type: 'response',
            id: 5,
            ok: false,
            error: { code: 'capability-error', message: 'exceeded the 30000ms async budget and was terminated' },
        }, '*');
    });

    it('keeps the pending indicator up until the LAST of several invokes settles', async () => {
        const settlers: Array<(canvas: unknown) => void> = [];
        mocks.invokeCapability.mockImplementation(() => new Promise(resolve => { settlers.push(resolve); }));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;

        postFromIframe(iframe, { __canvasHost: true, id: 1, type: 'invoke-capability', name: 'a' });
        postFromIframe(iframe, { __canvasHost: true, id: 2, type: 'invoke-capability', name: 'b' });
        await waitFor(() => expect(settlers).toHaveLength(2));

        await act(async () => { settlers[0](makeCanvas({ revision: 3 })); });
        expect(screen.getByTestId('extension-canvas-pending')).toBeTruthy();

        await act(async () => { settlers[1](makeCanvas({ revision: 4 })); });
        await waitFor(() => expect(screen.queryByTestId('extension-canvas-pending')).toBeNull());
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

        postFromIframe(iframe, { __canvasHost: true, id: 31, type: 'no-such-request', path: 'a.txt' });

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

/**
 * CanvasHost.readFile / listFiles — the read-only file bridge.
 *
 * Two things must hold: the frame gets a real promise back (so an artifact can
 * `await CanvasHost.readFile('data.csv')` and parse it), and the REST call goes
 * through the clone-aware client, so a remote-clone workspace reads from the
 * server that actually owns the canvas rather than the page origin.
 */
describe('ExtensionCanvasView — canvas files', () => {
    const listFiles = vi.fn();
    const readFile = vi.fn();

    beforeEach(() => {
        mocks.getExtension.mockReset().mockResolvedValue(EXTENSION);
        listFiles.mockReset();
        readFile.mockReset();
        mocks.useCocClient.mockReset().mockReturnValue({
            canvases: {
                getExtension: mocks.getExtension,
                invokeCapability: mocks.invokeCapability,
                save: mocks.save,
                listFiles,
                readFile,
            },
        });
    });

    /** Collect the host→frame replies posted at the iframe. */
    function captureReplies(iframe: HTMLIFrameElement): unknown[] {
        const replies: unknown[] = [];
        Object.defineProperty(iframe, 'contentWindow', {
            configurable: true,
            value: { postMessage: (message: unknown) => { replies.push(message); } },
        });
        return replies;
    }

    it('exposes listFiles and readFile on the bootstrap bridge', () => {
        const doc = buildExtensionSrcDoc({ uiHtml: '' });
        expect(doc).toContain("type: 'list-files'");
        expect(doc).toContain("type: 'read-file'");
    });

    it('answers read-file through the workspace client and replies with the file', async () => {
        const file = { path: 'data.csv', size: 4, encoding: 'utf-8', content: 'a,b\n' };
        readFile.mockResolvedValue(file);

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const replies = captureReplies(iframe);

        postFromIframe(iframe, { __canvasHost: true, id: 7, type: 'read-file', path: 'data.csv', options: {} });

        await waitFor(() => expect(readFile).toHaveBeenCalledWith('ws-1', 'board-abc123', 'data.csv', undefined));
        await waitFor(() => expect(replies).toContainEqual({
            __canvasHost: true, type: 'response', id: 7, ok: true, result: file,
        }));
    });

    it('forwards a base64 encoding option', async () => {
        readFile.mockResolvedValue({ path: 'logo.png', size: 2, encoding: 'base64', content: 'AAE=' });

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        captureReplies(iframe);

        postFromIframe(iframe, { __canvasHost: true, id: 1, type: 'read-file', path: 'logo.png', options: { encoding: 'base64' } });

        await waitFor(() => expect(readFile).toHaveBeenCalledWith('ws-1', 'board-abc123', 'logo.png', { encoding: 'base64' }));
    });

    it('answers list-files with the entries', async () => {
        const files = [{ path: 'data.csv', size: 4, encoding: 'utf-8' }];
        listFiles.mockResolvedValue(files);

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const replies = captureReplies(iframe);

        postFromIframe(iframe, { __canvasHost: true, id: 3, type: 'list-files' });

        await waitFor(() => expect(listFiles).toHaveBeenCalledWith('ws-1', 'board-abc123'));
        await waitFor(() => expect(replies).toContainEqual({
            __canvasHost: true, type: 'response', id: 3, ok: true, result: { files },
        }));
    });

    it('rejects with code "file-error" and does NOT raise a panel banner', async () => {
        readFile.mockRejectedValue(new Error('Canvas file not found'));

        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const replies = captureReplies(iframe);

        postFromIframe(iframe, { __canvasHost: true, id: 2, type: 'read-file', path: 'missing.csv' });

        await waitFor(() => expect(replies).toContainEqual({
            __canvasHost: true,
            type: 'response',
            id: 2,
            ok: false,
            error: { code: 'file-error', message: 'Canvas file not found' },
        }));
        // A missing data file is the artifact's business, not a panel error.
        expect(screen.queryByTestId('extension-canvas-action-error')).toBeNull();
    });

    it('rejects a read-file with no path instead of calling the client', async () => {
        render(<ExtensionCanvasView workspaceId="ws-1" canvas={makeCanvas()} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        const replies = captureReplies(iframe);

        postFromIframe(iframe, { __canvasHost: true, id: 4, type: 'read-file' });

        await waitFor(() => expect(replies).toContainEqual({
            __canvasHost: true, type: 'response', id: 4, ok: false,
            error: { code: 'file-error', message: 'readFile needs a path' },
        }));
        expect(readFile).not.toHaveBeenCalled();
    });

    it('regression: a remote-clone workspace reads from the clone, never the page-origin client', async () => {
        const REMOTE_WS = 'ws-remote-xyz';
        const makeClient = () => ({
            canvases: {
                getExtension: vi.fn().mockResolvedValue(EXTENSION),
                invokeCapability: vi.fn(),
                save: vi.fn(),
                listFiles: vi.fn().mockResolvedValue([]),
                readFile: vi.fn().mockResolvedValue({ path: 'data.csv', size: 1, encoding: 'utf-8', content: 'x' }),
            },
        });
        const remoteClient = makeClient();
        const localClient = makeClient();
        mocks.useCocClient.mockReset().mockImplementation(
            (wsId: string) => (wsId === REMOTE_WS ? remoteClient : localClient),
        );

        render(<ExtensionCanvasView workspaceId={REMOTE_WS} canvas={makeCanvas({ workspaceId: REMOTE_WS })} onCanvasSaved={vi.fn()} />);
        const iframe = await screen.findByTestId('extension-canvas-iframe') as HTMLIFrameElement;
        captureReplies(iframe);

        postFromIframe(iframe, { __canvasHost: true, id: 1, type: 'read-file', path: 'data.csv' });
        postFromIframe(iframe, { __canvasHost: true, id: 2, type: 'list-files' });

        await waitFor(() => expect(remoteClient.canvases.readFile)
            .toHaveBeenCalledWith(REMOTE_WS, 'board-abc123', 'data.csv', undefined));
        await waitFor(() => expect(remoteClient.canvases.listFiles).toHaveBeenCalledWith(REMOTE_WS, 'board-abc123'));
        expect(localClient.canvases.readFile).not.toHaveBeenCalled();
        expect(localClient.canvases.listFiles).not.toHaveBeenCalled();
    });
});

describe('CanvasHost bootstrap — file methods', () => {
    it('readFile and listFiles return promises that settle from the host reply', async () => {
        const { host, posted, deliver } = loadBootstrap() as any;

        const read = host.readFile('data.csv', { encoding: 'base64' });
        const request = posted.find((m: any) => m.type === 'read-file');
        expect(request).toMatchObject({
            __canvasHost: true, type: 'read-file', path: 'data.csv', options: { encoding: 'base64' },
        });

        const file = { path: 'data.csv', size: 4, encoding: 'base64', content: 'YSxiCg==' };
        deliver({ __canvasHost: true, type: 'response', id: request.id, ok: true, result: file });
        await expect(read).resolves.toEqual(file);
    });

    it('a rejected file request surfaces its code to the extension', async () => {
        const { host, posted, deliver } = loadBootstrap() as any;

        const listed = host.listFiles();
        const request = posted.find((m: any) => m.type === 'list-files');
        deliver({
            __canvasHost: true, type: 'response', id: request.id, ok: false,
            error: { code: 'file-error', message: 'Canvas file not found' },
        });

        await expect(listed).rejects.toMatchObject({ code: 'file-error', message: 'Canvas file not found' });
    });
});
