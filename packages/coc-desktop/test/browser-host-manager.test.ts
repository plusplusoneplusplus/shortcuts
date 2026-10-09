import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BrowserHostManager } from '../src/browser-host-manager';
import { BrowserHistoryStore } from '../src/browser-history';
import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserViewRequest, type FilePreviewHost, type FileViewRequest } from '../src/browser-host-contract';
import { BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL, BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL, BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, BROWSER_VIEW_CLOSED_CHANNEL, BROWSER_VIEW_NEW_TAB_CHANNEL, BROWSER_VIEW_STATE_CHANNEL, type BrowserEngine } from '../src/browser-view-policy';
import { htmlPageFileUrl, toHtmlPageLoadState, toHtmlPageOpenResult } from '../src/html-page-policy';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

function harness(defaultEngine: BrowserEngine = 'electron', history: Pick<BrowserHistoryStore, 'recordVisit' | 'updateTitle' | 'flush' | 'clearEngine'> = {
    clearEngine: vi.fn(async () => true), recordVisit: vi.fn(async () => true), updateTitle: vi.fn(async () => true), flush: vi.fn(async () => {}),
}) {
    let pageZoom = 100;
    const savePageZoom = vi.fn((percent: number) => { pageZoom = percent; });
    const send = vi.fn();
    const changed = vi.fn();
    const created: { request: BrowserViewRequest; sink: BrowserEventSink; view: BrowserHostedView; engine: BrowserEngine }[] = [];
    const makeHost = (engine: BrowserEngine): BrowserEngineHost => ({
        engine,
        availability: vi.fn(async () => ({ engine, available: true })),
        create: vi.fn(async (request, sink) => {
            const view: BrowserHostedView = {
                snapshot: () => ({ viewId: request.viewId, engine, url: request.url, title: 'Fixture', loading: false, canGoBack: true, canGoForward: false }),
                navigate: vi.fn(), nav: vi.fn(), setBounds: vi.fn(), focus: vi.fn(), close: vi.fn(),
                setPageZoom: vi.fn(),
            };
            created.push({ request, sink, view, engine });
            return view;
        }),
        importCookies: vi.fn(async () => {}),
        clearData: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
    });
    const hosts = { electron: makeHost('electron'), webview2: makeHost('webview2') };
    const files: { request: FileViewRequest; sink: BrowserEventSink; view: BrowserHostedView }[] = [];
    const fileHost: FilePreviewHost = {
        create: vi.fn(async (request, sink) => {
            const view: BrowserHostedView = {
                snapshot: () => ({ viewId: request.viewId, engine: 'electron', url: htmlPageFileUrl(request.path), title: 'Preview', loading: false, canGoBack: false, canGoForward: false }),
                navigate: vi.fn(), nav: vi.fn(), setBounds: vi.fn(), focus: vi.fn(), close: vi.fn(),
            };
            files.push({ request, sink, view });
            return view;
        }),
        dispose: vi.fn(async () => {}),
    };
    const manager = new BrowserHostManager({
        history, hosts, fileHost, getDefault: () => defaultEngine, saveDefault: engine => { defaultEngine = engine; },
        getPageZoom: () => pageZoom, savePageZoom, send, changed,
    });
    return { manager, hosts, fileHost, files, created, send, changed, history, savePageZoom };
}

