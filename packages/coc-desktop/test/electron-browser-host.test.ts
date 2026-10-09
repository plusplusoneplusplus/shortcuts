import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronBrowserHost } from '../src/electron-browser-host';
import type { BrowserEventSink } from '../src/browser-host-contract';

const mocks = vi.hoisted(() => ({
    visible: false,
    deferAttach: false,
    attach: undefined as undefined | (() => void),
    expire: undefined as undefined | (() => void),
    revoke: vi.fn(),
    handlers: new Map<string, ((...args: any[]) => void)[]>(),
    owner: { id: 7, focus: vi.fn() },
    profile: {
        getUserAgent: () => 'Electron/42', setUserAgent: vi.fn(),
        setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), on: vi.fn(),
        clearData: vi.fn().mockResolvedValue(undefined),
        clearAuthCache: vi.fn().mockResolvedValue(undefined),
        clearCodeCaches: vi.fn().mockResolvedValue(undefined),
        cookies: { set: vi.fn().mockResolvedValue(undefined), flushStore: vi.fn().mockResolvedValue(undefined) },
        flushStorageData: vi.fn(),
    },
    contents: {
        id: 8, on: vi.fn(), once: vi.fn(), setWindowOpenHandler: vi.fn(),
        isDestroyed: () => false, loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        setZoomFactor: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        getURL: () => 'https://example.test/', getTitle: () => 'Fixture', isLoading: () => false,
        navigationHistory: { canGoBack: () => true, canGoForward: () => false },
    },
}));
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }));
vi.mock('../src/browser-profile-lock', () => ({ lockElectronProfile: () => ({ close: vi.fn() }) }));
vi.mock('../src/browser-webview-guard', () => ({
    isBrowserEmbedder: () => true,
    hardenedBrowserPreferences: (session: unknown) => ({ session, sandbox: true }),
    authorizeBrowserWebview: (_owner: number, src: string, _profile: unknown, attach: (guest: unknown) => void, expire: () => void) => {
        mocks.attach = () => attach(mocks.contents);
        if (!mocks.deferAttach) { attach(mocks.contents); }
        mocks.expire = expire;
        return { embed: 'webview', src, partition: 'token', adopt: vi.fn(), dispose: mocks.revoke };
    },
}));
vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => ({
        webContents: mocks.owner, isDestroyed: () => false,
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    }) },
    WebContentsView: class {
        webContents = mocks.contents;
        setVisible(value: boolean) { mocks.visible = value; }
        getVisible() { return mocks.visible; }
        setBounds = vi.fn();
    },
    webContents: { fromId: () => mocks.owner },
    session: { fromPath: () => mocks.profile },
    shell: {},
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.deferAttach = false;
    mocks.contents.on.mockImplementation((name: string, handler: (...args: any[]) => void) => {
        const handlers = mocks.handlers.get(name) ?? [];
        handlers.push(handler);
        mocks.handlers.set(name, handlers);
    });
});

function emit(name: string, ...args: any[]) {
    for (const handler of mocks.handlers.get(name) ?? []) { handler({}, ...args); }
}

describe('Electron browser profile cleanup', () => {
    it('waits for all browsing data to clear before flushing the persistent profile', async () => {
        let finish!: () => void;
        mocks.profile.clearData.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const clearing = new ElectronBrowserHost('profile').clearData();
        expect(mocks.profile.clearData).toHaveBeenCalledWith();
        expect(mocks.profile.cookies.flushStore).not.toHaveBeenCalled();
        expect(mocks.profile.flushStorageData).not.toHaveBeenCalled();
        finish();
        await clearing;
        expect(mocks.profile.clearAuthCache).toHaveBeenCalledOnce();
        expect(mocks.profile.clearCodeCaches).toHaveBeenCalledWith({});
        expect(mocks.profile.cookies.flushStore).toHaveBeenCalledOnce();
        expect(mocks.profile.flushStorageData).toHaveBeenCalledOnce();
    });

    it('reports cleanup failures without flushing stale profile data', async () => {
        mocks.profile.clearData.mockRejectedValueOnce(new Error('Cleanup failed'));
        await expect(new ElectronBrowserHost('profile').clearData()).rejects.toThrow('Cleanup failed');
        expect(mocks.profile.cookies.flushStore).not.toHaveBeenCalled();
        expect(mocks.profile.flushStorageData).not.toHaveBeenCalled();
    });
});

