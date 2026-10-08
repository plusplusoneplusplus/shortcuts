import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronBrowserHost } from '../src/electron-browser-host';
import type { BrowserEventSink } from '../src/browser-host-contract';

const mocks = vi.hoisted(() => ({
    visible: false,
    deferAttach: false,
    attach: undefined as undefined | (() => void),
    expire: undefined as undefined | (() => void),
    revoke: vi.fn(),
    handlers: new Map<string, (...args: any[]) => void>(),
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
        mocks.handlers.set(name, handler);
    });
});

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
    };
    const hosted = await new ElectronBrowserHost('profile').create({
        ownerId: 7, viewId: 'browser', sessionKey: 'remote:workspace', url: 'https://example.test/',
    }, sink);
    const press = (overrides: Record<string, unknown> = {}) => {
        const event = { preventDefault: vi.fn() };
        mocks.handlers.get('before-input-event')!(event, {
            type: 'keyDown', key: 't', control: process.platform !== 'darwin',
            meta: process.platform === 'darwin', ...overrides,
        });
        return event;
    };
    return { sink, hosted, press };
}

describe('Electron browser add-menu forwarding', () => {
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

it('imports auth cookies into the persistent profile even while showing a different domain', async () => {
    const { hosted } = await view();
    const { parseBrowserCookies } = await import('../src/browser-cookie-import');
    const cookies = parseBrowserCookies('original.example.com', 'session=token');
    await hosted.importCookies!(cookies);
    expect(mocks.profile.cookies.set).toHaveBeenCalledWith(cookies[0]);
    expect(mocks.profile.cookies.flushStore).toHaveBeenCalled();
});
