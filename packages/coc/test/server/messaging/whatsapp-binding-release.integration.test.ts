import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, SqliteQueueStore } from '@plusplusoneplusplus/forge';
import { WhatsAppBindings, type WhatsAppBinding } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter } from '../../../src/server/messaging/whatsapp-command-router';
import { WhatsAppAnswerRelay, createWhatsAppQuestionTransport } from '../../../src/server/messaging/whatsapp-answer-relay';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { getRepoDataPath } from '../../../src/server/paths';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

describe('WhatsApp authoritative binding removal', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let queue: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    let bindings: WhatsAppBindings;
    const processId = 'queue_origin';
    const receipt = (patch: Partial<WhatsAppBinding> = {}): WhatsAppBinding => ({
        groupJid: 'test-group@g.us', workspaceId: 'ws-a', processId, taskId: 'origin',
        inboundId: 'inbound-origin', outboundIds: ['outbound-origin'], nextPart: 1,
        status: 'delivered', ...patch,
    });
    const openQueue = () => {
        queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
        });
        for (const id of ['ws-a', 'ws-b']) queue.registerRepoId(id, path.join(dir, id));
        persistence = new SqliteQueuePersistence(queue, store.getDatabase());
        bindings = new WhatsAppBindings(dir, { store, queue: queue.createAggregateQueueFacade() });
    };
    const restart = async () => {
        persistence.dispose();
        queue.dispose();
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        openQueue();
        persistence.restore();
        await bindings.restore(store);
    };
    const enqueue = () => queue.enqueue({
        id: 'origin', type: 'chat', processId, repoId: 'ws-a', priority: 'normal', config: {},
        botControl: createBotControlMetadata('whatsapp'),
        payload: { kind: 'chat', prompt: 'request', workspaceId: 'ws-a', relayRequestId: 'origin' },
    });
    const register = async () => store.addProcess({
        id: processId, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'request',
        metadata: { type: 'chat', workspaceId: 'ws-a', queueTaskId: 'origin', provider: 'codex',
            botControl: { ...createBotControlMetadata('whatsapp'), externalThreadUrl: 'https://web.whatsapp.com/thread' } },
        conversationTurns: [
            { role: 'user', content: 'request', turnIndex: 0, timestamp: new Date(), relayRequestId: 'origin' },
            { role: 'assistant', content: 'answer', turnIndex: 1, timestamp: new Date() },
        ],
    });
    const durableControl = () => new SqliteQueueStore(store.getDatabase()).getQueueTasks()
        .find(task => task.id === 'origin')?.botControl;
    const failBindingWrites = (state: string, inboundId?: string) => {
        const write = vi.mocked(fs.writeFileSync).getMockImplementation()!;
        return vi.mocked(fs.writeFileSync).mockImplementation((file, data, options) => {
            if (String(file).includes('whatsapp-bindings.json')) {
                const rows: WhatsAppBinding[] = JSON.parse(String(data));
                if (rows.some(row => row.releaseState === state && (inboundId === undefined || row.inboundId === inboundId))) {
                    throw new Error('binding write rejected');
                }
            }
            return write(file, data, options);
        });
    };

    it.each(['releasing', 'released'] as const)('excludes %s receipts from ask_user routing and rechecks before posting', async releaseState => {
        const binding = receipt({ questionIds: ['prior-question'] });
        bindings.add(binding);
        const send = vi.fn(async () => 'question');
        const transport = createWhatsAppQuestionTransport({
            bindings, connected: () => true, groupJid: () => binding.groupJid, send,
        });
        const request = { processId, requestId: 'origin' };
        const target = transport.locate(request)!;
        expect(target.chatKey).toBe(binding.groupJid);
        binding.releaseState = releaseState;
        bindings.update(binding);
        expect(transport.locate(request)).toBeUndefined();
        await expect(transport.post(target, { question: 'Proceed?', options: [], hint: 'Reply yes or no' }, request))
            .rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
        expect(bindings.isQuestionMessage('prior-question')).toBe(true);
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-binding-release-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        for (const id of ['ws-a', 'ws-b']) {
            fs.mkdirSync(path.join(dir, id));
            await store.registerWorkspace({ id, name: id, rootPath: path.join(dir, id) });
        }
        openQueue();
        await bindings.restore(store);
    });
    afterEach(() => {
        persistence.dispose();
        queue.dispose();
        store.close();
        vi.restoreAllMocks();
        vi.mocked(fs.writeFileSync).mockReset();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it.each([false, true])('releases the last binding and pending/persisted control durably (%s)', async persisted => {
        await enqueue();
        if (persisted) await register();
        const binding = receipt();
        bindings.add(binding);
        await bindings.remove(binding);
        expect(binding.releaseState).toBe('released');
        expect(durableControl()).toBeUndefined();
        await restart();
        expect(queue.getTask('origin')?.status).toBe('queued');
        expect(durableControl()).toBeUndefined();
        const process = await store.getProcess(processId);
        expect(process?.metadata?.botControl).toBeUndefined();
        if (persisted) {
            expect(process?.metadata?.provider).toBe('codex');
            expect(process?.conversationTurns).toHaveLength(2);
        }
        const restored = bindings.findMessage('inbound-origin')!;
        await bindings.remove(restored);
        expect(bindings.isKnownMessage('inbound-origin')).toBe(true);
        expect(bindings.isKnownMessage('outbound-origin')).toBe(true);
        expect(bindings.add(receipt())).toBe(false);
    });

    it('retains control for another live binding and releases on the last follow-up receipt', async () => {
        await enqueue();
        const origin = receipt();
        const followUp = receipt({ taskId: 'follow-up', inboundId: 'inbound-follow-up', outboundIds: [] });
        bindings.add(origin);
        bindings.add(followUp);
        await bindings.remove(origin);
        expect(durableControl()?.source).toBe('whatsapp');
        await restart();
        await bindings.remove(bindings.findMessage('inbound-follow-up')!);
        expect(durableControl()).toBeUndefined();
    });

    it.each(['success', 'receipt-failure', 'process-crash'] as const)(
        'releases an adopted fork without touching its source authority across restart (%s)', async stage => {
            await enqueue();
            await register();
            bindings.add(receipt());
            const original = await store.getProcess(processId);
            const originalTask = new SqliteQueueStore(store.getDatabase()).getQueueTasks().find(task => task.id === 'origin');
            const fork = await store.forkProcess(processId, 'adopted-fork');
            expect(fork.metadata?.queueTaskId).toBe('origin');
            expect(fork.metadata?.botControl).toBeUndefined();
            bindings.selectRepo('ws-a');
            bindings.selectTopic('ws-a', fork.id);
            const send = vi.fn(async () => 'command-reply');
            const router = new WhatsAppCommandRouter({
                bindings, store, groupJid: () => 'test-group@g.us', getTask: id => queue.getTask(id),
                getBotManagedConversationsEnabled: () => true, send, react: vi.fn(),
                enqueue: async (workspaceId, prompt, mode, target, taskId, botControl, _images, admissionHeld) => (admissionHeld ? queue.enqueueAdmitted : queue.enqueue).call(queue, {
                    id: taskId, repoId: workspaceId, type: 'chat', processId: target,
                    priority: 'normal', config: {}, botControl,
                    payload: { kind: 'chat', workspaceId, processId: target, prompt, mode, relayRequestId: taskId },
                }),
            });
            for (const inboundId of ['fork-first', 'fork-last']) {
                await router.handle({ chatJid: 'test-group@g.us', senderJid: 'test-group@g.us',
                    fromMe: true, text: 'request', messageId: inboundId });
                expect(bindings.findMessage(inboundId)?.processId).toBe(fork.id);
            }
            expect(send).not.toHaveBeenCalled();
            await bindings.remove(bindings.findMessage('fork-first')!);
            expect((await store.getProcess(fork.id))?.metadata?.botControl?.source).toBe('whatsapp');
            await restart();
            const last = bindings.findMessage('fork-last')!;
            if (stage === 'receipt-failure') {
                failBindingWrites('released', 'fork-last');
                await expect(bindings.remove(last)).rejects.toThrow('binding write rejected');
                expect(last.releaseState).toBe('releasing');
                expect((await store.getProcess(fork.id))?.metadata?.botControl).toEqual(createBotControlMetadata('whatsapp'));
                vi.mocked(fs.writeFileSync).mockReset();
            } else if (stage === 'process-crash') {
                last.releaseState = 'releasing';
                bindings.update(last);
                const metadata = { ...(await store.getProcess(fork.id))!.metadata };
                delete metadata.botControl;
                await store.updateProcess(fork.id, { metadata });
            } else {
                await bindings.remove(last);
            }
            await restart();
            await bindings.remove(bindings.findMessage('fork-last')!);
            expect(bindings.findMessage('fork-last')?.releaseState).toBe('released');
            expect((await store.getProcess(fork.id))?.metadata).toEqual(fork.metadata);
            expect((await store.getProcess(fork.id))?.conversationTurns).toEqual(fork.conversationTurns);
            expect(await store.getProcess(processId)).toEqual(original);
            expect(new SqliteQueueStore(store.getDatabase()).getQueueTasks().find(task => task.id === 'origin'))
                .toEqual(originalTask);
            expect(bindings.findMessage('inbound-origin')?.releaseState).toBeUndefined();
            expect(bindings.isKnownMessage('fork-last')).toBe(true);
        },
    );

    it('does not release on selection, completion, relay disposal, or ordinary reload', async () => {
        await enqueue();
        await register();
        const binding = receipt();
        bindings.add(binding);
        bindings.selectTopic('ws-a', processId);
        bindings.selectTopic('ws-a', null);
        bindings.selectRepo('ws-b');
        const relay = new WhatsAppAnswerRelay({
            bindings, store, queue: queue.createAggregateQueueFacade(), connected: () => false,
            groupJid: () => 'test-group@g.us', send: vi.fn(),
        });
        await relay.reconnected();
        relay.dispose();
        await restart();
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('whatsapp');
        expect(durableControl()?.source).toBe('whatsapp');
        expect(bindings.findMessage(binding.inboundId)?.releaseState).toBeUndefined();
    });

    it('rejects an unowned receipt reference without recording a release intent', async () => {
        await enqueue();
        const binding = receipt();
        bindings.add(binding);
        await expect(bindings.remove({ ...binding })).rejects.toThrow('target is unavailable');
        expect(binding.releaseState).toBeUndefined();
        expect(durableControl()?.source).toBe('whatsapp');
    });

    it('keeps exact ownership when the durable intent write fails', async () => {
        await enqueue();
        await register();
        const binding = receipt();
        bindings.add(binding);
        const fault = failBindingWrites('releasing');
        await expect(bindings.remove(binding)).rejects.toThrow('binding write rejected');
        expect(binding.releaseState).toBeUndefined();
        expect(durableControl()?.source).toBe('whatsapp');
        expect((await store.getProcess(processId))?.metadata?.botControl?.externalThreadUrl)
            .toBe('https://web.whatsapp.com/thread');
        fault.mockReset();
        await restart();
        expect(bindings.findMessage(binding.inboundId)?.releaseState).toBeUndefined();
    });

    it('compensates failed final receipt persistence and completes the durable intent on reload', async () => {
        await enqueue();
        await register();
        const binding = receipt();
        bindings.add(binding);
        const fault = failBindingWrites('released');
        await expect(bindings.remove(binding)).rejects.toThrow('binding write rejected');
        expect(binding.releaseState).toBe('releasing');
        expect(durableControl()?.source).toBe('whatsapp');
        expect((await store.getProcess(processId))?.metadata?.botControl?.externalThreadUrl)
            .toBe('https://web.whatsapp.com/thread');
        expect(() => bindings.add(receipt({ inboundId: 'new', taskId: 'new' }))).toThrow('release is pending');
        fault.mockReset();
        await restart();
        expect(bindings.findMessage(binding.inboundId)?.releaseState).toBe('released');
        expect(durableControl()).toBeUndefined();
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeUndefined();
    });

    it.each(['intent', 'queue', 'process'] as const)('recovers a crash after %s persistence without backfill', async stage => {
        await enqueue();
        await register();
        const binding = receipt();
        bindings.add(binding);
        binding.releaseState = 'releasing';
        bindings.update(binding);
        if (stage !== 'intent') {
            const control = queue.getTask('origin')!.botControl;
            queue.createAggregateQueueFacade().replaceBotControl('origin', control, undefined);
        }
        if (stage === 'process') {
            const process = (await store.getProcess(processId))!;
            const metadata = { ...process.metadata };
            delete metadata.botControl;
            await store.updateProcess(processId, { metadata });
        }
        await restart();
        expect(bindings.findMessage(binding.inboundId)?.releaseState).toBe('released');
        expect(durableControl()).toBeUndefined();
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeUndefined();
    });

    it('retains a retryable intent on queue persistence failure and blocks new admission', async () => {
        await enqueue();
        const binding = receipt();
        bindings.add(binding);
        store.getDatabase().exec(`CREATE TRIGGER reject_release BEFORE INSERT ON queue_tasks
            WHEN NEW.id = 'origin' AND NEW.bot_control IS NULL
            BEGIN SELECT RAISE(ABORT, 'queue release rejected'); END`);
        await expect(bindings.remove(binding)).rejects.toThrow('queue release rejected');
        expect(binding.releaseState).toBe('releasing');
        expect(durableControl()?.source).toBe('whatsapp');
        await expect(bindings.restore(store)).rejects.toMatchObject({
            message: 'WhatsApp binding release reconciliation failed',
            errors: [expect.objectContaining({ message: expect.stringContaining('queue release rejected') })],
        });
        store.getDatabase().exec('DROP TRIGGER reject_release');
        await bindings.restore(store);
        expect(binding.releaseState).toBe('released');
    });

    it('does not remove another workspace or competing controller', async () => {
        await enqueue();
        await register();
        const binding = receipt({ workspaceId: 'ws-b' });
        bindings.add(binding);
        await expect(bindings.remove(binding)).rejects.toThrow('unavailable in this workspace');
        expect(binding.releaseState).toBeUndefined();
        expect(durableControl()?.source).toBe('whatsapp');
        const process = (await store.getProcess(processId))!;
        await store.updateProcess(processId, { metadata: { ...process.metadata, botControl: createBotControlMetadata('teams') } });
        const own = receipt({ inboundId: 'own' });
        bindings.add(own);
        await expect(bindings.remove(own)).rejects.toThrow('already controlled');
        expect(own.releaseState).toBeUndefined();
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('teams');
    });

    it('reconciles other workspaces even when one durable release intent keeps failing', async () => {
        await enqueue();
        const failed = receipt({ releaseState: 'releasing' });
        const other = receipt({ workspaceId: 'ws-b', processId: 'queue_other', taskId: 'other',
            inboundId: 'inbound-other', releaseState: 'releasing' });
        const file = getRepoDataPath(dir, 'ws-a', 'whatsapp-bindings.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify([failed]));
        const otherFile = getRepoDataPath(dir, 'ws-b', 'whatsapp-bindings.json');
        fs.mkdirSync(path.dirname(otherFile), { recursive: true });
        fs.writeFileSync(otherFile, JSON.stringify([other]));
        await queue.enqueue({
            id: 'other', type: 'chat', processId: 'queue_other', repoId: 'ws-b', priority: 'normal', config: {},
            botControl: createBotControlMetadata('whatsapp'),
            payload: { kind: 'chat', prompt: 'request', workspaceId: 'ws-b' },
        });
        store.getDatabase().exec(`CREATE TRIGGER reject_release BEFORE INSERT ON queue_tasks
            WHEN NEW.id = 'origin' AND NEW.bot_control IS NULL
            BEGIN SELECT RAISE(ABORT, 'queue release rejected'); END`);
        bindings = new WhatsAppBindings(dir, { store, queue: queue.createAggregateQueueFacade() });
        await expect(bindings.restore(store)).rejects.toMatchObject({
            message: 'WhatsApp binding release reconciliation failed', errors: [expect.any(Error)],
        });
        expect(bindings.findMessage(other.inboundId)?.releaseState).toBe('released');
        expect(queue.getTask('other')?.botControl).toBeUndefined();
        expect(bindings.findMessage(failed.inboundId)?.releaseState).toBe('releasing');
        expect(durableControl()?.source).toBe('whatsapp');
        expect(await bindings.admit(receipt({ workspaceId: 'ws-b', processId: 'queue_new', taskId: 'new',
            inboundId: 'unrelated' }), async () => {})).toBe(true);
    });

    it('does not let released tombstones erase an explicitly readmitted conversation', async () => {
        await enqueue();
        await register();
        const origin = receipt();
        bindings.add(origin);
        await bindings.remove(origin);
        const next = receipt({ inboundId: 'new-admission', taskId: 'new-admission' });
        expect(await bindings.admit(next, async () => {
            const process = (await store.getProcess(processId))!;
            await store.updateProcess(processId, { metadata: {
                ...process.metadata, botControl: createBotControlMetadata('whatsapp'),
            } });
        })).toBe(true);
        await bindings.remove(origin);
        await restart();
        expect((await store.getProcess(processId))?.metadata?.botControl?.source).toBe('whatsapp');
        expect(bindings.findMessage(next.inboundId)?.releaseState).toBeUndefined();
        await bindings.remove(bindings.findMessage(next.inboundId)!);
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeUndefined();
    });

    it('preserves a different workspace live binding when releasing its own last binding', async () => {
        await enqueue();
        const own = receipt();
        bindings.add(own);
        await queue.enqueue({
            id: 'other', type: 'chat', processId: 'queue_other', repoId: 'ws-b', priority: 'normal', config: {},
            botControl: createBotControlMetadata('whatsapp'),
            payload: { kind: 'chat', prompt: 'request', workspaceId: 'ws-b' },
        });
        const other = receipt({ workspaceId: 'ws-b', processId: 'queue_other', taskId: 'other', inboundId: 'other' });
        bindings.add(other);
        await bindings.remove(own);
        await restart();
        expect(durableControl()).toBeUndefined();
        expect(queue.getTask('other')?.botControl?.source).toBe('whatsapp');
        expect(bindings.findMessage(other.inboundId)?.releaseState).toBeUndefined();
    });

    it('serializes concurrent removals, retaining control until the last live receipt', async () => {
        await enqueue();
        const first = receipt();
        const second = receipt({ inboundId: 'second', taskId: 'second' });
        bindings.add(first);
        bindings.add(second);
        await Promise.all([bindings.remove(first), bindings.remove(second), bindings.remove(second)]);
        expect(first.releaseState).toBe('released');
        expect(second.releaseState).toBe('released');
        expect(durableControl()).toBeUndefined();
    });

    it.each([true, false])('waits for an in-flight accepted/rejected admission before removing the last binding (%s)', async accepted => {
        await enqueue();
        const origin = receipt();
        bindings.add(origin);
        const followUp = receipt({ inboundId: 'follow-up', taskId: 'follow-up' });
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        let started!: () => void;
        const startedPromise = new Promise<void>(resolve => { started = resolve; });
        const admission = bindings.admit(followUp, async () => {
            started();
            await waiting;
            if (!accepted) throw new Error('admission rejected');
        });
        const result = accepted ? expect(admission).resolves.toBe(true)
            : expect(admission).rejects.toThrow('admission rejected');
        await startedPromise;
        const removal = bindings.remove(origin);
        finish();
        await result;
        await removal;
        expect(durableControl()?.source).toBe(accepted ? 'whatsapp' : undefined);
        expect(bindings.isKnownMessage('follow-up')).toBe(accepted);
    });

    it('restores a rejected-admission receipt in memory when its removal write fails', () => {
        const binding = receipt();
        bindings.add(binding);
        vi.mocked(fs.writeFileSync).mockImplementationOnce(() => { throw new Error('receipt removal rejected'); });
        expect(() => bindings.discardRejected(binding)).toThrow('receipt removal rejected');
        expect(bindings.findMessage(binding.inboundId)).toBe(binding);
        const reloaded = new WhatsAppBindings(dir);
        expect(reloaded.add(receipt())).toBe(false);
    });

    it('deduplicates released inbound delivery and rejects quotes without admitting or sending answers', async () => {
        await enqueue();
        await register();
        const binding = receipt({ status: 'queued', nextPart: 0 });
        bindings.add(binding);
        await bindings.remove(binding);
        bindings.selectRepo('ws-a');
        bindings.selectTopic('ws-a', processId);
        const send = vi.fn(async () => 'command-reply');
        const enqueueChat = vi.fn(async () => 'new-task');
        const router = new WhatsAppCommandRouter({
            bindings, store, groupJid: () => 'test-group@g.us', getTask: id => queue.getTask(id),
            getBotManagedConversationsEnabled: () => true, enqueue: enqueueChat, send, react: vi.fn(),
        });
        const message = { chatJid: 'test-group@g.us', senderJid: 'test-group@g.us',
            fromMe: true, text: 'question', messageId: binding.inboundId };
        await router.handle(message);
        expect(send).not.toHaveBeenCalled();
        await router.handle({ ...message, messageId: 'quoted', quotedMessageId: 'outbound-origin' });
        expect(send).toHaveBeenCalledWith(expect.stringContaining('binding is unavailable'), 'quoted');
        expect(enqueueChat).not.toHaveBeenCalled();
        const relay = new WhatsAppAnswerRelay({
            bindings, store, queue: queue.createAggregateQueueFacade(), connected: () => true,
            groupJid: () => 'test-group@g.us', send,
        });
        try {
            await relay.reconnected();
            expect(send).toHaveBeenCalledTimes(1);
        } finally {
            relay.dispose();
        }
        expect((await store.getProcess(processId))?.metadata?.botControl).toBeUndefined();
    });

    it('stops an in-flight relay before sending if its binding is released during the process read', async () => {
        await enqueue();
        await register();
        const binding = receipt({ status: 'queued', nextPart: 0 });
        bindings.add(binding);
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        let started!: () => void;
        const startedPromise = new Promise<void>(resolve => { started = resolve; });
        const read = store.getProcess.bind(store);
        vi.spyOn(store, 'getProcess').mockImplementationOnce(async (...args) => {
            started();
            await waiting;
            return read(...args);
        });
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markStarted('origin');
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).markCompleted('origin', {});
        const send = vi.fn();
        const relay = new WhatsAppAnswerRelay({
            bindings, store, queue: queue.createAggregateQueueFacade(), connected: () => true,
            groupJid: () => 'test-group@g.us', send,
        });
        try {
            const delivering = relay.reconnected();
            await startedPromise;
            await bindings.remove(binding);
            finish();
            await delivering;
            expect(send).not.toHaveBeenCalled();
        } finally {
            finish();
            relay.dispose();
        }
    });

    it('does not reclaim an unattributed old receipt during restore or removal', async () => {
        const binding = receipt();
        bindings.add(binding);
        await restart();
        await bindings.remove(bindings.findMessage(binding.inboundId)!);
        expect(await store.getProcess(processId)).toBeUndefined();
        expect(durableControl()).toBeUndefined();
    });

    it('rejects malformed persisted release state', async () => {
        const binding = receipt();
        bindings.add(binding);
        const file = getRepoDataPath(dir, 'ws-a', 'whatsapp-bindings.json');
        fs.writeFileSync(file, JSON.stringify([{ ...binding, releaseState: 'invalid' }]));
        const restored = new WhatsAppBindings(dir, { store, queue: queue.createAggregateQueueFacade() });
        await expect(restored.restore(store)).rejects.toThrow('Invalid WhatsApp bindings');
    });
});
