import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as policy from '../src/browser-view-policy';
import { BROWSER_HISTORY_RETENTION_MS } from '../src/browser-history';

const mocks = vi.hoisted(() => ({
    handlers: new Map<string, (...args: any[]) => any>(), windows: new Map<any, any>(),
    sinks: [] as any[], clearData: vi.fn(async () => {}), dialog: vi.fn(async () => ({ response: 0 })),
}));
vi.mock('electron', () => ({
    app: { on: vi.fn() }, webContents: { getAllWebContents: () => [] },
    BrowserWindow: { fromWebContents: (sender: unknown) => mocks.windows.get(sender) },
    ipcMain: { handle: (channel: string, handler: any) => mocks.handlers.set(channel, handler), on: vi.fn() },
    dialog: { showMessageBox: (...args: any[]) => mocks.dialog(...args) }, shell: { openExternal: vi.fn() },
}));
vi.mock('../src/server-controller', () => ({ defaultDataDir: () => 'unused' }));
vi.mock('../src/electron-browser-host', () => ({ ElectronBrowserHost: class {
    engine = 'electron';
    availability = async () => ({ engine: this.engine, available: true });
    clearData = mocks.clearData;
    dispose = async () => {};
    async create(request: any, sink: any) {
        mocks.sinks.push(sink);
        return { snapshot: () => ({ viewId: request.viewId, engine: this.engine, url: request.url, title: '', loading: false, canGoBack: false, canGoForward: false }),
            close: async () => {}, navigate: async () => {}, nav: async () => {}, setBounds: async () => {}, focus: async () => {} };
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
    });
    const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
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
    mocks.handlers.clear(); mocks.windows.clear(); mocks.sinks.length = 0;
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
        expect((await invoke(policy.BROWSER_HISTORY_SUGGEST_CHANNEL, b.event)).entries).toHaveLength(8);
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
