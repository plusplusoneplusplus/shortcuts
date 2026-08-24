import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    NativeNotesIndex,
    NativeNotesIndexAddon,
    NativeNotesSearchResponse,
} from '@plusplusoneplusplus/coc-native';
import {
    NotesSearchService,
    type NotesSearchScope,
    type NotesSearchWatchFactory,
} from '../../src/server/notes/notes-search-service';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

interface FakeWatch {
    watchPath: string;
    emit(eventType: string, filename: string | Buffer | null): void;
    error(error: Error): void;
    close: ReturnType<typeof vi.fn>;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function emptyResponse(label?: string): NativeNotesSearchResponse {
    return {
        results: label ? [{ path: `${label}.md`, matches: [{ line: 0, text: `${label}.md` }] }] : [],
        truncated: false,
    };
}

function createIndex(label?: string): NativeNotesIndex & {
    search: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    refreshChanged: ReturnType<typeof vi.fn>;
} {
    return {
        search: vi.fn(async () => emptyResponse(label)),
        refresh: vi.fn(async () => undefined),
        refreshChanged: vi.fn(async () => undefined),
    } as unknown as NativeNotesIndex & {
        search: ReturnType<typeof vi.fn>;
        refresh: ReturnType<typeof vi.fn>;
        refreshChanged: ReturnType<typeof vi.fn>;
    };
}

function createAddon(
    build: (root: string, options?: { skipSymlinks?: boolean }) => Promise<NativeNotesIndex>,
): NativeNotesIndexAddon & { buildNotesIndex: ReturnType<typeof vi.fn> } {
    return {
        buildNotesIndex: vi.fn(build),
        NotesIndex: class NotesIndex {} as never,
    } as unknown as NativeNotesIndexAddon & { buildNotesIndex: ReturnType<typeof vi.fn> };
}

function createWatchHarness(): { watches: FakeWatch[]; watchFactory: NotesSearchWatchFactory } {
    const watches: FakeWatch[] = [];
    const watchFactory: NotesSearchWatchFactory = (watchPath, onEvent, onError) => {
        const close = vi.fn();
        watches.push({
            watchPath,
            emit: onEvent,
            error: onError,
            close,
        });
        return { close };
    };
    return { watches, watchFactory };
}

function scope(
    workspaceId: string,
    rootId: string,
    absolutePath: string,
    isDefault = rootId === 'default',
    isTaskDerived = rootId.startsWith('task:'),
): NotesSearchScope {
    return { workspaceId, rootId, absolutePath, isDefault, isTaskDerived };
}

async function flushDebounce(): Promise<void> {
    await vi.runAllTimersAsync();
    await Promise.resolve();
}

describe('NotesSearchService', () => {
    const services: NotesSearchService[] = [];
    const tempDirs: string[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        for (const service of services) service.dispose();
        for (const tempDir of tempDirs) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        services.length = 0;
        tempDirs.length = 0;
        vi.useRealTimers();
    });

    function makeRoot(name = 'notes'): string {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-search-service-'));
        tempDirs.push(parent);
        const root = path.join(parent, name);
        fs.mkdirSync(root, { recursive: true });
        return root;
    }

    function makeService(
        addon: NativeNotesIndexAddon,
        watchFactory: NotesSearchWatchFactory,
        logger = { error: vi.fn(), warn: vi.fn() },
    ): NotesSearchService {
        const service = new NotesSearchService({
            nativeAddon: addon,
            watchFactory,
            debounceMs: 10,
            logger,
        });
        services.push(service);
        return service;
    }

    it('shares one lazy initial build across concurrent first searches', async () => {
        const root = makeRoot();
        const build = deferred<NativeNotesIndex>();
        const index = createIndex('shared');
        const addon = createAddon(async () => build.promise);
        const { watches, watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);

        const first = service.search(scope('ws-a', 'default', root), 'one');
        const second = service.search(scope('ws-a', 'default', root), 'two');

        expect(addon.buildNotesIndex).toHaveBeenCalledOnce();
        expect(watches).toHaveLength(1);
        build.resolve(index);
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(index.search).toHaveBeenCalledTimes(2);
    });

    it('builds identical physical roots independently for each workspace and root id', async () => {
        const root = makeRoot();
        const indexes = [createIndex('workspace-a'), createIndex('workspace-b'), createIndex('other-root')];
        const addon = createAddon(async () => indexes.shift()!);
        const { watches, watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);

        const [workspaceA, workspaceB, otherRoot] = await Promise.all([
            service.search(scope('ws-a', 'default', root), 'q'),
            service.search(scope('ws-b', 'default', root), 'q'),
            service.search(scope('ws-a', 'configured', root, false), 'q'),
        ]);

        expect(addon.buildNotesIndex).toHaveBeenCalledTimes(3);
        expect(watches).toHaveLength(3);
        expect(workspaceA.results[0].path).toBe('workspace-a.md');
        expect(workspaceB.results[0].path).toBe('workspace-b.md');
        expect(otherRoot.results[0].path).toBe('other-root.md');
    });

    it('allows different scopes to build concurrently', async () => {
        const rootA = makeRoot('a');
        const rootB = makeRoot('b');
        const firstBuild = deferred<NativeNotesIndex>();
        const secondBuild = deferred<NativeNotesIndex>();
        const addon = createAddon(root => root === rootA ? firstBuild.promise : secondBuild.promise);
        const { watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);

        const first = service.search(scope('ws-a', 'default', rootA), 'q');
        const second = service.search(scope('ws-b', 'default', rootB), 'q');
        expect(addon.buildNotesIndex).toHaveBeenCalledTimes(2);

        firstBuild.resolve(createIndex());
        secondBuild.resolve(createIndex());
        await Promise.all([first, second]);
    });

    it('starts managed, configured, and task-derived roots lazily with the right symlink policy', async () => {
        const managed = makeRoot('managed');
        const configured = makeRoot('configured');
        const task = makeRoot('task');
        const addon = createAddon(async () => createIndex());
        const { watches, watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);

        expect(watches).toHaveLength(0);
        await service.search(scope('ws', 'default', managed), 'q');
        await service.search(scope('ws', 'docs', configured, false), 'q');
        await service.search(scope('ws', 'task:abc', task, false), 'q');

        expect(watches.map(watch => watch.watchPath)).toEqual([managed, configured, task]);
        expect(addon.buildNotesIndex).toHaveBeenNthCalledWith(1, managed, { skipSymlinks: false });
        expect(addon.buildNotesIndex).toHaveBeenNthCalledWith(2, configured, { skipSymlinks: true });
        expect(addon.buildNotesIndex).toHaveBeenNthCalledWith(3, task, { skipSymlinks: true });
    });

    it('coalesces Markdown changes and preserves changes arriving during an in-flight refresh', async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, 'a.md'), 'a');
        fs.mkdirSync(path.join(root, 'nested'));
        fs.writeFileSync(path.join(root, 'nested', 'b.md'), 'b');
        const firstRefresh = deferred<void>();
        const index = createIndex();
        index.refreshChanged.mockImplementationOnce(async () => firstRefresh.promise);
        const addon = createAddon(async () => index);
        const { watches, watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);
        await service.search(scope('ws', 'default', root), 'q');