describe('browser manager history integration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-manager-history-'));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('shares persisted visits across workspace sessions and desktop owners without counting replay', async () => {
        const history = new BrowserHistoryStore(dir);
        const h = harness('electron', history);
        await h.manager.open(1, 'a', 'https://start.test/', 'workspace-a');
        await h.manager.open(2, 'b', 'https://start.test/', 'workspace-b', 'webview2');
        expect((await history.query()).entries).toEqual([]);
        h.created[0].sink.visited!('https://user:secret@final.test/Path?q=Case#Part', 'Final page');
        h.created[1].sink.visited!('https://final.test/Path?q=Case#Part', 'Other engine');
        h.created[0].sink.titleUpdated!('https://final.test/Path?q=Case#Part', 'Updated title');
        await h.manager.open(1, 'a', 'https://ignored.test/', 'workspace-a');
        h.created[0].sink.state(h.created[0].view.snapshot());
        await h.manager.bounds(1, 'a', null);
        await h.manager.bounds(1, 'a', { x: 0, y: 0, width: 400, height: 300 });
        const result = await history.query();
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toMatchObject({ url: 'https://final.test/Path?q=Case#Part', visitCount: 2 });
        expect((await new BrowserHistoryStore(dir).query()).entries).toEqual(result.entries);
        const saved = JSON.parse(fs.readFileSync(history.filename, 'utf8'));
        expect(saved.entries[0].engines.electron).toMatchObject({ title: 'Updated title', visitCount: 1 });
        expect(saved.entries[0].engines.webview2).toMatchObject({ title: 'Other engine', visitCount: 1 });
        await history.delete(result.entries[0].url);
        h.created[0].sink.titleUpdated!(result.entries[0].url, 'Late title');
        h.created[0].sink.state(h.created[0].view.snapshot());
        await h.manager.open(2, 'b', 'https://start.test/', 'workspace-b');
        expect((await history.query()).entries).toEqual([]);
        await h.manager.dispose();
    });

    it('ignores history events from file sources and closed owners, even with an HTTP URL', async () => {
        const h = harness();
        const filePath = path.join(dir, 'preview.html');
        fs.writeFileSync(filePath, '<h1>Preview</h1>');
        await h.manager.openFile(1, 'preview', filePath, 'workspace-a');
        h.files[0].sink.visited!('https://example.test/', 'File redirected');
        h.files[0].sink.titleUpdated!('https://example.test/', 'File title');
        await h.manager.open(2, 'browser', 'https://example.test/', 'workspace-b');
        await h.manager.closeOwner(2);
        h.created[0].sink.visited!('https://example.test/', 'Late');
        h.created[0].sink.titleUpdated!('https://example.test/', 'Late title');
        expect(h.history.recordVisit).not.toHaveBeenCalled();
        expect(h.history.updateTitle).not.toHaveBeenCalled();
        await h.manager.dispose();
    });

    it('reports failed history writes without interrupting browsing or title/state events', async () => {
        const history = {
            clearEngine: vi.fn(async () => true),
            recordVisit: vi.fn(async () => { throw new Error('Disk full'); }),
            updateTitle: vi.fn(async () => { throw new Error('Disk full'); }),
            flush: vi.fn(async () => {}),
        };
        const report = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const h = harness('electron', history);
            await h.manager.open(1, 'browser', 'https://example.test/', 'workspace-a');
            h.created[0].sink.visited!('https://example.test/', 'Page');
            h.created[0].sink.titleUpdated!('https://example.test/', 'New title');
            await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(2));
            expect(await h.manager.navigate(1, 'browser', 'https://other.test/')).toEqual({ ok: true, engine: 'electron' });
            h.created[0].sink.state(h.created[0].view.snapshot());
            expect(h.send).toHaveBeenLastCalledWith(1, BROWSER_VIEW_STATE_CHANNEL, expect.objectContaining({ url: 'https://example.test/' }));
            await h.manager.dispose();
        } finally { report.mockRestore(); }
    });

    it('waits for queued history and engine cleanup, preserving the other engine contributions', async () => {
        const history = new BrowserHistoryStore(dir);
        await history.clear();
        const h = harness('electron', history);
        await h.manager.open(1, 'a', 'https://example.test/', 'workspace-a');
        await h.manager.open(2, 'b', 'https://example.test/', 'workspace-b', 'webview2');
        h.created[0].sink.visited!('https://example.test/', 'Electron');
        h.created[1].sink.visited!('https://example.test/', 'WebView2');
        const gate = deferred<void>();
        vi.mocked(h.hosts.electron.clearData).mockImplementationOnce(() => gate.promise);
        const clearing = h.manager.clear('electron');
        await vi.waitFor(() => expect(h.hosts.electron.clearData).toHaveBeenCalledOnce());
        expect((await history.query()).entries[0].visitCount).toBe(2);
        gate.resolve();
        expect(await clearing).toEqual({ ok: true });
        expect((await history.query()).entries[0]).toMatchObject({ title: 'WebView2', visitCount: 1 });
        h.created[0].sink.visited!('https://example.test/', 'Closed');
        h.created[0].sink.titleUpdated!('https://example.test/', 'Closed');
        expect((await history.query()).entries[0].visitCount).toBe(1);
        await h.manager.dispose();
    });

    it('keeps history on profile failure and reports history cleanup failure after profile success', async () => {
        const h = harness();
        vi.mocked(h.hosts.electron.clearData).mockRejectedValueOnce(new Error('Profile locked'));
        expect(await h.manager.clear('electron')).toMatchObject({ ok: false, reason: 'cleanup-failed' });
        expect(h.history.clearEngine).not.toHaveBeenCalled();
        vi.mocked(h.history.clearEngine).mockRejectedValueOnce(new Error('History disk full'));
        expect(await h.manager.clear('electron')).toEqual({ ok: false, reason: 'cleanup-failed', message: 'History disk full' });
        expect((await h.manager.preferences()).clearing).toEqual([]);
        expect(await h.manager.clear('electron')).toEqual({ ok: true });
        await h.manager.dispose();
    });

    it('drains history writes on shutdown even when a browser host fails to dispose', async () => {
        const h = harness();
        const pending = deferred<void>();
        vi.mocked(h.history.flush).mockReturnValue(pending.promise);
        vi.mocked(h.hosts.electron.dispose).mockRejectedValue(new Error('Host dispose failed'));
        let completed = false;
        const result = h.manager.dispose().catch(error => { completed = true; return error; });
        await vi.waitFor(() => expect(h.history.flush).toHaveBeenCalledOnce());
        expect(completed).toBe(false);
        pending.resolve();
        expect(await result).toEqual(new Error('Host dispose failed'));
    });
});

