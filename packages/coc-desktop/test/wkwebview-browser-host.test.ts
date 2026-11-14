import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserDownloadStore } from '../src/browser-downloads';
import { WKWEBVIEW_FAVICON_LINKS, WKWEBVIEW_LOAD_SETTLE_MS, WkWebViewBrowserHost, wkWebViewCertificate, wkWebViewParentWindow } from '../src/wkwebview-browser-host';
import { BrowserHostError, type BrowserEventSink, type BrowserHostedView } from '../src/browser-host-contract';
import { captureWebView2Annotation } from '../src/webview2-annotation-capture';

const mocks = vi.hoisted(() => {
    const listeners = new Map<string, Set<() => void>>();
    const window = {
        destroyed: false,
        fullscreen: false,
        visible: true,
        minimized: false,
        mediaSourceId: 'window:4242:0',
        isDestroyed: () => mocks.window.destroyed,
        isFullScreen: () => mocks.window.fullscreen,
        isVisible: () => mocks.window.visible,
        isMinimized: () => mocks.window.minimized,
        getMediaSourceId: () => mocks.window.mediaSourceId,
        getContentBounds: () => ({ x: 100, y: 200, width: 640, height: 480 }),
        show: vi.fn(),
        focus: vi.fn(),
        on: vi.fn((event: string, listener: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); }),
        removeListener: vi.fn((event: string, listener: () => void) => { listeners.get(event)?.delete(listener); }),
        emit: (event: string) => { for (const listener of [...listeners.get(event) ?? []]) listener(); },
        listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    };
    return {
        request: vi.fn().mockResolvedValue(undefined),
        running: true,
        rejectView: vi.fn(),
        dispose: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn<(message: Record<string, unknown>) => void>(),
        onFailure: vi.fn<(error: BrowserHostError) => void>(),
        profile: '',
        window,
        owner: { focus: vi.fn() },
        fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
        partitions: [] as string[],
    };
});

vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => Object.assign(mocks.window, { webContents: mocks.owner }) },
    webContents: { fromId: () => mocks.owner },
    session: { fromPartition: (partition: string) => { mocks.partitions.push(partition); return { fetch: mocks.fetch }; } },
}));

vi.mock('../src/webview2-annotation-capture', () => ({
    captureWebView2Annotation: vi.fn(async (capture: () => Promise<unknown>) => {
        await capture();
        return { dataUrl: 'data:image/png;base64,', width: 30, height: 40 };
    }),
}));

vi.mock('../src/wkwebview-process', () => ({
    WkWebViewProcess: class {
        constructor(_binary: () => string, profile: string, onEvent: (message: Record<string, unknown>) => void, onFailure: (error: BrowserHostError) => void) {
            mocks.profile = profile;
            mocks.onEvent.mockImplementation(onEvent);
            mocks.onFailure.mockImplementation(onFailure);
        }
        get running() { return mocks.running; }
        request = mocks.request;
        rejectView = mocks.rejectView;
        dispose = mocks.dispose;
    },
}));

const bounds = { x: 10, y: 20, width: 300, height: 200 };
const placed = { x: 110, y: 220, width: 300, height: 200 };
const state = { url: 'https://tab.test/', title: 'Tab', canGoBack: false, canGoForward: false, loading: false };

function makeSink(extra: Partial<BrowserEventSink> = {}): BrowserEventSink {
    return {
        state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(), openMenuRequested: vi.fn(),
        focusAddressRequested: vi.fn(), reopenClosedRequested: vi.fn(), tabShortcut: vi.fn(), visited: vi.fn(), titleUpdated: vi.fn(),
        documentCommitted: vi.fn(), documentTitleUpdated: vi.fn(), navigationStarted: vi.fn(), controlFocused: vi.fn(), ...extra,
    };
}

async function open(sink = makeSink(), request: { pageZoomPercent?: number } = {}) {
    const host = new WkWebViewBrowserHost('/data/browser/wkwebview');
    const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url, ...request }, sink);
    return { host, view, sink };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockReset().mockResolvedValue(undefined);
    mocks.running = true;
    Object.assign(mocks.window, { destroyed: false, fullscreen: false, visible: true, minimized: false, mediaSourceId: 'window:4242:0' });
});

