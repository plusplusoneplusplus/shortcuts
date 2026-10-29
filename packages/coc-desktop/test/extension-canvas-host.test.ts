import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    app: undefined as EventEmitter | undefined,
    owners: new Map<number, ReturnType<typeof makeOwner>>(),
    profiles: new Map<string, ReturnType<typeof makeProfile>>(),
    external: vi.fn().mockResolvedValue(undefined),
}));

function makeOwner(id: number) {
    const owner = Object.assign(new EventEmitter(), {
        id, getURL: vi.fn(() => 'https://spa.test/'),
        getType: () => 'window', isDestroyed: () => false,
    });
    const window = Object.assign(new EventEmitter(), { webContents: owner, isDestroyed: () => false });
    return { owner, window };
}

function makeProfile() {
    return Object.assign(new EventEmitter(), {
        setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
    });
}

vi.mock('electron', () => ({
    get app() { return mocks.app; },
    webContents: {
        getAllWebContents: () => [],
        fromId: (id: number) => mocks.owners.get(id)?.owner,
    },
    BrowserWindow: { fromWebContents: (owner: { id: number }) => mocks.owners.get(owner.id)?.window },
    session: {
        fromPartition: (partition: string) => {
            if (!mocks.profiles.has(partition)) mocks.profiles.set(partition, makeProfile());
            return mocks.profiles.get(partition);
        },
    },
    shell: { openExternal: mocks.external },
}));

async function harness() {
    const { ExtensionCanvasHost } = await import('../src/extension-canvas-host');
    const guard = await import('../src/browser-webview-guard');
    guard.installBrowserWebviewGuard();
    const first = makeOwner(1);
    const second = makeOwner(2);
    for (const item of [first, second]) {
        mocks.owners.set(item.owner.id, item);
        mocks.app!.emit('web-contents-created', {}, item.owner);
        guard.registerBrowserEmbedder(item.window as unknown as Electron.BrowserWindow, 'https://spa.test/');
    }
    const host = new ExtensionCanvasHost();
    hosts.push(host);
    let guestId = 10;
    function open(extensionKey = 'workspace:counter', ownerId = 1, url = 'http://127.0.0.1:8123/') {
        const sink = { state: vi.fn(), closed: vi.fn() };
        const handle = host.create({ ownerId, extensionKey, url }, sink);
        const owner = mocks.owners.get(ownerId)!.owner;
        const preferences: Electron.WebPreferences = { nodeIntegration: true, sandbox: false, preload: 'untrusted' };
        const event = { preventDefault: vi.fn() };
        owner.emit('will-attach-webview', event, preferences, {
            partition: handle.partition, src: handle.src, allowpopups: 'true',
        });
        expect(event.preventDefault).not.toHaveBeenCalled();
        const profile = [...mocks.profiles.values()].find(value => value === preferences.session)!;
        const guest = Object.assign(new EventEmitter(), {
            id: guestId++, hostWebContents: owner, session: profile,
            getType: () => 'webview', isDestroyed: vi.fn(() => false),
            getURL: () => url, close: vi.fn(), setWindowOpenHandler: vi.fn(),
        });
        mocks.app!.emit('web-contents-created', {}, guest);
        owner.emit('did-attach-webview', {}, guest);
        handle.adopt(guest.id);
        return { handle, sink, guest, profile, preferences, owner };
    }
    return { host, open, first, second };
}

const hosts: { dispose(): void }[] = [];
beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.app = new EventEmitter();
    mocks.owners.clear();
    mocks.profiles.clear();
    mocks.external.mockResolvedValue(undefined);
});
afterEach(() => { for (const host of hosts.splice(0)) host.dispose(); vi.useRealTimers(); });