describe('installation-wide web page zoom', () => {
    it('updates active and hidden guests across workspaces, windows and engines, and initializes new/restored tabs', async () => {
        const h = harness();
        await h.manager.open(1, 'active', 'https://example.test/', 'workspace-a');
        await h.manager.open(1, 'inactive', 'https://other.test/', 'workspace-b');
        await h.manager.bounds(1, 'inactive', null);
        await h.manager.open(2, 'active', 'https://example.test/', 'remote-workspace', 'webview2');
        expect(await h.manager.setPageZoom(150)).toEqual({ ok: true });
        for (const { view } of h.created) expect(view.setPageZoom).toHaveBeenLastCalledWith(150);
        expect(h.changed).toHaveBeenCalledOnce();
        expect((await h.manager.preferences()).pageZoom).toEqual({ percent: 150, min: 50, max: 200, step: 25 });
        await h.manager.open(3, 'new', 'https://new.test/', 'workspace-c');
        expect(h.created[3].request.pageZoomPercent).toBe(150);
        expect(h.created[3].view.setPageZoom).toHaveBeenLastCalledWith(150);
        await h.manager.reloadOwner(1);
        await h.manager.open(1, 'active', 'https://restored.test/', 'workspace-a');
        expect(h.created[4].request.pageZoomPercent).toBe(150);
        await h.manager.navigate(1, 'active', 'https://navigation.test/');
        await h.manager.nav(1, 'active', 'back');
        await h.manager.open(1, 'active', 'https://ignored.test/', 'workspace-a');
        expect(h.created[4].view.setPageZoom).toHaveBeenLastCalledWith(150);
    });

    it('serializes changes and updates a guest that completes startup during a zoom change', async () => {
        const h = harness();
        const pending = deferred<BrowserHostedView>();
        const create = h.hosts.electron.create;
        vi.mocked(create).mockImplementationOnce(async (request, sink) => {
            const view = await pending.promise;
            h.created.push({ request, sink, view, engine: 'electron' });
            return view;
        });
        const opening = h.manager.open(1, 'pending', 'https://example.test/', 'workspace');
        const first = h.manager.setPageZoom(125);
        await vi.waitFor(() => expect(h.savePageZoom).toHaveBeenCalledWith(125));
        const second = h.manager.setPageZoom(175);
        const setPageZoom = vi.fn();
        pending.resolve({
            snapshot: () => ({ viewId: 'pending', engine: 'electron', url: 'https://example.test/', title: '', loading: false, canGoBack: false, canGoForward: false }),
            navigate: vi.fn(), nav: vi.fn(), setBounds: vi.fn(), focus: vi.fn(), close: vi.fn(), setPageZoom,
        });
        expect(await opening).toMatchObject({ ok: true });
        expect(await first).toEqual({ ok: true });
        expect(await second).toEqual({ ok: true });
        expect(setPageZoom).toHaveBeenLastCalledWith(175);
        expect(h.savePageZoom.mock.calls).toEqual([[125], [175]]);
    });

    it('rejects unsafe, out-of-range and off-step values, accepts bounds and resets to 100%', async () => {
        const h = harness();
        for (const percent of [NaN, Infinity, -Infinity, 49, 201, 101, '125', null]) {
            expect(await h.manager.setPageZoom(percent)).toEqual({ ok: false, reason: 'invalid' });
        }
        expect(h.savePageZoom).not.toHaveBeenCalled();
        for (const percent of [50, 200, 100]) expect(await h.manager.setPageZoom(percent)).toEqual({ ok: true });
        expect((await h.manager.preferences()).pageZoom.percent).toBe(100);
    });

    it('reports engine failures without preventing other guests from updating, and retries explicitly', async () => {
        const h = harness();
        await h.manager.open(1, 'bad', 'https://example.test/', 'workspace');
        await h.manager.open(2, 'good', 'https://example.test/', 'workspace', 'webview2');
        vi.mocked(h.created[0].view.setPageZoom!).mockRejectedValueOnce(new Error('Zoom failed'));
        expect(await h.manager.setPageZoom(125)).toMatchObject({ ok: false, message: 'Zoom failed' });
        expect(h.created[1].view.setPageZoom).toHaveBeenLastCalledWith(125);
        expect(await h.manager.setPageZoom(125)).toEqual({ ok: true });
        delete h.created[0].view.setPageZoom;
        expect(await h.manager.setPageZoom(150)).toMatchObject({ ok: false, reason: 'unsupported' });
    });

    it('surfaces persistence failures without changing live guests', async () => {
        const h = harness();
        await h.manager.open(1, 'a', 'https://example.test/', 'workspace');
        h.savePageZoom.mockImplementationOnce(() => { throw new Error('Storage unavailable'); });
        expect(await h.manager.setPageZoom(125)).toMatchObject({ ok: false, message: 'Storage unavailable' });
        expect(h.created[0].view.setPageZoom).toHaveBeenLastCalledWith(100);
    });
});

