import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { FileProcessStore, RepoQueueRegistry, toQueueProcessId, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import { SentinelMirrorService } from '../../../src/server/messaging/sentinel-mirror-service';
import { createTeamsMirrorAdapter, createWhatsAppMirrorAdapter } from '../../../src/server/messaging/sentinel-mirror-adapters';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppAnswerRelay } from '../../../src/server/messaging/whatsapp-answer-relay';
import { WhatsAppMessagingManager } from '../../../src/server/messaging/whatsapp-messaging-manager';
import { TeamsAnswerRelay } from '../../../src/server/messaging/teams-answer-relay';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { registerApiProcessRoutes } from '../../../src/server/routes/api-process-routes';
import type { Route } from '../../../src/server/types';

async function invoke(route: Route, url: string, body: unknown): Promise<number> {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
        url, method: route.method ?? 'POST', headers: {},
    }) as IncomingMessage;
    let status = 0;
    const res = { writeHead: (code: number) => { status = code; }, end: () => {}, setHeader: () => {} } as unknown as ServerResponse;
    await route.handler(req, res, url.split('?')[0].match(route.pattern as RegExp)!);
    return status;
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 300; i++) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out awaiting durable queue completion');
}

describe.each(['whatsapp', 'teams'] as const)('Sentinel mirror real queue integration (%s)', connector => {
    it('mirrors canonical desktop admissions/finals and independently cancels buffered/queued requests without connector echoes', { timeout: 20_000 }, async () => {
        const directory = fs.mkdtempSync(path.join(process.cwd(), '.sentinel-queue-test-'));
        const store = new FileProcessStore({ dataDir: directory });
        await store.registerWorkspace({ id: 'workspace-a', rootPath: directory, name: 'Workspace A' });
        const ai = createMockSDKService();
        let release!: () => void;
        const firstGate = new Promise<void>(resolve => { release = resolve; });
        let releaseDrain!: () => void;
        const drainGate = new Promise<void>(resolve => { releaseDrain = resolve; });
        const entered: string[] = [];
        ai.mockSendMessage.mockImplementation(async ({ prompt }: { prompt: string }) => {
            const last = prompt.trimEnd().split('\n').at(-1)!;
            entered.push(last);
            if (last === 'connector initial') await firstGate;
            return { success: true, response: `Final answer for ${last}`, sessionId: 'synthetic-session' };
        });
        const registry = new RepoQueueRegistry();
        const queue = new MultiRepoQueueRouter(registry, store, {
            aiService: ai.service, dataDir: directory, autoStart: false,
            followUpSuggestions: { enabled: false, count: 0 },
        });
        queue.registerRepoId('workspace-a', directory);
        const facade = queue.createAggregateQueueFacade();
        const sends: Array<{ id: string; text: string; root?: string }> = [];
        let connected = true;
        const send = vi.fn(async (text: string, root?: string) => {
            const id = `out-${sends.length + 1}`;
            sends.push({ id, text, root });
            return id;
        });
        const bindings = new WhatsAppBindings(directory);
        await bindings.restore(store);
        let teamsRelay: TeamsAnswerRelay | undefined;
        let whatsappRelay: WhatsAppAnswerRelay | undefined;
        let mirror: SentinelMirrorService | undefined;
        try {
            const enqueueOrigin = (id: string) => queue.enqueue({
                id, processId: toQueueProcessId(id), type: 'chat', repoId: 'workspace-a', priority: 'normal',
                botControl: createBotControlMetadata(connector),
                payload: { kind: 'chat', mode: 'sentinel', workspaceId: 'workspace-a', prompt: 'connector initial',
                    ...(connector === 'whatsapp' ? { relayRequestId: id } : {}) },
                config: {},
            });
            let originId: string;
            let adapter;
            if (connector === 'teams') {
                const manager = new TeamsMessagingManager(directory);
                vi.spyOn(manager, 'getStatus').mockImplementation(() => ({
                    connectionId: 'connection', enabled: true, status: connected ? 'connected' : 'disconnected', teamId: 'team', channelId: 'channel',
                    botName: 'CoC', error: null, serverUrl: null, authStatus: null, channelReadBackend: 'graph',
                    outboundBackend: 'graph', enableTrouter: false, notificationStatus: { state: 'disabled', error: null },
                }));
                vi.spyOn(manager, 'getMirrorAccountKey').mockReturnValue('synthetic-account');
                vi.spyOn(manager, 'sendMessage').mockImplementation((text, root) => send(text, root));
                teamsRelay = new TeamsAnswerRelay({
                    dataDir: directory, store, queue: facade, isEnabled: () => true,
                    target: () => ({ connected: true, teamId: 'team', channelId: 'channel' }), send,
                });
                manager.setAnswerRelay(teamsRelay);
                originId = (await teamsRelay.admitNew({ messageId: 'root', channelId: 'channel', text: 'connector initial' },
                    'workspace-a', enqueueOrigin)).taskId;
                await teamsRelay.acknowledged(originId);
                adapter = createTeamsMirrorAdapter(manager);
            } else {
                const manager = new WhatsAppMessagingManager(directory);
                vi.spyOn(manager, 'getStatus').mockImplementation(() => ({
                    enabled: true, status: connected ? 'connected' : 'disconnected', groupJid: 'bound@g.us', groupName: 'Group',
                    deviceName: 'CoC', qr: null, error: null,
                }));
                vi.spyOn(manager, 'getMirrorAccountKey').mockReturnValue('synthetic-account');
                vi.spyOn(manager, 'sendTo').mockImplementation((_jid, text, root) => send(text, root));
                originId = 'connector-origin';
                bindings.add({
                    groupJid: 'bound@g.us', workspaceId: 'workspace-a', processId: toQueueProcessId(originId),
                    taskId: originId, inboundId: 'root', outboundIds: [], nextPart: 0, status: 'queued',
                });
                await enqueueOrigin(originId);
                whatsappRelay = new WhatsAppAnswerRelay({
                    bindings, store, queue: facade, connected: () => true, groupJid: () => 'bound@g.us',
                    send: (text, root) => send(text, root),
                });
                adapter = createWhatsAppMirrorAdapter(manager, bindings);
            }
            const processId = toQueueProcessId(originId);
            mirror = new SentinelMirrorService({ dataDir: directory, store, queue: facade, enabled: () => true, adapters: [adapter] });
            mirror.start();
            queue.activateQueueProcessing();
            await until(() => entered.includes('connector initial'));
            const routes: Route[] = [];
            registerApiProcessRoutes({
                routes, store, bridge: queue, gitOpsStore: {} as never, getSentinelMirror: () => mirror,
            });
            const pendingPost = routes.find(route => route.method === 'POST'
                && String(route.pattern) === String(/^\/api\/processes\/([^/]+)\/pending-messages$/))!;
            const pendingDelete = routes.find(route => route.method === 'DELETE'
                && String(route.pattern) === String(/^\/api\/processes\/([^/]+)\/pending-messages\/([^/]+)$/))!;
            connected = false;
            const pendingUrl = `/api/processes/${processId}/pending-messages`;
            expect(await invoke(pendingPost, `${pendingUrl}?workspace=workspace-a`,
                { content: 'deleted legacy buffered request', mode: 'sentinel' })).toBe(201);
            const deleted = (await store.getProcess(processId))!.pendingMessages![0];
            expect(await invoke(pendingDelete, `${pendingUrl}/${deleted.id}?workspace=workspace-a`, {})).toBe(204);
            connected = true;
            const delivery = new ProcessMessageDeliveryService({ store, bridge: queue, sentinelMirror: mirror });
            const buffered = await delivery.deliver((await store.getProcess(processId, 'workspace-a'))!, {
                origin: 'desktop', content: 'desktop buffered', displayContent: 'desktop buffered',
                mode: 'sentinel', deliveryMode: 'enqueue', pasteExternalized: false, provider: 'copilot',
            });
            expect(buffered.path).toBe('buffered');
            await mirror.flush();
            expect(entered).toEqual(['connector initial']);
            expect(sends.filter(row => row.text.includes('desktop buffered'))).toHaveLength(1);
            const pending = (await store.getProcess(processId))!.pendingMessages![0];
            expect(pending.id).toBe(pending.relayRequestId);
            let drainEntered!: () => void;
            const enteredDrain = new Promise<void>(resolve => { drainEntered = resolve; });
            const append = store.appendConversationTurn.bind(store);
            vi.spyOn(store, 'appendConversationTurn').mockImplementation(async (...args) => {
                const result = await append(...args);
                if (result?.turn.role === 'user' && result.turn.relayRequestId === pending.relayRequestId) {
                    drainEntered();
                    await drainGate;
                }
                return result;
            });
            release();
            await enteredDrain;
            const drainingParent = (await store.getProcess(processId))!;
            expect(drainingParent.status).toBe('completed');
            expect(drainingParent.pendingMessages?.some(message => message.relayRequestId === pending.relayRequestId)).toBe(true);
            const drainedUser = drainingParent.conversationTurns!.find(turn => turn.relayRequestId === pending.relayRequestId)!;
            expect(new Date(drainedUser.timestamp).getTime()).toBe(new Date(pending.createdAt).getTime());
            expect(new Date(drainingParent.endTime!).getTime()).toBeGreaterThanOrEqual(new Date(pending.createdAt).getTime());
            expect(facade.getTask(pending.id!)).toBeUndefined();
            await mirror.flush();
            await mirror.flush();
            expect(mirror.outbox.list('workspace-a').some(row => row.role === 'assistant'
                && row.requestId === pending.relayRequestId)).toBe(false);
            releaseDrain();
            await until(() => facade.getTask(pending.id!)?.status === 'completed');
            await mirror.flush();
            await mirror.flush();
            expect(sends.filter(row => row.text.includes('Final answer for desktop buffered'))).toHaveLength(1);
            expect(sends.filter(row => row.text.includes('Final answer for connector initial'))).toHaveLength(1);
            const task: CreateTaskInput = {
                type: 'chat', processId, repoId: 'workspace-a', priority: 'normal', config: {},
                payload: { kind: 'chat', mode: 'sentinel', processId, workspaceId: 'workspace-a', prompt: 'desktop initial queue' },
            };
            const intent = await mirror.captureTask(task);
            expect(intent).toBeDefined();
            await queue.enqueue(task);
            mirror.accepted(intent!);
            await until(() => facade.getTask(task.id!)?.status === 'completed');
            await mirror.flush();
            await mirror.flush();
            expect(sends.filter(row => row.text.includes('Final answer for desktop initial queue'))).toHaveLength(1);
            expect(sends).toHaveLength(5);
            for (const outbound of sends.filter(row => row.text.includes('Desktop'))) {
                if (connector === 'teams') expect(teamsRelay!.isOwnReply('team', {
                    messageId: outbound.id, channelId: 'channel', replyToMessageId: 'root', text: outbound.text,
                })).toBe(true);
                else expect(bindings.isKnownMessage(outbound.id)).toBe(true);
            }
            registry.getQueueForRepo(directory).emit('taskCompleted', facade.getTask(task.id!)!);
            await mirror.flush();
            expect(sends).toHaveLength(5);
            expect(entered).not.toContain('deleted legacy buffered request');
            expect(sends.some(row => row.text.includes('deleted legacy buffered request'))).toBe(false);

            const manager = registry.getQueueForRepo(directory);
            manager.pause();
            connected = false;
            const enqueueDesktop = async (prompt: string) => {
                const input: CreateTaskInput = {
                    type: 'chat', processId, repoId: 'workspace-a', priority: 'normal', config: {},
                    payload: { kind: 'chat', mode: 'sentinel', processId, workspaceId: 'workspace-a', prompt },
                };
                const receipt = (await mirror!.captureTask(input))!;
                await queue.enqueue(input);
                mirror!.accepted(receipt);
                return input;
            };
            const cancelled = await enqueueDesktop('cancelled queued request');
            const retained = await enqueueDesktop('retained queued request');
            expect(queue.cancelQueuedTask(cancelled.id!)).toBe(true);
            await mirror.flush();
            connected = true;
            manager.resume();
            await until(() => facade.getTask(retained.id!)?.status === 'completed');
            await mirror.flush();
            await mirror.flush();
            expect(entered).not.toContain('cancelled queued request');
            expect(sends.some(row => row.text.includes('cancelled queued request'))).toBe(false);
            expect(sends.filter(row => row.text.includes('Final answer for retained queued request'))).toHaveLength(1);
            expect(sends).toHaveLength(7);
        } finally {
            release();
            releaseDrain();
            mirror?.dispose();
            teamsRelay?.dispose();
            whatsappRelay?.dispose();
            queue.dispose();
            vi.restoreAllMocks();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
