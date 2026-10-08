import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebView2BrowserHost } from '../src/webview2-browser-host';
import type { BrowserEventSink } from '../src/browser-host-contract';
import { BrowserHistoryStore } from '../src/browser-history';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mocks = vi.hoisted(() => ({
    request: vi.fn().mockResolvedValue(undefined),
    running: true,
    window: {
        isDestroyed: () => false,
        isFullScreen: () => false,
        getNativeWindowHandle: () => Buffer.alloc(8),
        getContentBounds: () => mocks.contentBounds,
        setFullScreen: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
    },
    owner: { focus: vi.fn() },
    contentBounds: { x: 100, y: 200, width: 640, height: 480 },
    dipToScreenPoint: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
    onEvent: vi.fn<(message: Record<string, unknown>) => void>(),
}));

vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => ({ ...mocks.window, webContents: mocks.owner }) },
    screen: { dipToScreenPoint: mocks.dipToScreenPoint },
    webContents: { fromId: () => mocks.owner },
    shell: {},
}));

vi.mock('../src/webview2-process', async importOriginal => ({
    ...await importOriginal<typeof import('../src/webview2-process')>(),
    WebView2Process: class {
        constructor(_binary: () => string, _profile: string, onEvent: (message: Record<string, unknown>) => void) {
            mocks.onEvent.mockImplementation(onEvent);
        }
        get running() { return mocks.running; }
        request = mocks.request;
    },
}));

const sink: BrowserEventSink = { state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(), openMenuRequested: vi.fn(), focusAddressRequested: vi.fn() };
const bounds = { x: 10, y: 20, width: 300, height: 200 };

describe('WebView2 native focus handoff', () => {
    beforeEach(() => {
        mocks.request.mockReset().mockResolvedValue(undefined);
        mocks.owner.focus.mockClear();
        vi.mocked(sink.closeRequested).mockClear();
        vi.mocked(sink.openMenuRequested).mockClear();
        vi.mocked(sink.focusAddressRequested!).mockClear();
        mocks.running = true;
        mocks.contentBounds = { x: 100, y: 200, width: 640, height: 480 };
        mocks.dipToScreenPoint.mockReset().mockImplementation(point => point);
        mocks.window.on.mockClear();
        mocks.window.setFullScreen.mockClear();
    });

    it('includes the live content origin in physical screen pixels, independent of viewport bounds', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        mocks.dipToScreenPoint.mockImplementation(({ x, y }) => ({ x: x * 1.5, y: y * 1.5 }));
        await view.setBounds(bounds);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: 150, y: 300 } },
        });
        mocks.contentBounds = { x: -800, y: 226, width: 640, height: 480 };
        await view.setBounds(bounds);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: -1200, y: 339 } },
        });
        await view.setBounds(null);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', { viewId: '7:tab:1', bounds: null });
    });

    it('refreshes the origin when the owner moves or resizes and preserves it in fullscreen', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.contentBounds = { x: 50, y: 80, width: 800, height: 600 };
        for (const [event, reposition] of mocks.window.on.mock.calls) {
            if (event === 'move' || event === 'resize') {
                reposition();
                expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
                    viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: 50, y: 80 } },
                });
            }
        }
        mocks.onEvent({ event: 'fullscreen', viewId: '7:tab:1', fullscreen: true });
        expect(mocks.window.setFullScreen).toHaveBeenLastCalledWith(true);
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:tab:1', bounds: { x: 0, y: 0, width: 800, height: 600, contentOrigin: { x: 50, y: 80 } },
        });
        mocks.onEvent({ event: 'fullscreen', viewId: '7:tab:1', fullscreen: false });
        expect(mocks.request).toHaveBeenLastCalledWith('bounds', {
            viewId: '7:tab:1', bounds: { ...bounds, contentOrigin: { x: 50, y: 80 } },
        });
    });

    it('forwards close only for the matching live visible native view', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'close-requested', viewId: '8:tab:1' });
        expect(sink.closeRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).toHaveBeenCalledOnce();
        expect(mocks.request).not.toHaveBeenCalledWith('close', expect.anything());
        await view.close();
        mocks.onEvent({ event: 'close-requested', viewId: '7:tab:1' });
        expect(sink.closeRequested).toHaveBeenCalledOnce();
    });

    it('returns focus and forwards add-menu only for a live visible source view', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'open-menu-requested', viewId: '8:tab:1' });
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        await vi.waitFor(() => expect(sink.openMenuRequested).toHaveBeenCalledOnce());
        expect(mocks.owner.focus).toHaveBeenCalled();
        expect(mocks.request).toHaveBeenCalledWith('focus-host', { viewId: '7:tab:1' });
        await view.close();
        mocks.onEvent({ event: 'open-menu-requested', viewId: '7:tab:1' });
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
    });

    it('hands native focus back before forwarding an address request, rejecting hidden and foreign views', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'remote-workspace', url: 'https://example.test' }, sink);
        mocks.onEvent({ event: 'focus-address-requested', viewId: '7:tab:1' });
        expect(sink.focusAddressRequested).not.toHaveBeenCalled();
        await view.setBounds(bounds);
        mocks.onEvent({ event: 'focus-address-requested', viewId: '8:tab:1' });
        expect(sink.focusAddressRequested).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'focus-address-requested', viewId: '7:tab:1' });
        await vi.waitFor(() => expect(sink.focusAddressRequested).toHaveBeenCalledOnce());
        expect(mocks.request).toHaveBeenCalledWith('focus-host', { viewId: '7:tab:1' });
        expect(mocks.owner.focus.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sink.focusAddressRequested!).mock.invocationCallOrder[0]);
        await view.close();
        mocks.onEvent({ event: 'focus-address-requested', viewId: '7:tab:1' });
        expect(sink.focusAddressRequested).toHaveBeenCalledOnce();
    });

    it('does not start a helper when no browser view is present', async () => {
        const host = new WebView2BrowserHost('profile');
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('returns focus only for visible views belonging to the requesting window', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockClear();
        await host.focusOwner(2);
        expect(mocks.request).not.toHaveBeenCalled();
        await host.focusOwner(1);
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith('focus-host', { viewId: '1:tab:1' });
        await view.setBounds(null);
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('ignores closed views and stopped helpers', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.running = false;
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
        mocks.running = true;
        await view.close();
        mocks.request.mockClear();
        await host.focusOwner(1);
        expect(mocks.request).not.toHaveBeenCalled();
    });

    it('surfaces native focus handoff failures', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockRejectedValueOnce(new Error('Native focus failed'));
        await expect(host.focusOwner(1)).rejects.toThrow('Native focus failed');
    });

    it('also releases native keyboard focus when the browser tabs back into the host', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 1, viewId: 'tab', sessionKey: 'workspace', url: 'https://example.test' }, sink);
        await view.setBounds(bounds);
        mocks.request.mockClear();
        mocks.onEvent({ event: 'focus-host', viewId: '1:tab:1' });
        expect(mocks.owner.focus).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledExactlyOnceWith('focus-host', { viewId: '1:tab:1' }));
    });
});

