import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElectronFilePreviewHost, HTML_PAGE_PARTITION } from '../src/file-preview-host';
import { htmlPageFileUrl } from '../src/html-page-policy';

const mocks = vi.hoisted(() => ({
    owner: undefined as any,
    owners: new Map<number, any>(),
    profile: undefined as any,
    saveDialog: vi.fn(),
    manage: vi.fn(),
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
    app: { getPath: () => path.resolve('desktop-downloads') },
    dialog: { showSaveDialogSync: mocks.saveDialog },
    BrowserWindow: { fromWebContents: (owner: any) => ({ webContents: owner, isDestroyed: () => false, isFocused: owner.isFocused }) },
    webContents: { fromId: (id: number) => mocks.owners.get(id) },
    session: { fromPartition: mocks.fromPartition },
    shell: { openExternal: mocks.openExternal },
}));
vi.mock('../src/electron-downloads', () => ({ manageElectronDownload: mocks.manage }));
vi.mock('../src/browser-webview-guard', () => ({
    isBrowserEmbedder: () => mocks.trusted,
    authorizeBrowserWebview: mocks.authorize,
}));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.trusted = true;
    mocks.profile = new EventEmitter();
    mocks.owner = makeOwner(1);
    mocks.owners.clear();
    mocks.owners.set(1, mocks.owner);
    mocks.fromPartition.mockReturnValue(mocks.profile);
    mocks.authorize.mockImplementation((_owner, src, _profile, attach, expire) => {
        mocks.attach = attach;
        mocks.expire = expire;
        return { embed: 'webview', src, partition: 'file-token', adopt: mocks.adopt, dispose: mocks.revoke };
    });
    mocks.guest = makeGuest(mocks.owner);
});

function makeOwner(id: number) {
    return Object.assign(new EventEmitter(), { id, isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => true) });
}
function makeGuest(owner: any, id = 2) {
    return Object.assign(new EventEmitter(), {
        id, isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => true), hostWebContents: owner,
        getURL: vi.fn(() => htmlPageFileUrl(path.resolve('preview/index.html'))),
        getTitle: () => 'Preview', isLoading: () => false,
        navigationHistory: { canGoBack: () => true, canGoForward: () => false, goBack: vi.fn() },
        setWindowOpenHandler: vi.fn(), loadURL: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn(), stop: vi.fn(), focus: vi.fn(), close: vi.fn(),
    });
}

