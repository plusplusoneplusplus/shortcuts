import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, SqliteQueueStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { TeamsAnswerRelay } from '../../../src/server/messaging/teams-answer-relay';
import { WhatsAppAnswerRelay } from '../../../src/server/messaging/whatsapp-answer-relay';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { collectResumableFollowUpProcessIds, sweepOrphanedRunningProcesses } from '../../../src/server/processes/finalize-orphaned-turn';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

describe('Bot-controlled request restart recovery', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let queue: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    let relay: TeamsAnswerRelay | WhatsAppAnswerRelay | undefined;
    const ai = createMockSDKService();
    const processId = toQueueProcessId('origin');

    const openQueue = () => {
        queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            aiService: ai.service, dataDir: dir, autoStart: false,
            followUpSuggestions: { enabled: false, count: 0 },
        });
        for (const id of ['ws-a', 'ws-b']) queue.registerRepoId(id, path.join(dir, id));
        persistence = new SqliteQueuePersistence(queue, store.getDatabase(), { restartPolicy: 'requeue' });
    };
    const restart = () => {
        relay?.dispose();
        persistence.dispose();
        queue.dispose();
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        openQueue();
        persistence.restore();
    };
    const registerOrigin = async (source: 'teams' | 'whatsapp', patch: Record<string, unknown> = {}) => {
        await store.addProcess({
            id: processId, type: 'chat', status: 'running', promptPreview: 'origin question',
            fullPrompt: 'origin question', startTime: new Date(),
            metadata: {
                workspaceId: 'ws-a', queueTaskId: 'origin', provider: 'copilot',
                type: 'chat', mode: 'ask', botControl: createBotControlMetadata(source), ...patch,
            },
            conversationTurns: [
                { role: 'user', content: 'origin question', turnIndex: 0, timestamp: new Date(),
                    ...(source === 'whatsapp' ? { relayRequestId: 'origin' } : {}) },
                { role: 'assistant', content: 'unfinished', turnIndex: 1, timestamp: new Date(), streaming: true },
            ],
        });
    };

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-control-restart-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        for (const id of ['ws-a', 'ws-b']) {
            const rootPath = path.join(dir, id);
            fs.mkdirSync(rootPath);
            await store.registerWorkspace({ id, name: id, rootPath });
        }
        ai.mockSendMessage.mockReset().mockResolvedValue({
            success: true, response: 'recovered answer', sessionId: 'synthetic-session',
        });
        openQueue();
    });
    afterEach(() => {
        relay?.dispose();
        relay = undefined;
        persistence?.dispose();
        queue?.dispose();
        store?.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it.each(['teams', 'whatsapp'] as const)(
        'resumes a registered %s origin without replacing control, provider, transcript or its answer receipt',
        { timeout: 20_000 },
        async source => {
            const sends = vi.fn(async (_text: string, _rootId: string) => 'synthetic-answer');
            const enqueue = async (id: string) => queue.enqueue({
                id, processId, type: 'chat', repoId: 'ws-a', priority: 'normal',
                botControl: createBotControlMetadata(source), config: {},
                payload: { kind: 'chat', mode: 'ask', workspaceId: 'ws-a', prompt: 'origin question',
                    ...(source === 'whatsapp' ? { relayRequestId: id } : {}) },
            });
            if (source === 'teams') {
                const teams = new TeamsAnswerRelay({
                    dataDir: dir, store, queue: queue.createAggregateQueueFacade(), isEnabled: () => true,
                    target: () => ({ connected: true, teamId: 'test-team', channelId: 'test-channel' }), send: sends,
                });
                relay = teams;
                await teams.admitNew({ channelId: 'test-channel', messageId: 'inbound', text: 'origin question' },
                    'ws-a', enqueue, 'origin');
                await teams.acknowledged('origin');
            } else {
                const bindings = new WhatsAppBindings(dir);
                bindings.add({
                    workspaceId: 'ws-a', processId, taskId: 'origin', inboundId: 'inbound',
                    groupJid: 'bound@g.us', outboundIds: [], nextPart: 0, status: 'queued',
                });
                await enqueue('origin');
            }
            await registerOrigin(source);
            queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted('origin');
            restart();
            const recovered = queue.getTask('origin')!;
            expect(recovered).toMatchObject({
                id: 'origin', processId, repoId: 'ws-a', botControl: createBotControlMetadata(source),
                payload: { processId, historyCutoffTurnIndex: 0, workspaceId: 'ws-a' },
            });
            const protectedProcessIds = collectResumableFollowUpProcessIds(queue.createAggregateQueueFacade().getQueued());
            expect(await sweepOrphanedRunningProcesses(store, { protectedProcessIds })).toEqual({ finalized: 0, revived: 1 });
            expect((await store.getProcess(processId))?.conversationTurns?.at(-1)).toMatchObject({
                interrupted: true, content: 'unfinished',
            });
            if (source === 'teams') {
                const teams = new TeamsAnswerRelay({
                    dataDir: dir, store, queue: queue.createAggregateQueueFacade(), isEnabled: () => true,
                    target: () => ({ connected: true, teamId: 'test-team', channelId: 'test-channel' }), send: sends,
                });
                relay = teams;
                await teams.restore();
            } else {
                const bindings = new WhatsAppBindings(dir);
                await bindings.restore(store);
                relay = new WhatsAppAnswerRelay({
                    bindings, store, queue: queue.createAggregateQueueFacade(),
                    connected: () => true, groupJid: () => 'bound@g.us', send: sends,
                });
                await relay.reconnected();
            }
            expect(sends).not.toHaveBeenCalled();
            queue.activateQueueProcessing();
            await vi.waitFor(() => expect(sends).toHaveBeenCalledTimes(1), { timeout: 5_000, interval: 20 });
            expect(sends.mock.calls[0][0]).toContain('recovered answer');
            const process = (await store.getProcess(processId))!;
            expect(process.metadata).toMatchObject({
                workspaceId: 'ws-a', queueTaskId: 'origin', provider: 'copilot', botControl: createBotControlMetadata(source),
            });
            expect(process.conversationTurns?.filter(turn => turn.role === 'user')).toHaveLength(1);
            expect(await store.getAllProcesses({ workspaceId: 'ws-a' })).toHaveLength(1);
            expect(await store.getAllProcesses({ workspaceId: 'ws-b' })).toEqual([]);
            await relay.reconnected();
            expect(sends).toHaveBeenCalledTimes(1);
        },
    );

    it('keeps a rejected recovery durable for retry and does not publish executable work', async () => {
        await queue.enqueue({
            id: 'origin', processId, type: 'chat', repoId: 'ws-a', priority: 'normal', config: {},
            botControl: createBotControlMetadata('teams'),
            payload: { kind: 'chat', workspaceId: 'ws-a', mode: 'ask', prompt: 'origin question' },
        });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted('origin');
        store.getDatabase().exec(`
            CREATE TRIGGER reject_restart BEFORE INSERT ON queue_tasks
            WHEN NEW.status = 'queued' AND EXISTS (
                SELECT 1 FROM queue_tasks WHERE id = NEW.id AND status = 'running'
            )
            BEGIN SELECT RAISE(ABORT, 'recovery rejected'); END;
        `);
        expect(restart).toThrow('recovery rejected');
        expect(queue.createAggregateQueueFacade().getQueued()).toEqual([]);
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')[0]).toMatchObject({
            id: 'origin', status: 'running', processId, botControl: createBotControlMetadata('teams'),
        });
        store.getDatabase().exec('DROP TRIGGER reject_restart');
        restart();
        expect(queue.getTask('origin')).toMatchObject({ status: 'queued', processId });
    });

    it.each(['teams', 'whatsapp'] as const)(
        'resumes a registered %s follow-up with its original request and without duplicating accepted turns',
        { timeout: 20_000 },
        async source => {
            await registerOrigin(source);
            const sends = vi.fn(async (_text: string, _rootId: string) => 'synthetic-answer');
            let requestId = 'followup';
            const enqueue = async (correlation: string) => ({
                taskId: await queue.enqueue({
                    id: 'followup', processId, type: 'chat', repoId: 'ws-a', priority: 'normal', config: {},
                    payload: { kind: 'chat', workspaceId: 'ws-a', processId, mode: 'ask',
                        prompt: 'follow-up question', relayRequestId: correlation },
                }),
            });
            if (source === 'teams') {
                const teams = new TeamsAnswerRelay({
                    dataDir: dir, store, queue: queue.createAggregateQueueFacade(), isEnabled: () => true,
                    target: () => ({ connected: true, teamId: 'test-team', channelId: 'test-channel' }), send: sends,
                });
                relay = teams;
                await teams.admitFollowUp({ channelId: 'test-channel', messageId: 'inbound', text: 'follow-up question' },
                    (await store.getProcess(processId))!, async correlation => {
                        requestId = correlation;
                        return enqueue(correlation);
                    }, 'followup');
            } else {
                const bindings = new WhatsAppBindings(dir);
                bindings.add({
                    workspaceId: 'ws-a', processId, taskId: 'followup', inboundId: 'inbound',
                    groupJid: 'bound@g.us', outboundIds: [], nextPart: 0, status: 'queued',
                });
                await enqueue(requestId);
            }
            await store.appendConversationTurn(processId, index => ({
                role: 'user', content: 'follow-up question', timestamp: new Date(), turnIndex: index, relayRequestId: requestId,
            }));
            queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted('followup');
            restart();
            expect(queue.getTask('followup')).toMatchObject({
                id: 'followup', processId, repoId: 'ws-a',
                payload: { relayRequestId: requestId, processId, prompt: 'follow-up question' },
            });
            expect(queue.getTask('followup')?.botControl).toBeUndefined();
            await sweepOrphanedRunningProcesses(store, {
                protectedProcessIds: collectResumableFollowUpProcessIds(queue.createAggregateQueueFacade().getQueued()),
            });
            if (source === 'teams') {
                const teams = new TeamsAnswerRelay({
                    dataDir: dir, store, queue: queue.createAggregateQueueFacade(), isEnabled: () => true,
                    target: () => ({ connected: true, teamId: 'test-team', channelId: 'test-channel' }), send: sends,
                });
                relay = teams;
                await teams.restore();
            } else {
                const bindings = new WhatsAppBindings(dir);
                await bindings.restore(store);
                relay = new WhatsAppAnswerRelay({
                    bindings, store, queue: queue.createAggregateQueueFacade(),
                    connected: () => true, groupJid: () => 'bound@g.us', send: sends,
                });
            }
            queue.activateQueueProcessing();
            await vi.waitFor(() => expect(sends).toHaveBeenCalledTimes(1), { timeout: 5_000, interval: 20 });
            expect(sends.mock.calls[0][0]).toContain('recovered answer');
            const process = (await store.getProcess(processId))!;
            expect(process.conversationTurns?.filter(turn => turn.role === 'user')).toHaveLength(2);
            expect(process.conversationTurns?.filter(turn => turn.role === 'user' && turn.relayRequestId === requestId)).toHaveLength(1);
            expect(process.metadata).toMatchObject({
                queueTaskId: 'origin', workspaceId: 'ws-a', provider: 'copilot', botControl: createBotControlMetadata(source),
            });
            await relay!.reconnected();
            expect(sends).toHaveBeenCalledTimes(1);
        },
    );

    it('retains exact accepted recovery after a post-admission observer fails', async () => {
        await queue.enqueue({
            id: 'origin', processId, type: 'chat', repoId: 'ws-a', priority: 'normal', config: {},
            botControl: createBotControlMetadata('teams'),
            payload: { kind: 'chat', workspaceId: 'ws-a', mode: 'ask', prompt: 'origin question' },
        });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted('origin');
        persistence.dispose();
        queue.dispose();
        openQueue();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        queue.getOrCreateBridge(path.join(dir, 'ws-a'));
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => {
            throw new Error('observer failed');
        });
        persistence.restore();
        expect(queue.getTask('origin')).toMatchObject({
            status: 'queued', processId, botControl: createBotControlMetadata('teams'),
        });
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')).toHaveLength(1);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('admission retained'));
    });

    it.each(['cancelling', 'cancelled'] as const)('does not revive an origin already %s', async status => {
        await queue.enqueue({
            id: 'origin', processId, type: 'chat', repoId: 'ws-a', priority: 'normal', config: {},
            botControl: createBotControlMetadata('teams'),
            payload: { kind: 'chat', workspaceId: 'ws-a', mode: 'ask', prompt: 'origin question' },
        });
        await registerOrigin('teams');
        await store.updateProcess(processId, { status });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted('origin');
        restart();
        expect(queue.getTask('origin')).toBeUndefined();
        expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')).toEqual([]);
        expect((await store.getProcess(processId))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
        expect(ai.mockSendMessage).not.toHaveBeenCalled();
    });

    it.each(['workspace', 'admission', 'process', 'turn'] as const)(
        'rejects registered origin %s drift without replacing ownership or discarding the running task',
        async mismatch => {
            await queue.enqueue({
                id: 'origin', processId: mismatch === 'process' ? 'other-process' : processId,
                type: 'chat', repoId: 'ws-a', priority: 'normal', config: {},
                botControl: createBotControlMetadata('teams'),
                payload: { kind: 'chat', workspaceId: 'ws-a', mode: 'ask', prompt: 'origin question' },
            });
            await registerOrigin('teams', mismatch === 'workspace' ? { workspaceId: 'ws-b' }
                : mismatch === 'admission' ? { queueTaskId: 'other-task' } : {});
            if (mismatch === 'turn') store.getDatabase().prepare('DELETE FROM conversation_turns WHERE process_id = ?').run(processId);
            queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted('origin');
            expect(restart).toThrow(/Restart chat/);
            expect(queue.createAggregateQueueFacade().getQueued()).toEqual([]);
            expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks('ws-a')[0].status).toBe('running');
            expect((await store.getProcess(processId))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
            expect(ai.mockSendMessage).not.toHaveBeenCalled();
        },
    );
});