describe('WKWebView engine availability', () => {
    it('reports macOS-only availability without spawning the helper elsewhere', async () => {
        if (process.platform === 'darwin') return;
        const availability = await new WkWebViewBrowserHost('profile').availability();
        expect(availability).toMatchObject({ engine: 'wkwebview', available: false, reason: 'unsupported-platform' });
    });

    it.runIf(process.platform === 'darwin')('runs the helper check once and maps an old macOS to unsupported-platform', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wkwebview-check-'));
        const counter = path.join(dir, 'count');
        const helper = path.join(dir, 'helper.sh');
        fs.writeFileSync(helper, `#!/bin/sh\necho x >> '${counter}'\necho '{"available":false,"reason":"unsupported-platform"}'\n`, { mode: 0o755 });
        const previous = process.env.COC_WKWEBVIEW_PATH;
        process.env.COC_WKWEBVIEW_PATH = helper;
        try {
            const host = new WkWebViewBrowserHost('profile');
            const [first, second] = await Promise.all([host.availability(), host.availability()]);
            expect(first).toEqual({ engine: 'wkwebview', available: false, reason: 'unsupported-platform', message: 'WebKit (WKWebView) requires macOS 14 or later. Use Electron.' });
            expect(await host.availability()).toBe(first);
            expect(second).toBe(first);
            expect(fs.readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(1);
        } finally {
            if (previous === undefined) delete process.env.COC_WKWEBVIEW_PATH; else process.env.COC_WKWEBVIEW_PATH = previous;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('reads the AppKit window number from the macOS media source id', () => {
        expect(wkWebViewParentWindow({ getMediaSourceId: () => 'window:4242:0' })).toBe(4242);
        for (const id of ['screen:1:0', 'window:0:0', 'window::0', ''])
            expect(() => wkWebViewParentWindow({ getMediaSourceId: () => id })).toThrow(BrowserHostError);
    });
});

describe('WKWebView overlay placement', () => {
    it('opens unplaced with the owner window number, visibility and page zoom on the engine profile', async () => {
        const { host } = await open(undefined, { pageZoomPercent: 125 });
        expect(mocks.profile).toBe('/data/browser/wkwebview');
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith('open', {
            viewId: '7:tab:1', url: state.url, parentWindow: 4242, visible: true, pageZoomPercent: 125,
        });
        await host.dispose();
    });

    it('rejects a closed owner window before starting the helper', async () => {
        mocks.window.destroyed = true;
        const host = new WkWebViewBrowserHost('profile');
        await expect(host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, makeSink()))
            .rejects.toMatchObject({ reason: 'no-window' });
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('rolls back registration when the helper refuses to open', async () => {
        mocks.request.mockRejectedValueOnce(new BrowserHostError('profile-locked', 'locked'));
        const host = new WkWebViewBrowserHost('profile');
        await expect(host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, makeSink()))
            .rejects.toMatchObject({ reason: 'profile-locked' });
        expect(mocks.window.listenerCount()).toBe(0);
    });

    it('pushes screen bounds in owner content coordinates, unplaces on hide and fills the window in fullscreen', async () => {
        const { host, view } = await open();
        await view.setBounds(bounds);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', { viewId: '7:tab:1', bounds: placed });
        await view.setBounds(null);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', { viewId: '7:tab:1' });
        await view.setBounds(bounds);
        mocks.window.fullscreen = true;
        mocks.window.emit('enter-full-screen');
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', { viewId: '7:tab:1', bounds: { x: 100, y: 200, width: 640, height: 480 } });
        await host.dispose();
    });

    it('tracks owner move and resize only while placed, and stops after close', async () => {
        const { view } = await open();
        mocks.request.mockClear();
        mocks.window.emit('move');
        expect(mocks.request).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.request.mockClear();
        mocks.window.emit('move');
        mocks.window.emit('resize');
        expect(mocks.request.mock.calls).toEqual([
            ['bounds', { viewId: '7:tab:1', bounds: placed }],
            ['bounds', { viewId: '7:tab:1', bounds: placed }],
        ]);
        await view.close();
        expect(mocks.request).toHaveBeenLastCalledWith('close', { viewId: '7:tab:1' });
        expect(mocks.window.listenerCount()).toBe(0);
        mocks.request.mockClear();
        mocks.window.emit('move');
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('hides the panel while the owner is minimized or hidden and shows it again on restore', async () => {
        const { host } = await open();
        mocks.window.minimized = true;
        mocks.window.emit('minimize');
        expect(mocks.request).toHaveBeenLastCalledWith('parent', { viewId: '7:tab:1', visible: false });
        mocks.window.minimized = false;
        mocks.window.emit('restore');
        expect(mocks.request).toHaveBeenLastCalledWith('parent', { viewId: '7:tab:1', visible: true });
        mocks.window.visible = false;
        mocks.window.emit('hide');
        expect(mocks.request).toHaveBeenLastCalledWith('parent', { viewId: '7:tab:1', visible: false });
        await host.dispose();
    });

    it('keeps background control native and off-screen without placing or focusing', async () => {
        const { host, view } = await open();
        await view.setBackgroundControl!(true);
        await view.setBackgroundControl!(true);
        expect(mocks.request.mock.calls.filter(([op]) => op === 'background')).toEqual([['background', { viewId: '7:tab:1', enabled: true }]]);
        await view.setBackgroundControl!(false);
        expect(mocks.request).toHaveBeenLastCalledWith('background', { viewId: '7:tab:1', enabled: false });
        expect(mocks.window.focus).not.toHaveBeenCalled();
        expect(mocks.request.mock.calls.some(([op]) => op === 'focus')).toBe(false);
        await host.dispose();
    });

    it('focuses the owner window before the panel only on explicit focus, and rejects closed views', async () => {
        const { view } = await open();
        await view.focus();
        expect(mocks.window.show).toHaveBeenCalledOnce();
        expect(mocks.window.focus).toHaveBeenCalledOnce();
        expect(mocks.request).toHaveBeenLastCalledWith('focus', { viewId: '7:tab:1' });
        await view.close();
        await expect(view.focus()).rejects.toMatchObject({ reason: 'not-found' });
    });

    it('marks a view crashed when a placement push fails', async () => {
        const { host, view, sink } = await open();
        await view.setBounds(bounds);
        mocks.request.mockRejectedValueOnce(new Error('helper gone'));
        mocks.window.emit('move');
        await vi.waitFor(() => expect(sink.state).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'runtime-crashed', error: 'helper gone' })));
        await host.dispose();
    });
});

describe('WKWebView navigation and page state', () => {
    it('routes navigation, history actions and zoom to the exact native view', async () => {
        const { host, view } = await open();
        await view.navigate('https://tab.test/next');
        expect(mocks.request).toHaveBeenLastCalledWith('navigate', { viewId: '7:tab:1', url: 'https://tab.test/next' });
        for (const action of ['back', 'forward', 'reload', 'stop'] as const) {
            await view.nav(action);
            expect(mocks.request).toHaveBeenLastCalledWith('nav', { viewId: '7:tab:1', action });
        }
        await view.setPageZoom!(150);
        expect(mocks.request).toHaveBeenLastCalledWith('page-zoom', { viewId: '7:tab:1', pageZoomPercent: 150 });
        await host.dispose();
    });

    it('applies validated helper state, signals new documents and drops invalid state as a crash', async () => {
        const { host, view, sink } = await open();
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        expect(view.snapshot()).toEqual({ viewId: 'tab', engine: 'wkwebview', ...state });
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
        expect(sink.navigationStarted).toHaveBeenCalledOnce();
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, url: 'https://tab.test/missing', errorCode: 'navigation-failed', error: 'Navigation failed.' } });
        expect(view.snapshot()).toMatchObject({ errorCode: 'navigation-failed', error: 'Navigation failed.' });
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { url: 1 } });
        expect(view.snapshot()).toMatchObject({ errorCode: 'runtime-crashed' });
        mocks.onEvent({ event: 'state', viewId: '9:other:1', state });
        expect(view.snapshot()).toMatchObject({ errorCode: 'runtime-crashed' });
        await host.dispose();
    });

    describe('favicons', () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
        const icon = `data:image/png;base64,${png.toString('base64')}`;
        const links = ['https://tab.test/icon.png', 'https://tab.test/favicon.ico'];

        beforeEach(() => {
            mocks.partitions.length = 0;
            mocks.fetch.mockReset().mockImplementation(async () => new Response(png));
            mocks.request.mockImplementation(async (op: string, payload: { expression?: string }) =>
                op === 'evaluate' && payload.expression === WKWEBVIEW_FAVICON_LINKS ? { value: links } : undefined);
        });

        it('loads the page icon in the control world when a load finishes and keeps it until the next document', async () => {
            const { host, view, sink } = await open();
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
            await vi.waitFor(() => expect(view.snapshot().favicon).toBe(icon));
            expect(mocks.request).toHaveBeenCalledWith('evaluate', { viewId: '7:tab:1', expression: WKWEBVIEW_FAVICON_LINKS, world: 'coc-control' });
            expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(links[0], expect.objectContaining({ redirect: 'follow' }));
            expect(mocks.partitions).toEqual(['coc-wkwebview-favicons']);
            expect(sink.state).toHaveBeenLastCalledWith(expect.objectContaining({ favicon: icon }));
            // Later state keeps the icon; an error page hides it; a new main document drops it.
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, title: 'Renamed' } });
            expect(view.snapshot()).toMatchObject({ title: 'Renamed', favicon: icon });
            mocks.onEvent({ event: 'frame-navigated', viewId: '7:tab:1', frameId: 'main', parentFrameId: null, owner: null, token: 'a'.repeat(32), url: 'https://tab.test/next', origin: 'https://tab.test' });
            expect(view.snapshot().favicon).toBeUndefined();
            expect(sink.state).toHaveBeenLastCalledWith(expect.objectContaining({ favicon: undefined }));
            await host.dispose();
        });

        it('drops an icon whose document changed or whose tab closed before it arrived', async () => {
            let release!: () => void;
            mocks.fetch.mockImplementation(() => new Promise(resolve => { release = () => resolve(new Response(png)); }));
            const { host, view } = await open();
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
            await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
            release();
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(view.snapshot().favicon).toBeUndefined();
            const signal = mocks.fetch.mock.calls[0][1].signal!;
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
            await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
            await view.close();
            release();
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(signal.aborted).toBe(true);
            expect(mocks.fetch.mock.calls[1][1].signal!.aborted).toBe(true);
            await host.dispose();
        });

        it('skips error pages, failed evaluations and popups', async () => {
            const sink = makeSink({ controlPopoutOpened: vi.fn() });
            const { host, view } = await open(sink);
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, errorCode: 'navigation-failed', error: 'Navigation failed.' } });
            mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'about:blank' });
            mocks.onEvent({ event: 'state', viewId: '7:tab:1:popup:1', state: { ...state, loading: true } });
            mocks.onEvent({ event: 'state', viewId: '7:tab:1:popup:1', state });
            mocks.request.mockRejectedValueOnce(new Error('evaluation-failed'));
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(mocks.request.mock.calls.filter(([op]) => op === 'evaluate')).toEqual([
                ['evaluate', { viewId: '7:tab:1', expression: WKWEBVIEW_FAVICON_LINKS, world: 'coc-control' }],
            ]);
            expect(mocks.fetch).not.toHaveBeenCalled();
            expect(view.snapshot()).toEqual({ viewId: 'tab', engine: 'wkwebview', ...state });
            await host.dispose();
        });
    });

    it('reopens a crashed tab in place with its placement, zoom, shortcuts and background control', async () => {
        const { host, view } = await open();
        await view.setBounds(bounds);
        await view.setTabShortcuts!(true);
        await view.setBackgroundControl!(true);
        await view.setPageZoom!(75);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, errorCode: 'runtime-crashed', error: 'Web content process ended.' } });
        mocks.request.mockClear();
        await view.nav('reload');
        expect(mocks.request.mock.calls).toEqual([
            ['close', { viewId: '7:tab:1' }],
            ['open', { viewId: '7:tab:1', url: state.url, parentWindow: 4242, visible: true, pageZoomPercent: 75, bounds: placed, tabShortcuts: true }],
            ['background', { viewId: '7:tab:1', enabled: true }],
        ]);
        expect(view.snapshot()).toMatchObject({ loading: true, errorCode: undefined, error: undefined });
        await host.dispose();
    });

    it('drives native control on the exact view, and replaces it when a crashed tab reopens', async () => {
        const { host, view } = await open();
        const control = view.control!;
        await control.mouse({ type: 'move', x: 1, y: 2 });
        expect(mocks.request).toHaveBeenLastCalledWith('input', { input: { kind: 'mouse', type: 'move', x: 1, y: 2 }, viewId: '7:tab:1' });
        await control.setFocusEmulation(true);
        expect(mocks.request).toHaveBeenLastCalledWith('focus-emulation', { enabled: true, viewId: '7:tab:1' });
        const events: unknown[] = [];
        control.onEvent(event => events.push(event));
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, errorCode: 'runtime-crashed', error: 'Web content process ended.' } });
        expect(events).toEqual([{ type: 'crashed' }, { type: 'detached', reason: 'crashed' }]);
        await expect(control.evaluate('1')).rejects.toMatchObject({ reason: 'not-found' });
        await view.nav('reload');
        expect(view.control).not.toBe(control);
        mocks.request.mockResolvedValueOnce({ value: 2 });
        await expect(view.control!.evaluate('1 + 1')).resolves.toEqual({ value: 2 });
        expect(mocks.request).toHaveBeenLastCalledWith('evaluate', { expression: '1 + 1', world: 'page', viewId: '7:tab:1' });
        await view.close();
        await expect(view.control!.insertText('x')).rejects.toMatchObject({ reason: 'not-found' });
        await host.dispose();
    });

    it('routes helper frame events to the exact view control', async () => {
        const { host, view } = await open();
        const events: unknown[] = [];
        view.control!.onEvent(event => events.push(event));
        await view.control!.enableFrameEvents();
        const frame = { frameId: 'main/1', parentFrameId: 'main', owner: 1, token: 'a'.repeat(32), url: 'https://child.test/', origin: 'https://child.test' };
        mocks.onEvent({ event: 'frame-navigated', viewId: '9:other:1', ...frame });
        expect(events).toEqual([]);
        mocks.onEvent({ event: 'frame-navigated', viewId: '7:tab:1', ...frame });
        mocks.onEvent({ event: 'frame-detached', viewId: '7:tab:1', frameId: 'main/1' });
        expect(events.map(event => (event as { type: string }).type)).toEqual(['frame-attached', 'frame-navigated', 'frame-detached']);
        await host.dispose();
    });

    it('marks every tab failed when the helper process fails', async () => {
        const { host, view, sink } = await open();
        mocks.onFailure(new BrowserHostError('runtime-crashed', 'WKWebView host stopped.'));
        expect(view.snapshot()).toMatchObject({ loading: false, errorCode: 'runtime-crashed', error: 'WKWebView host stopped.' });
        expect(sink.state).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'runtime-crashed' }));
        await host.dispose();
    });

    it('requests new tabs for featureless window.open and Cmd+click', async () => {
        const { host, sink } = await open();
        mocks.onEvent({ event: 'new-tab', viewId: '7:tab:1', url: 'https://tab.test/other' });
        expect(sink.newTab).toHaveBeenCalledExactlyOnceWith('https://tab.test/other');
        await host.dispose();
    });
});

