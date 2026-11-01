import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronBrowserHost } from '../src/electron-browser-host';
import type { BrowserEventSink } from '../src/browser-host-contract';
import { BrowserHostManager } from '../src/browser-host-manager';
import { BrowserDemoTabCapture } from '../src/browser-demo-tab-capture';
import { BROWSER_VIEW_NEW_TAB_CHANNEL } from '../src/browser-view-policy';

const mocks = vi.hoisted(() => ({
    visible: false,
    deferAttach: false,
    attach: undefined as undefined | ((guest?: unknown) => void),
    expire: undefined as undefined | (() => void),
    beforeRequest: undefined as undefined | ((details: any, callback: any) => void),
    verifyProc: undefined as undefined | ((request: any, callback: (result: number) => void) => void),
    download: undefined as undefined | ((event: any, item: any, wc: any) => void),
    external: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn(),
    handlers: new Map<string, ((...args: any[]) => void)[]>(),
    owner: { id: 7, focus: vi.fn(), executeJavaScript: vi.fn().mockResolvedValue(true) },
    windowShow: vi.fn(),
    windowFocus: vi.fn(),
    profile: {
        getUserAgent: () => 'Electron/42', setUserAgent: vi.fn(),
        setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), on: vi.fn(),
        setCertificateVerifyProc: vi.fn((proc: any) => { mocks.verifyProc = proc; }),
        clearData: vi.fn().mockResolvedValue(undefined),
        clearAuthCache: vi.fn().mockResolvedValue(undefined),
        clearCodeCaches: vi.fn().mockResolvedValue(undefined),
        cookies: { set: vi.fn().mockResolvedValue(undefined), flushStore: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue([]) },
        flushStorageData: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
        fetch: vi.fn(),
    },
    contents: {
        focus: vi.fn(),
        id: 8, on: vi.fn(), once: vi.fn(), setWindowOpenHandler: vi.fn(),
        isDestroyed: () => false, loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        removeListener: vi.fn(),
        debugger: {
            on: vi.fn(), removeListener: vi.fn(), isAttached: vi.fn(() => false),
            attach: vi.fn(), detach: vi.fn(), sendCommand: vi.fn().mockResolvedValue({ value: 'fixture' }),
        },
        setZoomFactor: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        sendInputEvent: vi.fn(), insertText: vi.fn().mockResolvedValue(undefined), selectAll: vi.fn(),
        reload: vi.fn(), reloadIgnoringCache: vi.fn(),
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
        mocks.attach = guest => attach(guest ?? mocks.contents);
        if (!mocks.deferAttach) { attach(mocks.contents); }
        mocks.expire = expire;
        return { embed: 'webview', src, partition: 'token', adopt: vi.fn(), dispose: mocks.revoke };
    },
}));
vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => ({
        show: mocks.windowShow, focus: mocks.windowFocus,
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
    shell: { openExternal: mocks.external }, app: { getPath: () => '/native/Downloads' },
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
    mocks.profile.webRequest.onBeforeRequest.mockImplementation(callback => { mocks.beforeRequest = callback; });
    mocks.profile.on.mockImplementation((name, callback) => { if (name === 'will-download') mocks.download = callback; });
});

function emit(name: string, ...args: any[]) {
    for (const handler of mocks.handlers.get(name) ?? []) { handler({}, ...args); }
}

