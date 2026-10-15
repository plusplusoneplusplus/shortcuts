import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { acquireNativeWatchService, NativeWatchService, type WatchBatch } from '../../../src/server/shared/native-watch-service';
import { getServerLogger } from '../../../src/server/logging/server-logger';

const options = {
    workspaceId: 'one', root: path.resolve('repo'), recursive: true, debounceMs: 300,
    ignoreDirs: [], extensions: [], respectGitignore: false,
};

function setup() {
    let nextId = 1;
    let deliver: ((batch: WatchBatch) => void) | undefined;
    const handle = {
        subscribe: vi.fn(() => nextId++),
        unsubscribe: vi.fn(),
        unwatchWorkspace: vi.fn(),
        dispose: vi.fn(),
    };
    const create = vi.fn((onBatch: (batch: WatchBatch) => void) => {
        deliver = onBatch;
        return handle;
    });
    const service = new NativeWatchService(create);
    return { service, handle, create, emit: (batch: WatchBatch) => deliver?.(batch) };
}

describe('NativeWatchService', () => {
    afterEach(() => vi.restoreAllMocks());
    it('creates one native owner lazily for all consumers and workspaces', () => {
        const { service, create, handle, emit } = setup();
        expect(create).not.toHaveBeenCalled();
        const first = vi.fn();
        const second = vi.fn();
        const one = service.subscribe(options, first);
        const two = service.subscribe({ ...options, workspaceId: 'two' }, second);
        expect(create).toHaveBeenCalledTimes(1);
        expect(handle.subscribe).toHaveBeenCalledTimes(2);
        emit({ subscriptionId: two, paths: ['a.md'], rescan: false });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledExactlyOnceWith({ subscriptionId: two, paths: ['a.md'], rescan: false });
        emit({ subscriptionId: one, paths: [], rescan: true });
        expect(first).toHaveBeenCalledExactlyOnceWith({ subscriptionId: one, paths: [], rescan: true });
    });

    it('gates late native deliveries after unsubscribe and workspace removal', () => {
        const { service, handle, emit } = setup();
        const changed = vi.fn();
        const one = service.subscribe(options, changed);
        const two = service.subscribe(options, changed);
        const other = service.subscribe({ ...options, workspaceId: 'two' }, changed);
        service.unsubscribe(one);
        service.unwatchWorkspace('one');
        emit({ subscriptionId: one, paths: ['a.md'], rescan: false });
        emit({ subscriptionId: two, paths: [], rescan: true });
        expect(changed).not.toHaveBeenCalled();
        emit({ subscriptionId: other, paths: [], rescan: true });
        expect(changed).toHaveBeenCalledTimes(1);
        expect(handle.unsubscribe).toHaveBeenCalledWith(one);
        expect(handle.unwatchWorkspace).toHaveBeenCalledExactlyOnceWith('one');
    });

    it('disposes once, rejects new work and suppresses queued batches', () => {
        const { service, handle, emit } = setup();
        const changed = vi.fn();
        const id = service.subscribe(options, changed);
        service.dispose();
        service.dispose();
        emit({ subscriptionId: id, paths: [], rescan: true });
        expect(changed).not.toHaveBeenCalled();
        expect(handle.dispose).toHaveBeenCalledTimes(1);
        expect(() => service.subscribe(options, changed)).toThrow('disposed');
    });

    it('propagates install and subscribe failures without a fallback', () => {
        const failed = new NativeWatchService(() => { throw new Error('broken install'); });
        expect(() => failed.subscribe(options, vi.fn())).toThrow('broken install');
        const { service, handle, emit } = setup();
        const changed = vi.fn();
        handle.subscribe.mockImplementationOnce(() => { throw new Error('watch failed'); });
        expect(() => service.subscribe(options, changed)).toThrow('watch failed');
        emit({ subscriptionId: 1, paths: [], rescan: true });
        expect(changed).not.toHaveBeenCalled();
    });

    it('logs a consumer exception without disabling other subscriptions', () => {
        const { service, emit } = setup();
        const error = new Error('consumer failed');
        const log = vi.spyOn(getServerLogger(), 'error').mockImplementation(() => undefined);
        const failed = service.subscribe(options, () => { throw error; });
        const changed = vi.fn();
        const healthy = service.subscribe(options, changed);
        emit({ subscriptionId: failed, paths: [], rescan: true });
        emit({ subscriptionId: healthy, paths: [], rescan: true });
        expect(log).toHaveBeenCalledExactlyOnceWith({
            err: error, workspaceId: 'one', subscriptionId: failed,
        }, 'Native watch consumer failed');
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it('keeps equal workspace IDs in two server scopes isolated while sharing a native owner', () => {
        const { service, handle, create, emit } = setup();
        const first = acquireNativeWatchService(service);
        const second = acquireNativeWatchService(service);
        const changed = vi.fn();
        const one = first.subscribe(options, changed);
        const two = second.subscribe(options, changed);
        expect(create).toHaveBeenCalledTimes(1);
        first.unwatchWorkspace('one');
        first.dispose();
        emit({ subscriptionId: one, paths: [], rescan: true });
        expect(changed).not.toHaveBeenCalled();
        emit({ subscriptionId: two, paths: ['a.md'], rescan: false });
        expect(changed).toHaveBeenCalledTimes(1);
        expect(handle.dispose).not.toHaveBeenCalled();
        expect(handle.unwatchWorkspace).not.toHaveBeenCalled();
        second.dispose();
        expect(handle.dispose).toHaveBeenCalledTimes(1);
        expect(handle.unsubscribe.mock.calls).toEqual([[one], [two]]);
        expect(() => first.subscribe(options, changed)).toThrow('disposed');
    });

    it('gates callbacks from a released native handle when a new owner reuses IDs', () => {
        const callbacks: Array<(batch: WatchBatch) => void> = [];
        const handles = [];
        const service = new NativeWatchService(callback => {
            callbacks.push(callback);
            const handle = {
                subscribe: vi.fn(() => 1), unsubscribe: vi.fn(),
                unwatchWorkspace: vi.fn(), dispose: vi.fn(),
            };
            handles.push(handle);
            return handle;
        });
        const first = acquireNativeWatchService(service);
        first.subscribe(options, vi.fn());
        first.dispose();
        const second = acquireNativeWatchService(service);
        const changed = vi.fn();
        second.subscribe(options, changed);
        callbacks[0]({ subscriptionId: 1, paths: [], rescan: true });
        expect(changed).not.toHaveBeenCalled();
        callbacks[1]({ subscriptionId: 1, paths: [], rescan: true });
        expect(changed).toHaveBeenCalledTimes(1);
        second.dispose();
        expect(handles.every(handle => handle.dispose.mock.calls.length === 1)).toBe(true);
    });
});
