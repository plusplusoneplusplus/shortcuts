import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, SqliteQueueStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { releaseBotControlledConversation, admitBotControlledFollowUp } from '../../../src/server/messaging/bot-control-admission';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

describe('authoritative bot control release persistence', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let router: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    const processId = 'queue_origin';
    const openQueue = () => {
        router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
        });
        for (const workspaceId of ['ws-a', 'ws-b']) router.registerRepoId(workspaceId, path.join(dir, workspaceId));
        persistence = new SqliteQueuePersistence(router, store.getDatabase(), { restartPolicy: 'requeue' });
    };
    const restart = () => {
        persistence.dispose();
        router.dispose();
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        openQueue();
        persistence.restore();
    };
    const enqueue = (source: 'teams' | 'whatsapp', patch: Partial<QueuedTask> = {}) => {
        router.enqueue({
            id: 'origin', type: 'chat', processId, repoId: 'ws-a', priority: 'normal', config: {},
            botControl: createBotControlMetadata(source),
            payload: { kind: 'chat', prompt: 'request', workspaceId: 'ws-a' }, ...patch,
        });
    };
    const register = async (source: 'teams' | 'whatsapp') => {
        await store.addProcess({
            id: processId, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'request',
            metadata: { type: 'chat', workspaceId: 'ws-a', queueTaskId: 'origin', provider: 'codex',
                botControl: { ...createBotControlMetadata(source), externalThreadUrl: source === 'teams'
                    ? 'https://teams.microsoft.com/thread' : 'https://web.whatsapp.com/thread' } },
            conversationTurns: [{ role: 'user', content: 'request', turnIndex: 0, timestamp: new Date() }],
        });
    };
    const release = (source: 'teams' | 'whatsapp', remove = vi.fn(async () => {})) =>
        releaseBotControlledConversation(store, router.createAggregateQueueFacade(), 'ws-a', processId, source, 'origin', remove);
    const durableControl = () => new SqliteQueueStore(store.getDatabase()).getQueueTasks().find(task => task.id === 'origin')?.botControl;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-release-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        for (const workspaceId of ['ws-a', 'ws-b']) {
            const rootPath = path.join(dir, workspaceId);
            fs.mkdirSync(rootPath);
            await store.registerWorkspace({ id: workspaceId, name: workspaceId, rootPath });
        }
        openQueue();
    });
    afterEach(() => {
        persistence.dispose();
        router.dispose();
        store.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it.each(['teams', 'whatsapp'] as const)('clears %s process and origin authority before binding removal, durably and idempotently', async source => {
        enqueue(source);
        await register(source);
        const remove = vi.fn(async () => {
            expect((await store.getProcess(processId))?.metadata).not.toHaveProperty('botControl');
            expect(router.getTask('origin')).not.toHaveProperty('botControl');
            expect(durableControl()).toBeUndefined();
        });
        await release(source, remove);
        restart();
        expect((await store.getProcess(processId))?.metadata).toMatchObject({ provider: 'codex', workspaceId: 'ws-a' });
        expect((await store.getProcess(processId))?.conversationTurns).toHaveLength(1);
        expect(durableControl()).toBeUndefined();
        expect(router.getTask('origin')).not.toHaveProperty('botControl');
        await release(source, remove);
        expect(remove).toHaveBeenCalledTimes(2);
    });

    it.each(['teams', 'whatsapp'] as const)('clears accepted pending %s origins across restart without cancelling execution', async source => {
        enqueue(source);
        await release(source);
        restart();
        expect(router.getTask('origin')).toMatchObject({ status: 'queued', repoId: 'ws-a', processId });
        expect(router.getTask('origin')).not.toHaveProperty('botControl');
        expect(durableControl()).toBeUndefined();
    });

    it.each(['teams', 'whatsapp'] as const)(
        'releases an adopted nested %s fork without consulting inherited queue authority', async source => {
            enqueue(source === 'teams' ? 'whatsapp' : 'teams');
            await register(source === 'teams' ? 'whatsapp' : 'teams');
            const original = await store.getProcess(processId);
            const originalTask = new SqliteQueueStore(store.getDatabase()).getQueueTasks().find(task => task.id === 'origin');
            await store.forkProcess(processId, 'first-fork');
            const fork = await store.forkProcess('first-fork', 'nested-fork');
            await admitBotControlledFollowUp(store, 'ws-a', fork.id, source, async () => {});
            restart();
            const getTask = vi.fn(() => { throw new Error('source queue must not be consulted'); });
            const replaceBotControl = vi.fn(() => { throw new Error('source queue must not be mutated'); });
            const remove = vi.fn(async () => {});
            await releaseBotControlledConversation(store, { getTask, replaceBotControl }, 'ws-a', fork.id,
                source, 'origin', remove);
            expect(remove).toHaveBeenCalledOnce();
            expect(getTask).not.toHaveBeenCalled();
            expect(replaceBotControl).not.toHaveBeenCalled();
            expect((await store.getProcess(fork.id))?.metadata).toEqual(fork.metadata);
            expect(await store.getProcess(processId)).toEqual(original);
            expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks().find(task => task.id === 'origin'))
                .toEqual(originalTask);
        },
    );

    it.each(['workspace', 'controller'] as const)(
        'rejects adopted-fork %s drift before preparing release', async drift => {
            enqueue('teams');
            await register('teams');
            const fork = await store.forkProcess(processId, 'fork');
            await admitBotControlledFollowUp(store, 'ws-a', fork.id, 'whatsapp', async () => {});
            const prepare = vi.fn();
            const remove = vi.fn(async () => {});
            await expect(releaseBotControlledConversation(store, router.createAggregateQueueFacade(),
                drift === 'workspace' ? 'ws-b' : 'ws-a', fork.id, 'teams', 'origin', remove, prepare))
                .rejects.toThrow(drift === 'workspace' ? 'unavailable' : 'already controlled');
            expect(prepare).not.toHaveBeenCalled();
            expect(remove).not.toHaveBeenCalled();
            expect((await store.getProcess(fork.id))?.metadata?.botControl?.source).toBe('whatsapp');
            expect(durableControl()?.source).toBe('teams');
        },
    );

    it.each(['valid', 'workspace', 'process', 'payload'] as const)(
        'validates a fork with its own initial queue authority (%s)', async state => {
            enqueue('teams');
            await register('teams');
            const fork = await store.forkProcess(processId, 'queue_fork-origin');
            await store.updateProcess(fork.id, { metadata: { ...fork.metadata, queueTaskId: 'fork-origin',
                botControl: createBotControlMetadata('teams') } });
            enqueue('teams', { id: 'fork-origin', processId: state === 'process' ? processId : fork.id,
                repoId: state === 'workspace' ? 'ws-b' : 'ws-a',
                payload: { kind: 'chat', workspaceId: state === 'workspace' ? 'ws-b' : 'ws-a', prompt: 'request',
                    ...(state === 'payload' ? { processId: 'another' } : {}) } });
            const prepare = vi.fn();
            const remove = vi.fn(async () => {});
            const result = releaseBotControlledConversation(store, router.createAggregateQueueFacade(), 'ws-a',
                fork.id, 'teams', undefined, remove, prepare);
            if (state === 'valid') {
                await result;
                expect(router.getTask('fork-origin')?.botControl).toBeUndefined();
                expect((await store.getProcess(fork.id))?.metadata?.botControl).toBeUndefined();
                expect(remove).toHaveBeenCalledOnce();
            } else {
                await expect(result).rejects.toThrow('authority does not match');
                expect(prepare).not.toHaveBeenCalled();
                expect(remove).not.toHaveBeenCalled();
                expect(router.getTask('fork-origin')?.botControl?.source).toBe('teams');
                expect((await store.getProcess(fork.id))?.metadata?.botControl?.source).toBe('teams');
            }
            expect(durableControl()?.source).toBe('teams');
            expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('teams');
        },
    );

    it('rejects mismatched saved authority on an ordinary conversation without mutating a reassigned source task', async () => {
        enqueue('teams', { processId: 'unrelated' });
        await store.addProcess({
            id: 'unrelated', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'request',
            metadata: { type: 'chat', workspaceId: 'ws-a', queueTaskId: 'origin',
                botControl: createBotControlMetadata('teams') },
        });
        const remove = vi.fn(async () => {});
        await expect(releaseBotControlledConversation(store, router.createAggregateQueueFacade(), 'ws-a',
            'unrelated', 'teams', 'origin', remove)).rejects.toThrow('authority does not match');
        expect(remove).not.toHaveBeenCalled();
        expect(durableControl()?.source).toBe('teams');
        expect((await store.getProcess('unrelated'))?.metadata?.botControl?.source).toBe('teams');
    });

    it('releases a reserved pending origin before its processId is assigned by execution', async () => {
        enqueue('teams', { processId: undefined });
        await release('teams');
        restart();
        expect(router.getTask('origin')).not.toHaveProperty('botControl');
        expect(durableControl()).toBeUndefined();
    });

    it.each(['teams', 'whatsapp'] as const)('retains valid %s ownership through running recovery until explicitly released', async source => {
        enqueue(source);
        await register(source);
        router.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted('origin');
        restart();
        expect(router.getTask('origin')?.botControl).toEqual(createBotControlMetadata(source));
        await release(source);
        restart();
        expect((await store.getProcess(processId))?.metadata).not.toHaveProperty('botControl');
        expect(router.getTask('origin')).not.toHaveProperty('botControl');
    });

    it.each(['teams', 'whatsapp'] as const)('restores exact %s control and saved link when binding removal fails, then permits retry', async source => {
        enqueue(source);
        await register(source);
        const prior = (await store.getProcess(processId))!.metadata!.botControl;
        const remove = vi.fn().mockRejectedValueOnce(new Error('binding write rejected')).mockResolvedValue(undefined);
        await expect(release(source, remove)).rejects.toThrow('binding write rejected');
        expect((await store.getProcess(processId))?.metadata?.botControl).toEqual(prior);
        expect(durableControl()).toEqual(createBotControlMetadata(source));
        restart();
        await release(source, remove);
        expect(remove).toHaveBeenCalledTimes(2);
        expect((await store.getProcess(processId))?.metadata).not.toHaveProperty('botControl');
    });

    it('rolls back queue clearing and keeps the binding when process persistence fails', async () => {
        enqueue('teams');
        await register('teams');
        const update = vi.spyOn(store, 'updateProcess');
        update.mockRejectedValueOnce(new Error('process write rejected'));
        const remove = vi.fn(async () => {});
        await expect(release('teams', remove)).rejects.toThrow('process write rejected');
        expect(remove).not.toHaveBeenCalled();
        expect(durableControl()).toEqual(createBotControlMetadata('teams'));
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('teams');
        expect(update).toHaveBeenCalledOnce();
        await release('teams', remove);
    });

    it('compensates a committed process write whose observer throws', async () => {
        enqueue('whatsapp');
        await register('whatsapp');
        const update = store.updateProcess.bind(store);
        vi.spyOn(store, 'updateProcess').mockImplementationOnce(async (id, updates) => {
            await update(id, updates);
            throw new Error('observer rejected');
        });
        const remove = vi.fn(async () => {});
        await expect(release('whatsapp', remove)).rejects.toThrow('observer rejected');
        expect(remove).not.toHaveBeenCalled();
        expect(durableControl()?.source).toBe('whatsapp');
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('whatsapp');
    });

    it('keeps process, queue, and binding on durable queue rejection, then retries', async () => {
        enqueue('teams');
        await register('teams');
        store.getDatabase().exec(`CREATE TRIGGER reject_release BEFORE INSERT ON queue_tasks
            WHEN NEW.id = 'origin' AND NEW.bot_control IS NULL
            BEGIN SELECT RAISE(ABORT, 'release write rejected'); END`);
        const remove = vi.fn(async () => {});
        await expect(release('teams', remove)).rejects.toThrow('release write rejected');
        expect(remove).not.toHaveBeenCalled();
        expect(durableControl()?.source).toBe('teams');
        expect(router.getTask('origin')?.botControl?.source).toBe('teams');
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('teams');
        store.getDatabase().exec('DROP TRIGGER reject_release');
        await release('teams', remove);
    });

    it('does not erase other-workspace queued authority or process metadata', async () => {
        enqueue('teams');
        await register('teams');
        enqueue('whatsapp', { id: 'other', processId: 'queue_other', repoId: 'ws-b',
            payload: { kind: 'chat', workspaceId: 'ws-b', prompt: 'other' } });
        await store.addProcess({
            id: 'queue_other', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'other',
            metadata: { type: 'chat', workspaceId: 'ws-b', botControl: createBotControlMetadata('whatsapp') },
        });
        await release('teams');
        expect(router.getTask('other')?.botControl?.source).toBe('whatsapp');
        expect((await store.getProcess('queue_other'))?.metadata?.botControl?.source).toBe('whatsapp');
    });

    it.each(['process', 'queue'] as const)('rejects competing %s ownership without touching the binding', async target => {
        enqueue(target === 'queue' ? 'whatsapp' : 'teams');
        await register(target === 'process' ? 'whatsapp' : 'teams');
        const remove = vi.fn(async () => {});
        await expect(release('teams', remove)).rejects.toThrow('already controlled');
        expect(remove).not.toHaveBeenCalled();
        expect(durableControl()).toBeDefined();
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeDefined();
    });

    it.each(['process', 'queue'] as const)('rejects malformed %s ownership rather than overwriting it', async target => {
        enqueue('teams');
        await register('teams');
        if (target === 'process') {
            const process = (await store.getProcess(processId))!;
            await store.updateProcess(processId, { metadata: { ...process.metadata,
                botControl: { ...createBotControlMetadata('teams'), controllerKey: 'unknown' } } });
        } else {
            router.getTask('origin')!.botControl!.controllerKey = 'unknown';
        }
        const remove = vi.fn(async () => {});
        await expect(release('teams', remove)).rejects.toThrow(/Invalid bot control/);
        expect(remove).not.toHaveBeenCalled();
    });

    it('rejects a workspace hint even when the SQLite single-process reader ignores it', async () => {
        enqueue('teams');
        await register('teams');
        const remove = vi.fn(async () => {});
        await expect(releaseBotControlledConversation(store, router.createAggregateQueueFacade(), 'ws-b',
            processId, 'teams', 'origin', remove)).rejects.toThrow('unavailable');
        expect(remove).not.toHaveBeenCalled();
    });

    it.each([
        { processId: 'queue_other' },
        { payload: { kind: 'chat', workspaceId: 'ws-b', prompt: 'request' } },
        { payload: { kind: 'chat', workspaceId: 'ws-a', prompt: 'request', processId: 'another' } },
    ])('rejects contradictory pending authority (%j)', async patch => {
        enqueue('teams', patch);
        const remove = vi.fn(async () => {});
        await expect(release('teams', remove)).rejects.toThrow('authority does not match');
        expect(remove).not.toHaveBeenCalled();
        expect(durableControl()?.source).toBe('teams');
    });

    it('permits removal of a disappeared origin without attributing any other conversation', async () => {
        const remove = vi.fn(async () => {});
        await release('teams', remove);
        expect(remove).toHaveBeenCalledOnce();
        expect(await store.getAllProcesses()).toEqual([]);
    });

    it('serializes release with adoption so the new owner cannot be erased', async () => {
        await register('teams');
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        let finish!: () => void;
        const removal = new Promise<void>(resolve => { finish = resolve; });
        const first = release('teams', vi.fn(async () => { entered(); await removal; }));
        await started;
        const admit = vi.fn(async () => 'admitted');
        const second = admitBotControlledFollowUp(store, 'ws-a', processId, 'whatsapp', admit);
        expect(admit).not.toHaveBeenCalled();
        finish();
        await first;
        expect(await second).toBe('admitted');
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('whatsapp');
    });

    it('surfaces removal and rollback failures explicitly', async () => {
        await register('teams');
        const update = store.updateProcess.bind(store);
        vi.spyOn(store, 'updateProcess').mockImplementationOnce(update).mockRejectedValueOnce(new Error('rollback write rejected'));
        const remove = vi.fn(async () => { throw new Error('binding write rejected'); });
        await expect(release('teams', remove)).rejects.toMatchObject({
            message: 'Bot control release failed and could not be fully rolled back',
            errors: [expect.objectContaining({ message: 'binding write rejected' }),
                expect.objectContaining({ message: 'rollback write rejected' })],
        });
    });
});