async function create(downloads?: any) {
    const host = new ElectronFilePreviewHost(downloads);
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

describe('HTML preview native reload shortcut', () => {
    it.each(['linux', 'win32', 'darwin'])('reloads only its own focused visible preview on %s', async platform => {
        vi.stubGlobal('process', { ...process, platform });
        try {
            const { view } = await create();
            mocks.attach!(mocks.guest);
            mocks.guest.reload.mockClear();
            const press = (patch = {}) => {
                const event = { preventDefault: vi.fn() };
                mocks.guest.emit('before-input-event', event, {
                    key: 'r', control: platform !== 'darwin', meta: platform === 'darwin',
                    alt: false, shift: false, type: 'keyDown', isAutoRepeat: false, ...patch,
                });
                return event;
            };
            // The app menu binds no reload key; a hidden preview swallows it without reloading.
            expect(press().preventDefault).toHaveBeenCalledOnce();
            expect(mocks.guest.reload).not.toHaveBeenCalled();
            await view.setBounds({ x: 0, y: 0, width: 200, height: 100 });
            expect(press({ key: 'R' }).preventDefault).toHaveBeenCalledOnce();
            expect(mocks.guest.reload).toHaveBeenCalledOnce();
            press({ isAutoRepeat: true });
            press({ type: 'keyUp' });
            expect(mocks.guest.reload).toHaveBeenCalledOnce();
            for (const patch of [{ alt: true }, { control: false, meta: false }]) {
                expect(press(patch).preventDefault).not.toHaveBeenCalled();
            }
            await view.close();
            press();
            expect(mocks.guest.reload).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('HTML preview native close shortcut', () => {
    it.each(['linux', 'win32', 'darwin'])('routes %s native input to its tab, never directly closes a window', async platform => {
        vi.stubGlobal('process', { ...process, platform });
        try {
            const { view, sink } = await create();
            mocks.attach!(mocks.guest);
            const press = (patch = {}) => {
                const event = { preventDefault: vi.fn() };
                mocks.guest.emit('before-input-event', event, {
                    key: 'w', control: platform !== 'darwin', meta: platform === 'darwin',
                    alt: false, type: 'keyDown', isAutoRepeat: false, ...patch,
                });
                return event;
            };
            // Hidden/no-longer-active guests consume the native shortcut without routing a close.
            expect(press().preventDefault).toHaveBeenCalledOnce();
            expect(sink.closeRequested).not.toHaveBeenCalled();
            await view.setBounds({ x: 0, y: 0, width: 200, height: 100 });
            expect(press().preventDefault).toHaveBeenCalledOnce();
            expect(sink.closeRequested).toHaveBeenCalledOnce();
            expect(press({ isAutoRepeat: true }).preventDefault).toHaveBeenCalledOnce();
            expect(press({ type: 'keyUp' }).preventDefault).toHaveBeenCalledOnce();
            expect(sink.closeRequested).toHaveBeenCalledOnce();
            for (const patch of [{ alt: true }, { control: false, meta: false }, { key: 'q' }]) {
                expect(press(patch).preventDefault).not.toHaveBeenCalled();
            }
            expect(mocks.guest.close).not.toHaveBeenCalled();
            await view.close();
            press();
            expect(sink.closeRequested).toHaveBeenCalledOnce();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

const bounds = { x: 0, y: 0, width: 200, height: 100 };
function click(guest = mocks.guest) {
    guest.emit('before-mouse-event', {}, { type: 'mouseDown', button: 'left' });
    guest.emit('before-mouse-event', {}, { type: 'mouseUp', button: 'left' });
}
function key(patch = {}, guest = mocks.guest) {
    guest.emit('before-input-event', {}, {
        key: 'Enter', type: 'keyDown', isAutoRepeat: false, control: false, meta: false, alt: false, ...patch,
    });
}
async function downloadable(downloads?: any) {
    const result = await create(downloads);
    await result.view.setBounds(bounds);
    mocks.attach!(mocks.guest);
    mocks.guest.emit('did-navigate', {}, htmlPageFileUrl(result.request.path));
    return { ...result, guest: mocks.guest, owner: mocks.owner };
}

describe('HTML preview owner-bound native download admission', () => {
    it('rejects input before a document commits and while the preview is hidden', async () => {
        const { host, view, request } = await create();
        await view.setBounds(bounds);
        mocks.attach!(mocks.guest);
        click();
        expect(host.requestDownload(mocks.guest, 'data:,')).toBeUndefined();
        mocks.guest.emit('did-navigate', {}, htmlPageFileUrl(request.path));
        expect(host.requestDownload(mocks.guest, 'data:,')).toBeUndefined();
        await view.setBounds(null);
        click();
        key();
        await view.setBounds(bounds);
        expect(host.requestDownload(mocks.guest, 'data:,')).toBeUndefined();
        click();
        expect(host.requestDownload(mocks.guest, 'data:,')!.approve()).toBe(true);
        await host.dispose();
    });

    it('requires native input in a committed document and consumes it once', async () => {
        const { host, guest } = await downloadable();
        expect(host.requestDownload(guest, 'data:,private')).toBeUndefined();
        guest.emit('ipc-message', {}, 'user-gesture', true);
        guest.emit('console-message', {}, 'click');
        expect(host.requestDownload(guest, 'data:,private')).toBeUndefined();
        click();
        const pending = host.requestDownload(guest, 'blob:null/id')!;
        expect(pending).toBeDefined();
        expect(host.requestDownload(guest, 'data:,second')).toBeUndefined();
        click();
        expect(pending.approve()).toBe(true);
        expect(pending.approve()).toBe(false);
        expect(host.requestDownload(guest, 'data:,second')).toBeUndefined();
        await host.dispose();
        expect(pending.signal.aborted).toBe(false);
    });

    it.each([{ key: 'Enter', type: 'keyDown' }, { key: ' ', type: 'keyUp' }])('admits keyboard activation %j', async input => {
        const { host, guest } = await downloadable();
        key(input);
        expect(host.requestDownload(guest, 'data:,')!.approve()).toBe(true);
        await host.dispose();
    });

    it.each([
        { key: 'Tab' }, { key: 'a' }, { key: ' ', type: 'keyDown' }, { type: 'keyUp' },
        { control: true }, { meta: true }, { alt: true }, { isAutoRepeat: true },
    ])('ignores non-activation input %j', async input => {
        const { host, guest } = await downloadable();
        key(input);
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        await host.dispose();
    });

    it('ignores right clicks, unpaired releases, cancelled input and unfocused guests', async () => {
        const { host, guest } = await downloadable();
        guest.emit('before-mouse-event', {}, { type: 'mouseUp', button: 'left' });
        guest.emit('before-mouse-event', {}, { type: 'mouseDown', button: 'right' });
        guest.emit('before-mouse-event', {}, { type: 'mouseUp', button: 'right' });
        guest.emit('before-input-event', { defaultPrevented: true }, { key: 'Enter', type: 'keyDown' });
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        mocks.owner.isFocused.mockReturnValue(false);
        click();
        key();
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        mocks.owner.isFocused.mockReturnValue(true);
        guest.isFocused.mockReturnValue(false);
        click();
        key();
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        await host.dispose();
    });

    it.each(['hide', 'reload', 'navigate', 'crash', 'load-failed', 'close', 'guest-destroyed', 'owner-destroyed', 'owner-navigate'])
    ('revokes pending approval on %s and rejects late approval', async action => {
        const { host, view, guest, owner } = await downloadable();
        click();
        const pending = host.requestDownload(guest, 'data:,')!;
        if (action === 'hide') { await view.setBounds(null); await view.setBounds(bounds); }
        if (action === 'reload') await view.nav('reload');
        if (action === 'navigate') guest.emit('did-start-navigation', { url: htmlPageFileUrl(path.resolve('preview/other.html')), isMainFrame: true, isSameDocument: false });
        if (action === 'crash') guest.emit('render-process-gone', {}, { reason: 'crashed' });
        if (action === 'load-failed') guest.emit('did-fail-load', {}, -6, 'unavailable', '', true);
        if (action === 'close') await view.close();
        if (action === 'guest-destroyed') guest.emit('destroyed');
        if (action === 'owner-destroyed') owner.emit('destroyed');
        if (action === 'owner-navigate') owner.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
        expect(pending.signal.aborted).toBe(true);
        expect(pending.approve()).toBe(false);
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        await host.dispose();
        expect(owner.listenerCount('destroyed')).toBe(0);
        expect(owner.listenerCount('did-start-navigation')).toBe(0);
    });

    it('requires fresh input after reload and discards old document approval', async () => {
        const { host, view, guest, request } = await downloadable();
        click();
        const old = host.requestDownload(guest, 'data:,old')!;
        await view.nav('reload');
        click();
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        guest.emit('did-navigate', {}, htmlPageFileUrl(request.path));
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        click();
        const fresh = host.requestDownload(guest, 'data:,new')!;
        expect(old.approve()).toBe(false);
        expect(fresh.approve()).toBe(true);
        await host.dispose();
    });

    it('recovers a stopped navigation with fresh intent and keeps blocked file navigation isolated', async () => {
        const { host, guest } = await downloadable();
        click();
        const pending = host.requestDownload(guest, 'data:,')!;
        guest.emit('did-start-navigation', { url: htmlPageFileUrl(path.resolve('preview/other.html')), isMainFrame: true, isSameDocument: false });
        guest.emit('did-stop-loading');
        expect(pending.approve()).toBe(false);
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        click();
        guest.emit('did-start-navigation', { url: htmlPageFileUrl(path.resolve('outside.html')), isMainFrame: true, isSameDocument: false });
        expect(host.requestDownload(guest, 'data:,')!.approve()).toBe(true);
        // Even a forged completion cannot make an out-of-policy document eligible.
        guest.emit('did-navigate', {}, htmlPageFileUrl(path.resolve('outside.html')));
        click();
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        await host.dispose();
    });

    it('preserves intent for download targets, same-document navigation and subframes', async () => {
        const { host, guest } = await downloadable();
        click();
        for (const details of [
            { url: 'blob:null/id', isMainFrame: true, isSameDocument: false },
            { url: 'data:,', isMainFrame: true, isSameDocument: false },
            { url: 'file:///child.html', isMainFrame: false, isSameDocument: false },
            { url: 'file:///preview.html#hash', isMainFrame: true, isSameDocument: true },
        ]) guest.emit('did-start-navigation', details);
        const event = { preventDefault: vi.fn() };
        guest.emit('will-navigate', event, 'blob:null/id');
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(host.requestDownload(guest, 'data:,')!.approve()).toBe(true);
        await host.dispose();
    });

    it.each([1, 9])('isolates repeated view names and workspace labels under owner %s', async ownerId => {
        const first = await downloadable();
        const owner = ownerId === 1 ? first.owner : makeOwner(ownerId);
        mocks.owners.set(ownerId, owner);
        const secondRequest = { ...first.request, ownerId, sessionKey: 'remote-b:workspace' };
        const second = await first.host.create(secondRequest, first.sink);
        const secondGuest = makeGuest(owner, 3);
        mocks.attach!(secondGuest);
        await second.setBounds(bounds);
        secondGuest.emit('did-navigate', {}, htmlPageFileUrl(first.request.path));
        click(first.guest);
        expect(first.host.requestDownload(secondGuest, 'data:,private')).toBeUndefined();
        expect(first.host.requestDownload({ ...first.guest } as any, 'data:,private')).toBeUndefined();
        const pending = first.host.requestDownload(first.guest, 'data:,private')!;
        await second.close();
        expect(pending.approve()).toBe(true);
        await first.host.dispose();
    });

    it('revokes unused mouse intent across hiding and validates owner at approval', async () => {
        const { host, view, guest } = await downloadable();
        guest.emit('before-mouse-event', {}, { type: 'mouseDown', button: 'left' });
        await view.setBounds(null);
        await view.setBounds(bounds);
        guest.emit('before-mouse-event', {}, { type: 'mouseUp', button: 'left' });
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        click();
        const pending = host.requestDownload(guest, 'data:,')!;
        mocks.trusted = false;
        expect(host.requestDownload(guest, 'data:,')).toBeUndefined();
        expect(pending.approve()).toBe(false);
        expect(pending.signal.aborted).toBe(true);
        await host.dispose();
    });
});


describe('HTML session native download routing', () => {
    const store = { installationWide: true };
    function request(guest = mocks.guest, url = 'data:text/csv,private') {
        const event = { preventDefault: vi.fn() };
        const item = { getURL: () => url };
        mocks.profile.emit('will-download', event, item, guest);
        return { event, item };
    }

    it.each(['data:text/csv,private', 'blob:file:///private-id'])('passes the original %s handle and captured owner to native Save As', async url => {
        const { host, owner } = await downloadable(store);
        mocks.manage.mockImplementation((_store, _item, _directory, approval) => {
            expect(approval.chooseDestination(path.resolve('desktop-downloads', 'export.csv'))).toBe(path.resolve('chosen', 'renamed.csv'));
            expect(approval.approve()).toBe(true);
            return true;
        });
        mocks.saveDialog.mockReturnValue(path.resolve('chosen', 'renamed.csv'));
        click();
        const { item, event } = request(mocks.guest, url);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(mocks.manage).toHaveBeenCalledWith(store, item, path.resolve('desktop-downloads'), expect.any(Object));
        expect(mocks.saveDialog).toHaveBeenCalledWith(expect.objectContaining({ webContents: owner }), {
            title: 'Save As', defaultPath: path.resolve('desktop-downloads', 'export.csv'),
            properties: ['showOverwriteConfirmation', 'createDirectory'],
        });
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        expect(mocks.manage).toHaveBeenCalledTimes(1);
        await host.dispose();
    });

    it('blocks load/timer, unowned, stale-document and unsupported requests before the adapter', async () => {
        const { host, view } = await downloadable(store);
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        click();
        expect(request(makeGuest(mocks.owner, 999)).event.preventDefault).toHaveBeenCalledOnce();
        expect(request(mocks.guest, 'https://example.test/private').event.preventDefault).toHaveBeenCalledOnce();
        await view.nav('reload');
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        expect(mocks.manage).not.toHaveBeenCalled();
        expect(mocks.saveDialog).not.toHaveBeenCalled();
        await host.dispose();
    });

    it('reports unavailable management only to the captured owner without private URLs', async () => {
        const { host, sink } = await downloadable();
        click();
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        expect(sink.download).toHaveBeenCalledWith({ viewId: 'html-page:one', url: 'Local or private source', ok: false,
            error: 'Download management is unavailable.' });
        expect(mocks.saveDialog).not.toHaveBeenCalled();
        await host.dispose();
    });

    it('reports rejected store admission without opening a dialog or replaying the request', async () => {
        const { host, sink } = await downloadable(store);
        mocks.manage.mockImplementation((_store, _item, _directory, approval) => { approval.cancel(); return false; });
        click();
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        expect(sink.download).toHaveBeenCalledWith(expect.objectContaining({ error: 'Too many active downloads or desktop is shutting down.' }));
        expect(mocks.saveDialog).not.toHaveBeenCalled();
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        expect(mocks.manage).toHaveBeenCalledTimes(1);
        await host.dispose();
    });

    it('revokes a lease when the source hides during the chooser and discards a late destination', async () => {
        const { host, view, sink } = await downloadable(store);
        mocks.saveDialog.mockImplementation(() => { view.setBounds(null); return path.resolve('late.csv'); });
        mocks.manage.mockImplementation((_store, _item, _directory, approval) => {
            approval.chooseDestination(path.resolve('suggestion.csv'));
            expect(approval.signal.aborted).toBe(true);
            expect(approval.approve()).toBe(false);
            return true;
        });
        click();
        request();
        expect(sink.download).not.toHaveBeenCalled();
        await host.dispose();
    });

    it('passes quiet native cancellation to the adapter and requires fresh input to retry', async () => {
        const { host, sink } = await downloadable(store);
        mocks.saveDialog.mockReturnValue(undefined);
        mocks.manage.mockImplementation((_store, _item, _directory, approval) => {
            expect(approval.chooseDestination(path.resolve('export.csv'))).toBeUndefined();
            approval.cancel();
            return true;
        });
        click();
        request();
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        expect(mocks.manage).toHaveBeenCalledTimes(1);
        key();
        request();
        expect(mocks.manage).toHaveBeenCalledTimes(2);
        expect(sink.download).not.toHaveBeenCalled();
        await host.dispose();
    });

    it('cancels unexpected adapter errors with brief feedback and no diagnostic disclosure', async () => {
        const { host, sink } = await downloadable(store);
        mocks.manage.mockImplementation(() => { throw new Error('private data and destination'); });
        click();
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        expect(sink.download).toHaveBeenCalledWith({ viewId: 'html-page:one', url: 'Local or private source', ok: false,
            error: 'Unable to start the download. Try Download again.' });
        expect(request().event.preventDefault).toHaveBeenCalledOnce();
        expect(mocks.manage).toHaveBeenCalledTimes(1);
        await host.dispose();
    });

    it('sends safe transfer failure feedback only to the captured preview owner', async () => {
        const first = await downloadable(store);
        mocks.owner = makeOwner(10);
        mocks.owners.set(1, mocks.owner);
        mocks.guest = makeGuest(mocks.owner, 20);
        const second = await downloadable(store);
        let failure!: () => void;
        mocks.manage.mockImplementation((_store, _item, _directory, approval) => {
            expect(approval.approve()).toBe(true);
            failure = approval.onFailure;
            return true;
        });
        click(first.guest);
        request(first.guest);
        failure();
        expect(first.sink.download).toHaveBeenCalledExactlyOnceWith({
            viewId: 'html-page:one', url: 'Local or private source', ok: false,
            error: 'Unable to save the download. Try Download again.',
        });
        expect(second.sink.download).not.toHaveBeenCalled();
        await first.host.dispose();
        await second.host.dispose();
    });

    it.each(['close', 'reload', 'document', 'hide', 'owner', 'guest', 'reparent', 'unregistered'])('discards a transfer failure after %s invalidates its source', async change => {
        const { host, view, sink, guest, owner, request: source } = await downloadable(store);
        let failure!: () => void;
        mocks.manage.mockImplementation((_store, _item, _directory, approval) => {
            expect(approval.approve()).toBe(true);
            failure = approval.onFailure;
            return true;
        });
        click();
        request();
        if (change === 'close') await view.close();
        if (change === 'reload') await view.nav('reload');
        if (change === 'document') guest.emit('did-navigate', {}, htmlPageFileUrl(source.path));
        if (change === 'hide') await view.setBounds(null);
        if (change === 'owner') owner.isDestroyed.mockReturnValue(true);
        if (change === 'guest') guest.isDestroyed.mockReturnValue(true);
        if (change === 'reparent') guest.hostWebContents = makeOwner(99);
        if (change === 'unregistered') mocks.trusted = false;
        failure();
        expect(sink.download).not.toHaveBeenCalled();
        await host.dispose();
    });

    it('preserves approved transfers after source closure and removes its session listener on disposal', async () => {
        const { host, view, request: first } = await downloadable(store);
        const second = await host.create(first, { state: vi.fn() } as any);
        expect(mocks.profile.listenerCount('will-download')).toBe(1);
        let signal: AbortSignal | undefined;
        mocks.manage.mockImplementation((_store, _item, _directory, approval) => {
            signal = approval.signal;
            expect(approval.approve()).toBe(true);
            return true;
        });
        key();
        request();
        await view.close();
        expect(signal?.aborted).toBe(false);
        await second.close();
        await host.dispose();
        expect(mocks.profile.listenerCount('will-download')).toBe(0);
    });
});
