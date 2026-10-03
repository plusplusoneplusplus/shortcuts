import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, SqliteQueueStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

describe('WhatsApp trusted new and pending conversation admission', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let queue: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    let bindings: WhatsAppBindings;
    let enabled: boolean | undefined;
    let deps: WhatsAppRouterDeps;
    let router: WhatsAppCommandRouter;
    const inbound = (messageId: string, quotedMessageId?: string): InboundWAMessage => ({
        chatJid: 'test-group@g.us', senderJid: 'test-group@g.us', fromMe: true,
        text: 'question', messageId, quotedMessageId,
    });
    const setupQueue = () => {
        queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
            followUpSuggestions: { enabled: false, count: 0 },
        });
        queue.registerRepoId('ws-a', path.join(dir, 'ws-a'));
        queue.registerRepoId('ws-b', path.join(dir, 'ws-b'));
        persistence = new SqliteQueuePersistence(queue, store.getDatabase());
    };
    const setupRouter = () => {
        deps = {
            store, bindings, groupJid: () => 'test-group@g.us',
            getBotManagedConversationsEnabled: () => enabled === true,
            getTask: id => queue.getTask(id),
            enqueue: vi.fn((workspaceId, prompt, mode, processId, id, botControl) => queue.enqueue({
                id, processId, botControl, type: 'chat', repoId: workspaceId, priority: 'normal',
                payload: { kind: 'chat', mode, workspaceId, prompt, relayRequestId: id,
                    ...(processId !== toQueueProcessId(id) ? { processId } : {}) },
                config: {},
            })),
            send: vi.fn(async () => 'test-outbound'),
            react: vi.fn(async () => {}),
            queued: vi.fn(),
        };
        router = new WhatsAppCommandRouter(deps);
    };

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-new-control-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        for (const id of ['ws-a', 'ws-b']) {
            fs.mkdirSync(path.join(dir, id));
            await store.registerWorkspace({ id, name: id, rootPath: path.join(dir, id) });
        }
        setupQueue();
        bindings = new WhatsAppBindings(dir);
        await bindings.restore(store);
        bindings.selectRepo('ws-a');
        enabled = true;
        setupRouter();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        persistence?.dispose();
        queue?.dispose();
        store?.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it.each([true, false, undefined])('admits initial provenance only under the live gate (%s)', async gate => {
        enabled = gate;
        await router.handle(inbound('first'));
        const binding = bindings.findMessage('first')!;
        const task = new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')[0];
        expect(task.botControl).toEqual(gate ? createBotControlMetadata('whatsapp') : undefined);
        expect(task.processId).toBe(binding.processId);
        expect(task.payload).not.toHaveProperty('botControl');
        expect(task.config).not.toHaveProperty('botControl');
        expect(task.payload).toMatchObject({ workspaceId: 'ws-a', relayRequestId: binding.taskId });
        expect(await store.getProcess(binding.processId)).toBeUndefined();
        expect(deps.react).toHaveBeenCalledWith('first');
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-b')).toEqual([]);
    });

    it('restores authoritative pending work and admits quoted follow-ups in its owning workspace', async () => {
        await Promise.all([router.handle(inbound('first')), router.handle(inbound('first'))]);
        const original = bindings.findMessage('first')!;
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        persistence.dispose();
        queue.dispose();
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        setupQueue();
        persistence.restore();
        bindings = new WhatsAppBindings(dir);
        await bindings.restore(store);
        bindings.selectRepo('ws-b');
        setupRouter();
        enabled = false;
        await router.handle(inbound('pending', 'first'));
        await router.handle(inbound('pending', 'first'));
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        expect(bindings.findMessage('pending')).toMatchObject({
            workspaceId: 'ws-a', processId: original.processId,
        });
        const tasks = new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a');
        expect(tasks).toHaveLength(2);
        expect(tasks.find(task => task.id === original.taskId)?.botControl).toEqual(createBotControlMetadata('whatsapp'));
        expect(tasks.find(task => task.id !== original.taskId)?.payload.processId).toBe(original.processId);
        expect(tasks.find(task => task.id !== original.taskId)?.botControl).toBeUndefined();
        expect(bindings.selectedRepo).toBe('ws-b');
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-b')).toEqual([]);
    });

    it('does not infer a claim for an unmarked queued origin when the gate changes', async () => {
        enabled = false;
        await router.handle(inbound('first'));
        enabled = true;
        await router.handle(inbound('pending'));
        const tasks = new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a');
        expect(tasks).toHaveLength(2);
        expect(tasks.every(task => task.botControl === undefined)).toBe(true);
    });

    it('preserves running origin and follow-up receipts through repeated restarts and workspace changes', async () => {
        await router.handle(inbound('origin'));
        const origin = bindings.findMessage('origin')!;
        await router.handle(inbound('pending', 'origin'));
        const pending = bindings.findMessage('pending')!;
        for (const receipt of [origin, pending]) {
            queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted(receipt.taskId);
            persistence.dispose();
            queue.dispose();
            store.close();
            store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
            setupQueue();
            persistence.dispose();
            persistence = new SqliteQueuePersistence(queue, store.getDatabase(), { restartPolicy: 'requeue' });
            persistence.restore();
            bindings = new WhatsAppBindings(dir);
            await bindings.restore(store);
            bindings.selectRepo('ws-b');
            setupRouter();
            enabled = false;
            await router.handle(inbound('origin'));
            await router.handle(inbound('pending', 'origin'));
            expect(deps.enqueue).not.toHaveBeenCalled();
            expect(queue.getTask(receipt.taskId)).toMatchObject({
                id: receipt.taskId, processId: origin.processId, repoId: 'ws-a',
                payload: { relayRequestId: receipt.taskId, workspaceId: 'ws-a' },
            });
            expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')).toHaveLength(2);
        }
        await router.handle(inbound('next', 'origin'));
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        expect(bindings.findMessage('next')).toMatchObject({ workspaceId: 'ws-a', processId: origin.processId });
        expect(queue.getTask(origin.taskId)?.botControl).toEqual(createBotControlMetadata('whatsapp'));
        expect(queue.getTask(pending.taskId)?.botControl).toBeUndefined();
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-b')).toEqual([]);
    });

    it('rejects receipts without live pending work rather than creating a false follow-up', async () => {
        const processId = toQueueProcessId('missing-task');
        bindings.add({
            workspaceId: 'ws-a', processId, taskId: 'missing-task',
            groupJid: 'test-group@g.us', inboundId: 'stale', outboundIds: [], status: 'queued', nextPart: 0,
        });
        bindings.selectTopic('ws-a', processId);
        await router.handle(inbound('question'));
        expect(deps.enqueue).not.toHaveBeenCalled();
        expect(bindings.findMessage('question')).toBeUndefined();
        expect(deps.send).toHaveBeenCalledWith(expect.stringContaining('unavailable'), 'question');
    });

    it('rejects competing pending provenance and wrong-workspace processes even with a receipt', async () => {
        await router.handle(inbound('first'));
        const original = bindings.findMessage('first')!;
        queue.getTask(original.taskId)!.botControl = createBotControlMetadata('teams');
        await router.handle(inbound('competing'));
        expect(bindings.findMessage('competing')).toBeUndefined();
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        await store.addProcess({
            id: original.processId, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: '',
            metadata: { type: 'chat', workspaceId: 'ws-b' },
        });
        await router.handle(inbound('wrong-workspace'));
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        expect(bindings.findMessage('wrong-workspace')).toBeUndefined();
        expect((await store.getProcess(original.processId))?.metadata?.botControl).toBeUndefined();
    });

    it.each(['identity', 'private-fields'] as const)('rejects malformed pending control (%s)', async malformed => {
        await router.handle(inbound('first'));
        const original = bindings.findMessage('first')!;
        queue.getTask(original.taskId)!.botControl = malformed === 'identity'
            ? { ...createBotControlMetadata('whatsapp'), controllerLabel: 'Unknown controller' }
            : Object.assign(createBotControlMetadata('whatsapp'), { routingAccount: 'private-fixture' });
        await router.handle(inbound('malformed'));
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        expect(bindings.findMessage('malformed')).toBeUndefined();
        expect(deps.send).toHaveBeenCalledWith(expect.stringContaining('Could not queue'), 'malformed');
    });

    it('removes rejected durable admission and its receipt, then retries with provenance', async () => {
        store.getDatabase().exec(`
            CREATE TRIGGER reject_new_bot BEFORE INSERT ON queue_tasks
            WHEN NEW.repo_id = 'ws-a'
            BEGIN SELECT RAISE(ABORT, 'admission failed'); END;
        `);
        await router.handle(inbound('retry'));
        expect(bindings.findMessage('retry')).toBeUndefined();
        expect(queue.createAggregateQueueFacade().getQueued()).toEqual([]);
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')).toEqual([]);
        expect(deps.react).not.toHaveBeenCalled();
        store.getDatabase().exec('DROP TRIGGER reject_new_bot');
        await router.handle(inbound('retry'));
        await router.handle(inbound('retry'));
        expect(deps.enqueue).toHaveBeenCalledTimes(2);
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')[0].botControl)
            .toEqual(createBotControlMetadata('whatsapp'));
    });

    it.each(['new', 'existing', 'pending'] as const)('retains %s control and receipt after a post-admission observer error', async kind => {
        if (kind === 'existing') {
            await store.addProcess({
                id: 'topic', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: '',
                metadata: { type: 'chat', workspaceId: 'ws-a', provider: 'claude' },
            });
            bindings.selectTopic('ws-a', 'topic');
        }
        if (kind === 'pending') {
            await router.handle(inbound('origin'));
            vi.mocked(deps.enqueue).mockClear();
            vi.mocked(deps.react).mockClear();
            vi.mocked(deps.queued!).mockClear();
        }
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => {
            throw new Error('observer failed');
        });
        await router.handle(inbound('accepted'));
        await router.handle(inbound('accepted'));
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        const binding = bindings.findMessage('accepted')!;
        expect(bindings.topic('ws-a')).toBe(binding.processId);
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')).toHaveLength(kind === 'pending' ? 2 : 1);
        expect(deps.queued).toHaveBeenCalledWith(binding);
        expect(deps.react).toHaveBeenCalledWith('accepted');
        expect(deps.send).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('admitted'), expect.any(Error));
        if (kind === 'existing') {
            expect((await store.getProcess('topic'))?.metadata).toMatchObject({
                botControl: createBotControlMetadata('whatsapp'), provider: 'claude',
            });
        } else if (kind === 'new') {
            expect(queue.getTask(binding.taskId)?.botControl).toEqual(createBotControlMetadata('whatsapp'));
        } else {
            expect(queue.getTask(bindings.findMessage('origin')!.taskId)?.botControl).toEqual(createBotControlMetadata('whatsapp'));
            expect(queue.getTask(binding.taskId)?.botControl).toBeUndefined();
        }
        const restored = new WhatsAppBindings(dir);
        await restored.restore(store);
        expect(restored.findMessage('accepted')).toEqual(binding);
    });

    it.each(['repo', 'process', 'request', 'payload-process'] as const)(
        'does not reconcile a rejected enqueue against mismatched %s authority', async mismatch => {
            const enqueue = deps.enqueue;
            deps.enqueue = vi.fn(async (...args) => {
                const id = await enqueue(...args);
                const task = queue.getTask(id)!;
                if (mismatch === 'repo') task.repoId = 'ws-b';
                if (mismatch === 'process') task.processId = 'other-process';
                if (mismatch === 'request') task.payload.relayRequestId = 'other-request';
                if (mismatch === 'payload-process') task.payload.processId = 'other-process';
                throw new Error('rejected');
            });
            await router.handle(inbound('mismatch'));
            expect(bindings.findMessage('mismatch')).toBeUndefined();
            expect(deps.react).not.toHaveBeenCalled();
            expect(deps.send).toHaveBeenCalledWith(expect.stringContaining('Could not queue'), 'mismatch');
        },
    );

    it('does not enqueue after a receipt write failure and permits retry', async () => {
        const file = path.join(dir, 'repos', 'ws-a', 'whatsapp-bindings.json');
        fs.mkdirSync(file, { recursive: true });
        await router.handle(inbound('retry'));
        expect(deps.enqueue).not.toHaveBeenCalled();
        expect(bindings.findMessage('retry')).toBeUndefined();
        fs.rmSync(file, { recursive: true });
        await router.handle(inbound('retry'));
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        expect(queue.getTask(bindings.findMessage('retry')!.taskId)?.botControl)
            .toEqual(createBotControlMetadata('whatsapp'));
    });

    it('reports an accepted request accurately when confirmation persistence fails', async () => {
        vi.spyOn(bindings, 'selectTopic').mockImplementationOnce(() => { throw new Error('selection failed'); });
        await router.handle(inbound('accepted'));
        await router.handle(inbound('accepted'));
        expect(deps.enqueue).toHaveBeenCalledTimes(1);
        expect(bindings.findMessage('accepted')).toBeDefined();
        expect(deps.send).toHaveBeenCalledWith(expect.stringContaining('Request was queued'), 'accepted');
    });
});