describe('WKWebView explicit history events', () => {
    it('records helper visits and titles only, qualifying committed documents by native source', async () => {
        const { host, view, sink } = await open();
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        await view.setBounds(bounds);
        view.snapshot();
        expect(sink.visited).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', sourceViewId: '7:tab:1', url: state.url, title: '' });
        mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', sourceViewId: '7:tab:1', url: state.url, title: 'Tab' });
        expect(sink.visited).toHaveBeenCalledExactlyOnceWith(state.url, '');
        expect(sink.titleUpdated).toHaveBeenCalledExactlyOnceWith(state.url, 'Tab');
        expect(sink.documentCommitted).toHaveBeenCalledExactlyOnceWith(state.url, '');
        expect(sink.documentTitleUpdated).toHaveBeenCalledExactlyOnceWith(state.url, 'Tab');
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', sourceViewId: '7:tab:1:popup:1', url: 'https://auth.test/', title: 'Popup' });
        expect(sink.visited).toHaveBeenLastCalledWith('https://auth.test/', 'Popup');
        expect(sink.documentCommitted).toHaveBeenCalledOnce();
        await host.dispose();
    });

    it('drops non-HTTP, malformed and closed-view history events', async () => {
        const { view, sink } = await open();
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url: 'file:///tmp/a.html', title: 'File' });
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url: state.url, title: 1 });
        await view.close();
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url: state.url, title: 'Late' });
        expect(sink.visited).not.toHaveBeenCalled();
    });
});

