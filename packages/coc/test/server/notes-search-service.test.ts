import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { NativeAddonLoadError, type NativeNotesIndex } from '@plusplusoneplusplus/coc-native';
import { NotesSearchService, type NotesSearchScope } from '../../src/server/notes/notes-search-service';
import { FakeNativeWatchService } from '../helpers/fake-native-watch-service';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function createIndex(label = 'snapshot') {
    return {
        search: vi.fn(async () => ({
            results: [{ path: `${label}.md`, matches: [{ line: 0, text: label }] }],
            truncated: false,
        })),
        refresh: vi.fn(async () => undefined),
        refreshChanged: vi.fn(async (_paths: string[]) => undefined),
    };
}

function scope(workspaceId = 'ws', rootId = 'default', root = 'notes', isTaskDerived = false): NotesSearchScope {
    return { workspaceId, rootId, absolutePath: path.resolve(root), isDefault: rootId === 'default', isTaskDerived };
}

// Flush only promise continuations: neither watcher delivery nor refresh uses timers.
async function settle(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('NotesSearchService', () => {
    const services: NotesSearchService[] = [];
    afterEach(() => {
        for (const service of services) service.dispose();
        services.length = 0;
        vi.restoreAllMocks();
    });

    function setup(build: (root: string) => Promise<NativeNotesIndex> = async () => createIndex()) {
        const watchService = new FakeNativeWatchService();
        const buildNotesIndex = vi.fn(build);
        const logger = { error: vi.fn(), warn: vi.fn() };
        const service = new NotesSearchService({
            nativeAddon: { buildNotesIndex },
            watchService,
            logger,
        });
        services.push(service);
        return { service, watchService, buildNotesIndex, logger };
    }

    it('shares a lazy initial build and refreshes batches delivered during that build', async () => {
        const build = deferred<NativeNotesIndex>();
        const index = createIndex();
        const { service, watchService, buildNotesIndex } = setup(() => build.promise);
        expect(watchService.subscriptions.size).toBe(0);
        const first = service.search(scope(), 'one');
        const second = service.search(scope(), 'two');
        watchService.emit(1, ['a.md']);
        watchService.emit(1, ['b.md', 'b.md']);
        expect(buildNotesIndex).toHaveBeenCalledOnce();
        expect(watchService.subscriptions.get(1)?.options).toEqual({
            workspaceId: 'ws', root: path.resolve('notes'), recursive: true,
            ignoreDirs: [], extensions: [], respectGitignore: false, debounceMs: 300,
        });
        build.resolve(index);
        await Promise.all([first, second]);
        await settle();
        expect(index.search).toHaveBeenCalledTimes(2);
        expect(index.refreshChanged.mock.calls).toEqual([[['a.md']], [['b.md']]]);
    });

    it('keeps the same physical root independent for every workspace and root id', async () => {
        const indexes = [createIndex('a'), createIndex('b'), createIndex('c')];
        let next = 0;
        const { service, watchService, buildNotesIndex } = setup(async () => indexes[next++]);
        const results = await Promise.all([
            service.search(scope('a'), 'q'), service.search(scope('b'), 'q'),
            service.search(scope('a', 'configured'), 'q'),
        ]);
        expect(buildNotesIndex).toHaveBeenCalledTimes(3);
        expect(watchService.subscriptions.size).toBe(3);
        expect(results.map(result => result.results[0].path)).toEqual(['a.md', 'b.md', 'c.md']);
        watchService.emit(2, ['b.md']);
        await settle();
        expect(indexes[1].refreshChanged).toHaveBeenCalledWith(['b.md']);
        expect(indexes[0].refreshChanged).not.toHaveBeenCalled();
        expect(indexes[2].refreshChanged).not.toHaveBeenCalled();
    });

    it('builds separate scopes concurrently with their authorized symlink policies', async () => {
        const first = deferred<NativeNotesIndex>();
        const second = deferred<NativeNotesIndex>();
        const { service, buildNotesIndex } = setup(root => root === path.resolve('managed') ? first.promise : second.promise);
        const searches = [
            service.search(scope('a', 'default', 'managed'), 'q'),
            service.search(scope('a', 'task:abc', 'task', true), 'q'),
        ];
        expect(buildNotesIndex).toHaveBeenNthCalledWith(1, path.resolve('managed'), { skipSymlinks: false });
        expect(buildNotesIndex).toHaveBeenNthCalledWith(2, path.resolve('task'), { skipSymlinks: true });
        first.resolve(createIndex());
        second.resolve(createIndex());
        await Promise.all(searches);
    });

    it('passes a debounce override to the native subscription, including for missing roots', async () => {
        const watchService = new FakeNativeWatchService();
        const service = new NotesSearchService({
            nativeAddon: { buildNotesIndex: async () => createIndex() },
            watchService, debounceMs: 42,
        });
        services.push(service);
        await service.search(scope('ws', 'default', 'missing/nested/notes'), 'q');
        expect(watchService.subscriptions.get(1)?.options).toMatchObject({
            root: path.resolve('missing/nested/notes'), debounceMs: 42,
        });
    });

    it('refreshes Markdown removals incrementally and coalesces batches while refresh is in flight', async () => {
        const inFlight = deferred<void>();
        const index = createIndex();
        index.refreshChanged.mockImplementationOnce(() => inFlight.promise);
        const { service, watchService } = setup(async () => index);
        await service.search(scope(), 'q');
        watchService.emit(1, ['a.md', 'a.md', 'nested\\b.md']);
        await settle();
        expect(index.refreshChanged).toHaveBeenCalledWith(['a.md', 'nested/b.md']);
        watchService.emit(1, ['deleted.md']);
        watchService.emit(1, ['deleted.md', 'new.md']);
        await settle();
        expect(index.refreshChanged).toHaveBeenCalledOnce();
        inFlight.resolve(undefined);
        await settle();
        expect(index.refreshChanged).toHaveBeenNthCalledWith(2, ['deleted.md', 'new.md']);
    });

    it.each([
        { paths: [], rescan: true },
        { paths: ['renamed-directory'], rescan: false },
        { paths: ['deleted/directory'], rescan: false },
        { paths: ['asset.txt'], rescan: false },
        { paths: [''], rescan: false },
        { paths: ['../outside.md'], rescan: false },
        { paths: ['C:\\outside.md'], rescan: false },
        { paths: [path.resolve('outside.md')], rescan: false },
        { paths: Array.from({ length: 1_025 }, (_, i) => `${i}.md`), rescan: false },
    ])('fully refreshes ambiguous, rescan, and oversized batches ($rescan)', async ({ paths, rescan }) => {
        const index = createIndex();
        const { service, watchService } = setup(async () => index);
        await service.search(scope(), 'q');
        watchService.emit(1, paths, rescan);
        await settle();
        expect(index.refresh).toHaveBeenCalledOnce();
        expect(index.refreshChanged).not.toHaveBeenCalled();
        expect(watchService.subscriptions.size).toBe(1);
    });

    it('ignores empty batches and gives a queued rescan priority over incremental work', async () => {
        const inFlight = deferred<void>();
        const index = createIndex();
        index.refreshChanged.mockImplementationOnce(() => inFlight.promise);
        const { service, watchService } = setup(async () => index);
        await service.search(scope(), 'q');
        watchService.emit(1);
        await settle();
        expect(index.refreshChanged).not.toHaveBeenCalled();
        watchService.emit(1, ['a.md']);
        await settle();
        watchService.emit(1, ['b.md']);
        watchService.emit(1, [], true);
        watchService.emit(1, ['c.md']);
        inFlight.resolve(undefined);
        await settle();
        expect(index.refresh).toHaveBeenCalledOnce();
        expect(index.refreshChanged).toHaveBeenCalledOnce();
    });

    it('bounds pending paths across batches while a full refresh is in flight', async () => {
        const inFlight = deferred<void>();
        const index = createIndex();
        index.refresh.mockImplementationOnce(() => inFlight.promise);
        const { service, watchService } = setup(async () => index);
        await service.search(scope(), 'q');
        watchService.emit(1, [], true);
        await settle();
        watchService.emit(1, Array.from({ length: 700 }, (_, i) => `${i}.md`));
        watchService.emit(1, Array.from({ length: 700 }, (_, i) => `${i + 700}.md`));
        expect(index.refresh).toHaveBeenCalledOnce();
        inFlight.resolve(undefined);
        await settle();
        expect(index.refresh).toHaveBeenCalledTimes(2);
        expect(index.refreshChanged).not.toHaveBeenCalled();
    });

    it('retains the snapshot on refresh failure and waits for another batch before a full retry', async () => {
        const index = createIndex('retained');
        index.refreshChanged.mockRejectedValueOnce(new Error('read failed'));
        const { service, watchService, logger } = setup(async () => index);
        await service.search(scope(), 'q');
        watchService.emit(1, ['a.md']);
        await settle();
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ workspaceId: 'ws', rootId: 'default' }),
            'Notes search index refresh failed',
        );
        expect(index.refresh).not.toHaveBeenCalled();
        expect((await service.search(scope(), 'q')).results[0].path).toBe('retained.md');
        await settle();
        expect(index.refresh).not.toHaveBeenCalled();
        watchService.emit(1, ['b.md']);
        await settle();
        expect(index.refresh).toHaveBeenCalledOnce();
    });

    it('retries fully when a batch arrives during a failed refresh without overlapping refreshes', async () => {
        const inFlight = deferred<void>();
        const index = createIndex();
        index.refreshChanged.mockImplementationOnce(() => inFlight.promise);
        const { service, watchService } = setup(async () => index);
        await service.search(scope(), 'q');
        watchService.emit(1, ['a.md']);
        await settle();
        watchService.emit(1, ['b.md']);
        expect(index.refresh).not.toHaveBeenCalled();
        inFlight.reject(new Error('read failed'));
        await settle();
        expect(index.refresh).toHaveBeenCalledOnce();
        expect(index.refreshChanged).toHaveBeenCalledOnce();
    });

    it('isolates build failures and permits later searches to retry', async () => {
        let attempts = 0;
        const { service, watchService } = setup(async root => {
            if (root === path.resolve('failed') && attempts++ === 0) throw new Error('build failed');
            return createIndex();
        });
        await expect(service.search(scope('a', 'default', 'failed'), 'q')).rejects.toThrow('build failed');
        await expect(service.search(scope('b'), 'q')).resolves.toBeDefined();
        await expect(service.search(scope('a', 'default', 'failed'), 'q')).resolves.toBeDefined();
        expect(watchService.subscriptions.size).toBe(2);
    });

    it.each([new Error('watch failed'), new NativeAddonLoadError('missing native watch')])(
        'propagates subscription failures without caching an unwatched entry: %s', async error => {
            const { service, watchService, buildNotesIndex } = setup();
            vi.spyOn(watchService, 'subscribe').mockImplementationOnce(() => { throw error; });
            await expect(service.search(scope(), 'q')).rejects.toBe(error);
            expect(service.hasScope('ws', 'default')).toBe(false);
            expect(buildNotesIndex).not.toHaveBeenCalled();
            await expect(service.search(scope(), 'q')).resolves.toBeDefined();
            expect(watchService.subscriptions.size).toBe(1);
        },
    );

    it('reconciles configured and complete roots, preserves task roots, and reactivates tombstones', async () => {
        const { service, watchService } = setup();
        await Promise.all([
            service.search(scope(), 'q'), service.search(scope('ws', 'docs'), 'q'),
            service.search(scope('ws', 'task:abc', 'task', true), 'q'),
            service.search(scope('other'), 'q'),
            service.search(scope('ws', 'task:configured'), 'q'),
        ]);
        service.reconcileConfiguredRoots('ws', []);
        expect(service.hasScope('ws', 'docs')).toBe(false);
        expect(service.hasScope('ws', 'task:configured')).toBe(false);
        expect(service.hasScope('ws', 'task:abc')).toBe(true);
        expect(watchService.subscriptions.has(2)).toBe(false);
        await expect(service.search(scope('ws', 'docs'), 'q')).rejects.toThrow('unavailable');
        service.reconcileConfiguredRoots('ws', ['docs']);
        await expect(service.search(scope('ws', 'docs'), 'q')).resolves.toBeDefined();
        service.reconcileWorkspaceRoots('ws', ['default']);
        expect(service.hasScope('ws', 'task:abc')).toBe(false);
        service.evictWorkspace('ws');
        expect(service.hasScope('other', 'default')).toBe(true);
        await expect(service.search(scope(), 'q')).rejects.toThrow("workspace 'ws' is unavailable");
        service.activateWorkspace('ws');
        await expect(service.search(scope(), 'q')).resolves.toBeDefined();
    });

    it('ignores stale callbacks and queued refreshes after eviction while allowing captured searches to finish', async () => {
        const build = deferred<NativeNotesIndex>();
        const index = createIndex();
        const { service, watchService } = setup(() => build.promise);
        const search = service.search(scope(), 'q');
        const stale = watchService.subscriptions.get(1)!.onBatch;
        watchService.emit(1, ['queued.md']);
        service.evictRoot('ws', 'default');
        stale({ subscriptionId: 1, paths: ['stale.md'], rescan: true });
        build.resolve(index);
        await expect(search).resolves.toBeDefined();
        await settle();
        expect(index.refresh).not.toHaveBeenCalled();
        expect(index.refreshChanged).not.toHaveBeenCalled();
        expect(watchService.subscriptions.size).toBe(0);
    });

    it('replaces root paths and disposes only owned subscriptions, ignoring late callbacks', async () => {
        const index = createIndex();
        const { service, watchService } = setup(async () => index);
        const unrelatedId = watchService.subscribe({
            workspaceId: 'ws', root: path.resolve('unrelated'), recursive: true,
            ignoreDirs: [], extensions: [], respectGitignore: false, debounceMs: 10,
        }, () => {});
        await service.search(scope(), 'q');
        const old = watchService.subscriptions.get(2)!.onBatch;
        await service.search(scope('ws', 'default', 'replacement'), 'q');
        old({ subscriptionId: 2, paths: [], rescan: true });
        expect(watchService.subscriptions.has(2)).toBe(false);
        const late = watchService.subscriptions.get(3)!.onBatch;
        service.dispose();
        service.dispose();
        late({ subscriptionId: 3, paths: [], rescan: true });
        await settle();
        expect(index.refresh).not.toHaveBeenCalled();
        expect(watchService.subscriptions.has(unrelatedId)).toBe(true);
        await expect(service.search(scope(), 'q')).rejects.toThrow('disposed');
    });

    it('does not retain a disposed root entry when its replacement subscription fails', async () => {
        const { service, watchService, buildNotesIndex } = setup();
        await service.search(scope(), 'q');
        vi.spyOn(watchService, 'subscribe').mockImplementationOnce(() => { throw new Error('watch failed'); });
        await expect(service.search(scope('ws', 'default', 'replacement'), 'q')).rejects.toThrow('watch failed');
        expect(service.hasScope('ws', 'default')).toBe(false);
        await expect(service.search(scope(), 'q')).resolves.toBeDefined();
        expect(buildNotesIndex).toHaveBeenCalledTimes(2);
        expect(watchService.subscriptions.size).toBe(1);
    });
});
