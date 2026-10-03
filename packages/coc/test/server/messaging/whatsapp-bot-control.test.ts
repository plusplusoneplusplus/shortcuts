import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, SqliteQueueStore, type AIProcess } from '@plusplusoneplusplus/forge';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter } from '../../../src/server/messaging/whatsapp-command-router';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

describe('WhatsApp durable existing-topic control admission', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let bindings: WhatsAppBindings;
    let enabled: boolean;
    let enqueue: ReturnType<typeof vi.fn>;
    let send: ReturnType<typeof vi.fn>;
    let react: ReturnType<typeof vi.fn>;
    let router: WhatsAppCommandRouter;
    const inbound = (text: string, messageId: string, quotedMessageId?: string): InboundWAMessage => ({
        chatJid: 'test-group@g.us', senderJid: 'test-group@g.us', fromMe: true,
        text, messageId, quotedMessageId,
    });
    const process = (id: string, workspaceId: string): AIProcess => ({
        id, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'Ordinary topic',
        metadata: { type: 'chat', workspaceId, provider: 'claude' },
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-control-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        for (const workspaceId of ['ws-a', 'ws-b']) {
            await store.registerWorkspace({ id: workspaceId, name: workspaceId, rootPath: path.join(dir, workspaceId) });
            await store.addProcess(process(`topic-${workspaceId}`, workspaceId));
        }
        bindings = new WhatsAppBindings(dir);
        await bindings.restore(store);
        bindings.selectRepo('ws-a');
        bindings.selectTopic('ws-a', 'topic-ws-a');
        enabled = true;
        enqueue = vi.fn(async () => 'accepted');
        send = vi.fn(async () => 'test-outbound');
        react = vi.fn(async () => {});
        router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => 'test-group@g.us', enqueue, send, react,
            getTask: () => undefined,
            getBotManagedConversationsEnabled: () => enabled,
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        store?.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('claims only when an accepted message adopts the topic, then survives restart and duplicate delivery', async () => {
        await router.handle(inbound('select topic topic-ws-a', 'select'));
        expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl).toBeUndefined();
        enqueue.mockImplementation(async () => {
            expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl)
                .toEqual(createBotControlMetadata('whatsapp'));
            return 'accepted';
        });
        await router.handle(inbound('question', 'question'));
        await router.handle(inbound('question', 'question'));
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(react).toHaveBeenCalledWith('question');
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        const restored = new WhatsAppBindings(dir);
        await restored.restore(store);
        expect(restored.findMessage('question')?.processId).toBe('topic-ws-a');
        expect((await store.getProcess('topic-ws-a'))?.metadata).toMatchObject({
            botControl: createBotControlMetadata('whatsapp'), provider: 'claude', workspaceId: 'ws-a',
        });
        expect((await store.getProcess('topic-ws-b'))?.metadata?.botControl).toBeUndefined();
    });

    it('uses the live default-off gate without clearing an accepted claim when disabled', async () => {
        enabled = false;
        await router.handle(inbound('first', 'first'));
        expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl).toBeUndefined();
        enabled = true;
        await router.handle(inbound('second', 'second'));
        enabled = false;
        await router.handle(inbound('third', 'third'));
        await router.handle(inbound('create topic', 'new-topic'));
        expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl)
            .toEqual(createBotControlMetadata('whatsapp'));
    });

    it('routes a quoted adoption to its owning workspace rather than the selected workspace', async () => {
        await router.handle(inbound('first', 'first'));
        bindings.selectRepo('ws-b');
        bindings.selectTopic('ws-b', 'topic-ws-b');
        await router.handle(inbound('quoted', 'quoted', 'first'));
        expect(enqueue.mock.calls.at(-1)?.slice(0, 4)).toEqual(['ws-a', 'quoted', undefined, 'topic-ws-a']);
        expect((await store.getProcess('topic-ws-b'))?.metadata?.botControl).toBeUndefined();
    });

    it('rejects competing ownership and cross-workspace IDs before queue admission', async () => {
        const original = (await store.getProcess('topic-ws-a'))!;
        await store.updateProcess(original.id, {
            metadata: { ...original.metadata, botControl: createBotControlMetadata('teams') },
        });
        await router.handle(inbound('competing', 'competing'));
        expect(bindings.findMessage('competing')).toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
        expect(react).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Could not queue'), 'competing');
        bindings.selectTopic('ws-a', 'topic-ws-b');
        await router.handle(inbound('wrong workspace', 'wrong'));
        expect(enqueue).not.toHaveBeenCalled();
        expect((await store.getProcess(original.id))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
        expect((await store.getProcess('topic-ws-b'))?.metadata?.botControl).toBeUndefined();
    });

    it('rolls back failed admission durably and permits retry of the same inbound message', async () => {
        enqueue.mockRejectedValueOnce(new Error('queue full'));
        await router.handle(inbound('question', 'retry'));
        expect(bindings.findMessage('retry')).toBeUndefined();
        expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl).toBeUndefined();
        expect(react).not.toHaveBeenCalled();
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl).toBeUndefined();
        router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => 'test-group@g.us', enqueue, send, react,
            getTask: () => undefined,
            getBotManagedConversationsEnabled: () => enabled,
        });
        await router.handle(inbound('question', 'retry'));
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(bindings.findMessage('retry')).toBeDefined();
        expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl)
            .toEqual(createBotControlMetadata('whatsapp'));
    });

    it('removes partially persisted real queue admission before rolling back control and retrying', async () => {
        const registry = new RepoQueueRegistry();
        const queue = new MultiRepoQueueRouter(registry, store, {
            aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
        });
        for (const workspace of await store.getWorkspaces()) queue.registerRepoId(workspace.id, workspace.rootPath!);
        const db = store.getDatabase();
        const queueStore = new SqliteQueueStore(db);
        const persistence = new SqliteQueuePersistence(queue, db);
        try {
            await queue.enqueue({
                id: 'other-workspace', repoId: 'ws-b', type: 'custom', priority: 'normal', payload: {}, config: {},
            });
            db.exec(`
                CREATE TRIGGER reject_bot_queue_order BEFORE INSERT ON queue_tasks
                WHEN NEW.repo_id = 'ws-a' AND EXISTS (SELECT 1 FROM queue_tasks WHERE id = NEW.id)
                BEGIN SELECT RAISE(ABORT, 'queue order failed'); END;
            `);
            enqueue = vi.fn((workspaceId, prompt, mode, processId, id) => queue.enqueue({
                id, processId, repoId: workspaceId, type: 'chat', priority: 'normal',
                payload: { kind: 'chat', mode, workspaceId, prompt, processId, relayRequestId: id }, config: {},
            }));
            router = new WhatsAppCommandRouter({
                store, bindings, groupJid: () => 'test-group@g.us', enqueue, send, react,
                getTask: id => queue.getTask(id),
                getBotManagedConversationsEnabled: () => enabled,
            });
            await router.handle(inbound('question', 'partial'));
            expect(bindings.findMessage('partial')).toBeUndefined();
            expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl).toBeUndefined();
            expect(queue.createAggregateQueueFacade().getQueued().map(task => task.id)).toEqual(['other-workspace']);
            expect(queueStore.getQueueTasks('ws-a')).toEqual([]);
            expect(queueStore.getQueueTasks('ws-b')).toHaveLength(1);
            expect(react).not.toHaveBeenCalled();
            expect(send).toHaveBeenCalledWith(expect.stringContaining('Could not queue'), 'partial');
            db.exec('DROP TRIGGER reject_bot_queue_order');
            await router.handle(inbound('question', 'partial'));
            await router.handle(inbound('question', 'partial'));
            expect(enqueue).toHaveBeenCalledTimes(2);
            expect(queueStore.getQueueTasks('ws-a')).toHaveLength(1);
            expect((await store.getProcess('topic-ws-a'))?.metadata).toMatchObject({
                botControl: createBotControlMetadata('whatsapp'), provider: 'claude', workspaceId: 'ws-a',
            });
            const restoredBindings = new WhatsAppBindings(dir);
            await restoredBindings.restore(store);
            expect(restoredBindings.findMessage('partial')?.taskId).toBe(queueStore.getQueueTasks('ws-a')[0].id);
        } finally {
            persistence.dispose();
            queue.dispose();
        }
    });

    it('does not admit or retain a receipt when claim persistence fails', async () => {
        vi.spyOn(store, 'updateProcess').mockRejectedValueOnce(new Error('write failed'));
        await router.handle(inbound('question', 'failed-write'));
        expect(enqueue).not.toHaveBeenCalled();
        expect(react).not.toHaveBeenCalled();
        expect(bindings.findMessage('failed-write')).toBeUndefined();
        expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl).toBeUndefined();
    });

    it('does not keep an in-memory receipt when binding persistence fails, and permits retry', async () => {
        const receiptPath = path.join(dir, 'repos', 'ws-a', 'whatsapp-bindings.json');
        fs.mkdirSync(receiptPath, { recursive: true });
        await router.handle(inbound('question', 'failed-receipt'));
        expect(enqueue).not.toHaveBeenCalled();
        expect(bindings.findMessage('failed-receipt')).toBeUndefined();
        expect((await store.getProcess('topic-ws-a'))?.metadata?.botControl).toBeUndefined();
        fs.rmSync(receiptPath, { recursive: true });
        await router.handle(inbound('question', 'failed-receipt'));
        expect(enqueue).toHaveBeenCalledTimes(1);
    });
});