it.each([false, true])('preserves quoted session values and auth-cookie parts through WebView2 (with page: %s)', async withPage => {
    mocks.request.mockClear();
    const host = new WebView2BrowserHost('profile');
    const sink: BrowserEventSink = { state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(), openMenuRequested: vi.fn() };
    const target = withPage ? await host.create({ ownerId: 7, viewId: 'import', sessionKey: 'workspace', url: 'https://login.example.com' }, sink) : host;
    const { parseBrowserCookies } = await import('../src/browser-cookie-import');
    const cookies = parseBrowserCookies('original.example.com', JSON.stringify([
        { name: 'fixture_session', value: '"fixture\\segment"', httpOnly: true },
        { name: 'fixture_auth_0', value: 'fixture-part-0==%2F+/', httpOnly: true },
        { name: 'fixture_auth_1', value: 'fixture-part-1==', httpOnly: true },
    ]));
    mocks.request.mockClear();
    await target.importCookies!(cookies);
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(withPage ? 'import-cookies' : 'import-profile-cookies',
        { ...(withPage ? { viewId: '7:import:1' } : {}), cookies });
});

describe('WebView2 explicit history events', () => {
    const historySink: BrowserEventSink = { ...sink, state: vi.fn(), visited: vi.fn(), titleUpdated: vi.fn() };
    const state = { url: 'https://tab.test/', title: 'Tab', canGoBack: false, canGoForward: false, loading: false };

    beforeEach(() => {
        mocks.request.mockReset().mockResolvedValue(undefined);
        mocks.running = true;
        vi.mocked(historySink.visited!).mockClear();
        vi.mocked(historySink.titleUpdated!).mockClear();
        vi.mocked(historySink.state).mockClear();
    });

    it('records explicit final URLs while state replay, snapshots and placement do not record', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, historySink);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        view.snapshot();
        await view.setBounds(bounds);
        await view.setBounds(null);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        expect(historySink.visited).not.toHaveBeenCalled();
        expect(historySink.titleUpdated).not.toHaveBeenCalled();
        const url = 'http://127.0.0.1/Final?Case=Keep#fragment';
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url, title: 'Final' });
        mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url, title: 'New title' });
        expect(historySink.visited).toHaveBeenCalledExactlyOnceWith(url, 'Final');
        expect(historySink.titleUpdated).toHaveBeenCalledExactlyOnceWith(url, 'New title');
        expect(view.snapshot()).toMatchObject(state);
        await view.close();
    });

    it('keeps popup documents independent from tab navigation state', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, historySink);
        mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url: 'https://auth.test/login', title: 'Sign in' });
        mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url: 'https://auth.test/login', title: 'Signed in' });
        expect(historySink.visited).toHaveBeenCalledExactlyOnceWith('https://auth.test/login', 'Sign in');
        expect(historySink.titleUpdated).toHaveBeenCalledExactlyOnceWith('https://auth.test/login', 'Signed in');
        expect(view.snapshot()).toMatchObject(state);
        await view.close();
    });

    it('rejects malformed/non-HTTP events and callbacks for foreign or closed views', async () => {
        const host = new WebView2BrowserHost('profile');
        const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, historySink);
        for (const event of ['visited', 'title-updated']) {
            for (const fields of [
                { url: 'file:///tmp/preview.html', title: 'Preview' },
                { url: 'about:blank', title: 'Blank' },
                { url: 'javascript:alert(1)', title: 'Script' },
                { url: 'https://exa\nmple.test/', title: 'Invalid' },
                { url: 'https://example.test/', title: 1 },
                { url: 1, title: 'Invalid' },
                { url: 'https://example.test/' },
            ]) { mocks.onEvent({ event, viewId: '7:tab:1', ...fields }); }
            mocks.onEvent({ event, viewId: '8:tab:1', url: state.url, title: state.title });
        }
        await view.close();
        for (const event of ['visited', 'title-updated']) {
            mocks.onEvent({ event, viewId: '7:tab:1', url: state.url, title: state.title });
        }
        expect(historySink.visited).not.toHaveBeenCalled();
        expect(historySink.titleUpdated).not.toHaveBeenCalled();
    });

    it('routes events to their exact owner and rejects callbacks after same-tab recreation', async () => {
        const host = new WebView2BrowserHost('profile');
        const other: BrowserEventSink = { ...historySink, visited: vi.fn(), titleUpdated: vi.fn() };
        const first = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace-a', url: state.url }, historySink);
        const second = await host.create({ ownerId: 8, viewId: 'tab', sessionKey: 'workspace-b', url: state.url }, other);
        mocks.onEvent({ event: 'visited', viewId: '8:tab:2', url: 'https://other.test/', title: 'Other' });
        expect(other.visited).toHaveBeenCalledExactlyOnceWith('https://other.test/', 'Other');
        expect(historySink.visited).not.toHaveBeenCalled();
        await first.close();
        const replacement = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace-a', url: state.url }, historySink);
        mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url: state.url, title: state.title });
        mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url: state.url, title: state.title });
        expect(historySink.visited).not.toHaveBeenCalled();
        expect(historySink.titleUpdated).not.toHaveBeenCalled();
        mocks.onEvent({ event: 'visited', viewId: '7:tab:3', url: state.url, title: state.title });
        expect(historySink.visited).toHaveBeenCalledOnce();
        await replacement.close();
        await second.close();
    });

    it('persists sanitized visits and titles without resurrecting deletions from state or title events', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-webview2-history-'));
        const history = new BrowserHistoryStore(directory);
        const pending: Promise<unknown>[] = [];
        const persistentSink: BrowserEventSink = {
            ...historySink,
            visited: (url, title) => { pending.push(history.recordVisit('webview2', url, title)); },
            titleUpdated: (url, title) => { pending.push(history.updateTitle('webview2', url, title)); },
        };
        try {
            const host = new WebView2BrowserHost('profile');
            const view = await host.create({ ownerId: 7, viewId: 'tab', sessionKey: 'workspace', url: state.url }, persistentSink);
            const url = 'https://user:secret@final.test/Path?q=Case#Part';
            for (let visit = 0; visit < 2; visit++) { mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url, title: 'Final' }); }
            mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url, title: 'Updated' });
            await Promise.all(pending);
            const entries = (await history.query()).entries;
            expect(entries).toEqual([expect.objectContaining({ url: 'https://final.test/Path?q=Case#Part', title: 'Updated', visitCount: 2 })]);
            expect((await new BrowserHistoryStore(directory).query()).entries).toEqual(entries);
            await history.delete(entries[0].url);
            mocks.onEvent({ event: 'title-updated', viewId: '7:tab:1', url, title: 'Late title' });
            mocks.onEvent({ event: 'state', viewId: '7:tab:1', state });
            await Promise.all(pending);
            expect((await history.query()).entries).toEqual([]);
            mocks.onEvent({ event: 'visited', viewId: '7:tab:1', url, title: 'New visit' });
            await Promise.all(pending);
            expect((await history.query()).entries).toEqual([expect.objectContaining({ visitCount: 1, title: 'New visit' })]);
            await view.close();
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});