describe('WKWebView annotation capture', () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    const viewport = { width: 300, height: 200, devicePixelRatio: 2 };

    async function placedTab() {
        const h = await open();
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        await h.view.setBounds(bounds);
        mocks.request.mockClear();
        return h;
    }

    it('captures the exact native root through the shared crop', async () => {
        const h = await placedTab();
        mocks.request.mockResolvedValueOnce({ value: 3 }).mockResolvedValueOnce('native preview');
        expect(await h.view.captureAnnotation!(rect, viewport)).toMatchObject({ width: 30, height: 40 });
        expect(mocks.request).toHaveBeenCalledWith('pixel-ratio', { viewId: '7:tab:1' });
        expect(mocks.request).toHaveBeenCalledWith('capture-annotation', { viewId: '7:tab:1' });
        // The helper's device scale wins: before macOS 26 the page's devicePixelRatio leaves page zoom out.
        expect(captureWebView2Annotation).toHaveBeenCalledWith(expect.any(Function), rect, { ...viewport, devicePixelRatio: 3 });
    });

    it.each(['loading', 'hidden', 'minimized', 'closed', 'crashed'])('refuses %s views before capture dispatch', async reason => {
        const h = await placedTab();
        if (reason === 'loading') mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
        if (reason === 'hidden') await h.view.setBounds(null);
        if (reason === 'minimized') mocks.window.minimized = true;
        if (reason === 'closed') await h.view.close();
        if (reason === 'crashed') mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, error: 'Crash', errorCode: 'runtime-crashed' } });
        mocks.request.mockClear();
        await expect(h.view.captureAnnotation!(rect, viewport)).rejects.toThrow();
        expect(mocks.request).not.toHaveBeenCalledWith('capture-annotation', expect.anything());
    });

    it.each(['navigation', 'committed document', 'same-document URL', 'main navigation', 'zoom', 'hidden', 'closed', 'crashed', 'crash reopen'])(
        'rejects late %s captures', async reason => {
            const h = await placedTab();
            let release!: (result: unknown) => void;
            mocks.request.mockResolvedValueOnce({ value: 2 }).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
            const capture = h.view.captureAnnotation!(rect, viewport);
            await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledWith('capture-annotation', { viewId: '7:tab:1' }));
            const rejected = expect(capture).rejects.toThrow();
            if (reason === 'navigation') {
                mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, loading: true } });
                mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
            }
            if (reason === 'committed document') mocks.onEvent({ event: 'visited', viewId: '7:tab:1', sourceViewId: '7:tab:1', url: state.url, title: 'Tab' });
            if (reason === 'same-document URL') mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, url: 'https://tab.test/#next' } });
            if (reason === 'main navigation') await h.view.navigate(state.url);
            if (reason === 'zoom') await h.view.setPageZoom!(125);
            if (reason === 'hidden') await h.view.setBounds(null);
            if (reason === 'closed') await h.view.close();
            if (reason === 'crashed') mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, error: 'Crash', errorCode: 'runtime-crashed' } });
            if (reason === 'crash reopen') {
                mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, error: 'Crash', errorCode: 'runtime-crashed' } });
                await h.view.nav('reload');
                mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
            }
            release('native preview');
            await rejected;
        });

    it('keeps popup capture unavailable', async () => {
        const popups: BrowserHostedView[] = [];
        await open(makeSink({ controlPopoutOpened: vi.fn((_id, popup) => { popups.push(popup); }) }));
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'about:blank' });
        expect(popups).toHaveLength(1);
        expect(popups[0].captureAnnotation).toBeUndefined();
    });
});