describe.each<BrowserEngine>(['electron', 'webview2'])('%s shared browser manager contract', engine => {
    it('routes adoption to the exact owner and removes expired host handles', async () => {
        const h = harness(engine);
        await h.manager.open(1, 'view', 'https://example.test/', 'workspace');
        const item = h.created[0];
        item.view.adopt = vi.fn();
        Object.assign(item.view, { embed: 'webview', src: 'https://example.test/', partition: 'token' });
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'workspace')).toMatchObject({ embed: 'webview', src: 'https://example.test/', partition: 'token' });
        expect(await h.manager.adopt(2, 'view', 42)).toEqual({ ok: false, reason: 'not-found' });
        expect(await h.manager.adopt(1, 'other', 42)).toEqual({ ok: false, reason: 'not-found' });
        expect(await h.manager.adopt(1, 'view', '42')).toEqual({ ok: false, reason: 'not-found' });
        expect(item.view.adopt).not.toHaveBeenCalled();
        expect(await h.manager.adopt(1, 'view', 42)).toEqual({ ok: true });
        expect(item.view.adopt).toHaveBeenCalledWith(42);
        item.sink.closed!();
        await Promise.resolve();
        expect(await h.manager.adopt(1, 'view', 42)).toEqual({ ok: false, reason: 'not-found' });
        expect(h.send).toHaveBeenCalledWith(1, BROWSER_VIEW_CLOSED_CHANNEL, { viewId: 'view', engine });
        await h.manager.open(1, 'view', 'https://example.test/', 'workspace');
        expect(h.created).toHaveLength(2);
    });
    it('is idempotent and holds its engine when the global default changes', async () => {
        const h = harness(engine);
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'workspace-a')).toEqual({ ok: true, engine, sourceKind: 'url' });
        await h.manager.select(engine === 'electron' ? 'webview2' : 'electron');
        await h.manager.open(1, 'view', 'https://ignored.test/', 'workspace-a');
        expect(h.created).toHaveLength(1);
        await h.manager.nav(1, 'view', 'back');
        expect(h.created[0].view.nav).toHaveBeenCalledWith('back');
        expect(h.send).toHaveBeenLastCalledWith(1, BROWSER_VIEW_STATE_CHANNEL, expect.objectContaining({ engine, url: 'https://example.test/' }));
        await h.manager.open(2, 'new', 'https://example.test/', 'workspace-b');
        expect(h.created[1].engine).not.toBe(engine);
        await h.manager.close(1, 'view');
        await h.manager.open(1, 'view', 'https://example.test/', 'workspace-a');
        expect(h.created[2].engine).not.toBe(engine);
    });

    it('isolates command ownership even when windows reuse the same view id', async () => {
        const h = harness(engine);
        await h.manager.open(1, 'view', 'https://example.test/', 'owner');
        expect(await h.manager.navigate(2, 'view', 'https://other.test/')).toEqual({ ok: false, reason: 'not-found' });
        await h.manager.nav(2, 'view', 'back');
        await h.manager.close(2, 'view');
        expect(h.created[0].view.close).not.toHaveBeenCalled();
        expect(h.created[0].view.nav).not.toHaveBeenCalled();
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'forged-owner')).toEqual({ ok: false, reason: 'bad-session' });
    });

    it('rejects malformed commands before either host creates a view', async () => {
        const h = harness(engine);
        expect(await h.manager.open(1, '', 'https://example.test/', 'owner')).toEqual({ ok: false, reason: 'bad-id' });
        expect(await h.manager.open(1, 'view', 'https://example.test/', '')).toEqual({ ok: false, reason: 'bad-session' });
        expect(await h.manager.open(1, 'view', 'file:///page.html', 'owner')).toEqual({ ok: false, reason: 'invalid' });
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'owner', 'unknown')).toEqual({ ok: false, reason: 'bad-engine' });
        expect(h.created).toHaveLength(0);
    });

    it('routes related tabs to the opener engine and ignores late callbacks after close', async () => {
        const h = harness(engine);
        await h.manager.open(1, 'view', 'https://example.test/', 'owner');
        const sink = h.created[0].sink;
        sink.newTab('https://child.test/');
        expect(h.send).toHaveBeenLastCalledWith(1, BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: 'view', url: 'https://child.test/', engine });
        await h.manager.select(engine === 'electron' ? 'webview2' : 'electron');
        await h.manager.open(1, 'child', 'https://child.test/', 'owner', engine);
        expect(h.created[1].engine).toBe(engine);
        await h.manager.close(1, 'view');
        h.send.mockClear();
        sink.state(h.created[0].view.snapshot());
        sink.newTab('https://late.test/');
        sink.download({ viewId: 'view', url: 'https://file.test/', ok: true });
        expect(h.send).not.toHaveBeenCalled();
    });

    it('closes every target-engine tab across windows and excludes concurrent opens during clearing', async () => {
        const h = harness(engine);
        const pending = deferred<void>();
        vi.mocked(h.hosts[engine].clearData).mockImplementation(() => pending.promise);
        await h.manager.open(1, 'a', 'https://example.test/', 'workspace-a');
        await h.manager.open(2, 'b', 'https://example.test/', 'remote-workspace');
        await h.manager.open(2, 'other', 'https://example.test/', 'workspace-a', engine === 'electron' ? 'webview2' : 'electron');
        const clear = h.manager.clear(engine);
        expect(await h.manager.open(3, 'blocked', 'https://example.test/', 'workspace-c', engine)).toMatchObject({ ok: false, reason: 'busy' });
        await vi.waitFor(() => expect(h.hosts[engine].clearData).toHaveBeenCalled());
        expect(h.created[0].view.close).toHaveBeenCalled();
        expect(h.created[1].view.close).toHaveBeenCalled();
        expect(h.created[2].view.close).not.toHaveBeenCalled();
        expect(h.send).toHaveBeenCalledWith(1, BROWSER_VIEW_CLOSED_CHANNEL, { viewId: 'a', engine });
        expect(h.send).toHaveBeenCalledWith(2, BROWSER_VIEW_CLOSED_CHANNEL, { viewId: 'b', engine });
        pending.resolve();
        expect(await clear).toEqual({ ok: true });
        expect((await h.manager.preferences()).defaultEngine).toBe(engine);
        expect((await h.manager.preferences()).clearing).toEqual([]);
    });

    it('routes native close requests to the source window without destroying its tab', async () => {
        const h = harness(engine);
        await h.manager.open(1, 'same-id', 'https://example.test/', 'remote:workspace');
        await h.manager.open(2, 'same-id', 'https://example.test/', 'local-workspace');
        h.send.mockClear();
        h.created[0].sink.closeRequested();
        expect(h.send).toHaveBeenCalledExactlyOnceWith(1, BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, { viewId: 'same-id' });
        expect(h.created[0].view.close).not.toHaveBeenCalled();
        await h.manager.close(1, 'same-id');
        h.send.mockClear();
        h.created[0].sink.closeRequested();
        expect(h.send).not.toHaveBeenCalled();
        h.created[1].sink.closeRequested();
        expect(h.send).toHaveBeenCalledExactlyOnceWith(2, BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, { viewId: 'same-id' });
    });

    it('routes add-menu requests by source window and ignores closed entries', async () => {
        const h = harness(engine);
        await h.manager.open(1, 'same-id', 'https://example.test/', 'remote:workspace');
        await h.manager.open(2, 'same-id', 'https://example.test/', 'local-workspace');
        h.send.mockClear();
        h.created[0].sink.openMenuRequested();
        expect(h.send).toHaveBeenCalledExactlyOnceWith(1, BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL, { viewId: 'same-id' });
        expect(h.created[0].view.close).not.toHaveBeenCalled();
        await h.manager.close(1, 'same-id');
        h.send.mockClear();
        h.created[0].sink.openMenuRequested();
        expect(h.send).not.toHaveBeenCalled();
        h.created[1].sink.openMenuRequested();
        expect(h.send).toHaveBeenCalledExactlyOnceWith(2, BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL, { viewId: 'same-id' });
    });

    it('reports partial cleanup failure, unblocks the engine and permits explicit retry', async () => {
        const h = harness(engine);
        vi.mocked(h.hosts[engine].clearData).mockRejectedValueOnce(new BrowserHostError('cleanup-failed', 'Storage is locked.'));
        expect(await h.manager.clear(engine)).toEqual({ ok: false, reason: 'cleanup-failed', message: 'Storage is locked.' });
        expect((await h.manager.preferences()).clearing).toEqual([]);
        expect(await h.manager.clear(engine)).toEqual({ ok: true });
    });

    it('releases a view closed while asynchronous startup is still in progress', async () => {
        const h = harness(engine);
        const gate = deferred<void>();
        const create = vi.mocked(h.hosts[engine].create).getMockImplementation()!;
        vi.mocked(h.hosts[engine].create).mockImplementation(async (request, sink) => { await gate.promise; return create(request, sink); });
        const open = h.manager.open(1, 'view', 'https://example.test/', 'owner');
        await vi.waitFor(() => expect(h.hosts[engine].create).toHaveBeenCalled());
        const close = h.manager.close(1, 'view');
        gate.resolve();
        expect(await open).toMatchObject({ ok: false, reason: 'not-found', engine });
        await close;
        expect(h.created[0].view.close).toHaveBeenCalledTimes(1);
    });

    it('keeps a new document live when old-document startup settles after a full SPA reload', async () => {
        const h = harness(engine);
        const gate = deferred<void>();
        const create = vi.mocked(h.hosts[engine].create).getMockImplementation()!;
        vi.mocked(h.hosts[engine].create).mockImplementationOnce(async (request, sink) => { await gate.promise; return create(request, sink); });
        const old = h.manager.open(1, 'reused-id', 'https://old.test/', 'owner');
        await vi.waitFor(() => expect(h.hosts[engine].create).toHaveBeenCalledTimes(1));
        const reload = h.manager.closeOwner(1);
        expect(await h.manager.open(1, 'reused-id', 'https://new.test/', 'owner')).toEqual({ ok: true, engine, sourceKind: 'url' });
        gate.resolve();
        expect(await old).toMatchObject({ ok: false, reason: 'not-found' });
        await reload;
        expect(await h.manager.navigate(1, 'reused-id', 'https://next.test/')).toEqual({ ok: true, engine });
        expect(h.created[0].view.close).not.toHaveBeenCalled();
        expect(h.created[0].view.navigate).toHaveBeenCalledWith('https://next.test/');
        expect(h.created[1].view.close).toHaveBeenCalledOnce();
    });
});

