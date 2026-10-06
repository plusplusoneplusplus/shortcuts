import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileProcessStore, RepoQueueRegistry, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter } from '../../../src/server/messaging/whatsapp-command-router';
import { WhatsAppAnswerRelay } from '../../../src/server/messaging/whatsapp-answer-relay';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';

async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for WhatsApp queue answer');
}

describe('WhatsApp answer relay through real multi-repo queues', () => {
    let dataDir: string;
    let queue: MultiRepoQueueRouter;
    let relay: WhatsAppAnswerRelay;

    afterEach(() => {
        relay?.dispose();
        queue?.dispose();
        if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('correlates terminal turns and quoted cross-workspace follow-ups without mirroring other chats', { timeout: 20_000 }, async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-relay-integration-'));
        const store = new FileProcessStore({ dataDir });
        for (const [id, name] of [['ws-a', 'Alpha'], ['ws-b', 'Beta']]) {
            const rootPath = path.join(dataDir, id);
            fs.mkdirSync(rootPath);
            await store.registerWorkspace({ id, name, rootPath });
        }
        const ai = createMockSDKService();
        ai.mockSendMessage.mockImplementation(async ({ prompt }: { prompt: string }) => ({
            success: true, response: `Answer for ${prompt.trimEnd().split('\n').at(-1)}`,
            sessionId: 'test-session',
        }));
        const registry = new RepoQueueRegistry();
        queue = new MultiRepoQueueRouter(registry, store, {
            aiService: ai.service, dataDir, autoStart: false,
            followUpSuggestions: { enabled: false, count: 0 },
        });
        for (const workspace of await store.getWorkspaces()) queue.registerRepoId(workspace.id, workspace.rootPath!);
        const facade = queue.createAggregateQueueFacade();
        const bindings = new WhatsAppBindings(dataDir);
        await bindings.restore(store);
        const sends: Array<{ text: string; quotedId: string; id: string }> = [];
        const send = vi.fn(async (text: string, quotedId: string) => {
            const id = `out-${sends.length + 1}`;
            sends.push({ text, quotedId, id });
            return id;
        });
        relay = new WhatsAppAnswerRelay({
            bindings, store, queue: facade,
            connected: () => true, groupJid: () => 'bound@g.us', send,
        });
        const router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => 'bound@g.us',
            getTask: id => facade.getTask(id),
            getBotManagedConversationsEnabled: () => true,
            enqueue: (workspaceId, prompt, mode, processId, id, botControl, admissionHeld) => (admissionHeld ? queue.enqueueAdmitted : queue.enqueue).call(queue, {
                id, processId, type: 'chat', repoId: workspaceId, priority: 'normal',
                botControl,
                payload: { kind: 'chat', mode, workspaceId, prompt, relayRequestId: id,
                    ...(processId !== toQueueProcessId(id) ? { processId } : {}) },
                config: {},
            }),
            send, react: vi.fn(async () => {}),
            queued: binding => { void relay.reconcileTask(binding.taskId); },
        });
        const inbound = (id: string, text: string, quotedMessageId?: string): InboundWAMessage => ({
            chatJid: 'bound@g.us', senderJid: 'bound@g.us', fromMe: true,
            messageId: id, text, quotedMessageId,
        });
        await router.handle(inbound('select-a', 'select repo 1'));
        await router.handle(inbound('question-a', 'alpha prompt'));
        await router.handle(inbound('select-b', 'select repo 2'));
        await router.handle(inbound('question-b', 'beta prompt'));
        const alpha = bindings.findMessage('question-a')!;
        const beta = bindings.findMessage('question-b')!;
        expect(alpha.workspaceId).toBe('ws-a');
        expect(beta.workspaceId).toBe('ws-b');
        expect(facade.getTask(alpha.taskId)?.botControl).toEqual(createBotControlMetadata('whatsapp'));
        expect(facade.getTask(beta.taskId)?.botControl).toEqual(createBotControlMetadata('whatsapp'));
        await router.handle(inbound('pending-a', 'pending question', 'question-a'));
        expect(bindings.findMessage('pending-a')).toMatchObject({
            workspaceId: 'ws-a', processId: alpha.processId,
        });
        expect(facade.getTask(bindings.findMessage('pending-a')!.taskId)?.botControl).toBeUndefined();
        queue.activateQueueProcessing();
        await until(() => bindings.findMessage('question-a')?.status === 'delivered'
            && bindings.findMessage('question-b')?.status === 'delivered'
            && bindings.findMessage('pending-a')?.status === 'delivered');
        expect(sends.find(row => row.quotedId === 'question-a')?.text).toContain('Answer for alpha prompt');
        expect(sends.find(row => row.quotedId === 'question-b')?.text).toContain('Answer for beta prompt');
        expect(sends.find(row => row.quotedId === 'pending-a')?.text).toContain('Answer for pending question');
        const originalProvider = (await store.getProcess(alpha.processId))?.metadata?.provider;
        const answerA = alpha.outboundIds[0];
        await router.handle(inbound('follow-a', 'one more', answerA));
        await until(() => bindings.findMessage('follow-a')?.status === 'delivered');
        expect(bindings.findMessage('follow-a')?.workspaceId).toBe('ws-a');
        expect(sends.find(row => row.quotedId === 'follow-a')?.text).toContain('Answer for one more');
        expect(bindings.selectedRepo).toBe('ws-b');
        expect((await store.getProcess(alpha.processId, 'ws-a'))?.conversationTurns
            ?.filter(turn => turn.role === 'user').length).toBe(3);
        await relay.reconnected();
        expect(sends.filter(row => row.quotedId === 'follow-a')).toHaveLength(1);
        expect((await store.getProcess(alpha.processId))?.metadata).toMatchObject({
            botControl: createBotControlMetadata('whatsapp'), workspaceId: 'ws-a', provider: originalProvider,
        });
        expect((await store.getProcess(beta.processId))?.metadata?.botControl).toEqual(createBotControlMetadata('whatsapp'));
    });
});
