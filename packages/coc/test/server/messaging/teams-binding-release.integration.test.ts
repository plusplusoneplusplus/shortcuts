import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, SqliteQueueStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsAnswerRelay, TeamsBindingReleaseError } from '../../../src/server/messaging/teams-answer-relay';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { admitBotControlledFollowUp } from '../../../src/server/messaging/bot-control-admission';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { getRepoDataPath } from '../../../src/server/paths';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { TeamsUserStateStore } from '../../../src/server/messaging/teams-user-state';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), unlinkSync: vi.fn(actual.unlinkSync) };
});

describe('Teams authoritative binding release', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let queue: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    let relay: TeamsAnswerRelay;
    let manager: TeamsMessagingManager | undefined;
    let enabled: boolean;
    let send: ReturnType<typeof vi.fn>;
    const teamId = 'test-team';
    const channelId = 'test-channel';
    const processId = toQueueProcessId('origin');
    const message = (messageId = 'root', replyToMessageId?: string): InboundTeamsMessage => ({
        messageId, replyToMessageId, channelId, text: 'request', senderAadId: 'synthetic-user',
    });
    const receiptFile = (messageId = 'root', workspaceId = 'ws-a') => getRepoDataPath(dir, workspaceId,
        path.join('teams-answer-relay', createHash('sha256')
            .update(JSON.stringify([teamId, channelId, messageId])).digest('hex') + '.json'));
    const receipt = (messageId = 'root', workspaceId = 'ws-a') =>
        JSON.parse(fs.readFileSync(receiptFile(messageId, workspaceId), 'utf8'));
    const writeReceipt = (patch: Record<string, unknown>, messageId = 'root', workspaceId = 'ws-a') =>
        fs.writeFileSync(receiptFile(messageId, workspaceId), JSON.stringify({ ...receipt(messageId, workspaceId), ...patch }));
    const control = () => new SqliteQueueStore(store.getDatabase()).getQueueTasks().find(task => task.id === 'origin')?.botControl;
    const createRelay = () => {
        relay = new TeamsAnswerRelay({
            dataDir: dir, store, queue: queue.createAggregateQueueFacade(), isEnabled: () => enabled,
            isBotManagedConversationsEnabled: () => enabled,
            target: () => ({ connected: true, teamId, channelId }), send,
        });
    };
    const openQueue = () => {
        queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
        });
        for (const id of ['ws-a', 'ws-b']) queue.registerRepoId(id, path.join(dir, id));
        persistence = new SqliteQueuePersistence(queue, store.getDatabase());
        createRelay();
    };
    const restart = async () => {
        relay.dispose();
        persistence.dispose();
        queue.dispose();
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        openQueue();
        persistence.restore();
        await relay.restore();
    };
    const admitOrigin = (workspaceId = 'ws-a', id = 'origin', messageId = 'root', replyToMessageId?: string) =>
        relay.admitNew(message(messageId, replyToMessageId), workspaceId, async taskId => queue.enqueue({
            id: taskId, repoId: workspaceId, type: 'chat', processId: toQueueProcessId(taskId),
            priority: 'normal', config: {}, botControl: createBotControlMetadata('teams'),
            payload: { kind: 'chat', workspaceId, prompt: 'request' },
        }), id);
    const register = async (answer = 'answer') => store.addProcess({
        id: processId, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'request',
        metadata: { type: 'chat', workspaceId: 'ws-a', queueTaskId: 'origin', provider: 'codex',
            botControl: { ...createBotControlMetadata('teams'), externalThreadUrl: 'https://teams.microsoft.com/thread' } },
        conversationTurns: [
            { role: 'user', content: 'request', turnIndex: 0, timestamp: new Date() },
            { role: 'assistant', content: answer, turnIndex: 1, timestamp: new Date() },
        ],
    });
    const followUp = async (id = 'follow-up', accepted = true, wait?: () => Promise<void>, rootId?: string) =>
        relay.admitFollowUp(message(id, rootId), (await store.getProcess(processId))!, async requestId => {
            if (wait) await wait();
            if (!accepted) throw new Error('admission rejected');
            return admitBotControlledFollowUp(store, 'ws-a', processId, 'teams', async () => ({
                taskId: await queue.enqueueAdmitted({
                    id, repoId: 'ws-a', type: 'chat', processId, priority: 'normal', config: {},
                    payload: { kind: 'chat', workspaceId: 'ws-a', processId, prompt: 'request', relayRequestId: requestId },
                }),
            }));
        }, id);
    const remove = (messageId = 'root', workspaceId = 'ws-a') =>
        relay.removeBinding(workspaceId, teamId, channelId, messageId);
    const rejectWrites = (state: string) => {
        const original = vi.mocked(fs.writeFileSync).getMockImplementation()!;
        return vi.mocked(fs.writeFileSync).mockImplementation((file, data, options) => {
            if (String(file).includes('teams-answer-relay') && String(data).includes(`"releaseState":"${state}"`)) {
                throw new Error('binding write rejected');
            }
            return original(file, data, options);
        });
    };
    const rejectQueueRelease = () => store.getDatabase().exec(`CREATE TRIGGER reject_release BEFORE INSERT ON queue_tasks
        WHEN NEW.id = 'origin' AND NEW.bot_control IS NULL
        BEGIN SELECT RAISE(ABORT, 'queue release rejected'); END`);

    it.each(['released', 'releasing', 'admission-only'])('excludes %s receipts from ask_user routing and rechecks before posting', async state => {
        await admitOrigin();
        const request = { processId, requestId: 'origin' };
        const transport = relay.questionTransport();
        const target = transport.locate(request)!;
        expect(target.threadId).toBe('root');
        if (state === 'admission-only') {
            writeReceipt({ admissionOnly: true });
            relay.dispose();
            createRelay();
            await relay.restore();
        } else if (state === 'releasing') {
            rejectQueueRelease();
            await expect(remove()).rejects.toThrow();
            expect(receipt().releaseState).toBe('releasing');
        } else {
            await remove();
        }
        const current = relay.questionTransport();
        expect(current.locate(request)).toBeUndefined();
        await expect(current.post(target, { question: 'Proceed?', options: [], hint: 'Reply yes or no' }, request))
            .rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(process.cwd(), '.teams-release-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        for (const id of ['ws-a', 'ws-b']) {
            fs.mkdirSync(path.join(dir, id));
            await store.registerWorkspace({ id, name: id, rootPath: path.join(dir, id) });
        }
        enabled = true;
        send = vi.fn(async () => 'synthetic-outbound');
        openQueue();
        await relay.restore();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        manager?.dispose();
        manager = undefined;
        relay.dispose();
        persistence.dispose();
        queue.dispose();
        store.close();
        vi.restoreAllMocks();
        vi.mocked(fs.writeFileSync).mockReset();
        vi.mocked(fs.unlinkSync).mockReset();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it.each([false, true])('durably releases pending/persisted origins, retaining receipts and transcript (%s)', async persisted => {
        await admitOrigin();
        if (persisted) await register();
        enabled = false;
        await remove();
        expect(receipt().releaseState).toBe('released');
        expect(control()).toBeUndefined();
        await restart();
        await remove();
        expect(queue.getTask('origin')?.status).toBe('queued');
        expect(control()).toBeUndefined();
        const process = await store.getProcess(processId);
        expect(process?.metadata?.botControl).toBeUndefined();
        if (persisted) {
            expect(process?.metadata?.provider).toBe('codex');
            expect(process?.conversationTurns).toHaveLength(2);
        }
        expect(relay.hasInbound(message(), false)).toBe(true);
        enabled = true;
        const enqueue = vi.fn();
        expect(await relay.admitNew(message(), 'ws-a', enqueue)).toEqual({ taskId: 'origin', duplicate: true });
        expect(enqueue).not.toHaveBeenCalled();
        await relay.reconnected();
        expect(send).not.toHaveBeenCalled();
    });

    it('retains control for another live binding and releases on the last follow-up using the saved initial origin', async () => {
        await admitOrigin();
        await relay.admitPendingFollowUp(message('pending'), 'origin', async (workspaceId, target, requestId, taskId) =>
            queue.enqueue({ id: taskId, type: 'chat', repoId: workspaceId, processId: target, config: {}, priority: 'normal',
                payload: { kind: 'chat', workspaceId, processId: target, prompt: 'request', relayRequestId: requestId } }));
        await remove();
        expect(control()?.source).toBe('teams');
        await restart();
        await remove('pending');
        expect(control()).toBeUndefined();
        expect(receipt().taskId).toBe('origin');
        expect(receipt('pending').releaseState).toBe('released');
    });

    it.each(['success', 'receipt-failure', 'process-crash'] as const)(
        'releases an adopted fork without touching its source authority across restart (%s)', async stage => {
            await admitOrigin();
            await register();
            const original = await store.getProcess(processId);
            const originalTask = new SqliteQueueStore(store.getDatabase()).getQueueTasks().find(task => task.id === 'origin');
            const fork = await store.forkProcess(processId, 'adopted-fork');
            expect(fork.metadata?.queueTaskId).toBe('origin');
            expect(fork.metadata?.botControl).toBeUndefined();
            for (const id of ['fork-first', 'fork-last']) {
                await relay.admitFollowUp(message(id), (await store.getProcess(fork.id))!, async requestId =>
                    admitBotControlledFollowUp(store, 'ws-a', fork.id, 'teams', async () => ({
                        taskId: await queue.enqueueAdmitted({
                            id, repoId: 'ws-a', type: 'chat', processId: fork.id, priority: 'normal', config: {},
                            payload: { kind: 'chat', workspaceId: 'ws-a', processId: fork.id,
                                prompt: 'request', relayRequestId: requestId },
                        }),
                    })), id);
            }
            await remove('fork-first');
            expect((await store.getProcess(fork.id))?.metadata?.botControl?.source).toBe('teams');
            await restart();
            if (stage === 'receipt-failure') {
                rejectWrites('released');
                await expect(remove('fork-last')).rejects.toThrow('binding write rejected');
                expect(receipt('fork-last').releaseState).toBe('releasing');
                expect((await store.getProcess(fork.id))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
                vi.mocked(fs.writeFileSync).mockReset();
            } else if (stage === 'process-crash') {
                writeReceipt({ releaseState: 'releasing' }, 'fork-last');
                const metadata = { ...(await store.getProcess(fork.id))!.metadata };
                delete metadata.botControl;
                await store.updateProcess(fork.id, { metadata });
            } else {
                await remove('fork-last');
            }
            await restart();
            await remove('fork-last');
            expect(receipt('fork-last').releaseState).toBe('released');
            expect((await store.getProcess(fork.id))?.metadata).toEqual(fork.metadata);
            expect((await store.getProcess(fork.id))?.conversationTurns).toEqual(fork.conversationTurns);
            expect(await store.getProcess(processId)).toEqual(original);
            expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks().find(task => task.id === 'origin'))
                .toEqual(originalTask);
            expect(receipt().releaseState).toBeUndefined();
            expect(relay.hasInbound(message('fork-last'), false)).toBe(true);
        },
    );

    it('does not release on selection, flag changes, completion, shutdown or reload', async () => {
        await admitOrigin();
        await register();
        await relay.selectThreadTarget(message('select', 'root'), 'ws-b', null);
        enabled = false;
        await relay.reconnected();
        await restart();
        expect(control()?.source).toBe('teams');
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('teams');
        expect(receipt().releaseState).toBeUndefined();
    });

    it.each(['releasing', 'released'])('compensates a rejected %s receipt write with exact control/link', async state => {
        await admitOrigin();
        await register();
        rejectWrites(state);
        await expect(remove()).rejects.toThrow('binding write rejected');
        expect(receipt().releaseState).toBe(state === 'released' ? 'releasing' : undefined);
        expect(control()?.source).toBe('teams');
        expect((await store.getProcess(processId))?.metadata?.botControl?.externalThreadUrl)
            .toBe('https://teams.microsoft.com/thread');
        vi.mocked(fs.writeFileSync).mockReset();
        await restart();
        expect(receipt().releaseState).toBe(state === 'released' ? 'released' : undefined);
        expect(control()?.source).toBe(state === 'released' ? undefined : 'teams');
    });

    it.each(['intent', 'queue', 'process'] as const)('recovers a crash after %s persistence', async stage => {
        await admitOrigin();
        await register();
        writeReceipt({ releaseState: 'releasing' });
        if (stage !== 'intent') queue.createAggregateQueueFacade().replaceBotControl('origin', queue.getTask('origin')!.botControl, undefined);
        if (stage === 'process') {
            const metadata = { ...(await store.getProcess(processId))!.metadata };
            delete metadata.botControl;
            await store.updateProcess(processId, { metadata });
        }
        await restart();
        expect(receipt().releaseState).toBe('released');
        expect(control()).toBeUndefined();
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeUndefined();
    });

    it('keeps queue write failures retryable, blocks the affected admission and retries on reconnect', async () => {
        await admitOrigin();
        await register();
        rejectQueueRelease();
        await expect(remove()).rejects.toThrow('queue release rejected');
        expect(receipt().releaseState).toBe('releasing');
        expect(control()?.source).toBe('teams');
        await expect(followUp()).rejects.toThrow('release is pending');
        await expect(relay.reconnected()).rejects.toBeInstanceOf(TeamsBindingReleaseError);
        store.getDatabase().exec('DROP TRIGGER reject_release');
        await relay.reconnected();
        expect(control()).toBeUndefined();
        expect(receipt().releaseState).toBe('released');
    });

    it('compensates queue control and preserves unrelated metadata after a committed process observer failure', async () => {
        await admitOrigin();
        await register();
        const update = store.updateProcess.bind(store);
        vi.spyOn(store, 'updateProcess').mockImplementationOnce(async (id, updates) => {
            await update(id, { ...updates, metadata: { ...updates.metadata!, unrelated: 'retained' } });
            throw new Error('process observer rejected');
        });
        await expect(remove()).rejects.toThrow('process observer rejected');
        const metadata = (await store.getProcess(processId))?.metadata;
        expect(metadata?.botControl?.externalThreadUrl).toBe('https://teams.microsoft.com/thread');
        expect(metadata?.unrelated).toBe('retained');
        expect(control()?.source).toBe('teams');
        expect(receipt().releaseState).toBe('releasing');
        await relay.reconcileReleases();
        expect(control()).toBeUndefined();
    });

    it.each(['workspace', 'controller', 'queue'])('rejects %s authority drift before writing intent', async drift => {
        await admitOrigin();
        await register();
        const process = (await store.getProcess(processId))!;
        if (drift === 'workspace') {
            await store.updateProcess(processId, { metadata: { ...process.metadata, workspaceId: 'ws-b' } });
        } else if (drift === 'controller') {
            await store.updateProcess(processId, { metadata: { ...process.metadata, botControl: createBotControlMetadata('whatsapp') } });
        } else {
            queue.getTask('origin')!.payload.workspaceId = 'ws-b';
        }
        await expect(remove()).rejects.toThrow();
        expect(receipt().releaseState).toBeUndefined();
        expect(control()?.source).toBe('teams');
    });

    it('retries all workspaces and reports typed failures per conversation without blocking unrelated answers', async () => {
        await admitOrigin();
        await admitOrigin('ws-b', 'other', 'other-root');
        await admitOrigin('ws-b', 'answer', 'answer-root');
        await register();
        await store.addProcess({
            id: toQueueProcessId('answer'), type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'request', metadata: { type: 'chat', workspaceId: 'ws-b', queueTaskId: 'answer' },
            conversationTurns: [
                { role: 'user', content: 'request', turnIndex: 0, timestamp: new Date() },
                { role: 'assistant', content: 'unrelated answer', turnIndex: 1, timestamp: new Date() },
            ],
        });
        writeReceipt({ releaseState: 'releasing' });
        writeReceipt({ releaseState: 'releasing' }, 'other-root', 'ws-b');
        rejectQueueRelease();
        relay.dispose();
        const otherQueue = queue.registry.getQueueForRepo(path.join(dir, 'ws-b'));
        otherQueue.markStarted('answer');
        otherQueue.markCompleted('answer', {});
        createRelay();
        await expect(relay.restore()).rejects.toMatchObject({
            name: 'TeamsBindingReleaseError', failures: [{ workspaceId: 'ws-a', processId, error: expect.any(Error) }],
        });
        expect(receipt('other-root', 'ws-b').releaseState).toBe('released');
        expect(queue.getTask('other')?.botControl).toBeUndefined();
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('unrelated answer'), 'answer-root');
        await admitOrigin('ws-b', 'unrelated', 'unrelated-root');
        expect(queue.getTask('unrelated')?.botControl?.source).toBe('teams');
    });

    it('preserves another workspace live binding', async () => {
        await admitOrigin();
        await admitOrigin('ws-b', 'other', 'other-root');
        await remove();
        await restart();
        expect(control()).toBeUndefined();
        expect(queue.getTask('other')?.botControl?.source).toBe('teams');
        expect(receipt('other-root', 'ws-b').releaseState).toBeUndefined();
    });

    it('preserves exact queue control and link if the final tombstone write fails', async () => {
        await admitOrigin();
        const prior = { ...queue.getTask('origin')!.botControl!, externalThreadUrl: 'https://teams.microsoft.com/thread' };
        queue.createAggregateQueueFacade().replaceBotControl('origin', queue.getTask('origin')!.botControl, prior);
        rejectWrites('released');
        await expect(remove()).rejects.toThrow('binding write rejected');
        expect(queue.getTask('origin')!.botControl).toBe(prior);
        expect(control()).toEqual(prior);
    });

    it('retains both live receipts and control when a partial removal write fails', async () => {
        await admitOrigin();
        await register();
        await followUp();
        rejectWrites('released');
        await expect(remove()).rejects.toThrow('binding write rejected');
        expect(receipt().releaseState).toBeUndefined();
        expect(receipt('follow-up').releaseState).toBeUndefined();
        expect(control()?.source).toBe('teams');
    });

    it('serializes concurrent removals and makes repeat removal idempotent', async () => {
        await admitOrigin();
        await register();
        await followUp();
        await Promise.all([remove(), remove('follow-up'), remove('follow-up')]);
        expect(control()).toBeUndefined();
        expect(receipt().releaseState).toBe('released');
        expect(receipt('follow-up').releaseState).toBe('released');
    });

    it.each([true, false])('waits for accepted/rejected admission before considering the last live binding (%s)', async accepted => {
        await admitOrigin();
        await register();
        let finish!: () => void;
        let started!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        const starting = new Promise<void>(resolve => { started = resolve; });
        const admission = followUp('follow-up', accepted, async () => { started(); await waiting; });
        const outcome = accepted ? expect(admission).resolves.toMatchObject({ duplicate: false })
            : expect(admission).rejects.toThrow('admission rejected');
        await starting;
        const removal = remove();
        finish();
        await outcome;
        await removal;
        expect(control()?.source).toBe(accepted ? 'teams' : undefined);
        expect(fs.existsSync(receiptFile('follow-up'))).toBe(accepted);
    });

    it('retains rejected admission receipts and reports both failures if unlink compensation fails', async () => {
        await admitOrigin();
        await register();
        vi.mocked(fs.unlinkSync).mockImplementationOnce(() => { throw new Error('receipt unlink rejected'); });
        await expect(followUp('rejected', false)).rejects.toMatchObject({
            message: 'Teams admission receipt rollback failed',
            errors: [expect.objectContaining({ message: 'admission rejected' }),
                expect.objectContaining({ message: 'receipt unlink rejected' })],
        });
        expect(relay.hasInbound(message('rejected'))).toBe(true);
        expect(fs.existsSync(receiptFile('rejected'))).toBe(true);
    });

    it('allows new adoption after release without old tombstones clearing its control', async () => {
        await admitOrigin();
        await register();
        await remove();
        await followUp('readmitted');
        await remove();
        await restart();
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('teams');
        await remove('readmitted');
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeUndefined();
    });

    it('rejects released thread and pending targets and never sends their answers', async () => {
        await admitOrigin();
        await remove();
        await expect(relay.resolveThread(message('quote', 'root'))).rejects.toThrow('binding is unavailable');
        expect(relay.getThreadSelection(message('quote', 'root'))).toBeNull();
        const enqueue = vi.fn();
        await expect(relay.admitPendingFollowUp(message('pending'), 'origin', enqueue)).rejects.toThrow('binding is unavailable');
        expect(enqueue).not.toHaveBeenCalled();
        await register();
        await relay.acknowledged('origin');
        await relay.reconnected();
        expect(send).not.toHaveBeenCalled();
    });

    it('stops an in-flight answer after release during the process read', async () => {
        await admitOrigin();
        await register();
        let finish!: () => void;
        let started!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        const starting = new Promise<void>(resolve => { started = resolve; });
        const read = store.getProcess.bind(store);
        vi.spyOn(store, 'getProcess').mockImplementationOnce(async (...args) => {
            started();
            await waiting;
            return read(...args);
        });
        const delivering = relay.acknowledged('origin');
        await starting;
        await remove();
        finish();
        await delivering;
        expect(send).not.toHaveBeenCalled();
        expect(receipt().releaseState).toBe('released');
    });

    it('stops multipart answers between confirmed parts when the binding is explicitly removed', async () => {
        await admitOrigin();
        await register('answer '.repeat(7_000));
        const ownQueue = queue.registry.getQueueForRepo(path.join(dir, 'ws-a'));
        ownQueue.markStarted('origin');
        ownQueue.markCompleted('origin', {});
        send.mockImplementationOnce(async () => {
            await remove();
            return 'confirmed-part';
        });
        await relay.acknowledged('origin');
        expect(send).toHaveBeenCalledTimes(1);
        expect(receipt().partCount).toBeGreaterThan(1);
        expect(receipt().releaseState).toBe('released');
        await restart();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('compacts delivered follow-ups without releasing the root, retaining tombstones and pending origin authority', async () => {
        await admitOrigin();
        await register();
        await followUp('follow-up', true, undefined, 'root');
        writeReceipt({ status: 'delivered', createdAt: new Date(0).toISOString() }, 'follow-up');
        enabled = false;
        await restart();
        expect(fs.existsSync(receiptFile('follow-up'))).toBe(false);
        expect(fs.existsSync(receiptFile())).toBe(true);
        expect(control()?.source).toBe('teams');
        await remove();
        writeReceipt({ status: 'delivered', createdAt: new Date(0).toISOString() });
        await restart();
        expect(receipt().releaseState).toBe('released');
    });

    it('retains a command-thread initial receipt when it is not a channel root', async () => {
        await admitOrigin('ws-a', 'origin', 'thread-question', 'command-root');
        writeReceipt({ status: 'delivered', createdAt: new Date(0).toISOString() }, 'thread-question');
        await restart();
        expect(receipt('thread-question').taskId).toBe('origin');
        await remove('thread-question');
        expect(control()).toBeUndefined();
    });

    it('retains the last delivered follow-up and original pending authority after root removal', async () => {
        await admitOrigin();
        await relay.admitPendingFollowUp(message('pending', 'root'), 'origin', async (workspaceId, target, requestId, taskId) =>
            queue.enqueue({ id: taskId, type: 'chat', repoId: workspaceId, processId: target, config: {}, priority: 'normal',
                payload: { kind: 'chat', workspaceId, processId: target, prompt: 'request', relayRequestId: requestId } }));
        await remove();
        writeReceipt({ status: 'delivered', createdAt: new Date(0).toISOString() }, 'pending');
        await restart();
        expect(receipt('pending').releaseState).toBeUndefined();
        expect(control()?.source).toBe('teams');
        await remove('pending');
        expect(control()).toBeUndefined();
    });

    it('retains an existing-topic root receipt and its reply deduplication cursor', async () => {
        await register();
        await followUp('adopted-root');
        const reply = { ...message('old-reply', 'adopted-root'), createdDateTime: new Date(0).toISOString() };
        relay.recordSeenReply(teamId, reply);
        writeReceipt({ status: 'delivered', createdAt: new Date(0).toISOString() }, 'adopted-root');
        await restart();
        expect(receipt('adopted-root').requestId).toBeDefined();
        expect(relay.threadRoots(teamId, channelId)).toContain('adopted-root');
        expect(relay.hasSeenReply(teamId, reply)).toBe(true);
        expect((await relay.resolveThread(message('new-reply', 'adopted-root')))?.process?.id).toBe(processId);
        await remove('adopted-root');
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeUndefined();
    });

    it('rejects malformed release state and unknown owner removal', async () => {
        await admitOrigin();
        await expect(remove('missing')).rejects.toThrow('target is unavailable');
        writeReceipt({ releaseState: 'invalid' });
        await expect(restart()).rejects.toThrow('Invalid Teams answer binding');
    });

    it('propagates conflicting workspace receipt identities', async () => {
        await admitOrigin();
        fs.mkdirSync(path.dirname(receiptFile('root', 'ws-b')), { recursive: true });
        fs.writeFileSync(receiptFile('root', 'ws-b'), JSON.stringify({ ...receipt(), workspaceId: 'ws-b' }));
        await expect(restart()).rejects.toThrow('Conflicting Teams workspace bindings');
    });

    const wireProduction = () => {
        relay.dispose();
        // Plain messages and topic commands use the selected repo (else Global).
        new TeamsUserStateStore(dir).update('synthetic-user', { selectedRepo: 'ws-a' });
        manager = new TeamsMessagingManager(dir);
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId, channelId,
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(manager, 'sendMessage').mockImplementation(send);
        let handle!: (msg: InboundTeamsMessage) => Promise<void>;
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => {
            handle = msg => handler(msg, () => {});
        });
        vi.spyOn(manager, 'setAnswerRelay').mockImplementation(value => { relay = value; });
        registerTeamsMessagingRoutes([], {
            dataDir: dir, store, manager, relayQueue: queue.createAggregateQueueFacade(),
            getBotManagedConversationsEnabled: () => true, getAnswerRelayEnabled: () => false,
            enqueueChat: async (workspaceId, prompt, id, botControl) => queue.enqueue({
                id, botControl, repoId: workspaceId, type: 'chat', processId: toQueueProcessId(id!),
                config: {}, priority: 'normal', payload: { kind: 'chat', workspaceId, prompt },
            }),
            executeFollowUp: vi.fn(),
            admitRelayFollowUp: async (process, prompt, requestId, _mode, id, _images, admissionHeld) => ({
                taskId: await (admissionHeld ? queue.enqueueAdmitted : queue.enqueue).call(queue, { id, repoId: process.metadata!.workspaceId as string,
                    type: 'chat', processId: process.id, config: {}, priority: 'normal',
                    payload: { kind: 'chat', processId: process.id, workspaceId: process.metadata!.workspaceId,
                        prompt, relayRequestId: requestId } }),
            }),
        });
        return handle;
    };

    it('production startup/inbound typed retry continues unrelated work and later completes release', async () => {
        await admitOrigin();
        writeReceipt({ releaseState: 'releasing' });
        rejectQueueRelease();
        const handle = wireProduction();
        await handle(message('unrelated'));
        expect(queue.createAggregateQueueFacade().getAll().filter(task => task.id !== 'origin')).toHaveLength(1);
        expect(receipt().releaseState).toBe('releasing');
        expect(console.error).toHaveBeenCalledWith('[teams-answer-relay] Binding release reconciliation failed');
        store.getDatabase().exec('DROP TRIGGER reject_release');
        await handle(message());
        expect(receipt().releaseState).toBe('released');
        expect(control()).toBeUndefined();
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(2);
    });

    it('production ordinary controlled follow-ups retain authoritative admission-only receipts', async () => {
        await admitOrigin();
        await register();
        const handle = wireProduction();
        await handle({ ...message('choose'), text: `/select topic ${processId}` });
        await handle(message('ordinary-follow-up'));
        expect(receipt('ordinary-follow-up').admissionOnly).toBe(true);
        await remove();
        expect(control()?.source).toBe('teams');
        await remove('ordinary-follow-up');
        expect(control()).toBeUndefined();
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeUndefined();
    });

    it('production does not swallow malformed receipt files as release retry failures', async () => {
        await admitOrigin();
        writeReceipt({ releaseState: 'invalid' });
        const handle = wireProduction();
        await expect(handle(message('unrelated'))).rejects.toThrow('Invalid Teams answer binding');
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(1);
    });
});