describe('address shortcut ownership', () => {
    it.each<BrowserEngine>(['electron', 'webview2'])('routes %s address requests only to their live owning window', async engine => {
        const h = harness(engine);
        await h.manager.open(1, 'same-view', 'https://example.test/', 'workspace-a');
        await h.manager.open(2, 'same-view', 'https://example.test/', 'workspace-b');
        h.send.mockClear();
        h.created[0].sink.focusAddressRequested!();
        expect(h.send).toHaveBeenCalledExactlyOnceWith(1, BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL, { viewId: 'same-view' });
        await h.manager.close(1, 'same-view');
        h.send.mockClear();
        h.created[0].sink.focusAddressRequested!();
        expect(h.send).not.toHaveBeenCalled();
        h.created[1].sink.focusAddressRequested!();
        expect(h.send).toHaveBeenCalledExactlyOnceWith(2, BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL, { viewId: 'same-view' });
    });
});

describe('engine availability and startup errors', () => {
    it('disposes both engines even when one view fails to close', async () => {
        const h = harness();
        await h.manager.open(1, 'view', 'https://example.test/', 'owner');
        vi.mocked(h.created[0].view.close).mockRejectedValueOnce(new Error('Controller close failed.'));
        await expect(h.manager.dispose()).rejects.toThrow('Controller close failed.');
        expect(h.hosts.electron.dispose).toHaveBeenCalled();
        expect(h.hosts.webview2.dispose).toHaveBeenCalled();
        expect(h.fileHost.dispose).toHaveBeenCalled();
    });
    it('retains an unavailable preference and never falls back, then retries its original engine', async () => {
        const h = harness();
        vi.mocked(h.hosts.webview2.availability).mockResolvedValue({ engine: 'webview2', available: false, reason: 'missing-runtime', message: 'Install the runtime.' });
        expect(await h.manager.select('webview2')).toEqual({ ok: true });
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'owner')).toMatchObject({ ok: false, engine: 'webview2', reason: 'missing-runtime' });
        expect(h.created).toHaveLength(0);
        await h.manager.select('electron');
        vi.mocked(h.hosts.webview2.availability).mockResolvedValue({ engine: 'webview2', available: true });
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'owner')).toEqual({ ok: true, engine: 'webview2', sourceKind: 'url' });
        expect(h.created[0].engine).toBe('webview2');
    });

    it('rejects unsupported platforms and invalid engine preferences', async () => {
        const h = harness();
        vi.mocked(h.hosts.webview2.availability).mockResolvedValue({ engine: 'webview2', available: false, reason: 'unsupported-platform' });
        expect(await h.manager.select('webview2')).toMatchObject({ ok: false, reason: 'unsupported-platform' });
        expect(await h.manager.select('unknown')).toEqual({ ok: false, reason: 'bad-engine' });
        expect((await h.manager.preferences()).defaultEngine).toBe('electron');
    });
});