describe('Electron site information facts', () => {
    const sink: BrowserEventSink = { state() {}, newTab() {}, download() {}, closeRequested() {}, openMenuRequested() {} };
    const certificate = (subjectName: string) => ({ subjectName, issuerName: 'Fixture CA', validStart: 100, validExpiry: 200 });

    it('observes Chromium certificate verification without changing its result', async () => {
        const view = await new ElectronBrowserHost('profile').create({ ownerId: 7, viewId: 'cert', sessionKey: 'w', url: 'https://secure.test/' }, sink);
        try {
            const callback = vi.fn();
            mocks.verifyProc!({ hostname: 'secure.test', errorCode: 0, verificationResult: 'net::OK',
                certificate: certificate('leaf'), validatedCertificate: certificate('secure.test') }, callback);
            mocks.verifyProc!({ hostname: 'broken.test', errorCode: -202, verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
                certificate: certificate('broken.test'), validatedCertificate: certificate('broken.test') }, callback);
            expect(callback.mock.calls).toEqual([[-3], [-3]]);
            mocks.profile.cookies.get.mockResolvedValueOnce([{ name: 'sid', value: 'secret' }, { name: 'pref', value: 'x' }]);
            const facts = await view.siteFacts!('https://secure.test/page');
            expect(facts).toEqual({ rejectsInvalidCertificates: true, certificateError: false, cookieCount: 2,
                certificate: { subject: 'secure.test', issuer: 'Fixture CA', validStart: 100, validExpiry: 200 } });
            expect(JSON.stringify(facts)).not.toContain('secret');
            expect(mocks.profile.cookies.get).toHaveBeenCalledWith({ url: 'https://secure.test/page' });
            expect((await view.siteFacts!('https://broken.test/')).certificate).toBeUndefined();
            expect((await view.siteFacts!('http://secure.test/')).certificate).toBeUndefined();
            expect(await view.siteFacts!()).toEqual({ rejectsInvalidCertificates: true, certificateError: false });
        } finally {
            await view.close();
        }
    });

    it('flags only certificate failures of the current main-frame load and hides cookie read errors', async () => {
        const view = await new ElectronBrowserHost('profile').create({ ownerId: 7, viewId: 'fail', sessionKey: 'w', url: 'https://bad.test/' }, sink);
        try {
            emit('did-fail-load', -202, 'ERR_CERT_AUTHORITY_INVALID', 'https://bad.test/', true);
            expect((await view.siteFacts!()).certificateError).toBe(true);
            emit('did-start-loading');
            expect((await view.siteFacts!()).certificateError).toBe(false);
            emit('did-fail-load', -105, 'ERR_NAME_NOT_RESOLVED', 'https://bad.test/', true);
            expect((await view.siteFacts!()).certificateError).toBe(false);
            emit('did-fail-load', -201, 'ERR_CERT_DATE_INVALID', 'https://bad.test/frame', false);
            expect((await view.siteFacts!()).certificateError).toBe(false);
            mocks.profile.cookies.get.mockRejectedValueOnce(new Error('secret=value'));
            const facts = await view.siteFacts!('https://bad.test/');
            expect(facts.cookieCount).toBeUndefined();
            expect(JSON.stringify(facts)).not.toContain('secret');
        } finally {
            await view.close();
        }
    });
});

