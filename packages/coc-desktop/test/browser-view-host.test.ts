import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as policy from '../src/browser-view-policy';
import { DOWNLOADS_QUERY_CHANNEL, DOWNLOADS_ACTION_CHANNEL, DOWNLOADS_CHANGED_CHANNEL, type BrowserDownloadStore } from '../src/browser-downloads';
import { BROWSER_HISTORY_RETENTION_MS } from '../src/browser-history';
import { BROWSER_CONTROL_SCOPE_CHANNEL, BROWSER_CONTROL_RETAIN_CHANNEL, BROWSER_CONTROL_REVEAL_CHANNEL, BROWSER_CONTROL_COMMAND_CHANNEL, BROWSER_CONTROL_CANCEL_CHANNEL, BROWSER_CONTROL_RELEASE_FRAMES_CHANNEL, BROWSER_CONTROL_REMOVE_CURSORS_CHANNEL, BROWSER_CONTROL_ACTIVITY_CHANNEL, BROWSER_CONTROL_FINISH_CHANNEL, BROWSER_CONTROL_VISIBLE_CHANNEL } from '../src/browser-control-command';

const mocks = vi.hoisted(() => ({
    downloads: undefined as BrowserDownloadStore | undefined,
    handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>(), windows: new Map<any, any>(),
    sinks: [] as any[], views: [] as any[], clearData: vi.fn(async () => {}), dialog: vi.fn(async () => ({ response: 0 })),
    menu: vi.fn((_template: any[]) => ({ popup: vi.fn() })),
}));
vi.mock('electron', () => ({
    clipboard: { availableFormats: () => [], write: vi.fn() },
    Menu: { buildFromTemplate: (...args: any[]) => mocks.menu(...args) },
    app: { on: vi.fn() }, webContents: { getAllWebContents: () => [] },
    BrowserWindow: { fromWebContents: (sender: unknown) => mocks.windows.get(sender) },
    ipcMain: { handle: (channel: string, handler: any) => mocks.handlers.set(channel, handler), on: (channel: string, handler: any) => mocks.events.set(channel, handler) },
    dialog: { showMessageBox: (...args: any[]) => mocks.dialog(...args) }, shell: { openExternal: vi.fn() },
}));
vi.mock('../src/server-controller', () => ({ defaultDataDir: () => 'unused' }));
vi.mock('../src/electron-browser-host', () => ({ ElectronBrowserHost: class {
    constructor(_profile: string, downloads?: BrowserDownloadStore) { if (downloads) mocks.downloads = downloads; }
    engine = 'electron';
    availability = async () => ({ engine: this.engine, available: true });
    clearData = mocks.clearData;
    dispose = async () => {};
    async create(request: any, sink: any) {
        mocks.sinks.push(sink);
        const view = { snapshot: () => ({ viewId: request.viewId, engine: this.engine, url: request.url, title: '', loading: false, canGoBack: false, canGoForward: false }),
            close: async () => {}, navigate: async () => {}, nav: async () => {}, setBounds: async () => {}, focus: async () => {},
            cdp: vi.fn(async () => ({ result: { value: { title: 'Fixture', url: request.url, elements: [], nextRef: 1 } } })) };
        mocks.views.push(view);
        return view;
    }
} }));
vi.mock('../src/webview2-browser-host', async () => {
    const { ElectronBrowserHost } = await import('../src/electron-browser-host');
    return { WebView2BrowserHost: class extends ElectronBrowserHost { engine = 'webview2' as any; } };
});
vi.mock('../src/file-preview-host', () => ({ ElectronFilePreviewHost: class { dispose = async () => {}; } }));

let host: typeof import('../src/browser-view-host');
let dir: string;
function owner(id: number, url = 'http://localhost:4000/') {
    const contents = Object.assign(new EventEmitter(), {
        id, mainFrame: {}, getURL: () => url, isDestroyed: () => false, send: vi.fn(),
        copy: vi.fn(), cut: vi.fn(), paste: vi.fn(), selectAll: vi.fn(),
    });
    const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false, show: vi.fn(), focus: vi.fn() });
    mocks.windows.set(contents, window);
    host.registerBrowserEmbedder(window as any, 'http://localhost:4000/');
    return { contents, window, event: { sender: contents, senderFrame: contents.mainFrame } };
}
function invoke(channel: string, event: any, ...args: unknown[]) {
    return mocks.handlers.get(channel)!(event, ...args);
}
const query = (event: any, ...args: unknown[]) => invoke(policy.BROWSER_HISTORY_QUERY_CHANNEL, event, ...args);

beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();
    mocks.handlers.clear(); mocks.events.clear(); mocks.windows.clear(); mocks.sinks.length = 0; mocks.views.length = 0;
    mocks.clearData.mockResolvedValue(); mocks.dialog.mockResolvedValue({ response: 0 });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-history-ipc-'));
    host = await import('../src/browser-view-host');
    host.registerBrowserViewIpc(dir);
});
afterEach(async () => {
    await host.disposeBrowserViews(); vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('desktop history IPC', () => {
    it('keeps ClickOnce default-off and accepts preference changes only from registered main frames', async () => {
        const spa = owner(1), other = owner(2), foreign = owner(3, 'http://localhost:4000/foreign');
        const preferences = await invoke(policy.BROWSER_PREFERENCES_GET_CHANNEL, spa.event);
        expect(preferences.clickOnce.enabled).toBe(false);
        for (const event of [foreign.event, { ...spa.event, senderFrame: {} }]) {
            expect(invoke(policy.BROWSER_CLICKONCE_SET_CHANNEL, event, true)).toEqual({ ok: false, reason: 'no-window' });
        }
        expect(invoke(policy.BROWSER_CLICKONCE_SET_CHANNEL, spa.event, 'true')).toEqual({ ok: false, reason: 'invalid' });
        const result = invoke(policy.BROWSER_CLICKONCE_SET_CHANNEL, spa.event, true);
        if (process.platform === 'win32' && process.arch === 'x64') {
            expect(result).toEqual({ ok: true });
            expect((await invoke(policy.BROWSER_PREFERENCES_GET_CHANNEL, other.event)).clickOnce.enabled).toBe(true);
            expect(other.contents.send).toHaveBeenCalledWith(policy.BROWSER_PREFERENCES_CHANGED_CHANNEL);
        } else {
            expect(result).toMatchObject({ ok: false, reason: 'unsupported-platform' });
        }
        expect([...mocks.handlers.keys()].filter(channel => /activate|launch/.test(channel))).toEqual([]);
        expect(invoke(policy.BROWSER_CLICKONCE_SET_CHANNEL, spa.event, false)).toEqual({ ok: true });
    });
    it('answers site information only to the exact registered SPA main frame that owns the view', async () => {
        const spa = owner(1), other = owner(2), foreign = owner(3, 'http://localhost:4000/foreign');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, spa.event, 'site', 'https://fixture.test/', 'w');
        expect(await invoke(policy.BROWSER_SITE_INFO_CHANNEL, spa.event, 'site', 'w')).toMatchObject({ ok: true, info: {
            viewId: 'site', host: 'fixture.test', connection: 'unknown', cookies: { available: false, reason: 'not-applicable' } } });
        expect(await invoke(policy.BROWSER_SITE_INFO_CHANNEL, spa.event, 'site', 'other-workspace')).toEqual({ ok: false, reason: 'bad-session' });
        expect(await invoke(policy.BROWSER_SITE_INFO_CHANNEL, other.event, 'site', 'w')).toEqual({ ok: false, reason: 'not-found' });
        for (const event of [foreign.event, { ...spa.event, senderFrame: {} }]) {
            expect(await invoke(policy.BROWSER_SITE_INFO_CHANNEL, event, 'site', 'w')).toEqual({ ok: false, reason: 'no-window' });
        }
    });
    it('wires address-menu Copy to native copy in the requesting SPA, preserving cut and editing', () => {
        const spa = owner(1), other = owner(2), foreign = owner(3, 'http://localhost:4000/foreign');
        expect(invoke(policy.BROWSER_ADDRESS_MENU_CHANNEL, spa.event, true)).toEqual({ ok: true });
        expect(spa.contents.copy).not.toHaveBeenCalled();
        const template = mocks.menu.mock.calls.at(-1)![0];
        for (const [index, method] of [[0, 'cut'], [1, 'copy'], [2, 'paste'], [4, 'selectAll']] as const) {
            template[index].click();
            expect(spa.contents[method]).toHaveBeenCalledOnce();
            expect(other.contents[method]).not.toHaveBeenCalled();
        }
        invoke(policy.BROWSER_ADDRESS_MENU_CHANNEL, spa.event, false);
        expect(mocks.menu.mock.calls.at(-1)![0][1].enabled).toBe(false);
        for (const event of [foreign.event, { ...spa.event, senderFrame: {} }])
            expect(invoke(policy.BROWSER_ADDRESS_MENU_CHANNEL, event, true)).toEqual({ ok: false, reason: 'no-window' });
        expect(invoke(policy.BROWSER_ADDRESS_MENU_CHANNEL, spa.event, 'invalid')).toEqual({ ok: false, reason: 'invalid' });
        mocks.menu.mockImplementationOnce(() => { throw new Error('Fixture menu unavailable'); });
        expect(invoke(policy.BROWSER_ADDRESS_MENU_CHANNEL, spa.event, true)).toMatchObject({ ok: false, reason: 'unavailable' });
    });
    it('delivers cross-owner activity and accepts lifecycle clears only from exact registered SPA main frames', async () => {
        const routing = owner(1), target = owner(2), foreign = owner(3, 'http://localhost:4000/foreign');
        invoke(BROWSER_CONTROL_SCOPE_CHANNEL, routing.event, 'w', 'w');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, target.event, 'owned', 'https://fixture.test/', 'w');
        const request = { id: 'r', turnId: 'turn', workspaceId: 'w', processId: 'p', selectedTab: 't2:owned', command: { action: 'snapshot' } };
        await invoke(BROWSER_CONTROL_COMMAND_CHANNEL, routing.event, request);
        expect(target.contents.send).toHaveBeenCalledWith(BROWSER_CONTROL_ACTIVITY_CHANNEL, expect.objectContaining({ active: true, turnId: 'turn', viewId: 'owned' }));
        target.contents.send.mockClear();
        invoke(BROWSER_CONTROL_SCOPE_CHANNEL, target.event, 'w', 'w');
        expect(target.contents.send).not.toHaveBeenCalled();
        for (const event of [foreign.event, { ...routing.event, senderFrame: {} }]) {
            mocks.events.get(BROWSER_CONTROL_FINISH_CHANNEL)!(event, 'turn');
            mocks.events.get(BROWSER_CONTROL_VISIBLE_CHANNEL)!(event, true, 'w');
        }
        expect(target.contents.send).not.toHaveBeenCalled();
        mocks.events.get(BROWSER_CONTROL_FINISH_CHANNEL)!(target.event, 'turn');
        expect(target.contents.send).toHaveBeenCalledWith(BROWSER_CONTROL_ACTIVITY_CHANNEL, expect.objectContaining({ active: false, turnId: 'turn' }));
        await expect(invoke(BROWSER_CONTROL_COMMAND_CHANNEL, routing.event, { ...request, id: 'late' })).rejects.toThrow('turn has finished');
    });
    it('restricts browser-control IPC to exact-source registered SPA main frames', async () => {
        const spa = owner(1), arbitrary = owner(2, 'http://localhost:4000/other');
        for (const event of [arbitrary.event, { ...spa.event, senderFrame: {} }]) {
            expect(() => invoke(BROWSER_CONTROL_SCOPE_CHANNEL, event, 'w', 'w')).toThrow('registered SPA main frame');
            expect(() => invoke(BROWSER_CONTROL_RELEASE_FRAMES_CHANNEL, event, 'w')).toThrow('registered SPA main frame');
            await expect(invoke(BROWSER_CONTROL_COMMAND_CHANNEL, event, { id: 'r', workspaceId: 'w', processId: 'p', command: { action: 'tabs' } })).rejects.toThrow('registered SPA main frame');
        }
        expect(invoke(BROWSER_CONTROL_SCOPE_CHANNEL, spa.event, 'w', 'w')).toEqual({ ownerId: 1 });
        await expect(invoke(BROWSER_CONTROL_RELEASE_FRAMES_CHANNEL, spa.event, 'other')).rejects.toThrow('scope changed');
        await expect(invoke(BROWSER_CONTROL_RELEASE_FRAMES_CHANNEL, spa.event, 'w')).resolves.toBeUndefined();
        expect(await invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, { id: 'r', workspaceId: 'w', processId: 'p', command: { action: 'tabs' } })).toEqual({ tabs: [] });
        await expect(invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, { id: 'r', workspaceId: 'other', processId: 'p', command: { action: 'tabs' } })).rejects.toThrow('scope changed');
    });

    it('removes the AI cursor live only from the calling registered window\'s views in that scope', async () => {
        const spa = owner(1), other = owner(2), foreign = owner(3, 'http://localhost:4000/foreign');
        for (const window of [spa, other]) {
            invoke(BROWSER_CONTROL_SCOPE_CHANNEL, window.event, 'w', 'w');
            await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, window.event, 'view', 'https://fixture.test/', 'w');
            await invoke(BROWSER_CONTROL_COMMAND_CHANNEL, window.event, { id: 'r', turnId: `t${window.contents.id}`, workspaceId: 'w',
                processId: `p${window.contents.id}`, selectedTab: `t${window.contents.id}:view`, cursorOverlayEnabled: true, command: { action: 'press', key: 'Enter' } });
        }
        const ops = (view: any) => view.cdp.mock.calls.map(([, params]: any[]) => /"op":"(\w+)"/.exec(String(params?.expression ?? ''))?.[1]).filter(Boolean);
        expect(mocks.views.map(ops)).toEqual([['key'], ['key']]);
        for (const event of [foreign.event, { ...spa.event, senderFrame: {} }]) {
            expect(() => invoke(BROWSER_CONTROL_REMOVE_CURSORS_CHANNEL, event, 'w')).toThrow('registered SPA main frame');
        }
        expect(() => invoke(BROWSER_CONTROL_REMOVE_CURSORS_CHANNEL, spa.event, 42)).toThrow('Invalid browser workspace scope');
        expect(mocks.views.map(ops)).toEqual([['key'], ['key']]);
        expect(invoke(BROWSER_CONTROL_REMOVE_CURSORS_CHANNEL, spa.event, 'w')).toBeUndefined();
        expect(mocks.views.map(ops)).toEqual([['key', 'remove'], ['key']]);
    });

    it('cancels only the caller-owned request and rejects closed-window/reloaded-document calls promptly', async () => {
        const spa = owner(1), other = owner(2);
        invoke(BROWSER_CONTROL_SCOPE_CHANNEL, spa.event, 'w', 'w');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, spa.event, 'view', 'https://fixture.test/', 'w');
        const request = { id: 'r', workspaceId: 'w', processId: 'p', selectedTab: 't1:view', command: { action: 'wait', ms: 30_000 } };
        const result = invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, request);
        mocks.events.get(BROWSER_CONTROL_CANCEL_CHANNEL)!(other.event, 'r');
        await expect(invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, request)).rejects.toThrow('Duplicate');
        mocks.events.get(BROWSER_CONTROL_CANCEL_CHANNEL)!(spa.event, 'r');
        await expect(result).rejects.toThrow('cancelled');
        const closing = invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, { ...request, id: 'close' });
        spa.window.emit('closed');
        await expect(closing).rejects.toThrow('window closed');
    });

    it('keeps retained background requests across a workspace switch and aborts them when the scope is dropped', async () => {
        const spa = owner(1), arbitrary = owner(2, 'http://localhost:4000/other');
        expect(() => invoke(BROWSER_CONTROL_RETAIN_CHANNEL, arbitrary.event, 'a', 'a')).toThrow('registered SPA main frame');
        invoke(BROWSER_CONTROL_SCOPE_CHANNEL, spa.event, 'a', 'a');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, spa.event, 'view', 'https://fixture.test/', 'a');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, spa.event, 'second', 'https://fixture.test/two', 'a');
        const request = { id: 'r', workspaceId: 'a', processId: 'p', selectedTab: 't1:view', command: { action: 'wait', ms: 30_000 } };
        let settled = false;
        const waiting = invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, request);
        waiting.catch(() => {}).finally(() => { settled = true; });
        await new Promise(resolve => setTimeout(resolve, 0));
        invoke(BROWSER_CONTROL_RETAIN_CHANNEL, spa.event, 'a', 'a');
        invoke(BROWSER_CONTROL_SCOPE_CHANNEL, spa.event, 'b', 'b');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(settled).toBe(false);
        spa.window.show.mockClear(); spa.window.focus.mockClear();
        await expect(invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, { ...request, id: 'bg', processId: 'q', command: { action: 'select', tab: 't1:second' } }, 'a'))
            .resolves.toMatchObject({ tab: 't1:second' });
        expect(spa.contents.send).toHaveBeenCalledWith(BROWSER_CONTROL_REVEAL_CHANNEL, expect.objectContaining({ viewId: 'second', background: true }));
        expect(spa.window.show).not.toHaveBeenCalled();
        expect(spa.window.focus).not.toHaveBeenCalled();
        await expect(invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, { ...request, id: 'fg' })).rejects.toThrow('scope changed');
        await expect(invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, request, 42)).rejects.toThrow('routing reference');
        invoke(BROWSER_CONTROL_RETAIN_CHANNEL, spa.event, 'a', null);
        await expect(waiting).rejects.toThrow('workspace changed');
    });
    it('aborts unretained requests on a workspace switch as before', async () => {
        const spa = owner(1);
        invoke(BROWSER_CONTROL_SCOPE_CHANNEL, spa.event, 'a', 'a');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, spa.event, 'view', 'https://fixture.test/', 'a');
        const waiting = invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, { id: 'r', workspaceId: 'a', processId: 'p', selectedTab: 't1:view', command: { action: 'wait', ms: 30_000 } });
        await new Promise(resolve => setTimeout(resolve, 0));
        invoke(BROWSER_CONTROL_SCOPE_CHANNEL, spa.event, 'b', 'b');
        await expect(waiting).rejects.toThrow('workspace changed');
    });

    it('reveals a selected URL tab in its existing desktop owner without exposing debugger/CDP IPC', async () => {
        const spa = owner(1);
        invoke(BROWSER_CONTROL_SCOPE_CHANNEL, spa.event, 'w', 'w');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, spa.event, 'view', 'https://fixture.test/', 'w');
        const result = await invoke(BROWSER_CONTROL_COMMAND_CHANNEL, spa.event, { id: 'r', workspaceId: 'w', processId: 'p', command: { action: 'select', tab: 't1:view' } });
        expect(result).toMatchObject({ tab: 't1:view', elements: [] });
        expect(spa.window.show).toHaveBeenCalled();
        expect(spa.window.focus).toHaveBeenCalled();
        expect([...mocks.handlers.keys()].filter(key => /debugger|cdp/.test(key))).toEqual([]);
    });
    it('rejects guests, subframes, unregistered windows and arbitrary same-origin documents on every channel', async () => {
        const spa = owner(1), arbitrary = owner(2, 'http://localhost:4000/other');
        const guest = { id: 3, mainFrame: {} };
        const unregistered = { id: 4, mainFrame: {}, getURL: () => 'http://localhost:4000/' };
        mocks.windows.set(unregistered, { webContents: unregistered, isDestroyed: () => false });
        for (const event of [arbitrary.event, { ...spa.event, senderFrame: {} }, { sender: guest, senderFrame: guest.mainFrame }, { sender: unregistered, senderFrame: unregistered.mainFrame }]) {
            for (const channel of [policy.BROWSER_HISTORY_QUERY_CHANNEL, policy.BROWSER_HISTORY_SUGGEST_CHANNEL, policy.BROWSER_HISTORY_DELETE_CHANNEL, policy.BROWSER_HISTORY_CLEAR_CHANNEL, policy.BROWSER_HISTORY_RECORDING_CHANNEL, policy.BROWSER_CLEAR_DATA_CHANNEL]) {
                expect(await invoke(channel, event, 'https://example.test/')).toEqual({ ok: false, reason: 'no-window' });
            }
        }
        expect(mocks.dialog).not.toHaveBeenCalled();
    });

    it('shares committed visits and deletion across registered windows/workspaces without leaking broadcasts', async () => {
        const a = owner(1), b = owner(2), arbitrary = owner(3, 'http://localhost:4000/other');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, a.event, 'a', 'https://example.test/', 'workspace-a');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, b.event, 'b', 'https://example.test/', 'workspace-b', 'webview2');
        mocks.sinks[0].visited('https://user:secret@example.test/Path?q=X#Y', 'First title');
        mocks.sinks[1].visited('https://example.test/Path?q=X#Y', 'Second title');
        const page = await query(b.event, 'title', 0, 8);
        expect(page).toMatchObject({ ok: true, total: 1, recording: true, storageError: null });
        expect(page.entries[0]).toMatchObject({ url: 'https://example.test/Path?q=X#Y', visitCount: 2 });
        for (const window of [a, b]) expect(window.contents.send).toHaveBeenCalledWith(policy.BROWSER_HISTORY_CHANGED_CHANNEL);
        expect(arbitrary.contents.send).not.toHaveBeenCalled();
        expect(await invoke(policy.BROWSER_HISTORY_DELETE_CHANNEL, a.event, page.entries[0].url)).toEqual({ ok: true });
        mocks.sinks[1].titleUpdated(page.entries[0].url, 'Late title');
        expect((await query(b.event)).entries).toEqual([]);
        mocks.sinks[1].visited(page.entries[0].url, 'New visit');
        expect((await query(a.event)).entries[0].visitCount).toBe(1);
    });

    it('bounds queries and validates all mutation inputs without changing recording', async () => {
        const a = owner(1);
        for (const args of [[{}, 0, 8], ['', -1, 8], ['', 0, 101], ['', 0, NaN], ['x'.repeat(8193)]]) {
            expect(await query(a.event, ...args)).toMatchObject({ ok: false, reason: 'invalid' });
        }
        expect(await invoke(policy.BROWSER_HISTORY_DELETE_CHANNEL, a.event, 'file:///secret')).toMatchObject({ ok: false, reason: 'invalid' });
        expect(await invoke(policy.BROWSER_HISTORY_RECORDING_CHANNEL, a.event, 'false')).toMatchObject({ ok: false, reason: 'invalid' });
        expect((await query(a.event)).recording).toBe(true);
        for (const search of [{}, null, 123, 'x'.repeat(8193)]) {
            expect(await invoke(policy.BROWSER_HISTORY_SUGGEST_CHANNEL, a.event, search)).toMatchObject({ ok: false, reason: 'invalid' });
        }
    });

    it('serves ranked bounded suggestions from another workspace without changing its tabs', async () => {
        const a = owner(1), b = owner(2);
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, a.event, 'a', 'https://example.test/', 'workspace-a');
        for (let i = 0; i < 10; i++) mocks.sinks[0].visited(`https://other.test/${i}`, 'example.test title');
        mocks.sinks[0].visited('https://user:secret@example.test/Path?q=Case#Part', 'Prefix');
        const result = await invoke(policy.BROWSER_HISTORY_SUGGEST_CHANNEL, b.event, 'EXAMPLE.TEST/p');
        expect(result).toMatchObject({ ok: true, total: 1, storageError: null });
        expect(result.entries[0]).toMatchObject({ url: 'https://example.test/Path?q=Case#Part', completion: 'example.test/Path?q=Case#Part' });
        await invoke(policy.BROWSER_HISTORY_RECORDING_CHANNEL, a.event, false);
        const ranked = await invoke(policy.BROWSER_HISTORY_SUGGEST_CHANNEL, b.event, 'example.test');
        expect(ranked).toMatchObject({ ok: true, total: 11, recording: false });
        expect(ranked.entries).toHaveLength(8);
        expect(ranked.entries[0].title).toBe('Prefix');
        for (const window of [a, b]) {
            for (const search of ['', ' \t ']) {
                expect(await invoke(policy.BROWSER_HISTORY_SUGGEST_CHANNEL, window.event, search))
                    .toMatchObject({ ok: true, entries: [], total: 0, recording: false, storageError: null });
                expect(await query(window.event, search)).toMatchObject({ ok: true, total: 11, recording: false });
            }
        }
        expect(await invoke(policy.BROWSER_HISTORY_SUGGEST_CHANNEL, b.event)).toMatchObject({ ok: true, entries: [], total: 0 });
        expect(mocks.sinks).toHaveLength(1);
        await invoke(policy.BROWSER_HISTORY_DELETE_CHANNEL, b.event, result.entries[0].url);
        expect((await invoke(policy.BROWSER_HISTORY_SUGGEST_CHANNEL, a.event, 'EXAMPLE.TEST/p')).entries).toEqual([]);
    });

    it('persists pause/resume while queries remain available, and confirms clear without changing tabs or sign-ins', async () => {
        const a = owner(1);
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, a.event, 'a', 'https://example.test/', 'workspace-a');
        mocks.sinks[0].visited('https://example.test/', 'First');
        await query(a.event);
        expect(await invoke(policy.BROWSER_HISTORY_RECORDING_CHANNEL, a.event, false)).toEqual({ ok: true });
        mocks.sinks[0].visited('https://paused.test/', 'Paused');
        expect((await query(a.event)).total).toBe(1);
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'browser/history.json'), 'utf8')).recording).toBe(false);
        expect(await invoke(policy.BROWSER_HISTORY_CLEAR_CHANNEL, a.event)).toEqual({ ok: false, reason: 'cancelled' });
        expect((await query(a.event)).total).toBe(1);
        mocks.dialog.mockResolvedValueOnce({ response: 1 });
        expect(await invoke(policy.BROWSER_HISTORY_CLEAR_CHANNEL, a.event)).toEqual({ ok: true });
        expect(await query(a.event)).toMatchObject({ total: 0, recording: false });
        expect(mocks.clearData).not.toHaveBeenCalled();
        expect(await invoke(policy.BROWSER_HISTORY_RECORDING_CHANNEL, a.event, true)).toEqual({ ok: true });
        mocks.sinks[0].visited('https://resumed.test/', 'Resumed');
        expect((await query(a.event)).entries[0].url).toBe('https://resumed.test/');
    });

    it('rechecks the trusted document after clear confirmation', async () => {
        const a = owner(1);
        mocks.dialog.mockImplementationOnce(async () => { a.contents.getURL = () => 'https://external.test/'; return { response: 1 }; });
        expect(await invoke(policy.BROWSER_HISTORY_CLEAR_CHANNEL, a.event)).toEqual({ ok: false, reason: 'no-window' });
        expect(fs.existsSync(path.join(dir, 'browser/history.json'))).toBe(false);
    });

    it('returns storage failures, broadcasts errors and recovers after a successful mutation', async () => {
        const a = owner(1), b = owner(2);
        const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('disk full'));
        expect(await invoke(policy.BROWSER_HISTORY_RECORDING_CHANNEL, a.event, false)).toMatchObject({ ok: false, reason: 'storage-failed', message: expect.stringContaining('disk full') });
        expect(await query(b.event)).toMatchObject({ recording: true, storageError: expect.stringContaining('disk full') });
        expect(await invoke(policy.BROWSER_HISTORY_SUGGEST_CHANNEL, b.event)).toMatchObject({ ok: true, recording: true, storageError: expect.stringContaining('disk full') });
        expect(b.contents.send).toHaveBeenCalledWith(policy.BROWSER_HISTORY_CHANGED_CHANNEL);
        rename.mockRestore();
        expect(await invoke(policy.BROWSER_HISTORY_RECORDING_CHANNEL, a.event, false)).toEqual({ ok: true });
        expect(await query(b.event)).toMatchObject({ recording: false, storageError: null });
    });

    it('couples confirmed profile cleanup to only that engine history', async () => {
        const a = owner(1), b = owner(2);
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, a.event, 'a', 'https://example.test/', 'workspace-a');
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, b.event, 'b', 'https://example.test/', 'workspace-b', 'webview2');
        mocks.sinks[0].visited('https://example.test/', 'Electron');
        mocks.sinks[1].visited('https://example.test/', 'WebView2');
        await query(a.event);
        mocks.dialog.mockResolvedValueOnce({ response: 1 });
        expect(await invoke(policy.BROWSER_CLEAR_DATA_CHANNEL, a.event, 'electron')).toEqual({ ok: true });
        expect((await query(b.event)).entries[0]).toMatchObject({ title: 'WebView2', visitCount: 1 });
        mocks.sinks[0].visited('https://example.test/', 'Late closed guest');
        expect((await query(b.event)).entries[0].visitCount).toBe(1);
    });

    it('prunes periodically while paused and stops maintenance before shutdown', async () => {
        vi.useFakeTimers();
        // Replace the real interval with one controlled by the fake clock.
        await host.disposeBrowserViews();
        vi.resetModules();
        host = await import('../src/browser-view-host');
        host.registerBrowserViewIpc(dir);
        const a = owner(1);
        await invoke(policy.BROWSER_VIEW_OPEN_CHANNEL, a.event, 'a', 'https://example.test/', 'workspace-a');
        mocks.sinks[0].visited('https://example.test/', 'Expired');
        await query(a.event);
        await invoke(policy.BROWSER_HISTORY_RECORDING_CHANNEL, a.event, false);
        a.contents.send.mockClear();
        vi.setSystemTime(Date.now() + BROWSER_HISTORY_RETENTION_MS);
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        await query(a.event);
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'browser/history.json'), 'utf8')).entries).toEqual([]);
        expect(a.contents.send).toHaveBeenCalledWith(policy.BROWSER_HISTORY_CHANGED_CHANNEL);
        await host.disposeBrowserViews();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('desktop download IPC', () => {
    it('shares records and ID-only actions across registered windows/workspaces and rejects pages and subframes', async () => {
        const first = owner(101), second = owner(102), foreign = owner(103, 'https://foreign.test/');
        const handle = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), dispose: vi.fn() };
        const transfer = mocks.downloads!.start('file.txt', 'https://name:secret@files.test/file?auth=token', handle)!;
        const progress = { state: 'downloading' as const, received: 4, total: 10, canPause: true, canResume: false };
        transfer.update(progress);
        const a = await invoke(DOWNLOADS_QUERY_CHANNEL, first.event);
        const b = await invoke(DOWNLOADS_QUERY_CHANNEL, second.event);
        expect(a.entries).toEqual(b.entries);
        expect(a.entries[0]).toMatchObject({ source: 'files.test', filename: 'file.txt', active: true });
        expect(JSON.stringify(a)).not.toMatch(/secret|auth=|token|filePath/);
        expect(first.contents.send).toHaveBeenCalledWith(DOWNLOADS_CHANGED_CHANNEL);
        expect(second.contents.send).toHaveBeenCalledWith(DOWNLOADS_CHANGED_CHANNEL);
        expect(foreign.contents.send).not.toHaveBeenCalledWith(DOWNLOADS_CHANGED_CHANNEL);
        for (const event of [foreign.event, { ...first.event, senderFrame: {} }]) {
            expect(await invoke(DOWNLOADS_QUERY_CHANNEL, event)).toEqual({ ok: false, reason: 'no-window' });
            expect(await invoke(DOWNLOADS_ACTION_CHANNEL, event, transfer.id, 'cancel')).toEqual({ ok: false, reason: 'no-window' });
        }
        expect(await invoke(DOWNLOADS_ACTION_CHANNEL, second.event, '/arbitrary/file', 'open')).toMatchObject({ ok: false, reason: 'invalid' });
        expect(await invoke(DOWNLOADS_ACTION_CHANNEL, second.event, transfer.id, 'retry')).toMatchObject({ ok: false, reason: 'invalid' });
        expect(await invoke(DOWNLOADS_ACTION_CHANNEL, second.event, transfer.id, 'pause')).toEqual({ ok: true });
        expect(handle.pause).toHaveBeenCalledOnce();
        // A workspace reload and source-window closure do not own download lifetime.
        first.contents.emit('did-start-navigation', {}, 'http://localhost:4000/', false, true);
        first.window.emit('closed');
        transfer.update({ ...progress, received: 9 });
        expect((await invoke(DOWNLOADS_QUERY_CHANNEL, second.event)).entries[0].received).toBe(9);
        expect(handle.cancel).not.toHaveBeenCalled();
        expect(await invoke(DOWNLOADS_ACTION_CHANNEL, second.event, transfer.id, 'cancel')).toEqual({ ok: true });
        expect(handle.cancel).toHaveBeenCalledOnce();
    });
    it('rejects a pending query when its sender navigates away', async () => {
        let url = 'http://localhost:4000/';
        const spa = owner(104);
        spa.contents.getURL = () => url;
        const pending = invoke(DOWNLOADS_QUERY_CHANNEL, spa.event);
        url = 'https://foreign.test/';
        expect(await pending).toEqual({ ok: false, reason: 'no-window' });
    });
});