describe('file previews', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-file-preview-'));
    const page = path.join(dir, 'index.html');
    const other = path.join(dir, 'other.html');
    fs.writeFileSync(page, '<!doctype html>');
    fs.writeFileSync(other, '<!doctype html>');
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it.each<BrowserEngine>(['electron', 'webview2'])('always use the file host when the default engine is %s', async engine => {
        const h = harness(engine);
        expect(await h.manager.openFile(1, 'preview', page, 'workspace-a')).toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        expect(h.files).toHaveLength(1);
        expect(h.files[0].request).toEqual({ ownerId: 1, viewId: 'preview', sessionKey: 'workspace-a', path: path.normalize(page) });
        expect(h.created).toHaveLength(0);
        expect(h.hosts.electron.availability).not.toHaveBeenCalled();
        expect(h.hosts.webview2.availability).not.toHaveBeenCalled();
        expect(h.send).toHaveBeenLastCalledWith(1, BROWSER_VIEW_STATE_CHANNEL, expect.objectContaining({ viewId: 'preview', engine: 'electron', sourceKind: 'file' }));
    });

    it('rejects invalid paths with the html-page policy reasons before creating a view', async () => {
        const h = harness();
        expect(await h.manager.openFile(1, 'p', 'index.html', 'owner')).toEqual({ ok: false, reason: 'not-absolute' });
        expect(await h.manager.openFile(1, 'p', path.join(dir, 'style.css'), 'owner')).toEqual({ ok: false, reason: 'not-html' });
        expect(await h.manager.openFile(1, 'p', path.join(dir, 'missing.html'), 'owner')).toEqual({ ok: false, reason: 'missing' });
        expect(await h.manager.openFile(1, 'p', 42, 'owner')).toEqual({ ok: false, reason: 'invalid' });
        expect(await h.manager.openFile(1, '', page, 'owner')).toEqual({ ok: false, reason: 'bad-id' });
        expect(await h.manager.openFile(1, 'p', page, '')).toEqual({ ok: false, reason: 'bad-session' });
        expect(h.files).toHaveLength(0);
    });

    it('never loads a file through a url source', async () => {
        const h = harness();
        expect(await h.manager.open(1, 'p', htmlPageFileUrl(page), 'owner')).toMatchObject({ ok: false });
        expect(await h.manager.open(1, 'p', 'file://host/share/index.html', 'owner')).toMatchObject({ ok: false, reason: 'unsupported' });
        expect(h.created).toHaveLength(0);
        expect(h.files).toHaveLength(0);
    });

    it('replays a live preview for the same path and replaces it for a new path', async () => {
        const h = harness();
        await h.manager.openFile(1, 'p', page, 'owner');
        h.send.mockClear();
        expect(await h.manager.openFile(1, 'p', page, 'owner')).toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        expect(h.files).toHaveLength(1);
        expect(h.send).toHaveBeenCalledWith(1, BROWSER_VIEW_STATE_CHANNEL, expect.objectContaining({ viewId: 'p', sourceKind: 'file', url: htmlPageFileUrl(page) }));
        expect(await h.manager.openFile(1, 'p', other, 'owner')).toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        expect(h.files[0].view.close).toHaveBeenCalledOnce();
        expect(h.files[1].request.path).toBe(path.normalize(other));
    });

    it('keeps url and file views apart when a view id is reused for the other kind', async () => {
        const h = harness();
        await h.manager.open(1, 'shared', 'https://example.test/', 'owner');
        await h.manager.openFile(1, 'preview', page, 'owner');
        expect(await h.manager.openFile(1, 'shared', page, 'owner')).toEqual({ ok: false, reason: 'bad-id' });
        expect(await h.manager.open(1, 'preview', 'https://example.test/', 'owner')).toEqual({ ok: false, reason: 'bad-id' });
        expect(await h.manager.navigate(1, 'preview', 'https://example.test/')).toEqual({ ok: false, reason: 'unsupported', engine: 'electron' });
        expect(h.files[0].view.navigate).not.toHaveBeenCalled();
    });

    it('routes bounds, focus, history and close through the shared manager paths', async () => {
        const h = harness();
        await h.manager.openFile(1, 'p', page, 'owner');
        expect(await h.manager.importCookies(1, 'p', 'app.example.com', 'a=b')).toEqual({ ok: false, reason: 'unsupported' });
        const { view, sink } = h.files[0];
        view.setPageZoom = vi.fn();
        await h.manager.setPageZoom(175);
        expect(view.setPageZoom).not.toHaveBeenCalled();
        await h.manager.bounds(1, 'p', { x: 1, y: 2, width: 3, height: 4 });
        await h.manager.bounds(1, 'p', null);
        await h.manager.nav(1, 'p', 'back');
        await h.manager.nav(1, 'p', 'reload');
        await h.manager.command(1, 'p', v => v.focus());
        expect(view.setBounds).toHaveBeenNthCalledWith(1, { x: 1, y: 2, width: 3, height: 4 });
        expect(view.setBounds).toHaveBeenNthCalledWith(2, null);
        expect(view.nav).toHaveBeenCalledWith('back');
        expect(view.nav).toHaveBeenCalledWith('reload');
        expect(view.focus).toHaveBeenCalled();
        sink.state({ ...view.snapshot(), loading: true });
        expect(h.send).toHaveBeenLastCalledWith(1, BROWSER_VIEW_STATE_CHANNEL, expect.objectContaining({ viewId: 'p', sourceKind: 'file', loading: true }));
        await h.manager.close(1, 'p');
        expect(view.close).toHaveBeenCalledOnce();
        h.send.mockClear();
        sink.state(view.snapshot());
        expect(h.send).not.toHaveBeenCalled();
    });

    it('is never closed, blocked or cleared by Electron or WebView2 browser cleanup', async () => {
        const h = harness();
        let release!: () => void;
        vi.mocked(h.hosts.electron.clearData).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
        await h.manager.openFile(1, 'p', page, 'owner');
        await h.manager.open(1, 'web', 'https://example.test/', 'owner');
        const clear = h.manager.clear('electron');
        await vi.waitFor(() => expect(h.hosts.electron.clearData).toHaveBeenCalled());
        expect(await h.manager.openFile(1, 'p2', other, 'owner')).toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        release();
        expect(await h.manager.clear('webview2')).toEqual({ ok: true });
        expect(await clear).toEqual({ ok: true });
        expect(h.created[0].view.close).toHaveBeenCalled();
        expect(h.files).toHaveLength(2);
        for (const file of h.files) { expect(file.view.close).not.toHaveBeenCalled(); }
        expect(h.send).not.toHaveBeenCalledWith(1, BROWSER_VIEW_CLOSED_CHANNEL, expect.objectContaining({ viewId: 'p' }));
    });

    it('closes all sources on a full SPA reload without requesting removal of persisted tabs', async () => {
        const h = harness();
        await h.manager.openFile(1, 'p', page, 'owner');
        await h.manager.open(1, 'web', 'https://example.test/', 'owner');
        await h.manager.reloadOwner(1);
        expect(h.created[0].view.close).toHaveBeenCalledOnce();
        expect(h.files[0].view.close).toHaveBeenCalledOnce();
        expect(h.send.mock.calls.some(([, channel]) => channel === BROWSER_VIEW_CLOSED_CHANNEL)).toBe(false);
        h.send.mockClear();
        expect(await h.manager.openFile(1, 'p', page, 'owner')).toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        expect(h.fileHost.create).toHaveBeenCalledTimes(2);
        expect(h.send).toHaveBeenCalledWith(1, BROWSER_VIEW_STATE_CHANNEL, expect.objectContaining({ viewId: 'p', sourceKind: 'file', loading: false }));
        await h.manager.reloadOwner(1);
        await h.manager.openFile(1, 'p', page, 'owner');
        expect(h.files[1].view.close).toHaveBeenCalledOnce();
        await h.manager.close(1, 'p');
        expect(h.files[2].view.close).toHaveBeenCalledOnce();
    });

    it('closes every file on reload while preserving other windows', async () => {
        const h = harness();
        await h.manager.openFile(1, 'kept', page, 'owner');
        await h.manager.openFile(1, 'orphan', page, 'owner');
        await h.manager.openFile(2, 'other', page, 'owner');
        await h.manager.reloadOwner(1);
        await h.manager.openFile(1, 'kept', page, 'owner');
        await h.manager.reloadOwner(1);
        expect(h.files[0].view.close).toHaveBeenCalledOnce();
        expect(h.files[1].view.close).toHaveBeenCalledOnce();
        expect(h.files[2].view.close).not.toHaveBeenCalled();
        expect(await h.manager.openFile(1, 'orphan', page, 'owner')).toMatchObject({ ok: true });
        expect(h.fileHost.create).toHaveBeenCalledTimes(5);
    });

    it('closes previews with their window and on dispose', async () => {
        const h = harness();
        await h.manager.openFile(1, 'p', page, 'owner');
        await h.manager.openFile(2, 'p', page, 'owner');
        await h.manager.closeOwner(1);
        expect(h.files[0].view.close).toHaveBeenCalledOnce();
        expect(h.files[1].view.close).not.toHaveBeenCalled();
        await h.manager.dispose();
        expect(h.files[1].view.close).toHaveBeenCalledOnce();
        expect(await h.manager.openFile(2, 'q', page, 'owner')).toMatchObject({ ok: false, reason: 'busy' });
    });

    it.each<BrowserEngine>(['electron', 'webview2'])('openSource sends a file source to the file host even when the related engine is %s', async engine => {
        const h = harness('webview2');
        expect(await h.manager.openSource(1, 'p', { kind: 'file', path: page }, 'owner', engine)).toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        expect(h.files).toHaveLength(1);
        expect(h.created).toHaveLength(0);
    });

    it('openSource opens url sources and bare URL strings on the engine preference', async () => {
        const h = harness('webview2');
        expect(await h.manager.openSource(1, 'a', { kind: 'url', url: 'https://example.test/' }, 'owner')).toEqual({ ok: true, engine: 'webview2', sourceKind: 'url' });
        expect(await h.manager.openSource(1, 'b', 'https://example.test/', 'owner', 'electron')).toEqual({ ok: true, engine: 'electron', sourceKind: 'url' });
        expect(h.created.map(c => c.engine)).toEqual(['webview2', 'electron']);
        expect(h.files).toHaveLength(0);
    });

    it('openSource refuses malformed sources, unknown kinds and file URLs in url sources', async () => {
        const h = harness();
        expect(await h.manager.openSource(1, 'p', { kind: 'url', url: htmlPageFileUrl(page) }, 'owner')).toMatchObject({ ok: false });
        expect(await h.manager.openSource(1, 'p', { kind: 'file', path: 'index.html' }, 'owner')).toEqual({ ok: false, reason: 'not-absolute' });
        expect(await h.manager.openSource(1, 'p', { kind: 'file', path: path.join(dir, 'style.css') }, 'owner')).toEqual({ ok: false, reason: 'not-html' });
        expect(await h.manager.openSource(1, 'p', { kind: 'file', url: page }, 'owner')).toEqual({ ok: false, reason: 'invalid' });
        expect(await h.manager.openSource(1, 'p', { kind: 'server-file', path: page }, 'owner')).toEqual({ ok: false, reason: 'unsupported' });
        expect(await h.manager.openSource(1, 'p', null, 'owner')).toEqual({ ok: false, reason: 'invalid' });
        expect(h.created).toHaveLength(0);
        expect(h.files).toHaveLength(0);
    });

    it('opens a view externally only for its own kind of page', async () => {
        const h = harness();
        const open = vi.fn(async () => {});
        await h.manager.openFile(1, 'p', page, 'owner');
        await h.manager.open(1, 'web', 'https://example.test/', 'owner');
        await h.manager.openExternal(1, 'p', open);
        await h.manager.openExternal(1, 'web', open);
        await h.manager.openExternal(1, 'missing', open);
        expect(open.mock.calls).toEqual([[htmlPageFileUrl(page)], ['https://example.test/']]);
        vi.spyOn(h.created[0].view, 'snapshot').mockReturnValue({ ...h.created[0].view.snapshot(), url: 'file:///etc/hosts' });
        await h.manager.openExternal(1, 'web', open);
        expect(open).toHaveBeenCalledTimes(2);
    });

    it('retries a preview whose startup failed', async () => {
        const h = harness();
        vi.mocked(h.fileHost.create).mockRejectedValueOnce(new BrowserHostError('no-window', 'Preview window is closed.'));
        expect(await h.manager.openFile(1, 'p', page, 'owner')).toEqual({ ok: false, reason: 'no-window', message: 'Preview window is closed.', engine: 'electron' });
        expect(await h.manager.openFile(1, 'p', page, 'owner')).toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        expect(h.files).toHaveLength(1);
    });
});