describe('Electron browser profile cleanup', () => {
    it('activates the owner before focusing the exact guest', async () => {
        const host = new ElectronBrowserHost('profile');
        const sink: BrowserEventSink = { state() {}, newTab() {}, download() {}, closeRequested() {}, openMenuRequested() {} };
        const view = await host.create({ ownerId: 7, viewId: 'focus', sessionKey: 'w', url: 'https://fixture.test/' }, sink);
        try {
            await view.focus();
            expect(mocks.windowShow).toHaveBeenCalledOnce();
            expect(mocks.windowFocus.mock.invocationCallOrder[0]).toBeLessThan(mocks.contents.focus.mock.invocationCallOrder[0]);
        } finally {
            await view.close();
        }
    });
    it('sends background input to the guest itself instead of CDP, and restores CDP input in the foreground', async () => {
        const host = new ElectronBrowserHost('profile');
        const sink: BrowserEventSink = { state() {}, newTab() {}, download() {}, closeRequested() {}, openMenuRequested() {} };
        const view = await host.create({ ownerId: 7, viewId: 'background', sessionKey: 'w', url: 'https://fixture.test/' }, sink);
        try {
            await view.setBackgroundControl!(true);
            mocks.contents.debugger.sendCommand.mockClear();
            await view.cdp!('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', text: 'a' });
            await view.cdp!('Input.insertText', { text: 'typed' });
            expect(mocks.contents.sendInputEvent.mock.calls).toEqual([
                [{ type: 'keyDown', keyCode: 'a', modifiers: [] }], [{ type: 'char', keyCode: 'a', modifiers: [] }],
            ]);
            expect(mocks.contents.insertText).toHaveBeenCalledExactlyOnceWith('typed');
            const sent = mocks.contents.debugger.sendCommand.mock.calls.map(([method]) => method);
            expect(sent.every(method => method === 'Runtime.evaluate')).toBe(true);
            await expect(view.cdp!('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 }, 'frame')).rejects.toThrow('foreground-required');
            expect(mocks.windowFocus).not.toHaveBeenCalled();
            expect(mocks.contents.focus).not.toHaveBeenCalled();

            await view.setBackgroundControl!(false);
            mocks.contents.sendInputEvent.mockClear();
            mocks.contents.debugger.sendCommand.mockClear();
            await view.cdp!('Input.insertText', { text: 'front' });
            expect(mocks.contents.sendInputEvent).not.toHaveBeenCalled();
            expect(mocks.contents.debugger.sendCommand).toHaveBeenCalledWith('Input.insertText', { text: 'front' });
        } finally {
            await view.close();
        }
    });

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
        closeRequested: vi.fn(), openMenuRequested: vi.fn(), focusAddressRequested: vi.fn(), reopenClosedRequested: vi.fn(),
        tabShortcut: vi.fn(),
        visited: vi.fn(), titleUpdated: vi.fn(), navigationStarted: vi.fn(),
        documentCommitted: vi.fn(), documentTitleUpdated: vi.fn(),
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

describe('Electron ClickOnce routing', () => {
    const url = 'https://fixture.test/App.application?value=a%2Fb+z&value=two';
    async function opened(enabled = true) {
        const sink: BrowserEventSink = {
            state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(), openMenuRequested: vi.fn(),
            application: vi.fn(), visited: vi.fn(),
        };
        const hosted = await new ElectronBrowserHost('profile').create({
            ownerId: 7, viewId: 'application', sessionKey: 'workspace', url: 'https://fixture.test/', clickOnceEnabled: enabled,
        }, sink);
        return { hosted, sink };
    }
    it('keeps default-off deployment links ordinary and never replays an unmanaged download', async () => {
        const h = await opened(false);
        const event = { preventDefault: vi.fn() };
        mocks.handlers.get('will-navigate')![0](event, url);
        expect(event.preventDefault).not.toHaveBeenCalled();
        mocks.contents.setWindowOpenHandler.mock.calls.at(-1)![0]({ url, disposition: 'foreground-tab' });
        expect(h.sink.newTab).toHaveBeenCalledWith(url);
        mocks.download!(event, { getURL: () => url, getURLChain: () => [url], getMimeType: () => 'application/x-ms-application' }, mocks.contents);
        expect(mocks.external).not.toHaveBeenCalled();
        expect(h.sink.download).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
        expect(h.sink.application).not.toHaveBeenCalled();
        await h.hosted.close();
    });
    it('intercepts direct navigation, programmatic navigation and window.open without creating tabs', async () => {
        const h = await opened();
        const event = { preventDefault: vi.fn() };
        mocks.handlers.get('will-navigate')![0](event, url);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(h.sink.application).toHaveBeenLastCalledWith({ kind: 'navigation', url }, expect.any(Function));
        await h.hosted.navigate(url);
        expect(mocks.contents.loadURL).not.toHaveBeenCalled();
        const decision = mocks.contents.setWindowOpenHandler.mock.calls.at(-1)![0]({ url, disposition: 'new-window' });
        expect(decision).toEqual({ action: 'deny' });
        expect(h.sink.application).toHaveBeenLastCalledWith({ kind: 'new-window', url }, expect.any(Function));
        expect(h.sink.newTab).not.toHaveBeenCalled();
        expect(mocks.external).not.toHaveBeenCalled();
        expect(h.sink.visited).not.toHaveBeenCalled();
        await h.hosted.close();
    });
    it('preserves original redirect and MIME download activation queries', async () => {
        const h = await opened();
        const original = 'https://fixture.test/deploy?value=original%2Fquery&value=two';
        emit('did-start-navigation', original, false, true);
        const event = { preventDefault: vi.fn() };
        mocks.handlers.get('will-redirect')![0](event, url, false, true);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(h.sink.application).toHaveBeenLastCalledWith({ kind: 'navigation', url: original, deploymentUrl: url }, expect.any(Function));
        mocks.download!(event, { getURL: () => 'https://fixture.test/artifact', getURLChain: () => [original, 'https://fixture.test/artifact'], getMimeType: () => 'application/x-ms-application' }, mocks.contents);
        expect(h.sink.application).toHaveBeenLastCalledWith({
            kind: 'download', url: original, deploymentUrl: 'https://fixture.test/artifact', mimeType: 'application/x-ms-application',
        }, expect.any(Function));
        expect(mocks.external).not.toHaveBeenCalled();
        await h.hosted.close();
    });
    it('rejects stale source callbacks after navigation, crash or close and ignores subframes', async () => {
        const h = await opened();
        const current = () => vi.mocked(h.sink.application!).mock.calls.at(-1)![1];
        const event = { preventDefault: vi.fn() };
        mocks.handlers.get('will-navigate')![0](event, url, false, false);
        expect(h.sink.application).not.toHaveBeenCalled();
        mocks.handlers.get('will-navigate')![0](event, url);
        const beforeNavigation = current();
        expect(beforeNavigation()).toBe(true);
        emit('did-start-navigation', 'https://fixture.test/other', false, true);
        expect(beforeNavigation()).toBe(false);
        mocks.handlers.get('will-navigate')![0](event, url);
        const beforeCrash = current();
        emit('render-process-gone', { reason: 'crashed' });
        expect(beforeCrash()).toBe(false);
        mocks.handlers.get('will-navigate')![0](event, url);
        const beforeClose = current();
        expect(beforeClose()).toBe(false);
        await h.hosted.close();
        expect(beforeClose()).toBe(false);
    });
    it('holds main-frame requests at the navigation gate and sends them only when allowed', async () => {
        const h = await opened(false);
        let decide!: (allow: boolean) => void;
        h.sink.navigationGate = vi.fn((_url: string) => new Promise<boolean>(resolve => { decide = resolve; }));
        const callback = vi.fn();
        const target = 'https://other.test/after-redirect';
        mocks.beforeRequest!({ webContentsId: mocks.contents.id, resourceType: 'mainFrame', url: target }, callback);
        expect(h.sink.navigationGate).toHaveBeenCalledWith(target, undefined);
        await Promise.resolve();
        expect(callback).not.toHaveBeenCalled();
        decide(true);
        await vi.waitFor(() => expect(callback).toHaveBeenLastCalledWith({ cancel: false }));
        callback.mockClear();
        mocks.beforeRequest!({ webContentsId: mocks.contents.id, resourceType: 'mainFrame', url: target }, callback);
        decide(false);
        await vi.waitFor(() => expect(callback).toHaveBeenLastCalledWith({ cancel: true }));
        // Synchronous answers (manual navigation) and subresources never wait.
        vi.mocked(h.sink.navigationGate!).mockReturnValue(true);
        mocks.beforeRequest!({ webContentsId: mocks.contents.id, resourceType: 'mainFrame', url: target }, callback);
        expect(callback).toHaveBeenLastCalledWith({ cancel: false });
        vi.mocked(h.sink.navigationGate!).mockClear();
        mocks.beforeRequest!({ webContentsId: mocks.contents.id, resourceType: 'subFrame', url: target }, callback);
        expect(h.sink.navigationGate).not.toHaveBeenCalled();
        await h.hosted.close();
    });

    it('handles initial main-frame requests but not foreign guests or ordinary downloads', async () => {
        const h = await opened();
        const callback = vi.fn();
        mocks.beforeRequest!({ webContentsId: mocks.contents.id, resourceType: 'mainFrame', url }, callback);
        expect(callback).toHaveBeenLastCalledWith({ cancel: true });
        mocks.beforeRequest!({ webContentsId: 999, resourceType: 'mainFrame', url }, callback);
        expect(callback).toHaveBeenLastCalledWith({ cancel: false });
        mocks.beforeRequest!({ webContentsId: mocks.contents.id, resourceType: 'subFrame', url }, callback);
        expect(callback).toHaveBeenLastCalledWith({ cancel: false });
        const ordinary = 'https://fixture.test/report.zip';
        mocks.download!({ preventDefault: vi.fn() }, { getURL: () => ordinary, getURLChain: () => [ordinary], getMimeType: () => 'application/zip' }, mocks.contents);
        expect(mocks.external).not.toHaveBeenCalled();
        expect(h.sink.download).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
        await h.hosted.close();
    });
});

describe('Electron browser CDP capability', () => {
    it('invalidates the copy identity only for a new main document, not subframes or same-document navigation', async () => {
        const { sink, hosted } = await view();
        emit('did-start-navigation', 'https://frame.test/', false, false);
        emit('did-start-navigation', 'https://example.test/#part', true, true);
        expect(sink.navigationStarted).not.toHaveBeenCalled();
        emit('did-start-navigation', 'https://example.test/', false, true);
        expect(sink.navigationStarted).toHaveBeenCalledOnce();
        await hosted.close();
    });
    it('uses only the adopted guest and detaches before closing it', async () => {
        const { hosted } = await view();
        await expect(hosted.cdp!('Runtime.evaluate', { expression: 'document.title' })).resolves.toEqual({ value: 'fixture' });
        expect(mocks.contents.debugger.sendCommand).toHaveBeenCalledWith('Runtime.evaluate', { expression: 'document.title' });
        mocks.contents.debugger.isAttached.mockReturnValueOnce(true);
        await hosted.close();
        expect(mocks.contents.debugger.detach).toHaveBeenCalledOnce();
        expect(mocks.contents.debugger.detach.mock.invocationCallOrder[0]).toBeLessThan(mocks.contents.close.mock.invocationCallOrder[0]);
        await expect(hosted.cdp!('Runtime.evaluate')).rejects.toThrow('closed');
    });

    it('rejects commands before guest attachment without acquiring a debugger', async () => {
        mocks.deferAttach = true;
        const { hosted } = await view();
        await expect(hosted.cdp!('Runtime.evaluate')).rejects.toThrow('not attached');
        expect(mocks.contents.debugger.attach).not.toHaveBeenCalled();
        await hosted.close();
    });
});

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

    it('reloads only its own focused visible guest, with Shift bypassing the cache', async () => {
        const { hosted, press } = await view();
        const { reload, reloadIgnoringCache } = mocks.contents;
        reload.mockClear(); reloadIgnoringCache.mockClear();
        // A hidden guest (another tab, pane or workspace) never claims the key.
        expect(press({ key: 'r' }).preventDefault).not.toHaveBeenCalled();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        expect(press({ key: 'R' }).preventDefault).toHaveBeenCalledOnce();
        expect(reload).toHaveBeenCalledOnce();
        expect(press({ key: 'r', isAutoRepeat: true }).preventDefault).toHaveBeenCalledOnce();
        expect(reload).toHaveBeenCalledOnce();
        expect(press({ key: 'R', shift: true }).preventDefault).toHaveBeenCalledOnce();
        expect(reloadIgnoringCache).toHaveBeenCalledOnce();
        for (const input of [{ alt: true }, { control: false, meta: false }, { type: 'keyUp' }]) {
            expect(press({ key: 'r', ...input }).preventDefault).not.toHaveBeenCalled();
        }
        await hosted.setBounds(null);
        expect(press({ key: 'r' }).preventDefault).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledOnce();
        expect(reloadIgnoringCache).toHaveBeenCalledOnce();
        await hosted.close();
    });

    it('forwards Ctrl/Cmd+1–9 and modifier holds only while enabled, visible and live', async () => {
        const { hosted, sink, press } = await view();
        const tabShortcut = vi.mocked(sink.tabShortcut!);
        const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
        const digit = (code: string, overrides: Record<string, unknown> = {}) => press({ key: code.slice(-1), code, ...overrides });
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        // Off by default: the page keeps its own Ctrl/Cmd+digits and modifier keys.
        expect(digit('Digit1').preventDefault).not.toHaveBeenCalled();
        press({ key: modifierKey });
        expect(tabShortcut).not.toHaveBeenCalled();

        await hosted.setTabShortcuts!(true);
        const focusCalls = mocks.owner.focus.mock.calls.length;
        expect(digit('Digit2').preventDefault).toHaveBeenCalledOnce();
        expect(tabShortcut).toHaveBeenLastCalledWith({ digit: 2 });
        // Host focus returns to the SPA so key-up reaches its document after the switch.
        expect(mocks.owner.focus.mock.calls.length).toBe(focusCalls + 1);
        // Repeats and key-up are swallowed without switching again.
        expect(digit('Digit2', { isAutoRepeat: true }).preventDefault).toHaveBeenCalledOnce();
        expect(digit('Digit2', { type: 'keyUp' }).preventDefault).toHaveBeenCalledOnce();
        expect(tabShortcut).toHaveBeenCalledTimes(1);
        // Shift, Alt/AltGr, Digit0, the numpad and the other platform's modifier stay with the page.
        for (const input of [
            { code: 'Digit3', shift: true }, { code: 'Digit3', alt: true }, { code: 'Digit0' }, { code: 'Numpad3' },
            { code: 'Digit3', control: false, meta: false },
            process.platform === 'darwin' ? { code: 'Digit3', control: true } : { code: 'Digit3', meta: true },
        ]) {
            expect(press({ key: '3', ...input }).preventDefault).not.toHaveBeenCalled();
        }
        expect(tabShortcut).toHaveBeenCalledTimes(1);

        // A hold reports once, never blocks the key, and another chord or release ends it.
        tabShortcut.mockClear();
        expect(press({ key: modifierKey }).preventDefault).not.toHaveBeenCalled();
        press({ key: modifierKey, isAutoRepeat: true });
        expect(tabShortcut.mock.calls).toEqual([[{ held: true }]]);
        press({ key: 'c', code: 'KeyC' });
        press({ key: modifierKey, type: 'keyUp' });
        expect(tabShortcut.mock.calls).toEqual([[{ held: true }], [{ held: false }]]);
        press({ key: modifierKey });
        press({ key: modifierKey, type: 'keyUp' });
        expect(tabShortcut.mock.calls.slice(2)).toEqual([[{ held: true }], [{ held: false }]]);

        // Disabling mid-hold releases the hint; hidden and disabled guests forward nothing.
        tabShortcut.mockClear();
        press({ key: modifierKey });
        await hosted.setTabShortcuts!(false);
        expect(tabShortcut.mock.calls).toEqual([[{ held: true }], [{ held: false }]]);
        expect(digit('Digit1').preventDefault).not.toHaveBeenCalled();
        await hosted.setTabShortcuts!(true);
        await hosted.setBounds(null);
        tabShortcut.mockClear();
        expect(digit('Digit1').preventDefault).not.toHaveBeenCalled();
        press({ key: modifierKey });
        expect(tabShortcut).not.toHaveBeenCalled();
        await hosted.close();
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

    it('forwards Shift+T once as a reopen request after returning owner focus', async () => {
        const { hosted, sink, press } = await view();
        expect(press({ key: 'T', shift: true }).preventDefault).not.toHaveBeenCalled();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        expect(press({ key: 'T', shift: true }).preventDefault).toHaveBeenCalledOnce();
        expect(sink.reopenClosedRequested).toHaveBeenCalledOnce();
        expect(mocks.owner.focus.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sink.reopenClosedRequested!).mock.invocationCallOrder[0]);
        expect(press({ key: 'T', shift: true, isAutoRepeat: true }).preventDefault).toHaveBeenCalledOnce();
        for (const input of [{ alt: true }, { control: false, meta: false }, { type: 'keyUp' }]) {
            expect(press({ key: 'T', shift: true, ...input }).preventDefault).not.toHaveBeenCalled();
        }
        expect(sink.reopenClosedRequested).toHaveBeenCalledOnce();
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        expect(sink.closeRequested).not.toHaveBeenCalled();
        await hosted.close();
        expect(press({ key: 'T', shift: true }).preventDefault).not.toHaveBeenCalled();
    });

    it('leaves Shift+T to the page when the sink cannot reopen tabs', async () => {
        const { hosted, sink, press } = await view();
        delete sink.reopenClosedRequested;
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        expect(press({ shift: true }).preventDefault).not.toHaveBeenCalled();
        expect(sink.openMenuRequested).not.toHaveBeenCalled();
        await hosted.close();
    });

    it('preserves modified chords, keyup and existing close behavior', async () => {
        const { hosted, sink, press } = await view();
        await hosted.setBounds({ x: 0, y: 0, width: 300, height: 200 });
        for (const input of [{ alt: true }, { control: false, meta: false }, { type: 'keyUp' }, { key: 'f' }]) {
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

it.each([false, true])('writes pair and JSON expiry in Unix seconds to Electron, retaining JSON sessions (with page: %s)', async withPage => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_123);
    try {
        const { parseBrowserCookies } = await import('../src/browser-cookie-import');
        const host = withPage ? (await view()).hosted : new ElectronBrowserHost('profile');
        mocks.contents.loadURL.mockClear();
        await host.importCookies!(parseBrowserCookies('original.example.com', 'fixture_pair=token'));
        await host.importCookies!(parseBrowserCookies('original.example.com', JSON.stringify([
            { name: 'fixture_persistent', value: 'token', expires: 1_800_003_600.5 },
            { name: 'fixture_session', value: 'token', session: true, expirationDate: 1_800_003_600 },
        ])));
        const written = mocks.profile.cookies.set.mock.calls.map(([cookie]) => cookie);
        expect(written).toHaveLength(3);
        expect(written[0]).toMatchObject({ name: 'fixture_pair', expirationDate: 1_802_592_000.123 });
        expect(written[1]).toMatchObject({ name: 'fixture_persistent', expirationDate: 1_800_003_600.5 });
        expect(written[2]).toMatchObject({ name: 'fixture_session' });
        expect(written[2]).not.toHaveProperty('expirationDate');
        expect(mocks.profile.cookies.flushStore).toHaveBeenCalledTimes(2);
        expect(mocks.contents.loadURL).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
});

describe('Electron successful history events', () => {
    it('keeps descendant lineage before guest attachment and captures only after its document is ready', async () => {
        const host = new ElectronBrowserHost('profile');
        const send = vi.fn();
        const manager = new BrowserHostManager({
            hosts: { electron: host, webview2: { engine: 'webview2', availability: vi.fn(), create: vi.fn(), clearData: vi.fn(), dispose: vi.fn() } },
            fileHost: { create: vi.fn(), dispose: vi.fn() },
            history: { recordVisit: async () => true, updateTitle: async () => true, flush: async () => {}, clearEngine: async () => true },
            getDefault: () => 'electron', saveDefault: () => {}, getPageZoom: () => 100, savePageZoom: () => {}, send, changed: () => {},
        });
        let queued: string[] = [];
        const command = mocks.contents.debugger.sendCommand;
        const respond = async (method: string, child = false) => {
            if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'demo-script' };
            if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
            if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 };
            if (method === 'Runtime.evaluate') {
                const items = child ? queued : [];
                if (child) queued = [];
                return { result: { value: { doc: 'fixture', items, dropped: 0 } } };
            }
            return {};
        };
        command.mockImplementation((method: string) => respond(method));
        const childCommand = vi.fn((method: string) => respond(method, true));
        const child = {
            ...mocks.contents, id: 9, getURL: () => 'https://child.test/',
            debugger: { ...mocks.contents.debugger, sendCommand: childCommand },
        };
        try {
            await manager.open(7, 'root', 'https://example.test/', 'workspace');
            const { id } = await manager.demos.start(7, { workspaceId: 'workspace', processId: 'demo-chat', routingRef: 'workspace' }, 'root');
            mocks.deferAttach = true;
            const rootHandler = mocks.contents.setWindowOpenHandler.mock.calls.at(-1)![0];
            rootHandler({ url: 'https://child.test/', disposition: 'background-tab' });
            const childId = send.mock.calls.filter(([, channel]) => channel === BROWSER_VIEW_NEW_TAB_CHANNEL).at(-1)![2].viewId;
            command.mockClear();
            await manager.open(7, childId, 'https://child.test/', 'workspace');
            expect(manager.demos.draft(7, id).tabs.find(tab => tab.viewId === childId)).toMatchObject({ openerViewId: 'root' });
            expect(manager.demos.recordingTab(7, childId)).toBe(true);
            expect(command).not.toHaveBeenCalled();
            const loading = vi.spyOn(child, 'isLoading').mockReturnValue(true);
            try {
                mocks.attach!(child);
                expect(await manager.adopt(7, childId, 9)).toEqual({ ok: true });
                expect(childCommand).not.toHaveBeenCalled();
                loading.mockReturnValue(false);
                await vi.waitFor(() => expect(childCommand.mock.calls.filter(([method]) => method === 'Page.addScriptToEvaluateOnNewDocument')).toHaveLength(1));
                await vi.waitFor(() => expect(childCommand.mock.calls.some(([method]) => method === 'Runtime.evaluate')).toBe(true));
                queued.push(JSON.stringify({ kind: 'click', role: 'button', label: 'Save', url: 'https://child.test/' }));
                await manager.demos.stop(7, id);
                const draft = manager.demos.draft(7, id);
                expect(draft.steps).toContainEqual(expect.objectContaining({ type: 'action', viewId: childId, action: expect.objectContaining({ kind: 'click', label: 'Save' }) }));
                expect(draft.incomplete).toBe(false);
            } finally { loading.mockRestore(); }
        } finally {
            await manager.dispose();
            command.mockReset().mockResolvedValue({ value: 'fixture' });
        }
    });

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
        expect(sink.documentCommitted).toHaveBeenCalledExactlyOnceWith('https://example.test/final', 'Fixture');
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
        mocks.handlers.get('did-create-window')![0]({ webContents: popup, once: vi.fn(), on: vi.fn(), isDestroyed: () => true });
        vi.mocked(sink.state).mockClear();
        handlers.get('did-start-navigation')!({}, 'https://popup.test/final', false, true);
        handlers.get('did-navigate')!({}, 'https://popup.test/final', 200);
        handlers.get('did-frame-finish-load')!({}, false);
        handlers.get('did-frame-finish-load')!({}, true);
        handlers.get('page-title-updated')!({}, 'Popup title');
        expect(sink.visited).toHaveBeenCalledExactlyOnceWith('https://popup.test/final', 'Popup', expect.stringMatching(/^browser-popout-/));
        expect(sink.titleUpdated).toHaveBeenCalledExactlyOnceWith('https://popup.test/final', 'Popup title');
        expect(sink.state).not.toHaveBeenCalled();
        expect(sink.documentCommitted).not.toHaveBeenCalled();
        expect(sink.documentTitleUpdated).not.toHaveBeenCalled();
        expect(sink.navigationStarted).not.toHaveBeenCalled();
        await hosted.close();
    });

    it('preserves actual popup navigation, focus and recursive opener lineage through the host manager', async () => {
        const start = vi.spyOn(BrowserDemoTabCapture.prototype, 'start').mockResolvedValue();
        const stop = vi.spyOn(BrowserDemoTabCapture.prototype, 'stop').mockResolvedValue();
        const host = new ElectronBrowserHost('profile');
        const send = vi.fn();
        const manager = new BrowserHostManager({
            hosts: { electron: host, webview2: { engine: 'webview2', availability: vi.fn(), create: vi.fn(), clearData: vi.fn(), dispose: vi.fn() } },
            fileHost: { create: vi.fn(), dispose: vi.fn() },
            history: { recordVisit: async () => true, updateTitle: async () => true, flush: async () => {}, clearEngine: async () => true },
            getDefault: () => 'electron', saveDefault: () => {}, getPageZoom: () => 100, savePageZoom: () => {}, send, changed: () => {},
        });
        const popup = (id: number, url: string) => {
            const events = new EventEmitter();
            const contents = { ...mocks.contents, id, getURL: () => url, getTitle: () => 'Popup',
                on: events.on.bind(events), once: events.once.bind(events), removeListener: events.removeListener.bind(events),
                setWindowOpenHandler: vi.fn() };
            let destroyed = false;
            const win = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => destroyed,
                destroy: () => { destroyed = true; win.emit('closed'); }, show: vi.fn(), focus: vi.fn() });
            return { events, contents, win };
        };
        try {
            manager.bindControlScope(7, 'workspace', 'workspace');
            await manager.open(7, 'tab', 'https://example.test/', 'workspace');
            const { id } = await manager.demos.start(7, { workspaceId: 'workspace', processId: 'demo-chat', routingRef: 'workspace' }, 'tab');
            const first = popup(90, 'https://popup.test/');
            mocks.handlers.get('did-create-window')![0](first.win);
            await Promise.resolve();
            let draft = manager.demos.draft(7, id);
            const firstId = draft.tabs.find(tab => tab.url === 'https://popup.test/')!.viewId;
            first.events.emit('did-navigate', {}, 'https://popup.test/final', 200);
            first.events.emit('did-frame-finish-load', {}, true);
            first.win.emit('focus');
            const second = popup(91, 'https://nested.test/');
            first.events.emit('did-create-window', second.win);
            await Promise.resolve();
            draft = manager.demos.draft(7, id);
            expect(draft.tabs.find(tab => tab.viewId === 'tab')!.url).toBe('https://example.test/');
            expect(draft.tabs.find(tab => tab.viewId === firstId)!.url).toBe('https://popup.test/final');
            expect(draft.tabs.find(tab => tab.url === 'https://nested.test/')!.openerViewId).toBe(firstId);
            expect(draft.steps).toContainEqual(expect.objectContaining({ type: 'switch', viewId: firstId }));
            const handler = first.contents.setWindowOpenHandler.mock.calls[0][0];
            expect(handler({ url: 'https://child.test/', disposition: 'background-tab' })).toEqual({ action: 'deny' });
            const request = send.mock.calls.filter(([, channel]) => channel === BROWSER_VIEW_NEW_TAB_CHANNEL).at(-1)![2];
            expect(request).toMatchObject({ openerViewId: 'tab', url: 'https://child.test/', viewId: expect.stringMatching(/^browser-/) });
            await manager.open(7, request.viewId, 'https://child.test/', 'workspace');
            await Promise.resolve();
            expect(manager.demos.draft(7, id).tabs.find(tab => tab.viewId === request.viewId)!.openerViewId).toBe(firstId);
        } finally {
            await manager.dispose();
            start.mockRestore();
            stop.mockRestore();
        }
    });
});