describe('WKWebView native popups', () => {
    async function opened() {
        const popups = new Map<string, BrowserHostedView>();
        const sink = makeSink({
            controlPopoutOpened: vi.fn((id, popup) => popups.set(id, popup)),
            controlPopoutClosed: vi.fn(id => popups.delete(id)),
        });
        const { host, view } = await open(sink);
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'about:blank' });
        const [id, popup] = [...popups][0];
        return { host, root: view, sink, popups, id, popup };
    }

    it('registers popups with opener identity and routes their commands to their own native handle', async () => {
        const h = await opened();
        expect(h.id).toMatch(/^browser-popout-/);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1:popup:1', state: { ...state, url: 'https://auth.test/', title: 'Sign in' } });
        expect(h.popup.snapshot()).toMatchObject({ viewId: h.id, engine: 'wkwebview', url: 'https://auth.test/', title: 'Sign in' });
        expect(h.root.snapshot()).toMatchObject({ url: state.url, title: '' });
        expect(h.sink.state).not.toHaveBeenCalled();
        await h.popup.focus();
        expect(mocks.window.focus).not.toHaveBeenCalled();
        expect(mocks.request).toHaveBeenLastCalledWith('focus', { viewId: '7:tab:1:popup:1' });
        await h.popup.navigate('https://auth.test/next');
        expect(mocks.request).toHaveBeenLastCalledWith('navigate', { viewId: '7:tab:1:popup:1', url: 'https://auth.test/next' });
        mocks.request.mockClear();
        await h.popup.setBounds(bounds);
        await h.popup.setBackgroundControl!(true);
        await h.popup.setTabShortcuts!(true);
        expect(mocks.request).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'control-focused', viewId: '7:tab:1:popup:1' });
        expect(h.sink.controlFocused).toHaveBeenCalledOnce();
        expect(h.popup.control).not.toBe(h.root.control);
        await h.popup.control!.insertText('x');
        expect(mocks.request).toHaveBeenLastCalledWith('input', { input: { kind: 'text', text: 'x' }, viewId: '7:tab:1:popup:1' });
        await h.host.dispose();
    });

    it('shows control activity only on popups and forwards their native Stop with the public popup id', async () => {
        const popups = new Map<string, BrowserHostedView>();
        const sink = makeSink({ controlPopoutOpened: vi.fn((id, popup) => popups.set(id, popup)), controlStopRequested: vi.fn() });
        const { host, view } = await open(sink);
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'about:blank' });
        const [id, popup] = [...popups][0];
        await popup.setControlActivity!('turn');
        expect(mocks.request).toHaveBeenLastCalledWith('control-activity', { viewId: '7:tab:1:popup:1', turnId: 'turn' });
        mocks.onEvent({ event: 'control-stop', viewId: '7:tab:1:popup:1', turnId: 'turn' });
        expect(sink.controlStopRequested).toHaveBeenCalledExactlyOnceWith(id, 'turn');
        await popup.setControlActivity!(null);
        expect(mocks.request).toHaveBeenLastCalledWith('control-activity', { viewId: '7:tab:1:popup:1', turnId: null });
        mocks.request.mockClear();
        await view.setControlActivity!('turn');
        expect(mocks.request).not.toHaveBeenCalled();
        // A tab's Stop event, a malformed turn and a closed popup's late Stop are ignored.
        mocks.onEvent({ event: 'control-stop', viewId: '7:tab:1', turnId: 'turn' });
        mocks.onEvent({ event: 'control-stop', viewId: '7:tab:1:popup:1', turnId: 7 });
        await popup.close();
        await popup.setControlActivity!('turn');
        expect(mocks.request).not.toHaveBeenCalledWith('control-activity', expect.anything());
        mocks.onEvent({ event: 'control-stop', viewId: '7:tab:1:popup:1', turnId: 'turn' });
        expect(sink.controlStopRequested).toHaveBeenCalledOnce();
        await host.dispose();
    });

    it('ignores duplicate, foreign and invalid popup events', async () => {
        const h = await opened();
        for (const message of [
            { viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'https://auth.test/' },
            { viewId: '8:tab:1:popup:2', rootId: '7:tab:1', url: 'https://auth.test/' },
            { viewId: '7:tab:1:popup:2', rootId: '8:tab:1', url: 'https://auth.test/' },
            { viewId: '7:tab:1:popup:2', rootId: '7:tab:1', url: 'file:///preview.html' },
            { viewId: '7:tab:1:popup:x', rootId: '7:tab:1', url: 'https://auth.test/' },
        ]) mocks.onEvent({ event: 'popup-opened', ...message });
        expect(h.popups.size).toBe(1);
        await h.host.dispose();
    });

    it('closes a popup on its helper event or a crash, and all popups with their root', async () => {
        const h = await opened();
        mocks.onEvent({ event: 'popup-closed', viewId: '7:tab:1:popup:1', rootId: '7:tab:1' });
        expect(h.sink.controlPopoutClosed).toHaveBeenCalledExactlyOnceWith(h.id);
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:2', rootId: '7:tab:1', url: 'https://auth.test/' });
        mocks.onEvent({ event: 'state', viewId: '7:tab:1:popup:2', state: { ...state, errorCode: 'runtime-crashed', error: 'ended' } });
        expect(h.popups.size).toBe(0);
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:3', rootId: '7:tab:1', url: 'https://auth.test/' });
        expect(h.popups.size).toBe(1);
        await h.root.close();
        expect(h.popups.size).toBe(0);
        expect(mocks.rejectView).toHaveBeenCalledWith('7:tab:1:popup:3');
    });
});

describe('WKWebView browser chords', () => {
    it('forwards Cmd+1–9 and Cmd holds only for an opted-in, placed tab, returning focus to the owner first', async () => {
        const { host, view, sink } = await open();
        mocks.onEvent({ event: 'tab-shortcut-requested', viewId: '7:tab:1', digit: 2 });
        mocks.onEvent({ event: 'tab-modifier', viewId: '7:tab:1', held: true });
        await view.setTabShortcuts!(true);
        expect(mocks.request).toHaveBeenLastCalledWith('tab-shortcuts', { viewId: '7:tab:1', tabShortcuts: true });
        expect(sink.tabShortcut).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'tab-shortcut-requested', viewId: '7:tab:1', digit: 2 });
        mocks.onEvent({ event: 'tab-modifier', viewId: '7:tab:1', held: true });
        expect(sink.tabShortcut).toHaveBeenCalledExactlyOnceWith({ held: true });
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'tab-shortcut-requested', viewId: '7:tab:1', digit: 10 });
        mocks.onEvent({ event: 'tab-shortcut-requested', viewId: '7:tab:1', digit: 3 });
        await vi.waitFor(() => expect(sink.tabShortcut).toHaveBeenLastCalledWith({ digit: 3 }));
        expect(mocks.window.focus).toHaveBeenCalled();
        expect(mocks.owner.focus).toHaveBeenCalled();
        expect(sink.tabShortcut).toHaveBeenCalledTimes(2);
        await host.dispose();
    });

    it('forwards close, add-menu, address and reopen requests only from a placed tab', async () => {
        const { host, view, sink } = await open();
        for (const event of ['close-requested', 'open-menu-requested', 'focus-address-requested', 'reopen-closed-requested'])
            mocks.onEvent({ event, viewId: '7:tab:1' });
        await view.setBounds(bounds);
        for (const event of ['close-requested', 'open-menu-requested', 'focus-address-requested', 'reopen-closed-requested'])
            mocks.onEvent({ event, viewId: '7:tab:1' });
        await vi.waitFor(() => expect(sink.reopenClosedRequested).toHaveBeenCalledOnce());
        expect(sink.closeRequested).toHaveBeenCalledOnce();
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
        expect(sink.focusAddressRequested).toHaveBeenCalledOnce();
        await host.dispose();
    });

    it('returns keyboard focus to the owner only for its placed tabs', async () => {
        const { host, view } = await open();
        await host.focusOwner(7);
        expect(mocks.window.focus).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        await host.focusOwner(8);
        expect(mocks.window.focus).not.toHaveBeenCalled();
        await host.focusOwner(7);
        expect(mocks.window.focus).toHaveBeenCalledOnce();
        expect(mocks.owner.focus).toHaveBeenCalledOnce();
        await host.dispose();
    });
});