describe('htmlPage load state mapping', () => {
    const base = { viewId: 'html-page:p', engine: 'electron' as const, url: 'file:///a/index.html', title: 'A', canGoBack: false, canGoForward: false, loading: false };
    it('maps loading, loaded and failed snapshots', () => {
        expect(toHtmlPageLoadState('p', { ...base, loading: true })).toEqual({ pageId: 'p', status: 'loading', url: base.url });
        expect(toHtmlPageLoadState('p', base)).toEqual({ pageId: 'p', status: 'loaded', url: base.url });
        expect(toHtmlPageLoadState('p', { ...base, error: 'ERR_FILE_NOT_FOUND' })).toEqual({ pageId: 'p', status: 'failed', url: base.url, error: 'ERR_FILE_NOT_FOUND' });
        expect(toHtmlPageLoadState('p', { ...base, url: '' })).toEqual({ pageId: 'p', status: 'loaded', url: undefined });
    });
});

describe('htmlPage open result mapping', () => {
    it('narrows merged-API results to the htmlPage reply shape', () => {
        expect(toHtmlPageOpenResult({ ok: true, engine: 'electron', sourceKind: 'file' })).toEqual({ ok: true });
        for (const reason of ['invalid', 'not-absolute', 'not-html', 'missing', 'not-file', 'bad-id']) {
            expect(toHtmlPageOpenResult({ ok: false, reason })).toEqual({ ok: false, reason });
        }
        expect(toHtmlPageOpenResult({ ok: false, reason: 'busy' })).toEqual({ ok: false, reason: 'no-window' });
        expect(toHtmlPageOpenResult({ ok: false, reason: 'bad-session' })).toEqual({ ok: false, reason: 'no-window' });
    });
});

