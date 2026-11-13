import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WkWebViewBrowserHost, wkWebViewParentWindow } from '../src/wkwebview-browser-host';
import { BrowserHostError, type BrowserEventSink, type BrowserHostedView } from '../src/browser-host-contract';

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
    };
});

vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => Object.assign(mocks.window, { webContents: mocks.owner }) },
    webContents: { fromId: () => mocks.owner },
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
        await h.host.dispose();
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