async function view() {
    const sink: BrowserEventSink = {
        state: vi.fn(), newTab: vi.fn(), download: vi.fn(),
        closeRequested: vi.fn(), openMenuRequested: vi.fn(), focusAddressRequested: vi.fn(),
        visited: vi.fn(), titleUpdated: vi.fn(),
    };
    const hosted = await new ElectronBrowserHost('profile').create({
        ownerId: 7, viewId: 'browser', sessionKey: 'remote:workspace', url: 'https://example.test/',
    }, sink);
    const press = (overrides: Record<string, unknown> = {}) => {
        const event = { preventDefault: vi.fn() };
        mocks.handlers.get('before-input-event')![0](event, {
            type: 'keyDown', key: 't', control: process.platform !== 'darwin',
            meta: process.platform === 'darwin', ...overrides,
        });
        return event;
    };
    return { sink, hosted, press };
}

describe('Electron browser add-menu forwarding', () => {
    it('retains shared page zoom before attachment and reapplies it on navigation without touching the owner', async () => {
        mocks.deferAttach = true;
        const { hosted } = await view();
        await hosted.setPageZoom!(150);
        expect(mocks.contents.setZoomFactor).not.toHaveBeenCalled();
        mocks.attach!();
        expect(mocks.contents.setBackgroundThrottling).toHaveBeenCalledWith(false);
        expect(mocks.contents.setZoomFactor).toHaveBeenLastCalledWith(1.5);
        await hosted.setPageZoom!(175);
        for (const event of ['dom-ready', 'did-navigate', 'zoom-changed']) {
            mocks.contents.setZoomFactor.mockClear();
            emit(event);
            expect(mocks.contents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1.75);
        }
        await hosted.setPageZoom!(100);
        expect(mocks.contents.setZoomFactor).toHaveBeenLastCalledWith(1);
        await hosted.close();
    });

    it('does not allow per-tab keyboard zoom to diverge from the shared toolbar preference', async () => {
        const { hosted, press } = await view();
        for (const key of ['+', '=', '-', '_', '0']) expect(press({ key }).preventDefault).toHaveBeenCalledOnce();
        expect(press({ key: '=', control: false, meta: false }).preventDefault).not.toHaveBeenCalled();
        await hosted.close();
    });

    it('keeps hidden guests active for shared zoom without claiming their close shortcuts', async () => {
        const { hosted, sink, press } = await view();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        expect(press({ key: 'w' }).preventDefault).toHaveBeenCalledOnce();
        expect(sink.closeRequested).toHaveBeenCalledOnce();
        await hosted.setBounds(null);
        await hosted.setPageZoom!(150);
        expect(mocks.contents.setBackgroundThrottling).toHaveBeenCalledExactlyOnceWith(false);
        expect(mocks.contents.setZoomFactor).toHaveBeenLastCalledWith(1.5);
        expect(press({ key: 'w' }).preventDefault).not.toHaveBeenCalled();
        expect(sink.closeRequested).toHaveBeenCalledOnce();
        await hosted.close();
    });

    it('preserves visibility set on a pending handle before guest attachment and adoption', async () => {
        mocks.deferAttach = true;
        const { hosted, sink, press } = await view();
        await hosted.setBounds({ x: 10, y: 20, width: 300, height: 200 });
        mocks.attach!();
        expect(press().preventDefault).toHaveBeenCalledOnce();
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
        await hosted.setBounds(null);
        expect(press().preventDefault).not.toHaveBeenCalled();
        await hosted.close();
    });

    it('returns an unloaded pending handle and removes it when adoption expires', async () => {
        mocks.deferAttach = true;
        const sink: BrowserEventSink = {
            state: vi.fn(), newTab: vi.fn(), download: vi.fn(),
            closeRequested: vi.fn(), openMenuRequested: vi.fn(), closed: vi.fn(),
        };
        const hosted = await new ElectronBrowserHost('profile').create({
            ownerId: 7, viewId: 'pending', sessionKey: 'workspace', url: 'https://example.test/',
        }, sink);
        expect(hosted).toMatchObject({ embed: 'webview', src: 'https://example.test/', partition: 'token' });
        expect(mocks.contents.loadURL).not.toHaveBeenCalled();
        expect(() => hosted.navigate('https://other.test/')).toThrow('not attached');
        expect(hosted.snapshot().url).toBe('https://example.test/');
        mocks.expire!();
        expect(sink.closed).toHaveBeenCalledOnce();
        expect(mocks.revoke).toHaveBeenCalledOnce();
        await hosted.close();
        expect(mocks.revoke).toHaveBeenCalledOnce();
    });

    it('returns owner focus for the address shortcut, preserving other chords and hidden views', async () => {
        const { hosted, sink, press } = await view();
        expect(press({ key: 'l' }).preventDefault).not.toHaveBeenCalled();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        expect(press({ key: 'L' }).preventDefault).toHaveBeenCalledOnce();
        expect(sink.focusAddressRequested).toHaveBeenCalledOnce();
        expect(mocks.owner.focus.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sink.focusAddressRequested!).mock.invocationCallOrder[0]);
        expect(press({ key: 'l', isAutoRepeat: true }).preventDefault).toHaveBeenCalledOnce();
        for (const input of [{ shift: true }, { alt: true }, { control: false, meta: false }, { type: 'keyUp' }]) {
            expect(press({ key: 'l', ...input }).preventDefault).not.toHaveBeenCalled();
        }
        expect(sink.focusAddressRequested).toHaveBeenCalledOnce();
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        await hosted.close();
        expect(press({ key: 'l' }).preventDefault).not.toHaveBeenCalled();
    });

    it('claims only visible live views and returns focus before forwarding once', async () => {
        const { hosted, sink, press } = await view();
        expect(press().preventDefault).not.toHaveBeenCalled();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        expect(press().preventDefault).toHaveBeenCalledOnce();
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
        expect(mocks.owner.focus.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sink.openMenuRequested).mock.invocationCallOrder[0]);
        expect(press({ isAutoRepeat: true }).preventDefault).toHaveBeenCalledOnce();
        expect(sink.openMenuRequested).toHaveBeenCalledOnce();
        await hosted.close();
        expect(press().preventDefault).not.toHaveBeenCalled();
    });

    it('preserves modified chords, keyup and existing close behavior', async () => {
        const { hosted, sink, press } = await view();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        for (const input of [{ shift: true }, { alt: true }, { control: false, meta: false }, { type: 'keyUp' }, { key: 'f' }]) {
            expect(press(input).preventDefault).not.toHaveBeenCalled();
        }
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        expect(press({ key: 'w' }).preventDefault).toHaveBeenCalledOnce();
        expect(sink.closeRequested).toHaveBeenCalledOnce();
        await hosted.setBounds(null);
        expect(press().preventDefault).not.toHaveBeenCalled();
        await hosted.close();
    });
});

