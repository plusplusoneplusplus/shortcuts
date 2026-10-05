import { describe, expect, it, vi } from 'vitest';
import { BrowserHostManager } from '../src/browser-host-manager';
import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserViewRequest } from '../src/browser-host-contract';
import { BROWSER_VIEW_CLOSED_CHANNEL, BROWSER_VIEW_NEW_TAB_CHANNEL, BROWSER_VIEW_STATE_CHANNEL, type BrowserEngine } from '../src/browser-view-policy';

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
    const manager = new BrowserHostManager({ hosts, getDefault: () => defaultEngine, saveDefault: engine => { defaultEngine = engine; }, send, changed });
    return { manager, hosts, created, send, changed };
}

describe.each<BrowserEngine>(['electron', 'webview2'])('%s shared browser manager contract', engine => {
    it('is idempotent and holds its engine when the global default changes', async () => {
        const h = harness(engine);
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'workspace-a')).toEqual({ ok: true, engine });
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
        expect(await h.manager.open(1, 'reused-id', 'https://new.test/', 'owner')).toEqual({ ok: true, engine });
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
    });
    it('retains an unavailable preference and never falls back, then retries its original engine', async () => {
        const h = harness();
        vi.mocked(h.hosts.webview2.availability).mockResolvedValue({ engine: 'webview2', available: false, reason: 'missing-runtime', message: 'Install the runtime.' });
        expect(await h.manager.select('webview2')).toEqual({ ok: true });
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'owner')).toMatchObject({ ok: false, engine: 'webview2', reason: 'missing-runtime' });
        expect(h.created).toHaveLength(0);
        await h.manager.select('electron');
        vi.mocked(h.hosts.webview2.availability).mockResolvedValue({ engine: 'webview2', available: true });
        expect(await h.manager.open(1, 'view', 'https://example.test/', 'owner')).toEqual({ ok: true, engine: 'webview2' });
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
