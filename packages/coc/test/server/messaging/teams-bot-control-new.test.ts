import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, SqliteQueueStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import type { BotControlMetadata } from '@plusplusoneplusplus/forge/ai';
import { TeamsUserStateStore } from '../../../src/server/messaging/teams-user-state';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { getRepoDataPath } from '../../../src/server/paths';

describe('Teams trusted initial conversation admission', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let queue: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    let manager: TeamsMessagingManager;
    let enabled: boolean | undefined;
    let relayEnabled: boolean;
    let relayQueue: ReturnType<MultiRepoQueueRouter['createAggregateQueueFacade']>;
    let handle: (msg: InboundTeamsMessage) => Promise<void>;
    let enqueue: ReturnType<typeof vi.fn>;
    let followUp: ReturnType<typeof vi.fn>;
    let admitFollowUp: ReturnType<typeof vi.fn>;
    let enqueuePending: ReturnType<typeof vi.fn>;
    let send: ReturnType<typeof vi.fn>;
    const inbound = (messageId: string, text = 'question', replyToMessageId?: string): InboundTeamsMessage => ({
        channelId: 'test-channel', messageId, text, senderAadId: 'synthetic-user', replyToMessageId,
    });
    const tasks = (workspaceId = 'ws-a') => new SqliteQueueStore(store.getDatabase()).getQueueTasks(workspaceId);
    const register = () => {
        relayQueue = queue.createAggregateQueueFacade();
        registerTeamsMessagingRoutes([], {
            dataDir: dir, store, manager, relayQueue,
            getAnswerRelayEnabled: () => relayEnabled,
            getBotManagedConversationsEnabled: () => enabled === true,
            enqueueChat: (ws, prompt, mode, id, control) => enqueue(ws, prompt, mode, id, control),
            enqueueRelayChat: (ws, prompt, id, mode, control) => enqueue(ws, prompt, mode, id, control),
            executeFollowUp: followUp,
            admitRelayFollowUp: admitFollowUp,
            enqueuePendingRelayFollowUp: enqueuePending,
        });
    };

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-new-control-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        for (const id of ['ws-a', 'ws-b']) {
            fs.mkdirSync(path.join(dir, id));
            await store.registerWorkspace({ id, name: id, rootPath: path.join(dir, id) });
        }
        // Plain messages go to the selected repo (else Global); these cases run in ws-a.
        new TeamsUserStateStore(dir).update('synthetic-user', { selectedRepo: 'ws-a' });
        queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
            followUpSuggestions: { enabled: false, count: 0 },
        });
        queue.registerRepoId('ws-a', path.join(dir, 'ws-a'));
        queue.registerRepoId('ws-b', path.join(dir, 'ws-b'));
        persistence = new SqliteQueuePersistence(queue, store.getDatabase());
        manager = new TeamsMessagingManager(dir);
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId: 'test-team', channelId: 'test-channel',
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => {
            handle = msg => handler(msg, () => {});
        });
        send = vi.fn(async () => 'synthetic-outbound');
        vi.spyOn(manager, 'sendMessage').mockImplementation(send);
        enqueue = vi.fn((workspaceId: string, prompt: string, mode: string | undefined, id?: string, botControl?: BotControlMetadata) =>
            queue.enqueue({
                id, botControl, ...(id ? { processId: toQueueProcessId(id) } : {}),
                type: 'chat', repoId: workspaceId, priority: 'normal',
                payload: { kind: 'chat', mode: mode ?? 'ask', workspaceId, prompt }, config: {},
            }));
        followUp = vi.fn(async () => {});
        admitFollowUp = vi.fn(async (proc, prompt: string, requestId: string, _mode: string | undefined, id?: string) => ({
            taskId: await queue.enqueue({
                id, type: 'chat', repoId: proc.metadata.workspaceId, processId: proc.id, priority: 'normal',
                payload: {
                    kind: 'chat', mode: 'ask', workspaceId: proc.metadata.workspaceId,
                    processId: proc.id, prompt, relayRequestId: requestId,
                }, config: {},
            }),
        }));
        enqueuePending = vi.fn((workspaceId: string, processId: string, prompt: string, requestId: string, _mode: string | undefined, id?: string) =>
            queue.enqueue({
                id, type: 'chat', repoId: workspaceId, processId, priority: 'normal',
                payload: { kind: 'chat', mode: 'ask', workspaceId, processId, prompt, relayRequestId: requestId },
                config: {},
            }));
        enabled = true;
        relayEnabled = true;
        register();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        manager?.dispose();
        persistence?.dispose();
        queue?.dispose();
        store?.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it.each([
        [true, true], [true, false], [true, undefined],
        [false, true], [false, false], [false, undefined],
    ])('gates durable initial provenance independently of answer relay (%s, %s)', async (relay, gate) => {
        relayEnabled = relay === true;
        enabled = gate;
        await handle(inbound('first'));
        expect(tasks()).toHaveLength(1);
        const task = tasks()[0];
        expect(task.botControl).toEqual(gate ? createBotControlMetadata('teams') : undefined);
        expect(task.payload).not.toHaveProperty('botControl');
        expect(task.config).not.toHaveProperty('botControl');
        expect(task.payload.workspaceId).toBe('ws-a');
        expect(await store.getProcess(toQueueProcessId(task.id))).toBeUndefined();
        expect(tasks('ws-b')).toEqual([]);
        expect(fs.existsSync(getRepoDataPath(dir, 'ws-a', 'teams-answer-relay'))).toBe(relay || gate === true);
        expect(send).toHaveBeenCalledWith(expect.stringContaining('New topic created'), 'first');
    });

    it('preserves explicit modes through controlled new, pending and adopted admissions', async () => {
        await handle(inbound('mode-origin', '/autopilot first'));
        const origin = tasks()[0];
        expect(origin.payload.mode).toBe('autopilot');
        expect(origin.botControl).toEqual(createBotControlMetadata('teams'));
        await handle(inbound('mode-pending', '/ask follow'));
        expect(enqueuePending).toHaveBeenLastCalledWith(
            'ws-a', origin.processId, 'follow', expect.any(String), 'ask', expect.any(String),
        );
        await existing(undefined, 'ws-a');
        await handle(inbound('choose-existing', '/select topic existing-topic'));
        await handle(inbound('mode-adopted', '/autopilot adopted'));
        expect(admitFollowUp).toHaveBeenLastCalledWith(
            expect.objectContaining({ id: 'existing-topic' }), 'adopted', expect.any(String), 'autopilot', expect.any(String),
        );
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('samples the live gate separately for each selected workspace without backfilling queued work', async () => {
        enabled = false;
        await handle(inbound('first'));
        await handle(inbound('choose-b', '/select repo ws-b'));
        await handle(inbound('new-b', '/create topic'));
        enabled = true;
        await handle(inbound('second'));
        expect(tasks()[0].botControl).toBeUndefined();
        expect(tasks('ws-b')[0].botControl).toEqual(createBotControlMetadata('teams'));
        enabled = false;
        expect(tasks('ws-b')[0].botControl).toEqual(createBotControlMetadata('teams'));
    });

    it.each([true, false])('removes rejected durable admission and permits retry (relay %s)', async relay => {
        relayEnabled = relay;
        store.getDatabase().exec(`
            CREATE TRIGGER reject_teams_origin BEFORE INSERT ON queue_tasks
            BEGIN SELECT RAISE(ABORT, 'admission failed'); END;
        `);
        await handle(inbound('retry'));
        expect(tasks()).toEqual([]);
        expect(queue.createAggregateQueueFacade().getQueued()).toEqual([]);
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('New topic created'), 'retry');
        store.getDatabase().exec('DROP TRIGGER reject_teams_origin');
        await handle(inbound('retry'));
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(tasks()[0].botControl).toEqual(createBotControlMetadata('teams'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('New topic created'), 'retry');
    });

    it.each([true, false])('retains admitted provenance after a taskAdded observer throws (relay %s)', async relay => {
        relayEnabled = relay;
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => {
            throw new Error('observer failed');
        });
        await handle(inbound('accepted'));
        expect(tasks()).toHaveLength(1);
        expect(tasks()[0].botControl).toEqual(createBotControlMetadata('teams'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('New topic created'), 'accepted');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('admission retained'));
        await handle(inbound('accepted'));
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])('restores receipt and queued provenance without replaying an accepted delivery (relay %s)', async relay => {
        relayEnabled = relay;
        await Promise.all([handle(inbound('first')), handle(inbound('first'))]);
        expect(enqueue).toHaveBeenCalledTimes(1);
        const original = tasks()[0];
        manager.dispose();
        register();
        enabled = false;
        await handle(inbound('first'));
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(tasks()[0]).toMatchObject({ id: original.id, botControl: createBotControlMetadata('teams') });
    });

    it.each([true, false])('retains running origin and pending request identities across repeated restarts (relay %s)', async relay => {
        relayEnabled = relay;
        await handle(inbound('origin'));
        const origin = tasks()[0];
        await handle(inbound('pending', 'follow-up'));
        const pending = tasks().find(task => task.id !== origin.id)!;
        for (let attempt = 0; attempt < 2; attempt++) {
            queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted(origin.id);
            manager.dispose();
            persistence.dispose();
            queue.dispose();
            store.close();
            store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
            queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
                aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
                followUpSuggestions: { enabled: false, count: 0 },
            });
            persistence = new SqliteQueuePersistence(queue, store.getDatabase(), { restartPolicy: 'requeue' });
            persistence.restore();
            register();
            enabled = false;
            await handle(inbound('origin'));
            await handle(inbound('pending', 'follow-up'));
            expect(tasks()).toHaveLength(2);
            expect(tasks().find(task => task.id === origin.id)).toMatchObject({
                processId: origin.processId, botControl: createBotControlMetadata('teams'), priority: 'high',
            });
            expect(tasks().find(task => task.id === pending.id)).toMatchObject({
                processId: origin.processId, payload: { relayRequestId: pending.payload.relayRequestId },
            });
        }
        await handle(inbound('next', 'next question'));
        expect(tasks()).toHaveLength(3);
        expect(tasks().find(task => task.payload.prompt === 'next question')).toMatchObject({
            processId: origin.processId, payload: { workspaceId: 'ws-a', processId: origin.processId },
        });
        expect(tasks('ws-b')).toEqual([]);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueuePending).toHaveBeenCalledTimes(2);
    });

    it.each([true, false])('does not report admission from another workspace after an observer error (relay %s)', async relay => {
        relayEnabled = relay;
        const getTask = relayQueue.getTask.bind(relayQueue);
        vi.spyOn(relayQueue, 'getTask').mockImplementation(id => {
            const task = getTask(id);
            return task ? { ...task, repoId: 'ws-b' } : undefined;
        });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => {
            throw new Error('observer failed');
        });
        await handle(inbound('mismatch'));
        expect(tasks()).toHaveLength(1);
        expect(tasks('ws-b')).toEqual([]);
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('New topic created'), 'mismatch');
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('admission retained'));
    });

    it.each([true, false].flatMap(relay => ['competing', 'private-fields'].map(kind => [relay, kind] as const)))(
        'rejects provenance during initial observer reconciliation (relay %s, %s)', async (relay, kind) => {
            relayEnabled = relay;
            const getTask = relayQueue.getTask.bind(relayQueue);
            vi.spyOn(relayQueue, 'getTask').mockImplementation(id => {
                const task = getTask(id);
                return task ? { ...task, botControl: kind === 'competing'
                    ? createBotControlMetadata('whatsapp')
                    : Object.assign(createBotControlMetadata('teams'), { account: 'private-fixture' }) } : undefined;
            });
            queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => {
                throw new Error('observer failed');
            });
            await handle(inbound('invalid'));
            expect(send).not.toHaveBeenCalledWith(expect.stringContaining('New topic created'), 'invalid');
            expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('admission retained'));
        },
    );

    it.each([true, false])('does not enqueue or falsely mark a chat when its initial receipt cannot persist (relay %s)', async relay => {
        relayEnabled = relay;
        const folder = getRepoDataPath(dir, 'ws-a', 'teams-answer-relay');
        fs.mkdirSync(path.dirname(folder), { recursive: true });
        fs.writeFileSync(folder, 'not-a-directory');
        await handle(inbound('receipt-failed'));
        expect(enqueue).not.toHaveBeenCalled();
        expect(tasks()).toEqual([]);
        fs.unlinkSync(folder);
        await handle(inbound('receipt-failed'));
        expect(enqueue).toHaveBeenCalledOnce();
        expect(tasks()[0].botControl).toEqual(createBotControlMetadata('teams'));
    });

    it.each(['missing-control', 'prompt', 'request'])('does not accept an ordinary observer outcome with %s drift', async mismatch => {
        relayEnabled = false;
        const lookup = relayQueue.getTask.bind(relayQueue);
        vi.spyOn(relayQueue, 'getTask').mockImplementation(id => {
            const task = lookup(id);
            if (!task) return undefined;
            return {
                ...task, ...(mismatch === 'missing-control' ? { botControl: undefined } : {}),
                payload: { ...task.payload,
                    ...(mismatch === 'prompt' ? { prompt: 'unrelated prompt' } : {}),
                    ...(mismatch === 'request' ? { relayRequestId: 'unrelated request' } : {}),
                },
            };
        });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => {
            throw new Error('observer failed');
        });
        await handle(inbound('ordinary-drift'));
        expect(tasks()).toHaveLength(1);
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('New topic created'), 'ordinary-drift');
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('admission retained'));
        await handle(inbound('ordinary-drift'));
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it('restores a command-only thread after rejected initial admission and retries in its selected workspace', async () => {
        await handle(inbound('choose-b', '/select repo ws-b', 'command-root'));
        store.getDatabase().exec(`
            CREATE TRIGGER reject_teams_origin BEFORE INSERT ON queue_tasks
            BEGIN SELECT RAISE(ABORT, 'admission failed'); END;
        `);
        await handle(inbound('retry', 'question', 'command-root'));
        expect(tasks('ws-b')).toEqual([]);
        store.getDatabase().exec('DROP TRIGGER reject_teams_origin');
        await handle(inbound('retry', 'question', 'command-root'));
        await handle(inbound('retry', 'question', 'command-root'));
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(tasks('ws-b')[0].botControl).toEqual(createBotControlMetadata('teams'));
        expect(tasks()).toEqual([]);
        expect(send).toHaveBeenCalledWith(expect.stringContaining('New chat started'), 'command-root');
    });

    it('continues an ordinary managed origin by its process identity after creation', async () => {
        relayEnabled = false;
        await handle(inbound('first'));
        const origin = tasks()[0];
        await store.addProcess({
            id: toQueueProcessId(origin.id), type: 'chat', status: 'completed',
            startTime: new Date(), promptPreview: '', metadata: {
                type: 'chat', workspaceId: 'ws-a', botControl: origin.botControl, provider: 'claude',
            },
        });
        await handle(inbound('follow', 'later question'));
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(followUp).not.toHaveBeenCalled();
        expect(admitFollowUp).toHaveBeenCalledWith(
            expect.objectContaining({ id: toQueueProcessId(origin.id) }), 'later question',
            expect.any(String), undefined, expect.any(String),
        );
        expect((await store.getProcess(toQueueProcessId(origin.id)))?.metadata).toMatchObject({
            botControl: createBotControlMetadata('teams'), provider: 'claude',
        });
    });

    it.each([true, false])('preserves the initial pending claim across gate changes (initial gate %s)', async gate => {
        enabled = gate;
        await handle(inbound('pending-origin'));
        const origin = tasks()[0];
        enabled = !gate;
        await handle(inbound('pending-question', '  next question  '));
        expect(enqueue).toHaveBeenCalledOnce();
        expect(enqueuePending).toHaveBeenCalledWith(
            'ws-a', origin.processId, 'next question', expect.any(String), undefined, expect.any(String),
        );
        expect(tasks()).toHaveLength(2);
        expect(tasks()[0].botControl).toEqual(gate ? createBotControlMetadata('teams') : undefined);
        expect(tasks()[1]).toMatchObject({
            processId: origin.processId,
            payload: { workspaceId: 'ws-a', processId: origin.processId, prompt: 'next question' },
        });
        expect(tasks()[1].botControl).toBeUndefined();
        expect(await store.getProcess(origin.processId!)).toBeUndefined();
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'pending-question');
        expect(tasks('ws-b')).toEqual([]);
    });

    it.each([true, false])('reconciles an accepted pending follow-up observer error and deduplicates after reload (relay %s)', async relay => {
        relayEnabled = relay;
        await handle(inbound('pending-origin'));
        const origin = tasks()[0];
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => {
            throw new Error('pending observer failed');
        });
        await handle(inbound('pending-question', 'accepted follow-up'));
        const follow = tasks()[1];
        expect(follow.id).toBe(enqueuePending.mock.calls[0][5]);
        expect(follow.processId).toBe(origin.processId);
        expect(tasks()[0].botControl).toEqual(createBotControlMetadata('teams'));
        expect(follow.botControl).toBeUndefined();
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'pending-question');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Pending follow-up observer failed; admission retained'));
        await handle(inbound('pending-question', 'accepted follow-up'));
        manager.dispose();
        register();
        enabled = false;
        await handle(inbound('pending-question', 'accepted follow-up'));
        expect(enqueuePending).toHaveBeenCalledOnce();
        expect(tasks()).toHaveLength(2);
    });

    it.each([true, false])('removes a rejected pending receipt without clearing the origin and retries the delivery (relay %s)', async relay => {
        relayEnabled = relay;
        await handle(inbound('pending-origin'));
        const origin = tasks()[0];
        store.getDatabase().exec(`
            CREATE TRIGGER reject_pending_follow_up BEFORE INSERT ON queue_tasks
            BEGIN SELECT RAISE(ABORT, 'pending admission failed'); END;
        `);
        await handle(inbound('pending-question', 'retry follow-up'));
        expect(tasks()).toHaveLength(1);
        expect(tasks()[0]).toMatchObject({ id: origin.id, botControl: createBotControlMetadata('teams') });
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'pending-question');
        const folder = getRepoDataPath(dir, 'ws-a', 'teams-answer-relay');
        expect(fs.readdirSync(folder)).toHaveLength(1);
        store.getDatabase().exec('DROP TRIGGER reject_pending_follow_up');
        await handle(inbound('pending-question', 'retry follow-up'));
        await handle(inbound('pending-question', 'retry follow-up'));
        expect(enqueuePending).toHaveBeenCalledTimes(2);
        expect(tasks()).toHaveLength(2);
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'pending-question');
    });

    it.each([true, false])('fails pending receipt persistence before enqueue and permits retry (relay %s)', async relay => {
        relayEnabled = relay;
        await handle(inbound('pending-origin'));
        const folder = getRepoDataPath(dir, 'ws-a', 'teams-answer-relay');
        const renamed = `${folder}-saved`;
        fs.renameSync(folder, renamed);
        fs.writeFileSync(folder, 'not-a-directory');
        await handle(inbound('pending-question'));
        expect(enqueuePending).not.toHaveBeenCalled();
        expect(tasks()).toHaveLength(1);
        fs.unlinkSync(folder);
        fs.renameSync(renamed, folder);
        await handle(inbound('pending-question'));
        expect(enqueuePending).toHaveBeenCalledOnce();
        expect(tasks()).toHaveLength(2);
    });

    it.each([true, false].flatMap(relay => [
        'missing', 'id', 'repo', 'process', 'payload-workspace', 'type', 'kind',
        'follow-up-origin', 'request', 'status', 'competing-control', 'private-control', 'unauthorized-link',
    ].map(mismatch => [relay, mismatch] as const)))('rejects pending authority (relay %s, %s) before enqueue without creating a replacement chat', async (relay, mismatch) => {
        relayEnabled = relay;
        await handle(inbound('pending-origin'));
        const origin = tasks()[0];
        const lookup = relayQueue.getTask.bind(relayQueue);
        vi.spyOn(relayQueue, 'getTask').mockImplementation(id => {
            const task = lookup(id);
            if (!task || id !== origin.id) return task;
            switch (mismatch) {
                case 'missing': return undefined;
                case 'id': return { ...task, id: 'wrong-id' };
                case 'repo': return { ...task, repoId: 'ws-b' };
                case 'process': return { ...task, processId: 'wrong-process' };
                case 'payload-workspace': return { ...task, payload: { ...task.payload, workspaceId: 'ws-b' } };
                case 'type': return { ...task, type: 'workflow' };
                case 'kind': return { ...task, payload: { ...task.payload, kind: 'workflow' } };
                case 'follow-up-origin': return { ...task, payload: { ...task.payload, processId: 'existing-topic' } };
                case 'request': return { ...task, payload: { ...task.payload, relayRequestId: 'unrelated-request' } };
                case 'status': return { ...task, status: 'completed' };
                case 'competing-control': return { ...task, botControl: createBotControlMetadata('whatsapp') };
                case 'private-control': return { ...task,
                    botControl: Object.assign(createBotControlMetadata('teams'), { account: 'private-fixture' }) };
                case 'unauthorized-link': return { ...task,
                    botControl: { ...createBotControlMetadata('teams'), externalThreadUrl: 'https://teams.microsoft.com/thread' } };
                default: throw new Error('Unexpected test mismatch');
            }
        });
        await handle(inbound('pending-question'));
        expect(enqueuePending).not.toHaveBeenCalled();
        expect(enqueue).toHaveBeenCalledOnce();
        expect(tasks()).toHaveLength(1);
        expect(tasks()[0].botControl).toEqual(createBotControlMetadata('teams'));
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'pending-question');
    });

    it.each([true, false].flatMap(relay =>
        ['id', 'repo', 'process', 'payload-workspace', 'payload-process', 'request', 'prompt', 'control', 'kind', 'type']
            .map(mismatch => [relay, mismatch] as const)))(
        'does not report success from a mismatching pending observer outcome (relay %s, %s)',
        async (relay, mismatch) => {
            relayEnabled = relay;
            await handle(inbound('pending-origin'));
            const origin = tasks()[0];
            const lookup = relayQueue.getTask.bind(relayQueue);
            vi.spyOn(relayQueue, 'getTask').mockImplementation(id => {
                const task = lookup(id);
                if (!task || id === origin.id) return task;
                switch (mismatch) {
                    case 'id': return { ...task, id: 'wrong-id' };
                    case 'repo': return { ...task, repoId: 'ws-b' };
                    case 'process': return { ...task, processId: 'wrong-process' };
                    case 'payload-workspace': return { ...task, payload: { ...task.payload, workspaceId: 'ws-b' } };
                    case 'payload-process': return { ...task, payload: { ...task.payload, processId: 'wrong-process' } };
                    case 'request': return { ...task, payload: { ...task.payload, relayRequestId: 'wrong-request' } };
                    case 'prompt': return { ...task, payload: { ...task.payload, prompt: 'different-prompt' } };
                    case 'control': return { ...task, botControl: createBotControlMetadata('teams') };
                    case 'kind': return { ...task, payload: { ...task.payload, kind: 'workflow' } };
                    case 'type': return { ...task, type: 'workflow' };
                    default: throw new Error('Unexpected test mismatch');
                }
            });
            queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => {
                throw new Error('observer failed');
            });
            await handle(inbound('pending-question'));
            expect(enqueuePending).toHaveBeenCalledOnce();
            expect(tasks()).toHaveLength(2);
            expect(tasks('ws-b')).toEqual([]);
            expect(send).not.toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'pending-question');
            expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('admission retained'));
            // A live mismatching outcome is ambiguous, not permission to enqueue the delivery again.
            await handle(inbound('pending-question'));
            expect(enqueuePending).toHaveBeenCalledOnce();
        },
    );

    it.each([true, false])('rejects a missing pending workspace before admission (relay %s)', async relay => {
        relayEnabled = relay;
        await handle(inbound('pending-origin'));
        vi.spyOn(store, 'getWorkspaces').mockResolvedValue([]);
        await handle(inbound('pending-question'));
        expect(enqueuePending).not.toHaveBeenCalled();
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it('keeps relay-off pending deliveries on their controlled origin after disabling identification', async () => {
        relayEnabled = false;
        await handle(inbound('ordinary-origin'));
        const origin = tasks()[0];
        enabled = false;
        await Promise.all([
            handle(inbound('ordinary-pending', 'pending question')),
            handle(inbound('ordinary-pending', 'pending question')),
        ]);
        expect(enqueue).toHaveBeenCalledOnce();
        expect(enqueuePending).toHaveBeenCalledOnce();
        expect(tasks()).toHaveLength(2);
        expect(tasks()[0].botControl).toEqual(createBotControlMetadata('teams'));
        expect(tasks()[1]).toMatchObject({
            processId: origin.processId,
            payload: { processId: origin.processId, prompt: 'pending question' },
        });
        expect(tasks()[1].botControl).toBeUndefined();
        manager.dispose();
        register();
        await handle(inbound('ordinary-origin'));
        await handle(inbound('ordinary-pending', 'pending question'));
        expect(enqueue).toHaveBeenCalledOnce();
        expect(enqueuePending).toHaveBeenCalledOnce();
    });

    it('persists ordinary pending authority without an outbound relay configuration', async () => {
        manager.dispose();
        registerTeamsMessagingRoutes([], {
            dataDir: dir, store, manager, relayQueue, enqueueChat: enqueue, executeFollowUp: followUp,
            enqueuePendingRelayFollowUp: enqueuePending, getBotManagedConversationsEnabled: () => enabled === true,
        });
        await handle(inbound('ordinary-origin'));
        const origin = tasks()[0];
        await handle(inbound('ordinary-pending', 'next question'));
        expect(enqueue).toHaveBeenCalledOnce();
        expect(enqueuePending).toHaveBeenCalledWith(
            'ws-a', origin.processId, 'next question', expect.any(String), undefined, expect.any(String),
        );
        expect(tasks()[1].botControl).toBeUndefined();
        expect(tasks('ws-b')).toEqual([]);
    });

    it('keeps ordinary receipt answers disabled when answer relay is enabled later', async () => {
        relayEnabled = false;
        await handle(inbound('ordinary-origin'));
        await handle(inbound('ordinary-pending', 'next question'));
        const [origin, follow] = tasks();
        await store.addProcess({
            id: origin.processId!, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: '', metadata: {
                type: 'chat', workspaceId: 'ws-a', queueTaskId: origin.id, botControl: origin.botControl,
            },
            conversationTurns: [
                { turnIndex: 0, role: 'user', content: 'question', timestamp: new Date() },
                { turnIndex: 1, role: 'assistant', content: 'initial answer', timestamp: new Date() },
                { turnIndex: 2, role: 'user', content: 'next question', timestamp: new Date(), relayRequestId: follow.payload.relayRequestId },
                { turnIndex: 3, role: 'assistant', content: 'pending answer', timestamp: new Date() },
            ],
        });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).emit('taskCompleted', { ...origin, status: 'completed' });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).emit('taskCompleted', { ...follow, status: 'completed' });
        relayEnabled = true;
        manager.dispose();
        register();
        send.mockClear();
        await handle(inbound('ordinary-pending', 'next question'));
        expect(send).not.toHaveBeenCalled();
        expect(enqueuePending).toHaveBeenCalledOnce();
    });

    it('executes relay-off pending requests in their original conversations across workspaces', async () => {
        relayEnabled = false;
        await handle(inbound('ordinary-a', 'first prompt'));
        const originA = tasks()[0];
        await handle(inbound('pending-a', 'follow-up a'));
        await handle(inbound('choose-b', '/select repo ws-b'));
        await handle(inbound('new-b', '/create topic'));
        await handle(inbound('ordinary-b', 'second prompt'));
        const originB = tasks('ws-b')[0];
        await handle(inbound('pending-b', 'follow-up b'));
        const followA = tasks()[1];
        const followB = tasks('ws-b')[1];
        queue.activateQueueProcessing();
        await vi.waitFor(async () => {
            for (const follow of [followA, followB]) {
                expect(relayQueue.getTask(follow.id)?.status).toBe('completed');
            }
        }, { timeout: 10_000 });
        for (const [origin, follow, prompt] of [[originA, followA, 'follow-up a'], [originB, followB, 'follow-up b']] as const) {
            const process = (await store.getProcess(origin.processId!))!;
            expect(process.metadata).toMatchObject({
                workspaceId: origin.repoId, botControl: createBotControlMetadata('teams'), provider: 'copilot',
            });
            expect(process.conversationTurns).toEqual(expect.arrayContaining([
                expect.objectContaining({ role: 'user', content: prompt, relayRequestId: follow.payload.relayRequestId }),
            ]));
        }
        expect(await store.getAllProcesses()).toHaveLength(2);
        expect(send.mock.calls.map(([text]) => text)).not.toEqual(expect.arrayContaining([
            expect.stringContaining('Request '),
        ]));
        manager.dispose();
        register();
        await handle(inbound('pending-a', 'follow-up a'));
        await handle(inbound('pending-b', 'follow-up b'));
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(enqueuePending).toHaveBeenCalledTimes(2);
    });

    async function existing(control?: BotControlMetadata, workspaceId = 'ws-b') {
        await store.addProcess({
            id: 'existing-topic', type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'ordinary conversation', metadata: {
                type: 'chat', workspaceId, provider: 'claude', botControl: control,
            },
        });
    }

    it.each([true, false])('adopts an existing topic before durable follow-up admission (relay %s)', async relay => {
        relayEnabled = relay;
        await existing();
        admitFollowUp.mockImplementationOnce(async (proc, prompt, requestId, _mode, id) => {
            expect((await store.getProcess(proc.id))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
            return { taskId: await queue.enqueue({
                id, type: 'chat', repoId: 'ws-b', processId: proc.id, priority: 'normal',
                payload: { kind: 'chat', mode: 'ask', workspaceId: 'ws-b', processId: proc.id, prompt, relayRequestId: requestId },
                config: {},
            }) };
        });
        await handle(inbound('adopt', '[existing-topic] later question'));
        expect(tasks()).toEqual([]);
        expect(tasks('ws-b')).toHaveLength(1);
        expect(tasks('ws-b')[0]).toMatchObject({ processId: 'existing-topic', payload: { prompt: 'later question' } });
        expect(tasks('ws-b')[0].botControl).toBeUndefined();
        expect((await store.getProcess('existing-topic'))?.metadata).toMatchObject({
            workspaceId: 'ws-b', provider: 'claude', botControl: createBotControlMetadata('teams'),
        });
        const reopened = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        try {
            expect((await reopened.getProcess('existing-topic'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
        } finally {
            reopened.close();
        }
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'adopt');
        if (relay) {
            await handle(inbound('adopt', '[existing-topic] later question'));
            expect(admitFollowUp).toHaveBeenCalledOnce();
            manager.dispose();
            register();
            await handle(inbound('adopt', '[existing-topic] later question'));
            expect(admitFollowUp).toHaveBeenCalledOnce();
        }
    });

    it.each([true, false])('retains a newly adopted claim after a follow-up observer fails (relay %s)', async relay => {
        relayEnabled = relay;
        await existing();
        queue.registry.getQueueForRepo(path.join(dir, 'ws-b')).on('taskAdded', () => {
            throw new Error('observer failed');
        });
        await handle(inbound('observer', '[existing-topic] accepted'));
        expect(tasks('ws-b')).toHaveLength(1);
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'observer');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('admission retained'));
        if (relay) {
            await handle(inbound('observer', '[existing-topic] accepted'));
            expect(admitFollowUp).toHaveBeenCalledOnce();
        }
    });

    it.each([true, false])('rolls back rejected adoption and permits the same delivery to retry (relay %s)', async relay => {
        relayEnabled = relay;
        await existing();
        store.getDatabase().exec(`
            CREATE TRIGGER reject_teams_follow_up BEFORE INSERT ON queue_tasks
            BEGIN SELECT RAISE(ABORT, 'admission failed'); END;
        `);
        await handle(inbound('retry-follow', '[existing-topic] later question'));
        expect(tasks('ws-b')).toEqual([]);
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toBeUndefined();
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'retry-follow');
        store.getDatabase().exec('DROP TRIGGER reject_teams_follow_up');
        await handle(inbound('retry-follow', '[existing-topic] later question'));
        expect(admitFollowUp).toHaveBeenCalledTimes(2);
        expect(tasks('ws-b')).toHaveLength(1);
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it.each([true, false])('fails claim persistence before enqueue and permits retry (relay %s)', async relay => {
        relayEnabled = relay;
        await existing();
        const update = vi.spyOn(store, 'updateProcess').mockRejectedValueOnce(new Error('claim failed'));
        await handle(inbound('claim-failed', '[existing-topic] later question'));
        expect(admitFollowUp).not.toHaveBeenCalled();
        expect(tasks('ws-b')).toEqual([]);
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toBeUndefined();
        update.mockRestore();
        await handle(inbound('claim-failed', '[existing-topic] later question'));
        expect(admitFollowUp).toHaveBeenCalledOnce();
    });

    it.each([true, false])('keeps same-controller provenance on rejection and gate changes (relay %s)', async relay => {
        relayEnabled = relay;
        const control = { ...createBotControlMetadata('teams'), externalThreadUrl: 'https://teams.microsoft.com/thread' };
        await existing(control);
        admitFollowUp.mockRejectedValueOnce(new Error('queue rejected'));
        await handle(inbound('retained', '[existing-topic] rejected'));
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toEqual(control);
        enabled = false;
        await handle(inbound('gate-disabled', '[existing-topic] follow up'));
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toEqual(control);
        if (!relay) expect(followUp).toHaveBeenCalledWith('existing-topic', 'follow up', undefined);
    });

    it.each([true, false])('does not claim an ordinary topic when the live gate is disabled (relay %s)', async relay => {
        relayEnabled = relay;
        enabled = false;
        await existing();
        await handle(inbound('disabled', '[existing-topic] ordinary'));
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toBeUndefined();
        expect(relay ? admitFollowUp : followUp).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'disabled');
    });

    it.each(['competing', 'malformed'] as const)('rejects %s control without admitting a follow-up', async kind => {
        const control = kind === 'competing' ? createBotControlMetadata('whatsapp')
            : { ...createBotControlMetadata('teams'), controllerLabel: 'Unknown bridge' };
        await existing(control);
        await handle(inbound('conflict', '[existing-topic] later question'));
        expect(admitFollowUp).not.toHaveBeenCalled();
        expect(followUp).not.toHaveBeenCalled();
        expect(tasks('ws-b')).toEqual([]);
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toEqual(control);
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'conflict');
    });

    it('rejects a workspace change between routing and locked admission', async () => {
        await existing();
        const process = (await store.getProcess('existing-topic'))!;
        vi.spyOn(store, 'getProcess').mockResolvedValueOnce(process).mockResolvedValueOnce({
            ...process, metadata: { ...process.metadata, workspaceId: 'ws-a' },
        });
        await handle(inbound('workspace-changed', '[existing-topic] later question'));
        expect(admitFollowUp).not.toHaveBeenCalled();
        expect(tasks()).toEqual([]);
        expect(tasks('ws-b')).toEqual([]);
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'workspace-changed');
    });

    it.each(['workspace', 'process', 'request', 'prompt'] as const)('rejects %s mismatch during follow-up observer reconciliation', async field => {
        await existing();
        const getTask = relayQueue.getTask.bind(relayQueue);
        vi.spyOn(relayQueue, 'getTask').mockImplementation(id => {
            const task = getTask(id);
            if (!task) return undefined;
            return {
                ...task, ...(field === 'workspace' ? { repoId: 'ws-a' } : {}),
                ...(field === 'process' ? { processId: 'another-topic' } : {}),
                payload: { ...task.payload,
                    ...(field === 'request' ? { relayRequestId: 'another-request' } : {}),
                    ...(field === 'prompt' ? { prompt: 'another-message' } : {}),
                },
            };
        });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-b')).on('taskAdded', () => {
            throw new Error('observer failed');
        });
        await handle(inbound('mismatch-follow', '[existing-topic] later question'));
        expect(send).not.toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'mismatch-follow');
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('admission retained'));
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toBeUndefined();
    });

    it('adopts through ordinary admission when no answer-relay instance is configured', async () => {
        manager.dispose();
        registerTeamsMessagingRoutes([], {
            dataDir: dir, store, manager, relayQueue, enqueueChat: enqueue, executeFollowUp: followUp,
            admitRelayFollowUp: admitFollowUp, getBotManagedConversationsEnabled: () => true,
        });
        await existing();
        await handle(inbound('without-relay', '[existing-topic] later question'));
        expect(admitFollowUp).toHaveBeenCalledOnce();
        expect(tasks('ws-b')).toHaveLength(1);
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('does not claim or enqueue when an existing-topic receipt cannot persist', async () => {
        await existing();
        const folder = getRepoDataPath(dir, 'ws-b', 'teams-answer-relay');
        fs.mkdirSync(path.dirname(folder), { recursive: true });
        fs.writeFileSync(folder, 'not-a-directory');
        await handle(inbound('receipt-adoption', '[existing-topic] later question'));
        expect(admitFollowUp).not.toHaveBeenCalled();
        expect((await store.getProcess('existing-topic'))?.metadata?.botControl).toBeUndefined();
        fs.unlinkSync(folder);
        await handle(inbound('receipt-adoption', '[existing-topic] later question'));
        expect(admitFollowUp).toHaveBeenCalledOnce();
    });

    it('does not reuse a follow-up receipt to claim another conversation', async () => {
        await existing();
        const process = (await store.getProcess('existing-topic'))!;
        await store.addProcess({ ...process, id: 'another-topic' });
        await handle(inbound('bound-delivery', '[existing-topic] later question'));
        await handle(inbound('bound-delivery', '[another-topic] later question'));
        expect(admitFollowUp).toHaveBeenCalledOnce();
        expect((await store.getProcess('another-topic'))?.metadata?.botControl).toBeUndefined();
        expect(tasks('ws-b')).toHaveLength(1);
    });
});
