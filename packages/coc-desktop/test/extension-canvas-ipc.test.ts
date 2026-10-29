import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn(),
    create: vi.fn(), dispose: vi.fn(), trusted: true, fetch: vi.fn(),
}));
vi.mock('electron', () => ({
    ipcMain: { handle: mocks.handle, on: mocks.on, removeHandler: mocks.removeHandler, removeListener: mocks.removeListener },
}));
vi.mock('../src/browser-webview-guard', () => ({ isBrowserEmbedder: () => mocks.trusted }));
vi.mock('../src/extension-canvas-host', () => ({
    ExtensionCanvasHost: class { create = mocks.create; dispose = mocks.dispose; },
}));

function sender(id = 1) {
    return Object.assign(new EventEmitter(), {
        id, mainFrame: {}, getURL: () => 'http://127.0.0.1:4000/#repos/workspace',
        send: vi.fn(),
    });
}
function event(contents = sender()) { return { sender: contents, senderFrame: contents.mainFrame }; }
function response(overrides: Record<string, unknown> = {}, status = 200) {
    return new Response(JSON.stringify({
        success: true, canvasId: 'canvas-1', extensionKey: 'workspace:counter',
        title: 'Counter', url: 'http://127.0.0.1:8123/', ...overrides,
    }), { status, headers: { 'Content-Type': 'application/json' } });
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
async function harness() {
    const ipc = await import('../src/extension-canvas-ipc');
    let server: string | undefined = 'http://127.0.0.1:4000/';
    ipc.registerExtensionCanvasIpc(() => server);
    const open = mocks.handle.mock.calls.find(([channel]) => channel === ipc.EXTENSION_CANVAS_OPEN_CHANNEL)![1];
    const adopt = mocks.handle.mock.calls.find(([channel]) => channel === ipc.EXTENSION_CANVAS_ADOPT_CHANNEL)![1];
    const close = mocks.on.mock.calls.find(([channel]) => channel === ipc.EXTENSION_CANVAS_CLOSE_CHANNEL)![1];
    return { ipc, open, adopt, close, setServer: (value: string | undefined) => { server = value; } };
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.trusted = true;
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockImplementation(async () => response());
    mocks.create.mockImplementation(() => ({
        embed: 'webview', src: 'http://127.0.0.1:8123/', partition: 'owner-token',
        adopt: vi.fn(), close: vi.fn(),
    }));
});
afterEach(async () => {
    (await import('../src/extension-canvas-ipc')).disposeExtensionCanvasIpc();
    vi.unstubAllGlobals();
});