it('retains an owned Chromium download independently of its source tab and rejects unowned downloads', async () => {
    const update = vi.fn(); let handle: any;
    const store = { start: vi.fn((_name, _url, native) => { handle = native; return { id: 'managed', update }; }) };
    const host = new ElectronBrowserHost('profile', store as any);
    const sink: BrowserEventSink = { state() {}, newTab() {}, download: vi.fn(), closeRequested() {}, openMenuRequested() {} };
    const view = await host.create({ ownerId: 7, viewId: 'managed-source', sessionKey: 'workspace', url: 'https://files.test' }, sink);
    const item = Object.assign(new EventEmitter(), {
        getFilename: () => 'archive.zip', getURL: () => 'https://files.test/export?auth=secret', getURLChain: () => ['https://files.test/export'], getMimeType: () => 'application/zip',
        getState: () => 'progressing', getReceivedBytes: () => 4, getTotalBytes: () => 10,
        isPaused: () => false, canResume: () => false, setSaveDialogOptions: vi.fn(), getSavePath: () => '/native/selected',
        pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
    });
    const event = { preventDefault: vi.fn() };
    mocks.download!(event, item, mocks.contents);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.external).not.toHaveBeenCalled();
    expect(item.setSaveDialogOptions).toHaveBeenCalledOnce();
    view.close();
    item.emit('updated', {}, 'progressing'); item.emit('done', {}, 'completed');
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'completed' }), true, '/native/selected');
    expect(item.cancel).not.toHaveBeenCalled(); handle.dispose();
    mocks.download!(event, item, { id: 99999 });
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(store.start).toHaveBeenCalledOnce();
});