describe('WKWebView agent navigation approval gate', () => {
    async function opened(navigationGate?: (url: string, popoutViewId?: string) => boolean | Promise<boolean>) {
        const popups = new Map<string, BrowserHostedView>();
        const gateSink = makeSink({ navigationGate: vi.fn(navigationGate ?? (() => true)),
            controlPopoutOpened: vi.fn((id, popup) => popups.set(id, popup)), controlPopoutClosed: vi.fn(id => popups.delete(id)) });
        const host = new WkWebViewBrowserHost('/data/browser/wkwebview');
        const root = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url, navigationGate: true }, gateSink);
        return { host, root, sink: gateSink, popups };
    }
    const decisions = () => mocks.request.mock.calls.filter(call => call[0] === 'navigation-decision');
    const pageState = (loading: boolean, url = state.url) => mocks.onEvent({ event: 'state', viewId: '7:tab:1', state: { ...state, url, loading } });

    it('opens gated and toggles root and popup gates, keeping popups gated while their root is', async () => {
        const h = await opened();
        expect(mocks.request).toHaveBeenCalledWith('open', expect.objectContaining({ viewId: '7:tab:1', navigationGate: true }));
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'https://tab.test/popup' });
        const [, popup] = [...h.popups][0];
        mocks.request.mockClear();
        await popup.setNavigationGate!(true);
        expect(mocks.request).toHaveBeenLastCalledWith('navigation-gate', { viewId: '7:tab:1:popup:1', navigationGate: true });
        await popup.setNavigationGate!(false);
        expect(mocks.request).toHaveBeenLastCalledWith('navigation-gate', { viewId: '7:tab:1:popup:1', navigationGate: true });
        mocks.request.mockClear();
        await h.root.setNavigationGate!(false);
        expect(mocks.request.mock.calls).toEqual([
            ['navigation-gate', { viewId: '7:tab:1', navigationGate: false }],
            ['navigation-gate', { viewId: '7:tab:1:popup:1', navigationGate: false }],
        ]);
        mocks.request.mockClear();
        await h.root.setNavigationGate!(false);
        expect(mocks.request).not.toHaveBeenCalled();
        await h.host.dispose();
    });

    it('releases a held load only after the sink allows it, and keeps control pending until it settles', async () => {
        let decide!: (allow: boolean) => void;
        const h = await opened(() => new Promise<boolean>(resolve => { decide = resolve; }));
        const controller = new AbortController();
        try {
            pageState(false);
            mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'https://other.test/login', gateId: 4 });
            expect(h.sink.navigationGate).toHaveBeenCalledExactlyOnceWith('https://other.test/login');
            let ready = false;
            const waiting = h.root.waitForControlReady!(controller.signal).then(() => { ready = true; });
            await new Promise(resolve => setTimeout(resolve, 40));
            expect(ready).toBe(false);
            expect(decisions()).toEqual([]);
            // The helper publishes the approved load as loading before it replies.
            mocks.request.mockImplementation(async op => { if (op === 'navigation-decision') pageState(true, 'https://other.test/login'); });
            decide(true);
            await vi.waitFor(() => expect(decisions()).toEqual([['navigation-decision', { viewId: '7:tab:1', gateId: 4, allow: true }]]));
            await new Promise(resolve => setTimeout(resolve, 40));
            expect(ready).toBe(false);
            pageState(false, 'https://other.test/home');
            await waiting;
            expect(ready).toBe(true);
        } finally {
            controller.abort();
            await h.host.dispose();
        }
    });

    it('waits for a navigation the page schedules right after its load stops', async () => {
        const h = await opened();
        const controller = new AbortController();
        try {
            pageState(true, 'https://tab.test/login');
            let ready = false;
            const waiting = h.root.waitForControlReady!(controller.signal).then(() => { ready = true; });
            // WebKit reports the load finished, then starts the page's scripted form submit.
            pageState(false, 'https://tab.test/login');
            await new Promise(resolve => setTimeout(resolve, WKWEBVIEW_LOAD_SETTLE_MS / 3));
            expect(ready).toBe(false);
            pageState(true, 'https://tab.test/login');
            await new Promise(resolve => setTimeout(resolve, WKWEBVIEW_LOAD_SETTLE_MS * 1.5));
            expect(ready).toBe(false);
            const stopped = performance.now();
            pageState(false, 'https://tab.test/home');
            await waiting;
            expect(performance.now() - stopped).toBeGreaterThanOrEqual(WKWEBVIEW_LOAD_SETTLE_MS - 5);
            // A page that settled long ago is ready at once.
            const start = performance.now();
            await h.root.waitForControlReady!(controller.signal);
            expect(performance.now() - start).toBeLessThan(WKWEBVIEW_LOAD_SETTLE_MS);
        } finally {
            controller.abort();
            await h.host.dispose();
        }
    });

    it.each(['denied', 'failed', 'cancelled', 'closed'] as const)('reports %s approval waits', async outcome => {
        let decide!: (allow: boolean) => void;
        const h = await opened(() => new Promise<boolean>(resolve => { decide = resolve; }));
        const controller = new AbortController();
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            pageState(false);
            mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'https://other.test/login', gateId: 1 });
            const waiting = h.root.waitForControlReady!(controller.signal);
            const rejected = expect(waiting).rejects.toThrow({
                denied: 'denied', failed: 'native decision failed', cancelled: 'aborted', closed: 'closed',
            }[outcome]);
            if (outcome === 'closed') await h.root.close();
            else if (outcome === 'cancelled') controller.abort(new Error('cancelled'));
            else {
                if (outcome === 'failed') mocks.request.mockRejectedValueOnce(new Error('native decision failed'));
                decide(outcome !== 'denied');
            }
            await rejected;
            if (outcome === 'denied') expect(decisions()).toEqual([['navigation-decision', { viewId: '7:tab:1', gateId: 1, allow: false }]]);
            if (outcome === 'closed') {
                decide(true);
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(decisions()).toEqual([]);
            }
        } finally {
            controller.abort();
            await h.host.dispose();
            log.mockRestore();
        }
    });

    it.each(['navigate', 'stop'] as const)('retires held loads on manual %s without answering them', async action => {
        let decide!: (allow: boolean) => void;
        const h = await opened(() => new Promise<boolean>(resolve => { decide = resolve; }));
        const controller = new AbortController();
        try {
            pageState(false);
            mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'https://other.test/login', gateId: 2 });
            if (action === 'navigate') await h.root.navigate('https://typed.test/');
            else await h.root.nav('stop');
            await h.root.waitForControlReady!(controller.signal);
            decide(true);
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(decisions()).toEqual([]);
        } finally {
            controller.abort();
            await h.host.dispose();
        }
    });

    it('asks through the root sink with the public popout id for popup loads', async () => {
        const h = await opened();
        mocks.onEvent({ event: 'popup-opened', viewId: '7:tab:1:popup:1', rootId: '7:tab:1', url: 'https://tab.test/popup' });
        const [id] = [...h.popups][0];
        mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1:popup:1', url: 'https://sso.test/', gateId: 9 });
        expect(h.sink.navigationGate).toHaveBeenCalledExactlyOnceWith('https://sso.test/', id);
        await vi.waitFor(() => expect(decisions()).toEqual([['navigation-decision', { viewId: '7:tab:1:popup:1', gateId: 9, allow: true }]]));
        await h.host.dispose();
    });

    it('denies held loads with invalid URLs and ignores events without a gate id or owner', async () => {
        const h = await opened();
        mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', url: 'file:///etc/passwd', gateId: 3 });
        for (const message of [{ url: 'https://x.test/' }, { url: 'https://x.test/', gateId: 0 }, { url: 'https://x.test/', gateId: 1.5 }, { viewId: 'foreign', url: 'https://x.test/', gateId: 5 }]) {
            mocks.onEvent({ event: 'navigation-gate', viewId: '7:tab:1', ...message });
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(h.sink.navigationGate).not.toHaveBeenCalled();
        expect(decisions()).toEqual([['navigation-decision', { viewId: '7:tab:1', gateId: 3, allow: false }]]);
        await h.host.dispose();
    });
});

