import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BrowserHostManager } from '../src/browser-host-manager';
import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserViewRequest, type FilePreviewHost, type FileViewRequest } from '../src/browser-host-contract';
import { BROWSER_VIEW_CLOSED_CHANNEL, BROWSER_VIEW_NEW_TAB_CHANNEL, BROWSER_VIEW_STATE_CHANNEL, type BrowserEngine } from '../src/browser-view-policy';
import { htmlPageFileUrl, toHtmlPageLoadState, toHtmlPageOpenResult } from '../src/html-page-policy';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

function harness(defaultEngine: BrowserEngine = 'electron') {
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
            };
            created.push({ request, sink, view, engine });
            return view;
        }),
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
    const manager = new BrowserHostManager({ hosts, fileHost, getDefault: () => defaultEngine, saveDefault: engine => { defaultEngine = engine; }, send, changed });
    return { manager, hosts, fileHost, files, created, send, changed };
}

describe.each<BrowserEngine>(['electron', 'webview2'])('%s shared browser manager contract', engine => {
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
        const { view, sink } = h.files[0];
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

    it('keeps file views hidden across a full SPA reload and replays them on reopen', async () => {
        const h = harness();
        await h.manager.openFile(1, 'p', page, 'owner');
        await h.manager.open(1, 'web', 'https://example.test/', 'owner');
        await h.manager.reloadOwner(1);
        expect(h.created[0].view.close).toHaveBeenCalledOnce();
        expect(h.files[0].view.close).not.toHaveBeenCalled();
        expect(h.files[0].view.setBounds).toHaveBeenLastCalledWith(null);
        h.send.mockClear();
        expect(await h.manager.openFile(1, 'p', page, 'owner')).toEqual({ ok: true, engine: 'electron', sourceKind: 'file' });
        expect(h.fileHost.create).toHaveBeenCalledOnce();
        expect(h.send).toHaveBeenCalledWith(1, BROWSER_VIEW_STATE_CHANNEL, expect.objectContaining({ viewId: 'p', sourceKind: 'file', loading: false }));
        // Reattached views survive the next reload too; the tab close still destroys them.
        await h.manager.reloadOwner(1);
        await h.manager.openFile(1, 'p', page, 'owner');
        expect(h.files[0].view.close).not.toHaveBeenCalled();
        await h.manager.close(1, 'p');
        expect(h.files[0].view.close).toHaveBeenCalledOnce();
    });

    it('closes a file view left unclaimed by the SPA across two reloads', async () => {
        const h = harness();
        await h.manager.openFile(1, 'kept', page, 'owner');
        await h.manager.openFile(1, 'orphan', page, 'owner');
        await h.manager.openFile(2, 'other', page, 'owner');
        await h.manager.reloadOwner(1);
        await h.manager.openFile(1, 'kept', page, 'owner');
        await h.manager.reloadOwner(1);
        expect(h.files[0].view.close).not.toHaveBeenCalled();
        expect(h.files[1].view.close).toHaveBeenCalledOnce();
        expect(h.files[2].view.close).not.toHaveBeenCalled();
        expect(await h.manager.openFile(1, 'orphan', page, 'owner')).toMatchObject({ ok: true });
        expect(h.fileHost.create).toHaveBeenCalledTimes(4);
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
