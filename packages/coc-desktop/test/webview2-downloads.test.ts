import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserDownloadStore, MAX_ACTIVE_DOWNLOADS } from '../src/browser-downloads';
import { WebView2Downloads, MAX_PENDING_WEBVIEW2_DOWNLOADS, supportedWebView2Download, type WebView2DownloadApproval } from '../src/webview2-downloads';
import { validateBrowserUrl } from '../src/browser-view-policy';

const fixtures: ReturnType<typeof setup>[] = [];
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function id(index = 1) { return `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`; }
function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-webview2-download-'));
    const store = new BrowserDownloadStore(dir);
    const request = vi.fn(async (_op: string, _payload: Record<string, unknown>) => {});
    const manager = new WebView2Downloads(store, request);
    const chooser = deferred<string | undefined>();
    const approval: WebView2DownloadApproval = {
        ownerId: 7, current: vi.fn(() => true), dispose: vi.fn(),
        chooseDestination: vi.fn(() => chooser.promise), failure: vi.fn(),
    };
    const start = (url = 'blob:https://fixture.test/opaque', index = 1, lease = approval, filename = 'report.csv', view = '7:tab:1') =>
        manager.start(view, id(index), url, filename, lease);
    const progress = (state = 'completed', received = 5, viewId = '7:tab:1', index = 1) => manager.progress({
        event: 'download-progress', viewId, downloadId: id(index), state, received, total: 5,
        final: !['downloading', 'paused'].includes(state), canPause: state === 'downloading', canResume: state === 'paused',
    });
    const fixture = { dir, store, manager, request, chooser, approval, start, progress };
    fixtures.push(fixture);
    return fixture;
}
afterEach(async () => {
    vi.useRealTimers();
    for (const fixture of fixtures.splice(0)) {
        await fixture.manager.dispose(); await fixture.store.dispose();
        fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
});

describe('original WebView2 managed downloads', () => {
    it.each(['blob:https://fixture.test/opaque', 'blob:null/opaque', 'https://fixture.test/export?private=value', 'http://fixture.test/export'])(
        'admits %s only through native approval and truthful completion', async url => {
            const h = setup(); h.start(url);
            expect(h.request).not.toHaveBeenCalled();
            expect(h.approval.chooseDestination).toHaveBeenCalledExactlyOnceWith('report.csv');
            h.progress('downloading', 2);
            expect((await h.store.query()).entries[0]).toMatchObject({ state: 'downloading', received: 0, canPause: false, engine: 'webview2' });
            const file = path.join(h.dir, 'selected.csv'); fs.writeFileSync(file, 'a,b\n1');
            h.chooser.resolve(file); await tick();
            expect(h.request).toHaveBeenCalledExactlyOnceWith('download-decide', {
                viewId: '7:tab:1', downloadId: id(), action: 'approve', destination: file,
            });
            expect((await h.store.query()).entries[0].state).toBe('downloading');
            h.progress('downloading', 2);
            const publicId = (await h.store.query()).entries[0].id;
            await h.store.action(publicId, 'pause', { open: async () => '', show: () => {} });
            expect(h.request).toHaveBeenLastCalledWith('download-action', { viewId: '7:tab:1', downloadId: id(), action: 'pause' });
            h.progress('paused', 2);
            await h.store.action(publicId, 'resume', { open: async () => '', show: () => {} });
            expect(h.request).toHaveBeenLastCalledWith('download-action', { viewId: '7:tab:1', downloadId: id(), action: 'resume' });
            h.progress();
            const query = await h.store.query();
            expect(query.entries[0]).toMatchObject({ state: 'completed', received: 5, fileAvailable: true, filename: 'selected.csv' });
            expect(query.engines.webview2.managed).toBe(true);
            const publicJson = JSON.stringify(query);
            for (const privateValue of [url, file, 'destination', 'downloadId', 'private=value']) expect(publicJson).not.toContain(privateValue);
            const restarted = new BrowserDownloadStore(h.dir);
            expect((await restarted.query()).entries[0]).toMatchObject({ engine: 'webview2', state: 'completed', fileAvailable: true });
            await restarted.dispose();
        },
    );
    it('does not broaden browser navigation for blob exports', () => {
        expect(supportedWebView2Download('blob:https://fixture.test/opaque')).toBe(true);
        expect(validateBrowserUrl('blob:https://fixture.test/opaque').ok).toBe(false);
        expect(supportedWebView2Download('blob:')).toBe(false);
        expect(supportedWebView2Download('blob:null/' + 'x'.repeat(16384))).toBe(false);
        expect(supportedWebView2Download('blob:null/' + '\u0085')).toBe(false);
    });
    it.each(['file:///secret', 'data:text/csv,a,b', 'javascript:alert(1)', 'ftp://fixture.test/file', 'https://fixture.test/\0', 'bad'])(
        'rejects unsupported or malformed %s without a chooser', async url => {
            const h = setup(); h.start(url);
            expect(h.approval.chooseDestination).not.toHaveBeenCalled();
            expect(h.request).toHaveBeenCalledWith('download-decide', expect.objectContaining({ action: 'cancel' }));
            expect((await h.store.query()).entries).toHaveLength(0);
        },
    );
    it.each(['C:\\private\\..\\CON.csv', '../../report?.csv', 'a\u202eb.csv', '/tmp/NUL', 'C:\\folder\\'])(
        'sanitizes page-supplied filename %s, never using it as a path', filename => {
            const h = setup(); h.start(undefined, 1, h.approval, filename);
            const proposed = vi.mocked(h.approval.chooseDestination).mock.calls[0][0];
            expect(proposed).not.toMatch(/[\\/\u202e?]/);
            expect(path.isAbsolute(proposed)).toBe(false);
        },
    );
    it.each(['relative.csv', '\\\\?\\C:\\secret', '\\\\.\\pipe\\private', `bad\0.csv`])('rejects invalid chooser destination %s', async destination => {
        const h = setup(); h.start(); h.chooser.resolve(destination); await tick();
        expect(h.request.mock.calls.some(([op, payload]) => op === 'download-decide' && payload.action === 'approve')).toBe(false);
        expect((await h.store.query()).entries[0]).toMatchObject({ state: 'failed', fileAvailable: false });
    });
    it('cancels a native chooser dismissal without saving or reporting failure', async () => {
        const h = setup(); h.start(); h.chooser.resolve(undefined); await tick();
        expect(h.request).toHaveBeenCalledExactlyOnceWith('download-decide', { viewId: '7:tab:1', downloadId: id(), action: 'cancel' });
        expect((await h.store.query()).entries[0].state).toBe('cancelled');
        expect(h.approval.failure).not.toHaveBeenCalled();
    });
    it.each(['view', 'owner', 'timeout', 'host', 'chooser-error'])('rejects late approval after %s revocation', async reason => {
        vi.useFakeTimers(); const h = setup(); h.start();
        if (reason === 'view') h.manager.revokeView('7:tab:1');
        if (reason === 'owner') { vi.mocked(h.approval.current).mockReturnValue(false); await vi.advanceTimersByTimeAsync(100); }
        if (reason === 'timeout') await vi.advanceTimersByTimeAsync(60_000);
        if (reason === 'host') h.manager.failed();
        if (reason === 'chooser-error') h.chooser.reject(new Error('private/path'));
        else h.chooser.resolve(path.join(h.dir, 'late.csv'));
        await tick(); vi.useRealTimers();
        expect(h.request.mock.calls.some(([, payload]) => payload.action === 'approve')).toBe(false);
        expect((await h.store.query()).entries[0]).toMatchObject({ active: false, fileAvailable: false });
    });
    it('binds progress to a one-time operation and exact native view; approved transfers survive source closure', async () => {
        const h = setup(); h.start();
        h.start(undefined, 1, { ...h.approval, ownerId: 8 });
        expect(h.approval.chooseDestination).toHaveBeenCalledOnce();
        h.progress('completed', 5, '8:tab:1');
        expect((await h.store.query()).entries[0].active).toBe(true);
        const file = path.join(h.dir, 'saved.csv'); fs.writeFileSync(file, '12345');
        h.chooser.resolve(file); await tick();
        h.manager.revokeView('7:tab:1');
        vi.mocked(h.approval.current).mockReturnValue(false);
        h.progress();
        expect((await h.store.query()).entries[0]).toMatchObject({ state: 'completed', fileAvailable: true });
        h.progress('failed');
        expect((await h.store.query()).entries[0].state).toBe('completed');
        h.start(undefined, 1, { ...h.approval, ownerId: 9, current: () => true });
        expect(h.approval.chooseDestination).toHaveBeenCalledOnce();
    });
    it.each(['premature', 'missing', 'wrong-size', 'incomplete-count', 'malformed'])('rejects false completion: %s', async reason => {
        const h = setup(); h.start();
        const file = path.join(h.dir, 'file.csv');
        if (reason === 'premature') h.progress();
        else {
            if (reason !== 'missing') fs.writeFileSync(file, reason === 'wrong-size' ? '1' : '12345');
            h.chooser.resolve(file); await tick();
            if (reason === 'malformed') h.manager.progress({ downloadId: id(), viewId: '7:tab:1', state: 'completed', final: false });
            else h.progress('completed', reason === 'incomplete-count' ? 3 : 5);
        }
        expect((await h.store.query()).entries[0]).toMatchObject({ state: 'failed', active: false, fileAvailable: false });
    });
    it('stages native completion until the one-time approval command acknowledges', async () => {
        const h = setup(); const ack = deferred<void>();
        h.request.mockReturnValueOnce(ack.promise);
        h.start(); const file = path.join(h.dir, 'saved.csv'); fs.writeFileSync(file, '12345');
        h.chooser.resolve(file); await tick(); h.progress();
        expect((await h.store.query()).entries[0]).toMatchObject({ active: true, fileAvailable: false });
        ack.resolve(); await tick();
        expect((await h.store.query()).entries[0]).toMatchObject({ state: 'completed', fileAvailable: true });
    });
    it('never enables resume or completed-file actions for an interrupted native transfer', async () => {
        const h = setup(); h.start(); h.chooser.resolve(path.join(h.dir, 'file')); await tick();
        h.progress('interrupted', 3);
        const record = (await h.store.query()).entries[0];
        expect(record).toMatchObject({ state: 'interrupted', canResume: false, canPause: false, fileAvailable: false });
        for (const action of ['resume', 'open', 'show']) {
            await expect(h.store.action(record.id, action, { open: async () => '', show: () => {} })).rejects.toThrow('unavailable');
        }
    });
    it('reports approval and active native failures without claiming success or leaking diagnostics', async () => {
        const h = setup(); h.start(); h.request.mockRejectedValueOnce(new Error('private/path'));
        h.chooser.resolve(path.join(h.dir, 'file')); await tick();
        expect((await h.store.query()).entries[0].state).toBe('failed');
        expect(h.approval.failure).toHaveBeenCalledOnce();
    });
    it('rejects active action failures and cancels the native transfer without automatic retry', async () => {
        const h = setup(); h.start();
        h.chooser.resolve(path.join(h.dir, 'file.csv')); await tick(); h.progress('downloading', 2);
        const record = (await h.store.query()).entries[0];
        h.request.mockRejectedValueOnce(new Error('private/path'));
        await expect(h.store.action(record.id, 'pause', { open: async () => '', show: () => {} })).rejects.toThrow('Native download action failed.');
        expect(h.request).toHaveBeenLastCalledWith('download-action', { viewId: '7:tab:1', downloadId: id(), action: 'cancel' });
        expect((await h.store.query()).entries[0]).toMatchObject({ state: 'failed', active: false });
    });
    it('bounds pending dialogs across owners and keeps at most one unsettled chooser per owner', async () => {
        const h = setup();
        for (let i = 1; i <= MAX_PENDING_WEBVIEW2_DOWNLOADS + 1; i++) h.start(undefined, i, { ...h.approval, ownerId: i });
        expect(h.approval.chooseDestination).toHaveBeenCalledTimes(MAX_PENDING_WEBVIEW2_DOWNLOADS);
        expect((await h.store.query()).entries).toHaveLength(MAX_PENDING_WEBVIEW2_DOWNLOADS);
        h.manager.revokeView('7:tab:1');
        h.start(undefined, 100, { ...h.approval, ownerId: 1 });
        expect(h.approval.chooseDestination).toHaveBeenCalledTimes(MAX_PENDING_WEBVIEW2_DOWNLOADS);
    });
    it('shares active admission with Electron transfers and blocks downloads during shutdown', async () => {
        const h = setup();
        const handles = { pause() {}, resume() {}, cancel() {}, dispose() {} };
        for (let i = 0; i < MAX_ACTIVE_DOWNLOADS; i++) h.store.start('file', 'https://fixture.test', handles);
        h.start();
        expect(h.approval.chooseDestination).not.toHaveBeenCalled();
        await h.manager.dispose();
        h.start(undefined, 2, { ...h.approval, ownerId: 8 });
        expect(h.approval.chooseDestination).not.toHaveBeenCalled();
    });
    it('cancels native operations on shutdown and marks live transfers interrupted', async () => {
        const h = setup(); h.start(); await h.manager.dispose();
        expect(h.request).toHaveBeenCalledWith('download-decide', expect.objectContaining({ action: 'cancel' }));
        expect((await h.store.query()).entries[0]).toMatchObject({ state: 'interrupted', active: false });
        h.chooser.resolve(path.join(h.dir, 'late')); await tick();
        expect(h.request.mock.calls.some(([, payload]) => payload.action === 'approve')).toBe(false);
    });
    it('preserves observed native byte progress on host failure and permits new downloads after engine cleanup', async () => {
        const h = setup(); h.start(); h.chooser.resolve(path.join(h.dir, 'file')); await tick();
        h.progress('downloading', 3); h.manager.failed();
        expect((await h.store.query()).entries[0]).toMatchObject({ state: 'interrupted', received: 3, total: 5, fileAvailable: false });
        await h.manager.cancelAll();
        h.start(undefined, 2, { ...h.approval, ownerId: 8 });
        expect(h.approval.chooseDestination).toHaveBeenCalledTimes(2);
    });
});