describe.each<BrowserEngine>(['electron', 'webview2'])('%s cookie imports', engine => {
    it('uses the owning tab engine after redirects or preference changes and rejects foreign owners', async () => {
        const h = harness(engine);
        await h.manager.open(1, 'view', 'https://login.example.com/', 'workspace-a');
        await h.manager.select(engine === 'electron' ? 'webview2' : 'electron');
        const view = h.created[0].view;
        view.importCookies = vi.fn(async () => {});
        expect(await h.manager.importCookies(2, 'view', 'app.example.com', 'session=token')).toMatchObject({ ok: false, reason: 'not-found' });
        expect(await h.manager.importCookies(1, 'view', 'app.example.com', 'session=token')).toEqual({ ok: true });
        expect(view.importCookies).toHaveBeenCalledWith([expect.objectContaining({ url: 'https://app.example.com/', name: 'session', value: 'token' })]);
        expect(view.navigate).not.toHaveBeenCalled();
        expect(await h.manager.importCookies(1, 'view', 'app.example.com', '[{"name":"a","value":"secret","domain":"evil.test"}]')).toMatchObject({ ok: false, reason: 'invalid' });
        expect(view.importCookies).toHaveBeenCalledTimes(1);
    });
    it('waits for an import before clearing and rejects new imports during cleanup', async () => {
        const h = harness(engine);
        await h.manager.open(1, 'view', 'https://login.example.com/', 'workspace');
        let finish!: () => void;
        h.created[0].view.importCookies = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        const importing = h.manager.importCookies(1, 'view', 'app.example.com', 'a=b');
        await vi.waitFor(() => expect(h.created[0].view.importCookies).toHaveBeenCalled());
        const clearing = h.manager.clear(engine);
        expect(await h.manager.importCookies(1, 'view', 'app.example.com', 'a=b')).toEqual({ ok: false, reason: 'busy' });
        expect(h.hosts[engine].clearData).not.toHaveBeenCalled();
        finish();
        expect(await importing).toEqual({ ok: true });
        expect(await clearing).toEqual({ ok: true });
        expect(h.hosts[engine].clearData).toHaveBeenCalled();
    });
    it('does not disclose engine error details', async () => {
        const h = harness(engine);
        await h.manager.open(1, 'view', 'https://login.example.com/', 'workspace');
        h.created[0].view.importCookies = vi.fn(async () => { throw new Error('secret token'); });
        const reply = await h.manager.importCookies(1, 'view', 'app.example.com', 'a=b');
        expect(reply).toMatchObject({ ok: false, reason: 'invalid' });
        expect(JSON.stringify(reply)).not.toContain('secret');
    });
});

describe.each<BrowserEngine>(['electron', 'webview2'])('%s blank-tab cookie imports', engine => {
    it('imports into the default profile without creating a view or navigating', async () => {
        const h = harness(engine);
        expect(await h.manager.importCookies(1, null, 'app.example.com', 'a=b')).toEqual({ ok: true });
        expect(h.hosts[engine].importCookies).toHaveBeenCalledWith([expect.objectContaining({ name: 'a', value: 'b' })]);
        expect(h.created).toHaveLength(0);
        expect(h.send).not.toHaveBeenCalled();
        const other = engine === 'electron' ? 'webview2' : 'electron';
        expect(await h.manager.importCookies(2, null, 'app.example.com', 'a=b', other)).toEqual({ ok: true });
        expect(h.hosts[other].importCookies).toHaveBeenCalledOnce();
        expect(await h.manager.importCookies(1, 'missing', 'app.example.com', 'a=b')).toMatchObject({ reason: 'not-found' });
        expect(await h.manager.importCookies(1, null, 'app.example.com', 'a=b', 'unknown')).toMatchObject({ reason: 'bad-engine' });
    });
    it('waits for profile imports during cleanup and blocks further imports', async () => {
        const h = harness(engine);
        let finish!: () => void;
        vi.mocked(h.hosts[engine].importCookies!).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const importing = h.manager.importCookies(1, null, 'app.example.com', 'a=b');
        await vi.waitFor(() => expect(h.hosts[engine].importCookies).toHaveBeenCalled());
        const clearing = h.manager.clear(engine);
        expect(await h.manager.importCookies(2, null, 'app.example.com', 'a=b')).toEqual({ ok: false, reason: 'busy' });
        expect(h.hosts[engine].clearData).not.toHaveBeenCalled();
        finish();
        expect(await importing).toEqual({ ok: true });
        expect(await clearing).toEqual({ ok: true });
    });
    it('returns unavailable-engine errors without creating a browser', async () => {
        const h = harness(engine);
        vi.mocked(h.hosts[engine].availability).mockResolvedValue({ engine, available: false, reason: 'missing-runtime' });
        expect(await h.manager.importCookies(1, null, 'app.example.com', 'a=b')).toMatchObject({ ok: false, reason: 'missing-runtime' });
        expect(h.hosts[engine].importCookies).not.toHaveBeenCalled();
        expect(h.created).toHaveLength(0);
    });
});