describe('WKWebView profile data', () => {
    const cookie = { url: 'https://app.test/', name: 'session', value: 'token', path: '/', secure: true, httpOnly: true, sameSite: 'lax' as const };

    function onPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
        const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { value: platform });
        return run().finally(() => Object.defineProperty(process, 'platform', original));
    }

    it('imports cookies into the shared profile store from the host and from a tab', async () => {
        const { host, view } = await open();
        await host.importCookies([cookie]);
        await view.importCookies!([cookie]);
        expect(mocks.request.mock.calls.filter(([op]) => op === 'import-profile-cookies'))
            .toEqual([['import-profile-cookies', { cookies: [cookie] }], ['import-profile-cookies', { cookies: [cookie] }]]);
        mocks.request.mockRejectedValueOnce(new BrowserHostError('invalid', 'Cookie import failed. Nothing was added.'));
        await expect(host.importCookies([cookie])).rejects.toThrow('Nothing was added');
        await host.dispose();
    });

    it('reports strict certificates and a cookie count only, treating count failures as unavailable', async () => {
        const { host, view } = await open();
        const nativeId = '7:tab:1';
        const replies: Record<string, unknown> = { 'site-info': { certificateError: false } };
        mocks.request.mockImplementation(async (op: string) => {
            const reply = replies[op];
            if (reply instanceof Error) throw reply;
            return reply;
        });
        expect(await view.siteFacts!()).toEqual({ rejectsInvalidCertificates: true, certificateError: false });
        expect(mocks.request).toHaveBeenLastCalledWith('site-info', { viewId: nativeId });
        expect(mocks.request).not.toHaveBeenCalledWith('cookie-count', expect.anything());
        replies['cookie-count'] = { count: 3 };
        expect(await view.siteFacts!('https://app.test/docs')).toEqual({ rejectsInvalidCertificates: true, certificateError: false, cookieCount: 3 });
        expect(mocks.request).toHaveBeenCalledWith('site-info', { viewId: nativeId, url: 'https://app.test/docs' });
        expect(mocks.request).toHaveBeenCalledWith('cookie-count', { url: 'https://app.test/docs' });
        replies['cookie-count'] = { count: 'many' };
        expect(await view.siteFacts!('https://app.test/')).not.toHaveProperty('cookieCount');
        replies['cookie-count'] = new BrowserHostError('runtime-crashed', 'WKWebView host is not running.');
        replies['site-info'] = new BrowserHostError('runtime-crashed', 'WKWebView host is not running.');
        expect(await view.siteFacts!('https://app.test/')).toEqual({ rejectsInvalidCertificates: true, certificateError: false });
        await host.dispose();
    });

    it('reports the helper certificate and certificate rejections in site facts', async () => {
        const { host, view } = await open();
        const certificate = { subject: 'app.test', issuer: 'Test CA', validStart: 1_700_000_000, validExpiry: 1_800_000_000 };
        let site: unknown = { certificateError: false, certificate };
        mocks.request.mockImplementation(async (op: string) => op === 'site-info' ? site : { count: 0 });
        expect(await view.siteFacts!('https://app.test/')).toEqual({ rejectsInvalidCertificates: true, certificateError: false, certificate, cookieCount: 0 });
        site = { certificateError: true };
        expect(await view.siteFacts!('https://bad.test/')).toEqual({ rejectsInvalidCertificates: true, certificateError: true, cookieCount: 0 });
        site = { certificateError: 'yes', certificate: { ...certificate, validExpiry: 'never' } };
        expect(await view.siteFacts!('https://app.test/')).toEqual({ rejectsInvalidCertificates: true, certificateError: false, cookieCount: 0 });
        await host.dispose();
    });

    it('accepts only well-formed helper certificates', () => {
        const certificate = { subject: 'a', issuer: 'b', validStart: 1, validExpiry: 2 };
        expect(wkWebViewCertificate(certificate)).toEqual(certificate);
        expect(wkWebViewCertificate({ ...certificate, extra: 'dropped' })).toEqual(certificate);
        expect(wkWebViewCertificate({ ...certificate, subject: 7 })).toBeUndefined();
        expect(wkWebViewCertificate({ ...certificate, validStart: Number.NaN })).toBeUndefined();
        expect(wkWebViewCertificate(null)).toBeUndefined();
        expect(wkWebViewCertificate('cert')).toBeUndefined();
    });

    it('clears the profile store through the helper on macOS only', async () => {
        const host = new WkWebViewBrowserHost('/data/browser/wkwebview');
        await onPlatform('darwin', () => host.clearData());
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith('clear');
        mocks.request.mockClear();
        await expect(onPlatform('linux', () => host.clearData())).rejects.toMatchObject({ reason: 'unsupported-platform' });
        expect(mocks.request).not.toHaveBeenCalled();
        await host.dispose();
    });
});