describe('Electron site icons', () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`;
    const lastState = (sink: BrowserEventSink) => vi.mocked(sink.state).mock.lastCall![0];

    it('loads the page-declared icon through the profile session and clears it on the next document', async () => {
        mocks.profile.fetch.mockResolvedValue(new Response(PNG, { status: 200 }));
        const { hosted, sink } = await view();
        emit('page-favicon-updated', ['javascript:alert(1)', 'https://user:pw@example.test/x.ico', 'https://example.test/favicon.ico']);
        await vi.waitFor(() => expect(lastState(sink).favicon).toBe(PNG_URL));
        expect(mocks.profile.fetch).toHaveBeenCalledExactlyOnceWith('https://example.test/favicon.ico', expect.objectContaining({ redirect: 'follow' }));
        expect(hosted.snapshot().favicon).toBe(PNG_URL);
        emit('did-navigate-in-page', 'https://example.test/#hash', true);
        expect(lastState(sink).favicon).toBe(PNG_URL);
        emit('did-navigate', 'https://other.test/', 200);
        expect(lastState(sink).favicon).toBeUndefined();
        expect(hosted.snapshot().favicon).toBeUndefined();
        await hosted.close();
    });

    it('drops a late icon from a superseded document and never publishes non-image bytes', async () => {
        let resolve!: (response: Response) => void;
        mocks.profile.fetch.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
        const { hosted, sink } = await view();
        emit('page-favicon-updated', ['https://old.test/favicon.ico']);
        emit('did-navigate', 'https://new.test/', 200);
        resolve(new Response(PNG, { status: 200 }));
        mocks.profile.fetch.mockResolvedValueOnce(new Response('<html><script>x</script>', { status: 200 }));
        emit('page-favicon-updated', ['https://new.test/favicon.ico']);
        await vi.waitFor(() => expect(mocks.profile.fetch).toHaveBeenCalledTimes(2));
        await new Promise(done => setTimeout(done, 0));
        expect(vi.mocked(sink.state).mock.calls.every(([state]) => state.favicon === undefined)).toBe(true);
        expect(mocks.profile.fetch.mock.calls[0][1].signal.aborted).toBe(true);
        await hosted.close();
    });

    it('hides the icon while the page shows a load error', async () => {
        mocks.profile.fetch.mockResolvedValue(new Response(PNG, { status: 200 }));
        const { hosted, sink } = await view();
        emit('page-favicon-updated', ['https://example.test/favicon.ico']);
        await vi.waitFor(() => expect(lastState(sink).favicon).toBe(PNG_URL));
        emit('did-fail-load', -105, 'NAME_NOT_RESOLVED', 'https://example.test/', true);
        expect(lastState(sink).favicon).toBeUndefined();
        await hosted.close();
    });
});
