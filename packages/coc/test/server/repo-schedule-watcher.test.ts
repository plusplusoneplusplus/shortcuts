import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { RepoScheduleWatcher } from '../../src/server/schedule/repo-schedule-watcher';
import { FakeNativeWatchService } from '../helpers/fake-native-watch-service';
import { getServerLogger } from '../../src/server/logging/server-logger';
import { ScheduleManager } from '../../src/server/schedule/schedule-manager';
import { ScheduleYamlPersistence } from '../../src/server/schedule/schedule-yaml-persistence';

describe('RepoScheduleWatcher', () => {
    afterEach(() => vi.restoreAllMocks());
    it('requests non-recursive batches and reloads on paths or rescan', async () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new RepoScheduleWatcher(service);
        await watcher.watch('one', path.resolve('schedules'), changed);
        expect(service.subscriptions.get(1)!.options).toMatchObject({
            workspaceId: 'one', recursive: false, debounceMs: 300, respectGitignore: false,
        });
        service.emit(1, ['a.yaml', 'b.yaml']);
        service.emit(1, [], true);
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it('replaces a subscription without delivering stale batches', async () => {
        const service = new FakeNativeWatchService();
        const changed = vi.fn();
        const watcher = new RepoScheduleWatcher(service);
        await watcher.watch('one', path.resolve('old'), changed);
        const stale = service.subscriptions.get(1)!.onBatch;
        await watcher.watch('one', path.resolve('new'), changed);
        stale({ subscriptionId: 1, paths: ['a.yaml'], rescan: false });
        expect(changed).not.toHaveBeenCalled();
        expect([...service.subscriptions.keys()]).toEqual([2]);
        watcher.unwatch('one');
        service.emit(2, [], true);
        expect(changed).not.toHaveBeenCalled();
    });

    it('disposes its subscriptions without disposing the shared owner', async () => {
        const service = new FakeNativeWatchService();
        const watcher = new RepoScheduleWatcher(service);
        await watcher.watch('one', path.resolve('schedules'), vi.fn());
        watcher.dispose();
        watcher.dispose();
        expect(service.subscriptions.size).toBe(0);
        await expect(watcher.watch('one', path.resolve('schedules'), vi.fn())).rejects.toThrow('disposed');
        expect(() => service.subscribe({
            workspaceId: 'two', root: path.resolve('other'), recursive: false, debounceMs: 300,
            ignoreDirs: [], extensions: [], respectGitignore: false,
        }, vi.fn())).not.toThrow();
    });

    it('logs synchronous and asynchronous reload failures', async () => {
        const service = new FakeNativeWatchService();
        const warn = vi.spyOn(getServerLogger(), 'warn').mockImplementation(() => undefined);
        const watcher = new RepoScheduleWatcher(service);
        const error = new Error('reload failed');
        await watcher.watch('one', path.resolve('schedules'), () => { throw error; });
        service.emit(1, [], true);
        expect(warn).toHaveBeenLastCalledWith(
            { err: error, repoId: 'one' }, 'RepoScheduleWatcher: onChange callback threw',
        );
        await watcher.watch('one', path.resolve('schedules'), async () => { throw error; });
        service.emit(2, ['a.yaml']);
        await Promise.resolve();
        expect(warn).toHaveBeenLastCalledWith(
            { err: error, repoId: 'one' }, 'RepoScheduleWatcher: onChange callback rejected',
        );
    });

    it('does not interpret a migrated empty workspace root as the server working directory', async () => {
        const service = new FakeNativeWatchService();
        const manager = new ScheduleManager(
            new ScheduleYamlPersistence(path.resolve('data')), null, null, undefined, service,
        );
        expect(await manager.registerWorkspacePath('one', '')).toEqual({ ok: true, loaded: 0 });
        expect(service.subscriptions.size).toBe(0);
        manager.dispose();
    });
});
