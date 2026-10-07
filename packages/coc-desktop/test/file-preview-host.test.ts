import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronFilePreviewHost, HTML_PAGE_PARTITION } from '../src/file-preview-host';
import { htmlPageFileUrl } from '../src/html-page-policy';

const mocks = vi.hoisted(() => ({
    owner: { id: 1 },
    profile: {},
    trusted: true,
    guest: undefined as any,
    attach: undefined as undefined | ((guest: any) => void),
    expire: undefined as undefined | (() => void),
    authorize: vi.fn(),
    adopt: vi.fn(),
    revoke: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
    fromPartition: vi.fn(),
}));
vi.mock('electron', () => ({
    BrowserWindow: { fromWebContents: () => ({ webContents: mocks.owner, isDestroyed: () => false }) },
    webContents: { fromId: () => mocks.owner },
    session: { fromPartition: mocks.fromPartition },
    shell: { openExternal: mocks.openExternal },
}));
vi.mock('../src/browser-webview-guard', () => ({
    isBrowserEmbedder: () => mocks.trusted,
    authorizeBrowserWebview: mocks.authorize,
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.trusted = true;
    mocks.fromPartition.mockReturnValue(mocks.profile);
    mocks.authorize.mockImplementation((_owner, src, _profile, attach, expire) => {
        mocks.attach = attach;
        mocks.expire = expire;
        return { embed: 'webview', src, partition: 'file-token', adopt: mocks.adopt, dispose: mocks.revoke };
    });
    mocks.guest = Object.assign(new EventEmitter(), {
        id: 2, isDestroyed: vi.fn(() => false),
        getURL: vi.fn(() => htmlPageFileUrl(path.resolve('preview/index.html'))),
        getTitle: () => 'Preview', isLoading: () => false,
        navigationHistory: { canGoBack: () => true, canGoForward: () => false, goBack: vi.fn() },
        setWindowOpenHandler: vi.fn(), loadURL: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn(), stop: vi.fn(), focus: vi.fn(), close: vi.fn(),
    });
});

async function create() {
    const host = new ElectronFilePreviewHost();
    const sink = {
        state: vi.fn(), newTab: vi.fn(), download: vi.fn(), closeRequested: vi.fn(),
        openMenuRequested: vi.fn(), closed: vi.fn(),
    };
    const request = { ownerId: 1, viewId: 'html-page:one', path: path.resolve('preview/index.html'), sessionKey: 'workspace' };
    const view = await host.create(request, sink);
    return { host, sink, request, view };
}

describe('renderer-owned file previews', () => {
    it('authorizes an exact file in the isolated in-memory session and preserves pending visibility', async () => {
        const { request, view, sink } = await create();
        expect(mocks.fromPartition).toHaveBeenCalledWith(HTML_PAGE_PARTITION);
        expect(mocks.authorize).toHaveBeenCalledWith(1, htmlPageFileUrl(request.path), mocks.profile, expect.any(Function), expect.any(Function), request.path);
        expect(view).toMatchObject({ embed: 'webview', src: htmlPageFileUrl(request.path), partition: 'file-token' });
        expect(view.snapshot()).toMatchObject({ sourceKind: 'file', url: htmlPageFileUrl(request.path), canGoBack: false });
        expect(mocks.guest.loadURL).not.toHaveBeenCalled();
        await view.setBounds({ x: 0, y: 0, width: 200, height: 100 });
        mocks.attach!(mocks.guest);
        expect(mocks.guest.listenerCount('will-navigate')).toBe(1);
        expect(mocks.guest.setWindowOpenHandler).toHaveBeenCalledOnce();
        await view.focus();
        expect(mocks.guest.focus).toHaveBeenCalledOnce();
        await view.adopt!(2);
        expect(mocks.adopt).toHaveBeenCalledWith(2);
        expect(sink.state).toHaveBeenCalledWith(expect.objectContaining({ title: 'Preview', sourceKind: 'file' }));
        await view.setBounds(null);
        await view.focus();
        expect(mocks.guest.focus).toHaveBeenCalledOnce();
        await view.close();
        expect(mocks.revoke).toHaveBeenCalledOnce();
        expect(mocks.guest.close).toHaveBeenCalledOnce();
    });

    it('wires sibling-file navigation, external links and denied popups before adoption', async () => {
        await create();
        mocks.attach!(mocks.guest);
        const navigate = (url: string) => {
            const event = { preventDefault: vi.fn() };
            mocks.guest.emit('will-navigate', event, url);
            return event;
        };
        expect(navigate(htmlPageFileUrl(path.resolve('preview/sibling.html'))).preventDefault).not.toHaveBeenCalled();
        expect(navigate(htmlPageFileUrl(path.resolve('outside.html'))).preventDefault).toHaveBeenCalledOnce();
        expect(navigate('https://example.test/').preventDefault).toHaveBeenCalledOnce();
        expect(mocks.openExternal).toHaveBeenCalledWith('https://example.test/');
        const popup = mocks.guest.setWindowOpenHandler.mock.calls[0][0];
        expect(popup({ url: 'https://example.test/popup' })).toEqual({ action: 'deny' });
        expect(popup({ url: 'file:///blocked.html' })).toEqual({ action: 'deny' });
        expect(mocks.openExternal).toHaveBeenCalledTimes(2);
    });

    it('reports pre-adoption load failures and guest destruction, and expires abandoned handles', async () => {
        const { sink } = await create();
        mocks.attach!(mocks.guest);
        mocks.guest.emit('did-fail-load', {}, -6, 'FILE_NOT_FOUND', '', true);
        expect(sink.state).toHaveBeenLastCalledWith(expect.objectContaining({ error: 'FILE_NOT_FOUND', errorCode: 'navigation-failed' }));
        mocks.guest.isDestroyed.mockReturnValue(true);
        mocks.guest.emit('destroyed');
        expect(sink.closed).toHaveBeenCalledOnce();
        expect(mocks.revoke).toHaveBeenCalledOnce();
        const pending = await create();
        mocks.expire!();
        expect(pending.sink.closed).toHaveBeenCalledOnce();
        expect(mocks.revoke).toHaveBeenCalledTimes(2);
    });

    it('rejects unregistered embedder windows', async () => {
        mocks.trusted = false;
        await expect(create()).rejects.toThrow('Preview window is closed');
        expect(mocks.authorize).not.toHaveBeenCalled();
    });
});
