import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebView2Process } from '../src/webview2-process';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => mocks.spawn(...args) }));

function child() {
    const process = Object.assign(new EventEmitter(), {
        stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
        stderr: new EventEmitter(),
        stdin: Object.assign(new EventEmitter(), { write: vi.fn() }),
        kill: vi.fn(),
        exitCode: null as number | null,
    });
    return process;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('WebView2 UI-process transport', () => {
    it('waits for startup and frames commands and responses across partial chunks', async () => {
        const native = child();
        mocks.spawn.mockReturnValue(native);
        const failure = vi.fn();
        const transport = new WebView2Process(() => 'native-host', 'profile', vi.fn(), failure);
        const open = transport.request('open', { viewId: 'owned-view', url: 'https://example.test/' });
        expect(native.stdin.write).not.toHaveBeenCalled();
        native.stdout.emit('data', '{"event":"rea');
        native.stdout.emit('data', 'dy"}\n');
        await vi.waitFor(() => expect(native.stdin.write).toHaveBeenCalledTimes(1));
        const request = JSON.parse(native.stdin.write.mock.calls[0][0]);
        expect(request).toMatchObject({ id: 1, op: 'open', viewId: 'owned-view' });
        native.stdout.emit('data', `{"id":${request.id},"ok":true}\n`);
        await expect(open).resolves.toBeUndefined();
        expect(failure).not.toHaveBeenCalled();
        native.stdout.emit('data', '{"event":"state","viewId":"owned-view"}\n');
        native.stdin.write.mockImplementation((line: string) => {
            const message = JSON.parse(line);
            native.stdout.emit('data', JSON.stringify({ id: message.id, ok: true }) + '\n');
            native.exitCode = 0;
            native.emit('exit', 0, null);
        });
        await transport.dispose();
        expect(failure).not.toHaveBeenCalled();
    });

    it('reports missing runtime without falling back or changing preferences', async () => {
        const native = child();
        mocks.spawn.mockReturnValue(native);
        const failure = vi.fn();
        const transport = new WebView2Process(() => 'native-host', 'profile', vi.fn(), failure);
        const open = transport.request('open');
        native.stdout.emit('data', '{"id":0,"ok":false,"reason":"missing-runtime","message":"Install the runtime, then retry."}\n');
        await expect(open).rejects.toMatchObject({ reason: 'missing-runtime' });
        expect(native.kill).toHaveBeenCalledOnce();
        expect(failure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'missing-runtime' }));
    });

    it('recovers from synchronous native-binary resolution failure only on explicit retry', async () => {
        let available = false;
        const native = child();
        mocks.spawn.mockReturnValue(native);
        const transport = new WebView2Process(() => { if (!available) throw new Error('Native capability missing.'); return 'native-host'; }, 'profile', vi.fn(), vi.fn());
        await expect(transport.request('open')).rejects.toMatchObject({ reason: 'native-unavailable' });
        available = true;
        const retry = transport.request('open');
        native.stdout.emit('data', '{"event":"ready"}\n');
        await vi.waitFor(() => expect(native.stdin.write).toHaveBeenCalled());
        native.stdout.emit('data', '{"id":1,"ok":true}\n');
        await retry;
        native.exitCode = 0;
        native.emit('exit', 0, null);
    });

    it('reports a runtime crash, rejects in-flight work and ignores the old process after explicit retry', async () => {
        const first = child();
        const second = child();
        mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
        const events = vi.fn();
        const transport = new WebView2Process(() => 'native-host', 'profile', events, vi.fn());
        const open = transport.request('open');
        first.stdout.emit('data', '{"event":"ready"}\n');
        await vi.waitFor(() => expect(first.stdin.write).toHaveBeenCalled());
        first.emit('exit', 1, null);
        await expect(open).rejects.toMatchObject({ reason: 'runtime-crashed' });
        await expect(transport.request('bounds')).rejects.toMatchObject({ reason: 'runtime-crashed' });
        expect(mocks.spawn).toHaveBeenCalledTimes(1);
        const retry = transport.request('open');
        second.stdout.emit('data', '{"event":"ready"}\n');
        await vi.waitFor(() => expect(second.stdin.write).toHaveBeenCalled());
        first.stdout.emit('data', '{"event":"state","viewId":"stale"}\n');
        expect(events).not.toHaveBeenCalled();
        second.stdout.emit('data', '{"id":2,"ok":true}\n');
        await retry;
        second.emit('exit', 0, null);
    });

    it('rejects invalid native messages and cleans startup timers', async () => {
        const native = child();
        mocks.spawn.mockReturnValue(native);
        const transport = new WebView2Process(() => 'native-host', 'profile', vi.fn(), vi.fn());
        const open = transport.request('open');
        native.stdout.emit('data', 'malformed\n');
        await expect(open).rejects.toMatchObject({ reason: 'runtime-crashed' });
        expect(native.kill).toHaveBeenCalledOnce();
    });
});

it('cold-starts the helper for profile imports without opening a browser page', async () => {
    const native = child();
    mocks.spawn.mockReturnValue(native);
    const failure = vi.fn();
    const transport = new WebView2Process(() => 'native-host', 'profile', vi.fn(), failure);
    const importing = transport.request('import-profile-cookies', { cookies: [] });
    native.stdout.emit('data', '{"event":"ready"}\n');
    await vi.waitFor(() => expect(native.stdin.write).toHaveBeenCalled());
    expect(JSON.parse(native.stdin.write.mock.calls[0][0])).toMatchObject({ op: 'import-profile-cookies', cookies: [] });
    native.stdout.emit('data', '{"id":1,"ok":true}\n');
    await importing;
    expect(failure).not.toHaveBeenCalled();
    native.stdin.write.mockImplementation(() => { native.exitCode = 0; native.emit('exit', 0, null); });
    await transport.dispose();
});
