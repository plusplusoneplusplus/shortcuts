import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebView2Process } from '../src/webview2-process';
import { parseBrowserCookies } from '../src/browser-cookie-import';

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

it('cold-starts the helper and preserves quoted cookie values in the JSON transport without opening a page', async () => {
    const native = child();
    mocks.spawn.mockReturnValue(native);
    const failure = vi.fn();
    const transport = new WebView2Process(() => 'native-host', 'profile', vi.fn(), failure);
    const cookies = parseBrowserCookies('app.example.com', String.raw`[{"name":"fixture_session","value":"\"fixture\\segment\""}]`);
    const importing = transport.request('import-profile-cookies', { cookies });
    native.stdout.emit('data', '{"event":"ready"}\n');
    await vi.waitFor(() => expect(native.stdin.write).toHaveBeenCalled());
    expect(JSON.parse(native.stdin.write.mock.calls[0][0])).toMatchObject({ op: 'import-profile-cookies', cookies });
    native.stdout.emit('data', '{"id":1,"ok":true}\n');
    await importing;
    expect(failure).not.toHaveBeenCalled();
    native.stdin.write.mockImplementation(() => { native.exitCode = 0; native.emit('exit', 0, null); });
    await transport.dispose();
});

// Exercise the actual framed transport, not a mock of request().
describe('WebView2 CDP transport', () => {
    async function started() {
        vi.useFakeTimers();
        const native = child();
        mocks.spawn.mockReturnValue(native);
        const failure = vi.fn();
        const transport = new WebView2Process(() => 'native-host', 'profile', vi.fn(), failure);
        const opening = transport.request('open', { viewId: 'owner:tab' });
        native.stdout.emit('data', '{"event":"ready"}\n');
        await Promise.resolve();
        native.stdout.emit('data', '{"id":1,"ok":true}\n');
        await opening;
        native.stdin.write.mockClear();
        return { native, transport, failure };
    }

    it('correlates concurrent out-of-order JSON results and preserves protocol errors', async () => {
        const { native, transport, failure } = await started();
        const first = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate', params: { expression: '6 * 7' } });
        const second = transport.request('cdp', { viewId: 'owner:b', method: 'Page.captureScreenshot', params: {} });
        await Promise.resolve();
        const requests = native.stdin.write.mock.calls.map(([line]) => JSON.parse(line));
        expect(requests).toEqual([
            { id: 2, op: 'cdp', viewId: 'owner:a', method: 'Runtime.evaluate', params: { expression: '6 * 7' } },
            { id: 3, op: 'cdp', viewId: 'owner:b', method: 'Page.captureScreenshot', params: {} },
        ]);
        native.stdout.emit('data', '{"id":3,"ok":true,"result":{"data":"jpeg"}}\n{"id":2,"ok":true,"result":{"result":{"value":42}}}\n');
        await expect(first).resolves.toEqual({ result: { value: 42 } });
        await expect(second).resolves.toEqual({ data: 'jpeg' });
        const invalid = transport.request('cdp', { viewId: 'owner:a', method: 'Bad.command' });
        await Promise.resolve();
        native.stdout.emit('data', '{"id":4,"ok":false,"reason":"invalid","message":"Unknown protocol method"}\n');
        await expect(invalid).rejects.toThrow('Unknown protocol method');
        expect(failure).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('times out one CDP request, ignores its late reply and leaves other tabs running', async () => {
        const { native, transport, failure } = await started();
        const pending = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate' });
        const rejected = expect(pending).rejects.toThrow('timed out after 30s');
        await vi.advanceTimersByTimeAsync(30_000);
        await rejected;
        expect(native.kill).not.toHaveBeenCalled();
        expect(failure).not.toHaveBeenCalled();
        native.stdout.emit('data', '{"id":2,"ok":true,"result":"late"}\n');
        const next = transport.request('cdp', { viewId: 'owner:b', method: 'Runtime.evaluate' });
        await Promise.resolve();
        native.stdout.emit('data', '{"id":3,"ok":true,"result":null}\n');
        await expect(next).resolves.toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])('rejects an oversized result only and drains its frame (fragmented: %s)', async fragmented => {
        const { native, transport, failure } = await started();
        const large = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate' });
        const other = transport.request('cdp', { viewId: 'owner:b', method: 'Runtime.evaluate' });
        const rejected = expect(large).rejects.toThrow('exceeds the transport limit');
        await Promise.resolve();
        const line = JSON.stringify({ id: 2, ok: true, result: { result: { value: 'x'.repeat(1100000) } } }) + '\n';
        const good = '{"id":3,"ok":true,"result":{"result":{"value":42}}}\n';
        if (fragmented) {
            native.stdout.emit('data', line.slice(0, 1050000));
            await rejected;
            native.stdout.emit('data', line.slice(1050000, 1080000));
            native.stdout.emit('data', line.slice(1080000) + good);
        } else native.stdout.emit('data', line + good);
        await rejected;
        await expect(other).resolves.toEqual({ result: { value: 42 } });
        expect(native.kill).not.toHaveBeenCalled();
        expect(failure).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds individual frames rather than a coalesced batch of valid replies', async () => {
        const { native, transport, failure } = await started();
        const calls = [1, 2, 3].map(view => transport.request('cdp', { viewId: `owner:${view}`, method: 'Runtime.evaluate' }));
        await Promise.resolve();
        native.stdout.emit('data', calls.map((_, index) => JSON.stringify({ id: index + 2, ok: true, result: 'x'.repeat(500000) }) + '\n').join(''));
        expect(await Promise.all(calls)).toEqual(['x'.repeat(500000), 'x'.repeat(500000), 'x'.repeat(500000)]);
        expect(failure).not.toHaveBeenCalled();
        expect(native.kill).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('measures overflow in UTF-8 bytes rather than UTF-16 characters', async () => {
        const { native, transport, failure } = await started();
        const request = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate' });
        const rejected = expect(request).rejects.toThrow('exceeds the transport limit');
        await Promise.resolve();
        native.stdout.emit('data', JSON.stringify({ id: 2, ok: true, result: '\u4e00'.repeat(400000) }) + '\n');
        await rejected;
        expect(native.kill).not.toHaveBeenCalled();
        expect(failure).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects oversized commands before stdin without terminating other views', async () => {
        const { native, transport, failure } = await started();
        await expect(transport.request('cdp', { viewId: 'owner:a', method: 'Input.insertText', params: { text: 'x'.repeat(1100000) } }))
            .rejects.toThrow('command exceeds the transport limit');
        expect(native.stdin.write).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        const next = transport.request('cdp', { viewId: 'owner:b', method: 'Runtime.evaluate', params: { expression: '42' } });
        await Promise.resolve();
        native.stdout.emit('data', '{"id":3,"ok":true,"result":{"result":{"value":42}}}\n');
        await expect(next).resolves.toEqual({ result: { value: 42 } });
        expect(native.kill).not.toHaveBeenCalled();
        expect(failure).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects on tab close including a close racing command admission', async () => {
        const { native, transport } = await started();
        const pending = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate' });
        const rejected = expect(pending).rejects.toMatchObject({ reason: 'not-found' });
        transport.rejectView('owner:a');
        const closing = transport.request('close', { viewId: 'owner:a' });
        await Promise.resolve();
        await rejected;
        native.stdout.emit('data', '{"id":2,"ok":true}\n');
        expect(native.stdin.write).toHaveBeenCalledTimes(1);
        expect(JSON.parse(native.stdin.write.mock.calls[0][0]).op).toBe('close');
        await closing;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects an already dispatched call on close and ignores its late result', async () => {
        const { native, transport } = await started();
        const pending = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate' });
        const rejected = expect(pending).rejects.toMatchObject({ reason: 'not-found' });
        await Promise.resolve();
        transport.rejectView('owner:a');
        await rejected;
        native.stdout.emit('data', '{"id":2,"ok":true,"result":"late"}\n');
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([false, true])('rejects native popup close during CDP (dispatched: %s) without disturbing its opener', async dispatched => {
        const { native, transport, failure } = await started();
        const popup = transport.request('cdp', { viewId: 'owner:tab:popup:1', method: 'Runtime.evaluate' });
        const rejected = expect(popup).rejects.toMatchObject({ reason: 'not-found' });
        if (dispatched) await Promise.resolve();
        native.stdout.emit('data', '{"event":"popup-closed","viewId":"owner:tab:popup:1","rootId":"owner:tab"}\n');
        await rejected;
        const root = transport.request('cdp', { viewId: 'owner:tab', method: 'Runtime.evaluate' });
        await Promise.resolve();
        const request = JSON.parse(native.stdin.write.mock.calls.at(-1)![0]);
        native.stdout.emit('data', JSON.stringify({ id: request.id, ok: true, result: { result: { value: 42 } } }) + '\n');
        await expect(root).resolves.toEqual({ result: { value: 42 } });
        expect(failure).not.toHaveBeenCalled();
        expect(native.kill).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects only the crashed page, then rejects all work on helper exit', async () => {
        const { native, transport } = await started();
        const a = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate' });
        const b = transport.request('cdp', { viewId: 'owner:b', method: 'Runtime.evaluate' });
        const rejectedA = expect(a).rejects.toThrow('Page crashed');
        const rejectedB = expect(b).rejects.toMatchObject({ reason: 'runtime-crashed' });
        await Promise.resolve();
        native.stdout.emit('data', '{"event":"state","viewId":"owner:a","state":{"errorCode":"runtime-crashed","error":"Page crashed"}}\n');
        await rejectedA;
        expect(vi.getTimerCount()).toBe(1);
        native.emit('exit', 1, null);
        await rejectedB;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects a page crash racing admission before writing a CDP command', async () => {
        const { native, transport } = await started();
        const pending = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate' });
        const rejected = expect(pending).rejects.toThrow('Page crashed');
        native.stdout.emit('data', '{"event":"state","viewId":"owner:a","state":{"errorCode":"runtime-crashed","error":"Page crashed"}}\n');
        await rejected;
        expect(native.stdin.write).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects pending CDP immediately when disposing the helper', async () => {
        const { native, transport } = await started();
        const pending = transport.request('cdp', { viewId: 'owner:a', method: 'Runtime.evaluate' });
        const rejected = expect(pending).rejects.toThrow('host is closing');
        await Promise.resolve();
        native.stdin.write.mockImplementation(() => { native.exitCode = 0; native.emit('exit', 0, null); });
        await transport.dispose();
        await rejected;
        expect(vi.getTimerCount()).toBe(0);
    });
});
