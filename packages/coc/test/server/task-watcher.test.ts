import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { TaskWatcher } from '../../src/server/tasks/task-watcher';
import { FakeNativeWatchService } from '../helpers/fake-native-watch-service';

describe('TaskWatcher', () => {
    it('subscribes to the resolved task root and consumes one batched callback', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new TaskWatcher(changed, service);
        const root = path.resolve('tasks');
        watcher.watchWorkspace('one', root);
        const [id, subscription] = [...service.subscriptions][0];
        expect(subscription.options).toEqual({
            workspaceId: 'one', root, recursive: true, debounceMs: 300,
            ignoreDirs: [], extensions: [], respectGitignore: false,
        });
        service.emit(id, ['a.md', 'nested/b.md']);
        expect(changed).toHaveBeenCalledExactlyOnceWith('one');
    });

    it('keeps subscription ownership distinct for workspaces with the same root', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new TaskWatcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('tasks'));
        watcher.watchWorkspace('two', path.resolve('tasks'));
        watcher.watchWorkspace('one', path.resolve('tasks'));
        expect(service.subscriptions.size).toBe(2);
        service.emit(1, [], true);
        service.emit(2, ['a.md']);
        expect(changed.mock.calls).toEqual([['one'], ['two']]);
    });

    it('suppresses stale batches after unwatch and replacement', () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new TaskWatcher(changed, service);
        watcher.watchWorkspace('one', path.resolve('tasks'));
        const stale = service.subscriptions.get(1)!.onBatch;
        watcher.unwatchWorkspace('one');
        watcher.watchWorkspace('one', path.resolve('other-tasks'));
        stale({ subscriptionId: 1, paths: ['a.md'], rescan: false });
        expect(changed).not.toHaveBeenCalled();
        expect(service.subscriptions.has(1)).toBe(false);
        service.emit(2, ['b.md']);
        expect(changed).toHaveBeenCalledExactlyOnceWith('one');
    });

    it('closes only its own subscriptions and can watch a missing root', () => {
        const service = new FakeNativeWatchService();
        const watcher = new TaskWatcher(vi.fn(), service);
        watcher.watchWorkspace('one', path.resolve('missing'));
        watcher.watchWorkspace('two', path.resolve('tasks'));
        const other = service.subscribe({
            workspaceId: 'one', root: path.resolve('notes'), recursive: true, debounceMs: 300,
            ignoreDirs: [], extensions: [], respectGitignore: false,
        }, vi.fn());
        watcher.closeAll();
        watcher.closeAll();
        expect(watcher.isWatching('one')).toBe(false);
        expect(watcher.isWatching('two')).toBe(false);
        expect([...service.subscriptions.keys()]).toEqual([other]);
    });

    it('propagates native subscription failure without recording an active watch', () => {
        const service = new FakeNativeWatchService();
        vi.spyOn(service, 'subscribe').mockImplementation(() => { throw new Error('watch failed'); });
        const watcher = new TaskWatcher(vi.fn(), service);
        expect(() => watcher.watchWorkspace('one', path.resolve('tasks'))).toThrow('watch failed');
        expect(watcher.isWatching('one')).toBe(false);
    });
});