describe('extension canvas guest boundary', () => {
    it('uses the real single-use owner guard and overwrites renderer privileges', async () => {
        const h = await harness();
        const opened = h.open();
        expect(opened.preferences).toMatchObject({
            sandbox: true, contextIsolation: true, nodeIntegration: false,
            nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
            webviewTag: false, webSecurity: true,
        });
        expect(opened.preferences).not.toHaveProperty('preload');
        expect(() => opened.handle.adopt(opened.guest.id)).toThrow('does not belong');
        const blocked = { preventDefault: vi.fn() };
        h.second.owner.emit('will-attach-webview', blocked, {}, {
            src: opened.handle.src, partition: opened.handle.partition,
        });
        expect(blocked.preventDefault).toHaveBeenCalledOnce();
        expect(opened.guest.eventNames()).not.toContain('before-input-event');
        expect(opened.guest.eventNames()).not.toContain('page-title-updated');
    });

    it('shares in-memory storage only within an extension key, not attachment tokens', async () => {
        const h = await harness();
        const a = h.open();
        const b = h.open('workspace:counter', 2);
        const c = h.open('other-workspace:counter');
        const d = h.open('global:counter');
        expect(a.profile).toBe(b.profile);
        expect(a.profile).not.toBe(c.profile);
        expect(a.profile).not.toBe(d.profile);
        expect(new Set([a.handle.partition, b.handle.partition, c.handle.partition, d.handle.partition]).size).toBe(4);
        expect([...mocks.profiles.keys()].every(key => !key.startsWith('persist:'))).toBe(true);
    });

    it('rejects invalid sources, keys, foreign windows and non-SPA documents', async () => {
        const h = await harness();
        const create = (url: string, extensionKey = 'workspace:counter', ownerId = 1) =>
            h.host.create({ url, extensionKey, ownerId }, { state: vi.fn(), closed: vi.fn() });
        for (const url of ['https://127.0.0.1:8123/', 'http://localhost:8123/', 'file:///index.html', 'http://example.test/']) {
            expect(() => create(url)).toThrow('Invalid canvas');
        }
        for (const key of ['', ' ', 'bad\nkey', 'a'.repeat(1025)]) {
            expect(() => create('http://127.0.0.1:8123/', key)).toThrow('Invalid canvas');
        }
        expect(() => create('http://127.0.0.1:8123/', 'counter', 100)).toThrow('unavailable');
        h.first.owner.getURL.mockReturnValue('https://spa.test/untrusted');
        expect(() => create('http://127.0.0.1:8123/')).toThrow('unavailable');
        expect(mocks.profiles.size).toBe(0);
    });

    it('allows only the original origin for navigation, redirects and network requests', async () => {
        const h = await harness();
        const a = h.open();
        const b = h.open('workspace:counter', 2, 'http://127.0.0.1:9123/');
        for (const eventName of ['will-navigate', 'will-redirect']) {
            for (const [url, allowed] of [
                ['http://127.0.0.1:8123/path#hash', true],
                ['http://127.0.0.1:9123/', false],
                ['https://example.test/', false],
                ['javascript:alert(1)', false],
            ] as const) {
                const event = { preventDefault: vi.fn() };
                a.guest.emit(eventName, event, url);
                expect(event.preventDefault.mock.calls.length).toBe(allowed ? 0 : 1);
            }
        }
        const before = a.profile.webRequest.onBeforeRequest.mock.calls[0][0];
        for (const [id, url, resourceType, cancel] of [
            [a.guest.id, a.handle.src, 'mainFrame', false],
            [a.guest.id, b.handle.src, 'mainFrame', true],
            [b.guest.id, b.handle.src, 'mainFrame', false],
            [999, a.handle.src, 'mainFrame', true],
            [a.guest.id, 'https://example.test/api', 'xhr', false],
        ] as const) {
            const callback = vi.fn();
            before({ webContentsId: id, url, resourceType }, callback);
            expect(callback).toHaveBeenCalledWith({ cancel });
        }
        expect(mocks.external.mock.calls.map(([url]) => url)).toEqual([
            'http://127.0.0.1:9123/', 'https://example.test/',
            'http://127.0.0.1:9123/', 'https://example.test/',
        ]);
    });

    it('denies popup windows and unsafe schemes, and surfaces external-open errors', async () => {
        const h = await harness();
        const a = h.open();
        const popup = a.guest.setWindowOpenHandler.mock.calls[0][0];
        expect(popup({ url: 'https://example.test/' })).toEqual({ action: 'deny' });
        expect(popup({ url: 'file:///private.html' })).toEqual({ action: 'deny' });
        expect(mocks.external).toHaveBeenCalledExactlyOnceWith('https://example.test/');
        mocks.external.mockRejectedValueOnce(new Error('external unavailable'));
        popup({ url: 'https://example.test/failure' });
        await Promise.resolve();
        expect(a.sink.state).toHaveBeenLastCalledWith({
            status: 'failed', error: 'Cannot open external link: external unavailable',
        });
    });

    it('denies permissions and downloads without browser-profile capabilities', async () => {
        const h = await harness();
        const a = h.open();
        const permission = vi.fn();
        a.profile.setPermissionRequestHandler.mock.calls[0][0]({}, 'camera', permission);
        expect(permission).toHaveBeenCalledWith(false);
        expect(a.profile.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
        const event = { preventDefault: vi.fn() };
        a.profile.emit('will-download', event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    it('keeps main-frame load and crash failures visible until a new navigation', async () => {
        const h = await harness();
        const a = h.open();
        a.guest.emit('did-start-loading');
        a.guest.emit('did-stop-loading');
        expect(a.sink.state.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'loaded']);
        a.guest.emit('did-fail-load', {}, -3, 'cancelled', a.handle.src, true);
        a.guest.emit('did-fail-load', {}, -2, 'subframe', a.handle.src, false);
        expect(a.sink.state).toHaveBeenCalledTimes(2);
        a.guest.emit('did-fail-load', {}, -102, 'Connection refused', a.handle.src, true);
        a.guest.emit('did-start-loading');
        a.guest.emit('did-stop-loading');
        expect(a.sink.state).toHaveBeenLastCalledWith({ status: 'failed', error: 'Connection refused' });
        a.guest.emit('did-start-navigation', {}, a.handle.src, false, true);
        a.guest.emit('did-stop-loading');
        expect(a.sink.state).toHaveBeenLastCalledWith({ status: 'loaded' });
        a.guest.emit('render-process-gone', {}, { reason: 'crashed' });
        a.guest.emit('did-stop-loading');
        expect(a.sink.state).toHaveBeenLastCalledWith({ status: 'failed', error: 'Canvas page crashed (crashed)' });
    });

    it('closes on owner reload/destruction and guest destruction, without affecting siblings', async () => {
        const h = await harness();
        const a = h.open();
        const b = h.open('workspace:counter', 2);
        a.owner.emit('did-start-navigation', {}, 'https://spa.test/#route', true, true);
        expect(a.guest.close).not.toHaveBeenCalled();
        a.owner.emit('did-start-navigation', {}, 'https://spa.test/', false, true);
        expect(a.guest.close).toHaveBeenCalledOnce();
        expect(a.sink.closed).toHaveBeenCalledOnce();
        expect(b.guest.close).not.toHaveBeenCalled();
        a.guest.emit('destroyed');
        expect(a.sink.closed).toHaveBeenCalledOnce();
        b.owner.emit('destroyed');
        expect(b.guest.close).toHaveBeenCalledOnce();
        expect(() => b.handle.adopt(b.guest.id)).toThrow('closed');
        const c = h.open('global:counter');
        c.guest.isDestroyed.mockReturnValue(true);
        c.guest.emit('destroyed');
        expect(c.sink.closed).toHaveBeenCalledOnce();
    });

    it('revokes expired and disposed tokens and drains all guests on shutdown', async () => {
        const h = await harness();
        const sink = { state: vi.fn(), closed: vi.fn() };
        const pending = h.host.create({ ownerId: 1, extensionKey: 'counter', url: 'http://127.0.0.1:8123/' }, sink);
        vi.advanceTimersByTime(30_000);
        expect(sink.closed).toHaveBeenCalledOnce();
        expect(() => pending.adopt(99)).toThrow('closed');
        const a = h.open();
        const b = h.open('global:counter', 2);
        a.handle.close();
        a.handle.close();
        h.host.dispose();
        h.host.dispose();
        expect(a.guest.close).toHaveBeenCalledOnce();
        expect(b.guest.close).toHaveBeenCalledOnce();
        expect(a.owner.listenerCount('did-start-navigation')).toBe(0);
        expect(b.owner.listenerCount('destroyed')).toBe(0);
        expect(a.profile.webRequest.onBeforeRequest).toHaveBeenLastCalledWith(null);
        expect(() => h.open()).toThrow('host is closed');
    });
});