describe('WKWebView managed native downloads', () => {
    const downloadId = '00000000-0000-0000-0000-000000000001';
    async function managed(choose: (ownerId: number, filename: string) => Promise<string | undefined>) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wkwebview-download-host-'));
        const store = new BrowserDownloadStore(dir);
        const host = new WkWebViewBrowserHost('/data/browser/wkwebview', store, choose, ownerId => ownerId === 7);
        const approval = { current: vi.fn(() => true), dispose: vi.fn() };
        const sink = makeSink({ downloadApproval: vi.fn(() => approval) });
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, sink);
        const cleanup = async () => { await host.dispose(); await store.dispose(); fs.rmSync(dir, { recursive: true, force: true }); };
        return { dir, store, host, view, sink, approval, cleanup };
    }
    const decisions = () => mocks.request.mock.calls.filter(([op]) => op === 'download-decide').map(([, payload]) => payload);

    it('reports helper refusals and cancels downloads from unknown views', async () => {
        const { host, sink } = await open();
        mocks.onEvent({ event: 'download', viewId: '7:tab:1', url: 'https://files.test/a?token=secret', reason: 'limit' });
        expect(sink.download).toHaveBeenLastCalledWith({ viewId: 'tab', url: 'files.test', ok: false, error: 'Too many active downloads or pending approvals.' });
        mocks.onEvent({ event: 'download', viewId: '7:tab:1', url: 'data:text/plain,x', reason: 'unsupported' });
        expect(sink.download).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: 'This download URL is unsupported or exceeds the native limit.' }));
        mocks.onEvent({ event: 'download', viewId: 'gone', downloadId, url: 'https://files.test/a', filename: 'a' });
        expect(mocks.request).toHaveBeenCalledWith('download-decide', { viewId: 'gone', downloadId, action: 'cancel' });
        // Without a download store, an announced download is refused rather than left waiting.
        mocks.onEvent({ event: 'download', viewId: '7:tab:1', downloadId, url: 'https://files.test/a', filename: 'a' });
        expect(sink.download).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: 'Download approval is unavailable for this source.' }));
        expect(mocks.request).toHaveBeenCalledWith('download-decide', { viewId: '7:tab:1', downloadId, action: 'cancel' });
        await host.dispose();
    });

    it('approves the Save dialog path and routes completion after the tab closes', async () => {
        let file = '';
        const choose = vi.fn(async () => file);
        const fixture = await managed(choose);
        try {
            file = path.join(fixture.dir, 'report.csv');
            mocks.onEvent({ event: 'download', viewId: '7:tab:1', downloadId, url: 'https://files.test/report.csv', filename: '../report?.csv' });
            await vi.waitFor(() => expect(decisions()).toEqual([{ viewId: '7:tab:1', downloadId, action: 'approve', destination: file }]));
            expect(choose).toHaveBeenCalledExactlyOnceWith(7, 'report_.csv');
            await fixture.view.close();
            fs.writeFileSync(file, 'a,b\n1');
            mocks.onEvent({ event: 'download-progress', viewId: '7:tab:1', downloadId, state: 'completed', received: 5, total: 5, final: true, canPause: false, canResume: false });
            const record = (await fixture.store.query()).entries[0];
            expect(record).toMatchObject({ engine: 'wkwebview', state: 'completed', fileAvailable: true });
            expect(JSON.stringify(record)).not.toContain(file);
        } finally { await fixture.cleanup(); }
    });

    it('drops a pending approval when main navigates the tab before the Save dialog answers', async () => {
        let finish!: (file: string) => void;
        const fixture = await managed(() => new Promise<string>(resolve => { finish = resolve; }));
        try {
            mocks.onEvent({ event: 'download', viewId: '7:tab:1', downloadId, url: 'https://files.test/report.csv', filename: 'report.csv' });
            await fixture.view.navigate('https://tab.test/next');
            expect(decisions()).toEqual([{ viewId: '7:tab:1', downloadId, action: 'cancel' }]);
            finish(path.join(fixture.dir, 'late.csv'));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(decisions().some(payload => payload.action === 'approve')).toBe(false);
            expect((await fixture.store.query()).entries[0]).toMatchObject({ engine: 'wkwebview', state: 'cancelled', fileAvailable: false });
        } finally { await fixture.cleanup(); }
    });

    it('interrupts transfers when the helper fails and cancels them before clearing data', async () => {
        const fixture = await managed(async () => path.join(os.tmpdir(), 'never-written.csv'));
        try {
            mocks.onEvent({ event: 'download', viewId: '7:tab:1', downloadId, url: 'https://files.test/a.csv', filename: 'a.csv' });
            await vi.waitFor(() => expect(decisions()).toHaveLength(1));
            mocks.onEvent({ event: 'download-progress', viewId: '7:tab:1', downloadId, state: 'downloading', received: 1, total: 5, final: false, canPause: false, canResume: false });
            expect((await fixture.store.query()).entries[0]).toMatchObject({ state: 'downloading', canPause: false });
            if (process.platform === 'darwin') {
                mocks.request.mockClear();
                await fixture.host.clearData();
                expect(mocks.request.mock.calls.map(([op, payload]) => [op, payload?.action])).toEqual([['download-action', 'cancel'], ['clear', undefined]]);
            }
            mocks.onFailure(new BrowserHostError('runtime-crashed', 'Helper exited.'));
            expect((await fixture.store.query()).entries[0]).toMatchObject({ state: 'interrupted', active: false });
        } finally { await fixture.cleanup(); }
    });
});