        watches[0].emit('change', 'a.md');
        await vi.advanceTimersByTimeAsync(10);
        expect(index.refreshChanged).toHaveBeenCalledWith(['a.md']);

        watches[0].emit('change', 'nested\\b.md');
        await vi.advanceTimersByTimeAsync(10);
        expect(index.refreshChanged).toHaveBeenCalledTimes(1);

        firstRefresh.resolve(undefined);
        await Promise.resolve();
        await Promise.resolve();
        await flushDebounce();
        expect(index.refreshChanged).toHaveBeenNthCalledWith(2, ['nested/b.md']);

        watches[0].emit('change', 'deleted.md');
        await flushDebounce();
        expect(index.refreshChanged).toHaveBeenNthCalledWith(3, ['deleted.md']);
    });

    it('uses full recovery for rename, directory, missing-path, and oversized batches', async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, 'nested'));
        const index = createIndex();
        const addon = createAddon(async () => index);
        const { watches, watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);
        await service.search(scope('ws', 'default', root), 'q');

        watches[0].emit('rename', 'renamed.md');
        await flushDebounce();
        watches[0].emit('change', 'nested');
        await flushDebounce();
        watches[0].emit('change', null);
        await flushDebounce();
        for (let i = 0; i <= 1_024; i++) {
            watches[0].emit('change', `deleted-${i}.md`);
        }
        await flushDebounce();
        watches[0].error(new Error('watch overflow'));
        await flushDebounce();

        expect(index.refresh).toHaveBeenCalledTimes(5);
        expect(index.refreshChanged).not.toHaveBeenCalled();
        expect(watches[0].close).toHaveBeenCalledOnce();
        expect(watches).toHaveLength(2);
    });

    it('retains a failed snapshot, logs its scope, and retries fully on a later change', async () => {
        const root = makeRoot();
        const healthyRoot = makeRoot('healthy');
        fs.writeFileSync(path.join(root, 'a.md'), 'a');
        fs.writeFileSync(path.join(root, 'b.md'), 'b');
        fs.writeFileSync(path.join(healthyRoot, 'healthy.md'), 'healthy');
        const index = createIndex('old');
        const healthyIndex = createIndex('healthy');
        index.refreshChanged.mockRejectedValueOnce(new Error('read failed'));
        const addon = createAddon(async candidate => candidate === root ? index : healthyIndex);
        const { watches, watchFactory } = createWatchHarness();
        const logger = { error: vi.fn(), warn: vi.fn() };
        const service = makeService(addon, watchFactory, logger);
        await service.search(scope('ws-failed', 'docs', root, false), 'q');
        await service.search(scope('ws-healthy', 'default', healthyRoot), 'q');

        watches[0].emit('change', 'a.md');
        await flushDebounce();
        expect(index.refreshChanged).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ workspaceId: 'ws-failed', rootId: 'docs' }),
            'Notes search index refresh failed',
        );
        await expect(service.search(scope('ws-failed', 'docs', root, false), 'q'))
            .resolves.toEqual(emptyResponse('old'));
        watches[1].emit('change', 'healthy.md');
        await flushDebounce();
        expect(healthyIndex.refreshChanged).toHaveBeenCalledWith(['healthy.md']);
        await expect(service.search(scope('ws-healthy', 'default', healthyRoot), 'q'))
            .resolves.toEqual(emptyResponse('healthy'));

        watches[0].emit('change', 'b.md');
        await flushDebounce();
        expect(index.refresh).toHaveBeenCalledOnce();
    });

    it('isolates initial build failures to their own scope and permits a later retry', async () => {
        const failedRoot = makeRoot('failed');
        const healthyRoot = makeRoot('healthy');
        const healthyIndex = createIndex('healthy');
        let failedAttempts = 0;
        const addon = createAddon(async root => {
            if (root === failedRoot && failedAttempts++ === 0) throw new Error('build failed');
            return root === failedRoot ? createIndex('recovered') : healthyIndex;
        });
        const { watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);

        await expect(service.search(scope('ws-a', 'default', failedRoot), 'q')).rejects.toThrow('build failed');
        await expect(service.search(scope('ws-b', 'default', healthyRoot), 'q'))
            .resolves.toEqual(emptyResponse('healthy'));
        await expect(service.search(scope('ws-a', 'default', failedRoot), 'q'))
            .resolves.toEqual(emptyResponse('recovered'));
    });

    it('watches a missing root through its ancestor and rebinds after recovery creates it', async () => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-search-missing-'));
        tempDirs.push(parent);
        const root = path.join(parent, 'missing', 'notes');
        const index = createIndex();
        const addon = createAddon(async () => index);
        const { watches, watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);

        await service.search(scope('ws', 'default', root), 'q');
        expect(watches[0].watchPath).toBe(parent);

        fs.mkdirSync(root, { recursive: true });
        watches[0].emit('rename', 'missing');
        await flushDebounce();

        expect(index.refresh).toHaveBeenCalledOnce();
        expect(watches[0].close).toHaveBeenCalledOnce();
        expect(watches[1].watchPath).toBe(root);
    });

    it('evicts configured roots, complete root sets, and whole workspaces without cross-scope effects', async () => {
        const managed = makeRoot('managed');
        const configured = makeRoot('configured');
        const task = makeRoot('task');
        const other = makeRoot('other');
        const addon = createAddon(async () => createIndex());
        const { watches, watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);

        await Promise.all([
            service.search(scope('ws', 'default', managed), 'q'),
            service.search(scope('ws', 'docs', configured, false), 'q'),
            service.search(scope('ws', 'task:abc', task, false), 'q'),
            service.search(scope('other-ws', 'default', other), 'q'),
        ]);

        service.reconcileConfiguredRoots('ws', []);
        expect(service.hasScope('ws', 'docs')).toBe(false);
        expect(service.hasScope('ws', 'default')).toBe(true);
        expect(service.hasScope('ws', 'task:abc')).toBe(true);
        expect(watches[1].close).toHaveBeenCalledOnce();
        await expect(service.search(scope('ws', 'docs', configured, false), 'q')).rejects.toThrow(
            "Notes search root 'docs' is unavailable",
        );

        service.reconcileConfiguredRoots('ws', ['docs']);
        await expect(service.search(scope('ws', 'docs', configured, false), 'q')).resolves.toBeDefined();

        const configuredTaskPrefix = makeRoot('configured-task-prefix');
        await service.search(scope('ws', 'task:literal', configuredTaskPrefix, false, false), 'q');
        service.reconcileConfiguredRoots('ws', ['docs']);
        expect(service.hasScope('ws', 'task:literal')).toBe(false);

        service.reconcileWorkspaceRoots('ws', ['default']);
        expect(service.hasScope('ws', 'task:abc')).toBe(false);
        expect(service.hasScope('other-ws', 'default')).toBe(true);

        service.evictWorkspace('ws');
        expect(service.hasScope('ws', 'default')).toBe(false);
        expect(service.hasScope('other-ws', 'default')).toBe(true);
        await expect(service.search(scope('ws', 'default', managed), 'q')).rejects.toThrow(
            "Notes search workspace 'ws' is unavailable",
        );

        service.activateWorkspace('ws');
        await expect(service.search(scope('ws', 'default', managed), 'q')).resolves.toBeDefined();
    });

    it('closes all watchers, rejects new work after disposal, and lets in-flight search finish', async () => {
        const root = makeRoot();
        const searchResult = deferred<NativeNotesSearchResponse>();
        const index = createIndex();
        index.search.mockImplementationOnce(async () => searchResult.promise);
        const addon = createAddon(async () => index);
        const { watches, watchFactory } = createWatchHarness();
        const service = makeService(addon, watchFactory);

        const inFlight = service.search(scope('ws', 'default', root), 'q');
        await Promise.resolve();
        service.dispose();

        expect(watches[0].close).toHaveBeenCalledOnce();
        await expect(service.search(scope('ws', 'default', root), 'new')).rejects.toThrow(
            'Notes search service is disposed',
        );
        searchResult.resolve(emptyResponse('finished'));
        await expect(inFlight).resolves.toEqual(emptyResponse('finished'));
    });
});