it.each([false, true])('preserves quoted session values and auth-cookie parts in the Electron profile (with page: %s)', async withPage => {
    const { parseBrowserCookies } = await import('../src/browser-cookie-import');
    const cookies = parseBrowserCookies('original.example.com', JSON.stringify([
        { name: 'fixture_session', value: '"fixture\\segment"', httpOnly: true },
        { name: 'fixture_auth_0', value: 'fixture-part-0==%2F+/', httpOnly: true },
        { name: 'fixture_auth_1', value: 'fixture-part-1==', httpOnly: true },
    ]));
    const host = withPage ? (await view()).hosted : new ElectronBrowserHost('profile');
    mocks.contents.loadURL.mockClear();
    await host.importCookies!(cookies);
    expect(mocks.profile.cookies.set.mock.calls.map(([cookie]) => cookie)).toEqual(cookies);
    expect(mocks.profile.cookies.flushStore).toHaveBeenCalledOnce();
    expect(mocks.contents.loadURL).not.toHaveBeenCalled();
});

describe('Electron successful history events', () => {
    it('records the final redirect URL once after main-frame completion, without snapshot replay', async () => {
        const { hosted, sink } = await view();
        emit('did-start-navigation', 'https://example.test/redirect', false, true);
        emit('did-redirect-navigation', 'https://example.test/final', false, true);
        emit('did-navigate', 'https://example.test/final', 200);
        emit('page-title-updated', 'Loading title');
        emit('did-frame-finish-load', false);
        expect(sink.visited).not.toHaveBeenCalled();
        emit('did-frame-finish-load', true);
        expect(sink.visited).toHaveBeenCalledExactlyOnceWith('https://example.test/final', 'Fixture');
        expect(sink.titleUpdated).not.toHaveBeenCalled();
        emit('did-frame-finish-load', true);
        emit('did-stop-loading');
        hosted.snapshot();
        await hosted.adopt!(8);
        expect(sink.visited).toHaveBeenCalledOnce();
        emit('page-title-updated', 'Final title');
        expect(sink.titleUpdated).toHaveBeenCalledExactlyOnceWith('https://example.test/final', 'Final title');
        await hosted.close();
    });

    it('counts reload, back/forward and committed main-page changes but ignores embedded frames', async () => {
        const { hosted, sink } = await view();
        for (const url of ['https://example.test/', 'https://example.test/', 'https://example.test/second', 'https://example.test/']) {
            emit('did-start-navigation', url, false, true);
            emit('did-navigate', url, 200);
            emit('did-frame-finish-load', true);
        }
        emit('did-start-navigation', 'https://frame.test/', false, false);
        emit('did-navigate-in-page', 'https://frame.test/#hash', false);
        emit('did-frame-finish-load', false);
        emit('did-start-navigation', 'https://example.test/#hash', true, true);
        emit('did-navigate-in-page', 'https://example.test/#hash', true);
        emit('did-stop-loading');
        emit('page-title-updated', 'Hash page');
        expect(sink.visited).toHaveBeenCalledTimes(5);
        expect(sink.visited).toHaveBeenLastCalledWith('https://example.test/#hash', 'Fixture');
        expect(sink.titleUpdated).toHaveBeenCalledWith('https://example.test/#hash', 'Hash page');
        await hosted.close();
    });

    it('records the final same-document URL once when it changes during the initial load', async () => {
        const { hosted, sink } = await view();
        emit('did-navigate', 'https://example.test/', 200);
        emit('did-navigate-in-page', 'https://example.test/#initial', true);
        expect(sink.visited).not.toHaveBeenCalled();
        emit('did-frame-finish-load', true);
        expect(sink.visited).toHaveBeenCalledExactlyOnceWith('https://example.test/#initial', 'Fixture');
        await hosted.close();
    });

    it.each(['did-fail-load', 'did-fail-provisional-load'])('excludes failed/cancelled loads reported by %s', async event => {
        const { hosted, sink } = await view();
        for (const code of [-105, -3]) {
            emit('did-start-navigation', 'https://failed.test/', false, true);
            emit('did-navigate', 'https://failed.test/', 200);
            emit(event, code, 'Failed', 'https://failed.test/', true);
            emit('did-frame-finish-load', true);
            emit('did-stop-loading');
            emit('page-title-updated', 'Error page');
            emit('did-navigate-in-page', 'https://failed.test/#error', true);
        }
        expect(sink.visited).not.toHaveBeenCalled();
        expect(sink.titleUpdated).not.toHaveBeenCalled();
        // A failed embedded resource cannot cancel the successful main page.
        emit('did-navigate', 'https://example.test/', 200);
        emit(event, -105, 'Failed', 'https://frame.test/', false);
        emit('did-frame-finish-load', true);
        expect(sink.visited).toHaveBeenCalledOnce();
        await hosted.close();
    });

    it('ignores error documents, crashes, closed guests and stale aborted navigations', async () => {
        const { hosted, sink } = await view();
        for (const url of ['about:blank', 'file:///preview.html', 'https://error.test/']) {
            emit('did-navigate', url, -1);
            emit('did-frame-finish-load', true);
        }
        emit('did-navigate', 'https://crashed.test/', 200);
        emit('render-process-gone', { reason: 'crashed' });
        emit('did-frame-finish-load', true);
        expect(sink.visited).not.toHaveBeenCalled();
        emit('did-navigate', 'https://new.test/', 200);
        emit('did-fail-provisional-load', -3, 'Aborted', 'https://old.test/', true);
        emit('did-frame-finish-load', true);
        expect(sink.visited).toHaveBeenCalledExactlyOnceWith('https://new.test/', 'Fixture');
        await hosted.close();
        emit('did-navigate', 'https://closed.test/', 200);
        emit('did-frame-finish-load', true);
        emit('page-title-updated', 'Closed');
        expect(sink.visited).toHaveBeenCalledOnce();
        expect(sink.titleUpdated).not.toHaveBeenCalled();
    });

    it('records popup main pages independently without recording embedded frames or changing the tab state', async () => {
        const { hosted, sink } = await view();
        const handlers = new Map<string, (...args: any[]) => void>();
        const popup = {
            ...mocks.contents, id: 90, getTitle: () => 'Popup',
            on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler),
        };
        mocks.handlers.get('did-create-window')![0]({ webContents: popup, once: vi.fn(), isDestroyed: () => true });
        vi.mocked(sink.state).mockClear();
        handlers.get('did-navigate')!({}, 'https://popup.test/final', 200);
        handlers.get('did-frame-finish-load')!({}, false);
        handlers.get('did-frame-finish-load')!({}, true);
        handlers.get('page-title-updated')!({}, 'Popup title');
        expect(sink.visited).toHaveBeenCalledExactlyOnceWith('https://popup.test/final', 'Popup');
        expect(sink.titleUpdated).toHaveBeenCalledExactlyOnceWith('https://popup.test/final', 'Popup title');
        expect(sink.state).not.toHaveBeenCalled();
        await hosted.close();
    });
});