describe('extension canvas IPC', () => {
    it('reopens only the saved identity against the main-owned local server', async () => {
        const h = await harness();
        const owner = event();
        expect(await h.open(owner, 'view', 'workspace', 'canvas-1')).toEqual({
            ok: true, embed: 'webview', src: 'http://127.0.0.1:8123/', partition: 'owner-token', title: 'Counter',
        });
        const [url, options] = mocks.fetch.mock.calls[0];
        expect(String(url)).toBe('http://127.0.0.1:4000/api/workspaces/workspace/canvases/canvas-1/copilot-extension/open');
        expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
        expect(options).not.toHaveProperty('body');
        expect(mocks.create).toHaveBeenCalledWith(
            { ownerId: owner.sender.id, extensionKey: 'workspace:counter', url: 'http://127.0.0.1:8123/' },
            expect.objectContaining({ state: expect.any(Function), closed: expect.any(Function) }),
        );
        h.adopt(owner, 'view', 10);
        expect(mocks.create.mock.results[0].value.adopt).toHaveBeenCalledExactlyOnceWith(10);
        const sink = mocks.create.mock.calls[0][1];
        sink.state({ status: 'loaded' });
        expect(owner.sender.send).toHaveBeenCalledWith(h.ipc.EXTENSION_CANVAS_STATE_CHANNEL, { viewId: 'view', status: 'loaded' });
    });

    it('rejects foreign frames, unknown embedders, remote servers and malformed identities before I/O', async () => {
        const h = await harness();
        const owner = event();
        expect(await h.open({ ...owner, senderFrame: {} }, 'view', 'workspace', 'canvas-1')).toMatchObject({ ok: false });
        mocks.trusted = false;
        expect(await h.open(owner, 'view', 'workspace', 'canvas-1')).toMatchObject({ ok: false });
        mocks.trusted = true;
        for (const server of [undefined, 'https://remote.test/', 'http://127.0.0.1:5000/']) {
            h.setServer(server);
            expect(await h.open(owner, 'view', 'workspace', 'canvas-1')).toMatchObject({ ok: false });
        }
        h.setServer('http://127.0.0.1:4000/');
        for (const ids of [
            ['', 'workspace', 'canvas-1'], ['view', '../workspace', 'canvas-1'],
            ['view', 'remote:server:workspace', 'canvas-1'], ['view', 'workspace', 'canvas/other'],
            ['view\nbad', 'workspace', 'canvas-1'],
        ]) expect(await h.open(owner, ...ids)).toMatchObject({ ok: false });
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('preserves server failures including disabled flags and structured CanvasError messages', async () => {
        const h = await harness();
        for (const [status, error, message] of [
            [404, 'Not found', 'Not found'],
            [422, { code: 'fixture-error', message: 'Rejected action' }, 'Rejected action'],
        ] as const) {
            mocks.fetch.mockResolvedValueOnce(response({ success: false, error }, status));
            expect(await h.open(event(), 'view', 'workspace', 'canvas-1')).toEqual({ ok: false, message });
        }
        mocks.fetch.mockRejectedValueOnce(new Error('Network failed'));
        expect(await h.open(event(), 'view', 'workspace', 'canvas-1')).toEqual({ ok: false, message: 'Network failed' });
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('rejects malformed or wrong-record replies and invalid runtime URLs', async () => {
        const h = await harness();
        for (const overrides of [
            { canvasId: 'other' }, { success: false }, { extensionKey: null }, { url: null }, { title: null },
        ]) {
            mocks.fetch.mockResolvedValueOnce(response(overrides));
            expect(await h.open(event(), 'view', 'workspace', 'canvas-1')).toEqual({ ok: false, message: 'Invalid canvas reopening response.' });
        }
        mocks.create.mockImplementationOnce(() => { throw new Error('Invalid canvas extension source.'); });
        expect(await h.open(event(), 'view', 'workspace', 'canvas-1')).toEqual({ ok: false, message: 'Invalid canvas extension source.' });
    });

    it('cancels pending requests on close, reload, crash and destruction without creating a late guest', async () => {
        const h = await harness();
        for (const [index, action] of ['close', 'reload', 'crash', 'destroy'].entries()) {
            const owner = event(sender(index + 1));
            const pending = deferred<Response>();
            mocks.fetch.mockReturnValueOnce(pending.promise);
            const opened = h.open(owner, 'view', 'workspace', 'canvas-1');
            const signal = mocks.fetch.mock.calls.at(-1)![1].signal as AbortSignal;
            if (action === 'close') h.close(owner, 'view');
            if (action === 'reload') owner.sender.emit('did-start-navigation', {}, 'http://127.0.0.1:4000/', false, true);
            if (action === 'crash') owner.sender.emit('render-process-gone');
            if (action === 'destroy') owner.sender.emit('destroyed');
            expect(signal.aborted).toBe(true);
            pending.resolve(response());
            expect(await opened).toMatchObject({ ok: false });
        }
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('does not let a superseded request destroy a replacement or another window view', async () => {
        const h = await harness();
        const owner = event();
        const pending = deferred<Response>();
        mocks.fetch.mockReturnValueOnce(pending.promise);
        const first = h.open(owner, 'view', 'workspace', 'canvas-1');
        expect(await h.open(owner, 'view', 'workspace', 'canvas-1')).toMatchObject({ ok: true });
        const replacement = mocks.create.mock.results[0].value;
        pending.resolve(response());
        expect(await first).toMatchObject({ ok: false });
        expect(replacement.close).not.toHaveBeenCalled();
        const sibling = event(sender(2));
        expect(await h.open(sibling, 'view', 'workspace', 'canvas-1')).toMatchObject({ ok: true });
        h.close(owner, 'view');
        expect(replacement.close).toHaveBeenCalledOnce();
        expect(mocks.create.mock.results[1].value.close).not.toHaveBeenCalled();
        expect(() => h.adopt(owner, 'view', 99)).toThrow('unavailable');
        expect(() => h.adopt({ ...sibling, senderFrame: {} }, 'view', 10)).toThrow('Invalid');
        expect(() => h.adopt(sibling, 'view', '10')).toThrow('Invalid');
        h.adopt(sibling, 'view', 10);
    });

    it('revalidates server/owner after I/O and closes failed guests with state notification', async () => {
        const h = await harness();
        const owner = event();
        const pending = deferred<Response>();
        mocks.fetch.mockReturnValueOnce(pending.promise);
        const opened = h.open(owner, 'view', 'workspace', 'canvas-1');
        mocks.trusted = false;
        pending.resolve(response());
        expect(await opened).toMatchObject({ ok: false });
        expect(mocks.create).not.toHaveBeenCalled();
        mocks.trusted = true;
        await h.open(owner, 'view', 'workspace', 'canvas-1');
        mocks.create.mock.calls[0][1].closed();
        expect(mocks.create.mock.results[0].value.close).toHaveBeenCalledOnce();
        expect(owner.sender.send).toHaveBeenLastCalledWith(h.ipc.EXTENSION_CANVAS_STATE_CHANNEL, {
            viewId: 'view', status: 'failed', error: 'Canvas guest closed.',
        });
    });

    it('unregisters IPC and drains pending and attached guests at shutdown', async () => {
        const h = await harness();
        const owner = event();
        await h.open(owner, 'view', 'workspace', 'canvas-1');
        h.ipc.registerExtensionCanvasIpc(() => 'http://127.0.0.1:4000/');
        expect(mocks.handle).toHaveBeenCalledTimes(2);
        h.ipc.disposeExtensionCanvasIpc();
        expect(mocks.create.mock.results[0].value.close).toHaveBeenCalledOnce();
        expect(mocks.dispose).toHaveBeenCalledOnce();
        expect(mocks.removeHandler.mock.calls).toEqual([
            [h.ipc.EXTENSION_CANVAS_OPEN_CHANNEL], [h.ipc.EXTENSION_CANVAS_ADOPT_CHANNEL],
        ]);
        expect(owner.sender.listenerCount('did-start-navigation')).toBe(0);
        expect(await h.open(owner, 'view', 'workspace', 'canvas-1')).toMatchObject({ ok: false });
    });
});
