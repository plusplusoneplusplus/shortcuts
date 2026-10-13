import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserControlQueue } from '../src/browser-control-queue';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('browser command queue', () => {
    it('returns operation results and retains one page across commands', async () => {
        const queue = new BrowserControlQueue(vi.fn());
        const first = await queue.run(async page => page);
        expect(await queue.run(async page => page)).toBe(first);
        expect(await queue.run(async () => ({ ok: true }))).toEqual({ ok: true });
    });

    it('serializes whole trusted-input sequences, not individual CDP calls', async () => {
        const gate = deferred<unknown>();
        const send = vi.fn(async (_method: string, _params?: Record<string, unknown>): Promise<unknown> => ({})).mockImplementationOnce(() => gate.promise);
        const queue = new BrowserControlQueue(send);
        const first = queue.run(page => page.press('Enter'));
        const second = queue.run(page => page.press('Tab'));
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        gate.resolve({});
        await Promise.all([first, second]);
        expect(send.mock.calls.map(call => call[1])).toEqual([
            expect.objectContaining({ type: 'keyDown', key: 'Enter' }),
            expect.objectContaining({ type: 'keyUp', key: 'Enter' }),
            expect.objectContaining({ type: 'keyDown', key: 'Tab' }),
            expect.objectContaining({ type: 'keyUp', key: 'Tab' }),
        ]);
    });

    it('does not serialize different views against each other', async () => {
        const gate = deferred<unknown>();
        const first = new BrowserControlQueue(() => gate.promise).run(page => page.scroll('down'));
        expect(await new BrowserControlQueue(async () => ({})).run(async () => 'other')).toBe('other');
        gate.resolve({});
        await first;
    });

    it('preserves engine errors and permits the next operation', async () => {
        const error = new Error('Debugger detached');
        const queue = new BrowserControlQueue(vi.fn().mockRejectedValueOnce(error).mockResolvedValue({}));
        await expect(queue.run(page => page.press('Enter'))).rejects.toBe(error);
        await expect(queue.run(page => page.press('Tab'))).resolves.toBeUndefined();
    });

    it('rejects an already cancelled command without starting it or allocating timers', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const error = new Error('Turn stopped');
        controller.abort(error);
        const operation = vi.fn();
        await expect(new BrowserControlQueue(vi.fn()).run(operation, controller.signal)).rejects.toBe(error);
        expect(operation).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels queued commands immediately without disturbing the active operation', async () => {
        const gate = deferred<void>();
        const queue = new BrowserControlQueue(vi.fn());
        const first = queue.run(() => gate.promise);
        const controller = new AbortController();
        const operation = vi.fn();
        const second = queue.run(operation, controller.signal);
        const error = new Error('Turn stopped');
        controller.abort(error);
        await expect(second).rejects.toBe(error);
        gate.resolve();
        await first;
        await queue.run(async () => {});
        expect(operation).not.toHaveBeenCalled();
    });

    it('rejects active commands immediately but waits for pending CDP before admitting new input', async () => {
        const gate = deferred<unknown>();
        const send = vi.fn(async (_method: string, _params?: Record<string, unknown>): Promise<unknown> => ({})).mockImplementationOnce(() => gate.promise);
        const queue = new BrowserControlQueue(send);
        const controller = new AbortController();
        const first = queue.run(async page => {
            await page.press('Enter');
            await page.press('Space');
        }, controller.signal);
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        const error = new Error('Turn stopped');
        controller.abort(error);
        await expect(first).rejects.toBe(error);
        const second = queue.run(page => page.press('Tab'));
        await Promise.resolve();
        expect(send).toHaveBeenCalledOnce();
        gate.resolve({});
        await second;
        expect(send.mock.calls.map(call => call[1])).toEqual([
            expect.objectContaining({ type: 'keyDown', key: 'Enter' }),
            expect.objectContaining({ type: 'keyUp', key: 'Enter' }),
            expect.objectContaining({ type: 'keyDown', key: 'Tab' }),
            expect.objectContaining({ type: 'keyUp', key: 'Tab' }),
        ]);
    });

    it('releases a pressed mouse button after cancellation and omits subsequent typing', async () => {
        const gate = deferred<unknown>();
        const send = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
            if (method === 'Runtime.evaluate') return { result: { value: { x: 0, y: 0, width: 10, height: 10 } } };
            if (params?.type === 'mousePressed') return gate.promise;
            return {};
        });
        const queue = new BrowserControlQueue(send);
        const controller = new AbortController();
        const result = queue.run(page => page.type('e1', 'not inserted'), controller.signal);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
        controller.abort(new Error('Turn stopped'));
        await expect(result).rejects.toThrow('Turn stopped');
        gate.resolve({});
        await queue.run(async () => {});
        expect(send).toHaveBeenCalledTimes(4);
        expect(send.mock.calls[3]).toEqual(['Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseReleased' })]);
    });

    it.each([false, true])('keeps the monotonic ref counter after cancellation (paged: %s)', async paged => {
        const gate = deferred<unknown>();
        const send = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue({
            result: { value: { elements: [], nextRef: 10, url: 'https://fixture.test/', title: 'Fixture' } },
        });
        const queue = new BrowserControlQueue(send);
        const controller = new AbortController();
        const snapshot = queue.run(page => page.snapshot(), controller.signal);
        await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
        controller.abort(new Error('Turn stopped'));
        await expect(snapshot).rejects.toThrow('Turn stopped');
        gate.resolve({ result: { value: paged
            ? { chunk: '{', token: 1, offset: 0, total: 100, nextRef: 10 }
            : { elements: [], nextRef: 10, url: 'https://fixture.test/', title: 'Fixture' } } });
        await queue.run(page => page.snapshot());
        expect(send.mock.calls[1][1].expression).toContain('"nextRef":10');
    });

    it('times out after 30s including time spent queued and cleans listeners and timers', async () => {
        vi.useFakeTimers();
        const gate = deferred<unknown>();
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const queue = new BrowserControlQueue(() => gate.promise);
        const operation = vi.fn();
        const active = expect(queue.run(page => page.scroll('down'), controller.signal)).rejects.toThrow('timed out after 30s');
        const queued = expect(queue.run(operation)).rejects.toThrow('timed out after 30s');
        await vi.advanceTimersByTimeAsync(30_000);
        await Promise.all([active, queued]);
        expect(vi.getTimerCount()).toBe(0);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        gate.resolve({});
        await queue.run(async () => {});
        expect(operation).not.toHaveBeenCalled();
    });

    it('cancels every pending command on close/crash and ignores late rejection', async () => {
        const gate = deferred<unknown>();
        const queue = new BrowserControlQueue(() => gate.promise);
        const operation = vi.fn();
        const first = queue.run(page => page.scroll('down'));
        const second = queue.run(operation);
        await Promise.resolve();
        const error = new Error('Browser tab closed');
        queue.cancel(error);
        await expect(first).rejects.toBe(error);
        await expect(second).rejects.toBe(error);
        gate.reject(new Error('Late debugger failure'));
        await queue.run(async () => {});
        expect(operation).not.toHaveBeenCalled();
    });

    it('removes the timeout and abort listener on success and failure', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const queue = new BrowserControlQueue(vi.fn());
        await queue.run(async () => {}, controller.signal);
        await expect(queue.run(async () => { throw new Error('Action failed'); }, controller.signal)).rejects.toThrow('Action failed');
        expect(vi.getTimerCount()).toBe(0);
        expect(remove).toHaveBeenCalledTimes(2);
    });
});
