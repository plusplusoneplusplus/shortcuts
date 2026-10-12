import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElectronBrowserCdp } from '../src/electron-browser-cdp';

function fixture() {
    let attached = false;
    let destroyed = false;
    const debuggerApi = Object.assign(new EventEmitter(), {
        isAttached: () => attached,
        attach: vi.fn(() => { attached = true; }),
        detach: vi.fn(() => { attached = false; debuggerApi.emit('detach', {}, 'target closed'); }),
        sendCommand: vi.fn<(method: string, params: Record<string, unknown>) => Promise<unknown>>().mockResolvedValue({ result: 42 }),
    });
    const contents = Object.assign(new EventEmitter(), { debugger: debuggerApi, isDestroyed: () => destroyed });
    const cdp = new ElectronBrowserCdp(contents as unknown as WebContents);
    return { cdp, contents, debuggerApi, destroy: () => { destroyed = true; contents.emit('destroyed'); } };
}

afterEach(() => vi.useRealTimers());

describe('Electron URL guest CDP lifecycle', () => {
    it('attaches lazily once and passes commands and results through', async () => {
        const { cdp, debuggerApi, contents } = fixture();
        expect(debuggerApi.attach).not.toHaveBeenCalled();
        await expect(cdp.send('Runtime.evaluate', { expression: '6 * 7' })).resolves.toEqual({ result: 42 });
        await cdp.send('Page.enable');
        expect(debuggerApi.attach).toHaveBeenCalledExactlyOnceWith('1.3');
        expect(debuggerApi.sendCommand.mock.calls).toEqual([
            ['Runtime.evaluate', { expression: '6 * 7' }], ['Page.enable', {}],
        ]);
        cdp.dispose();
        cdp.dispose();
        expect(debuggerApi.detach).toHaveBeenCalledOnce();
        expect(contents.listenerCount('destroyed')).toBe(0);
        expect(contents.listenerCount('render-process-gone')).toBe(0);
        expect(debuggerApi.listenerCount('detach')).toBe(0);
    });

    it('preserves attach and command errors and permits a later command', async () => {
        const { cdp, debuggerApi } = fixture();
        const error = new Error('CDP failure');
        debuggerApi.attach.mockImplementationOnce(() => { throw error; });
        await expect(cdp.send('Page.enable')).rejects.toBe(error);
        expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
        debuggerApi.sendCommand.mockRejectedValueOnce(error);
        await expect(cdp.send('Invalid.method')).rejects.toBe(error);
        await expect(cdp.send('Page.enable')).resolves.toEqual({ result: 42 });
        cdp.dispose();
    });

    it.each(['close', 'destroy', 'crash', 'detach'] as const)('rejects all pending commands on %s and ignores late results', async event => {
        vi.useFakeTimers();
        const { cdp, contents, debuggerApi, destroy } = fixture();
        let finish!: (result: unknown) => void;
        debuggerApi.sendCommand.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const first = cdp.send('Runtime.evaluate');
        const second = cdp.send('Page.captureScreenshot');
        const firstRejected = expect(first).rejects.toThrow(/closed|crashed|detached/);
        const secondRejected = expect(second).rejects.toThrow(/closed|crashed|detached/);
        if (event === 'close') { cdp.dispose(); }
        if (event === 'destroy') { destroy(); }
        if (event === 'crash') { contents.emit('render-process-gone', {}, { reason: 'crashed' }); }
        if (event === 'detach') { debuggerApi.detach(); }
        await Promise.all([firstRejected, secondRejected]);
        finish({ late: true });
        await Promise.resolve();
        expect(vi.getTimerCount()).toBe(0);
        cdp.dispose();
    });

    it('times out after 30 seconds, retires timers and permits later commands', async () => {
        vi.useFakeTimers();
        const { cdp, debuggerApi } = fixture();
        debuggerApi.sendCommand.mockImplementationOnce(() => new Promise(() => {}));
        const pending = cdp.send('Runtime.evaluate');
        const rejected = expect(pending).rejects.toThrow('timed out after 30s');
        await vi.advanceTimersByTimeAsync(29_999);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        await cdp.send('Page.enable');
        expect(vi.getTimerCount()).toBe(0);
        cdp.dispose();
    });

    it('rejects a closed view without dispatch and does not attach during disposal', async () => {
        const { cdp, debuggerApi } = fixture();
        cdp.dispose();
        await expect(cdp.send('Page.enable')).rejects.toThrow('closed');
        expect(debuggerApi.attach).not.toHaveBeenCalled();
        expect(debuggerApi.detach).not.toHaveBeenCalled();
        expect(debuggerApi.sendCommand).not.toHaveBeenCalled();
    });

    it('preserves an existing debugger attachment owned by another caller', async () => {
        const { cdp, debuggerApi } = fixture();
        debuggerApi.attach();
        debuggerApi.attach.mockClear();
        await cdp.send('Page.enable');
        cdp.dispose();
        expect(debuggerApi.attach).not.toHaveBeenCalled();
        expect(debuggerApi.detach).not.toHaveBeenCalled();
    });

    it('cleans up a synchronous dispatch failure', async () => {
        vi.useFakeTimers();
        const { cdp, debuggerApi } = fixture();
        const error = new Error('Target unavailable');
        debuggerApi.sendCommand.mockImplementationOnce(() => { throw error; });
        await expect(cdp.send('Page.enable')).rejects.toBe(error);
        expect(vi.getTimerCount()).toBe(0);
        cdp.dispose();
    });
});
