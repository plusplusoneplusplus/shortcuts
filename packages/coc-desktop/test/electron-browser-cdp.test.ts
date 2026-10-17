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
        sendCommand: vi.fn<(method: string, params: Record<string, unknown>, sessionId?: string) => Promise<unknown>>().mockResolvedValue({ result: 42 }),
    });
    const contents = Object.assign(new EventEmitter(), { isDestroyed: () => destroyed });
    Object.defineProperty(contents, 'debugger', { get: () => {
        if (destroyed) throw new Error('Object has been destroyed');
        return debuggerApi;
    } });
    const cdp = new ElectronBrowserCdp(contents as unknown as WebContents);
    return { cdp, contents, debuggerApi, destroy: () => { destroyed = true; contents.emit('destroyed'); } };
}

afterEach(() => vi.useRealTimers());

describe('Electron URL guest CDP lifecycle', () => {
    it('subscribes lazily, preserves root and nested session events, and rejects foreign sessions', async () => {
        const { cdp, debuggerApi } = fixture();
        const listener = vi.fn();
        expect(debuggerApi.listenerCount('message')).toBe(0);
        const off = cdp.onEvent(listener);
        expect(debuggerApi.attach).not.toHaveBeenCalled();
        debuggerApi.emit('message', {}, 'Network.requestWillBeSent', {});
        debuggerApi.emit('message', {}, 'Runtime.executionContextCreated', { context: { id: 1 } }, 'foreign');
        expect(listener).not.toHaveBeenCalled();
        debuggerApi.emit('message', {}, 'Page.frameAttached', { frameId: 'child', parentFrameId: 'root' });
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'child-session', targetInfo: { type: 'iframe' } });
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'nested-session', targetInfo: { type: 'iframe' } }, 'child-session');
        debuggerApi.emit('message', {}, 'Runtime.executionContextCreated', { context: { id: 2 } }, 'nested-session');
        expect(listener).toHaveBeenLastCalledWith('Runtime.executionContextCreated', { context: { id: 2 } }, 'nested-session');
        await cdp.send('Runtime.evaluate', { expression: '42' }, 'nested-session');
        expect(debuggerApi.sendCommand).toHaveBeenLastCalledWith('Runtime.evaluate', { expression: '42' }, 'nested-session');
        await expect(cdp.send('Runtime.evaluate', {}, 'foreign')).rejects.toThrow('does not belong');
        off();
        off();
        expect(debuggerApi.listenerCount('message')).toBe(0);
        await expect(cdp.send('Runtime.evaluate', {}, 'child-session')).rejects.toThrow('does not belong');
        cdp.dispose();
    });

    it('expires a detached frame and all nested pending commands without closing the root', async () => {
        const { cdp, debuggerApi } = fixture();
        cdp.onEvent(vi.fn());
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'child', targetInfo: { type: 'iframe' } });
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'nested', targetInfo: { type: 'iframe' } }, 'child');
        debuggerApi.sendCommand.mockImplementationOnce(() => new Promise(() => {}));
        const pending = cdp.send('Runtime.evaluate', {}, 'nested');
        const rejected = expect(pending).rejects.toThrow('detached');
        debuggerApi.emit('message', {}, 'Target.detachedFromTarget', { sessionId: 'child' });
        await rejected;
        await expect(cdp.send('Runtime.evaluate', {}, 'nested')).rejects.toThrow('does not belong');
        await expect(cdp.send('Page.enable')).resolves.toEqual({ result: 42 });
        cdp.dispose();
    });

    it('keeps independently registered identical callbacks and ignores stale disposers after a crash', () => {
        const { cdp, contents, debuggerApi } = fixture();
        const listener = vi.fn();
        const oldOff = cdp.onEvent(listener);
        contents.emit('render-process-gone');
        const off = cdp.onEvent(listener);
        const offDuplicate = cdp.onEvent(listener);
        oldOff();
        debuggerApi.emit('message', {}, 'Page.frameAttached', {});
        expect(listener).toHaveBeenCalledTimes(2);
        off();
        debuggerApi.emit('message', {}, 'Page.frameAttached', {});
        expect(listener).toHaveBeenCalledTimes(3);
        offDuplicate();
        expect(debuggerApi.listenerCount('message')).toBe(0);
        cdp.dispose();
    });

    it.each(['close', 'crash', 'detach'] as const)('retires frame listeners and sessions on %s', async event => {
        const { cdp, contents, debuggerApi } = fixture();
        const listener = vi.fn();
        cdp.onEvent(listener);
        await cdp.send('Page.enable');
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'child', targetInfo: { type: 'iframe' } });
        listener.mockClear();
        if (event === 'close') cdp.dispose();
        if (event === 'crash') contents.emit('render-process-gone');
        if (event === 'detach') debuggerApi.detach();
        debuggerApi.emit('message', {}, 'Page.frameNavigated', {});
        expect(listener).not.toHaveBeenCalled();
        expect(debuggerApi.listenerCount('message')).toBe(0);
        cdp.dispose();
    });

    it('bounds unsolicited event bytes and fails closed until the subscriber is disposed', async () => {
        const { cdp, debuggerApi } = fixture();
        const listener = vi.fn();
        const off = cdp.onEvent(listener);
        debuggerApi.emit('message', {}, 'Page.frameNavigated', { value: '\u754c'.repeat(300_001) });
        expect(listener).not.toHaveBeenCalled();
        await expect(cdp.send('Page.enable')).rejects.toThrow('transport limit');
        off();
        await expect(cdp.send('Page.enable')).resolves.toEqual({ result: 42 });
        cdp.dispose();
    });

    it('accepts only bounded iframe sessions, never worker targets or duplicate/cyclic session ownership', async () => {
        const { cdp, debuggerApi } = fixture();
        const listener = vi.fn();
        cdp.onEvent(listener);
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'worker', targetInfo: { type: 'worker' } });
        await expect(cdp.send('Runtime.evaluate', {}, 'worker')).rejects.toThrow('does not belong');
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'child', targetInfo: { type: 'iframe' } });
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'child', targetInfo: { type: 'iframe' } }, 'child');
        expect(listener).toHaveBeenCalledOnce();
        for (let i = 1; i < 256; i++) debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: `s${i}`, targetInfo: { type: 'iframe' } });
        debuggerApi.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'overflow', targetInfo: { type: 'iframe' } });
        await expect(cdp.send('Page.enable')).rejects.toThrow('session limit');
        cdp.dispose();
    });

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

    it('cleans listeners without reading native getters after destruction', async () => {
        const { cdp, contents, debuggerApi, destroy } = fixture();
        await cdp.send('Page.enable');
        expect(() => destroy()).not.toThrow();
        expect(contents.listenerCount('destroyed')).toBe(0);
        expect(contents.listenerCount('render-process-gone')).toBe(0);
        expect(debuggerApi.listenerCount('detach')).toBe(0);
        expect(debuggerApi.detach).not.toHaveBeenCalled();
        await expect(cdp.send('Page.enable')).rejects.toThrow('closed');
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
