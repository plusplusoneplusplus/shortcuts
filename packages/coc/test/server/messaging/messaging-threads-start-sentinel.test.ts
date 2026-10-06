/**
 * Phone threads start new chats as the sentinel dispatcher (AC-03).
 *
 * Drives the real `createExecutionServer` wiring: the WhatsApp router's
 * `enqueue` dep and the Teams handler's `enqueueChat` / `enqueueRelayChat`
 * deps, with `sentinel.enabled` both off and on. The queue is paused so the
 * first turn stays queued and its payload mode can be read back.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileProcessStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import type { CLIConfig } from '../../../src/config';

const captured = vi.hoisted(() => ({ whatsapp: undefined as any, teams: undefined as any }));

vi.mock('../../../src/server/messaging/whatsapp-command-router', async importOriginal => {
    const orig = await importOriginal<typeof import('../../../src/server/messaging/whatsapp-command-router')>();
    class CapturingRouter extends orig.WhatsAppCommandRouter {
        constructor(deps: ConstructorParameters<typeof orig.WhatsAppCommandRouter>[0]) {
            super(deps);
            captured.whatsapp = deps;
        }
    }
    return { ...orig, WhatsAppCommandRouter: CapturingRouter };
});

vi.mock('../../../src/server/messaging/teams-messaging-handler', async importOriginal => {
    const orig = await importOriginal<typeof import('../../../src/server/messaging/teams-messaging-handler')>();
    return {
        ...orig,
        registerTeamsMessagingRoutes: (...args: Parameters<typeof orig.registerTeamsMessagingRoutes>) => {
            captured.teams = args[1];
            return orig.registerTeamsMessagingRoutes(...args);
        },
    };
});

const GLOBAL = 'global-workspace-00';

describe('phone threads start chats in sentinel mode', () => {
    let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
    let dataDir: string | undefined;

    afterEach(async () => {
        await server?.close();
        server = undefined;
        if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
        dataDir = undefined;
    });

    async function start(sentinelEnabled: boolean) {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-sentinel-'));
        const { service } = createMockSDKService();
        server = await createExecutionServer({
            store: new FileProcessStore({ dataDir }), dataDir, port: 0, host: '127.0.0.1', aiService: service,
            fileConfig: { sentinel: { enabled: sentinelEnabled } } as CLIConfig,
        });
        const paused = await fetch(`${server.url}/api/queue/pause`, { method: 'POST' });
        expect(paused.ok).toBe(true);
    }

    async function queuedMode(taskId: string): Promise<string | undefined> {
        const res = await fetch(`${server!.url}/api/queue/${encodeURIComponent(taskId)}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { task?: { payload?: { mode?: string } } };
        return body.task?.payload?.mode;
    }

    for (const sentinelEnabled of [false, true]) {
        describe(`sentinel.enabled=${sentinelEnabled}`, () => {
            it('WhatsApp: a plain new-chat message queues a sentinel chat; a mode prefix keeps its mode', { timeout: 20_000 }, async () => {
                await start(sentinelEnabled);
                const plainId = 'wa-plain';
                await captured.whatsapp.enqueue(GLOBAL, 'hi', undefined, toQueueProcessId(plainId), plainId);
                expect(await queuedMode(plainId)).toBe('sentinel');

                const prefixedId = 'wa-autopilot';
                await captured.whatsapp.enqueue(GLOBAL, 'fix it', 'autopilot', toQueueProcessId(prefixedId), prefixedId);
                expect(await queuedMode(prefixedId)).toBe('autopilot');
            });

            it('Teams: plain new chats (ordinary and relay) queue sentinel chats; a mode prefix keeps its mode', { timeout: 20_000 }, async () => {
                await start(sentinelEnabled);
                const ordinaryId = await captured.teams.enqueueChat(GLOBAL, 'hi');
                expect(await queuedMode(ordinaryId)).toBe('sentinel');

                const relayId = await captured.teams.enqueueRelayChat(GLOBAL, 'hi', 'teams-relay');
                expect(await queuedMode(relayId)).toBe('sentinel');

                const askId = await captured.teams.enqueueChat(GLOBAL, 'just asking', 'ask');
                expect(await queuedMode(askId)).toBe('ask');
            });
        });
    }

    it('WhatsApp routes prepared first-turn and queued follow-up images through real server wiring', { timeout: 20_000 }, async () => {
        await start(false);
        const { WhatsAppCommandRouter } = await import('../../../src/server/messaging/whatsapp-command-router');
        const bindings = captured.whatsapp.bindings;
        const router = new WhatsAppCommandRouter({ ...captured.whatsapp,
            groupJid: () => 'group@g.us', send: async () => 'outbound', react: async () => {},
        });
        const bytes = Buffer.from('89504e470d0a1a0a010203', 'hex');
        const inbound = (messageId: string, text: string) => ({
            chatJid: 'group@g.us', senderJid: 'group@g.us', fromMe: true, messageId, text,
            images: [{ mimeType: 'image/png', download: async () => bytes }],
        });
        await router.handle(inbound('first-image', '/ask describe this'));
        await router.handle(inbound('next-image', '/autopilot compare this'));
        const rows = bindings.entries().filter((row: { inboundId: string }) => ['first-image', 'next-image'].includes(row.inboundId));
        expect(rows).toHaveLength(2);
        expect(rows[1].processId).toBe(rows[0].processId);
        for (const [index, row] of rows.entries()) {
            const res = await fetch(`${server!.url}/api/queue/${encodeURIComponent(row.taskId)}`);
            const { task } = await res.json() as { task: { payload: { mode: string; prompt: string; images: string[]; attachments: Array<{ path: string }>; imageTempDir: string; processId?: string } } };
            expect(task.payload.mode).toBe(index === 0 ? 'ask' : 'autopilot');
            expect(task.payload.prompt).toBe(index === 0 ? 'describe this' : 'compare this');
            expect(task.payload.attachments).toHaveLength(1);
            expect(fs.readFileSync(task.payload.attachments[0].path)).toEqual(bytes);
            expect(task.payload.imageTempDir).toContain(path.join(dataDir!, 'repos', GLOBAL, 'attachments'));
            // Queue summaries intentionally omit binary history; inspect the durable execution task.
            expect(captured.whatsapp.getTask(row.taskId).payload.images)
                .toEqual([`data:image/png;base64,${bytes.toString('base64')}`]);
            expect(task.payload.processId).toBe(index === 0 ? undefined : rows[0].processId);
        }
    });

    it('Teams routes first, pending and active follow-up images through real server callbacks', { timeout: 20_000 }, async () => {
        await start(false);
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const { TeamsMessagingManager } = await import('../../../src/server/messaging/teams-messaging-manager');
        const manager = new TeamsMessagingManager(dataDir!);
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId: 'team', channelId: 'channel',
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(manager, 'sendMessage').mockResolvedValue('outbound');
        let handle!: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) => Promise<void>;
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => { handle = msg => handler(msg); });
        const deps = captured.teams;
        registerTeamsMessagingRoutes([], { ...deps, manager,
            getAnswerRelayEnabled: () => true, getBotManagedConversationsEnabled: () => false,
        });
        const bytes = Buffer.from('89504e470d0a1a0a010203', 'hex');
        const inbound = (messageId: string, text: string) => ({
            channelId: 'channel', messageId, text, senderAadId: 'sender',
            images: [{ mimeType: 'image/png', download: async () => bytes }],
        });
        try {
            await handle(inbound('teams-first', '/ask describe this'));
            const initial = deps.relayQueue.getAll()[0];
            await handle(inbound('teams-pending', '/autopilot compare this'));
            await deps.store.addProcess({
                id: initial.processId, type: 'chat', status: 'completed', startTime: new Date(),
                promptPreview: 'describe this', fullPrompt: 'describe this',
                metadata: { workspaceId: GLOBAL, queueTaskId: initial.id, mode: 'ask' },
            });
            await handle(inbound('teams-active', `/autopilot [${initial.processId}] inspect again`));
            const tasks = deps.relayQueue.getAll();
            expect(tasks).toHaveLength(3);
            for (const [index, task] of tasks.entries()) {
                expect(task.repoId).toBe(GLOBAL);
                expect(task.payload.mode).toBe(index === 0 ? 'ask' : 'autopilot');
                expect(task.payload.prompt).toBe(['describe this', 'compare this', 'inspect again'][index]);
                expect(task.payload.processId).toBe(index === 0 ? undefined : initial.processId);
                expect(task.payload.attachments).toHaveLength(1);
                expect(fs.readFileSync(task.payload.attachments[0].path)).toEqual(bytes);
                expect(task.payload.images).toEqual([`data:image/png;base64,${bytes.toString('base64')}`]);
                expect(task.payload.imageTempDir).toContain(path.join(dataDir!, 'repos', GLOBAL, 'attachments'));
            }
        } finally {
            manager.dispose();
            vi.restoreAllMocks();
        }
    });

    it('both connectors admit real image handoffs from a queued sentinel with notices and stable selection', { timeout: 20_000 }, async () => {
        await start(false);
        const { WhatsAppCommandRouter } = await import('../../../src/server/messaging/whatsapp-command-router');
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const { TeamsMessagingManager } = await import('../../../src/server/messaging/teams-messaging-manager');
        const { TeamsUserStateStore } = await import('../../../src/server/messaging/teams-user-state');
        const waDeps = captured.whatsapp; const teamsDeps = captured.teams;
        const sentinelId = 'image-sentinel'; const parent = toQueueProcessId(sentinelId);
        await waDeps.enqueue(GLOBAL, 'dispatch', undefined, parent, sentinelId);
        waDeps.bindings.add({ groupJid: 'group@g.us', workspaceId: GLOBAL, processId: parent, taskId: sentinelId,
            inboundId: 'sentinel-origin', outboundIds: [], nextPart: 0, status: 'queued' });
        waDeps.bindings.selectTopic(GLOBAL, parent);
        const bytes = Buffer.from('89504e470d0a1a0a010203', 'hex');
        const images = () => [{ mimeType: 'image/png', download: async () => bytes }];
        const router = new WhatsAppCommandRouter({ ...waDeps, groupJid: () => 'group@g.us', send: async () => 'outbound', react: async () => {} });
        await router.handle({ chatJid: 'group@g.us', senderJid: 'group@g.us', fromMe: true,
            messageId: 'wa-handoff', text: '/ask inspect WA', images: images() });
        expect(waDeps.bindings.topic(GLOBAL)).toBe(parent);
        new TeamsUserStateStore(dataDir!).update('sender', { selectedRepo: GLOBAL, selectedTopic: null, lastActiveTopic: null });
        const manager = new TeamsMessagingManager(dataDir!);
        vi.spyOn(manager, 'getStatus').mockReturnValue({ enabled: true, status: 'connected', teamId: 'team', channelId: 'channel',
            botName: 'CoC', error: null, serverUrl: null, authStatus: null });
        vi.spyOn(manager, 'sendMessage').mockResolvedValue('teams-outbound');
        let handle!: (msg: import('@plusplusoneplusplus/coc-connector/teams').InboundTeamsMessage) => Promise<void>;
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => { handle = msg => handler(msg); });
        registerTeamsMessagingRoutes([], { ...teamsDeps, manager, getAnswerRelayEnabled: () => true, getBotManagedConversationsEnabled: () => false });
        try {
            await handle({ channelId: 'channel', senderAadId: 'sender', messageId: 'teams-sentinel', text: '/sentinel dispatch' });
            const teamsParent = teamsDeps.relayQueue.getAll().find((task: any) => task.payload.prompt === 'dispatch' && task.id !== sentinelId).processId;
            await handle({ channelId: 'channel', senderAadId: 'sender', messageId: 'teams-handoff', text: '/autopilot inspect Teams', images: images() });
            // The handoff receipt preserves the queued sentinel's identity for later replies.
            await handle({ channelId: 'channel', senderAadId: 'sender', messageId: 'teams-continue', replyToMessageId: 'teams-handoff', text: 'continue' });
            const jobs = teamsDeps.relayQueue.getAll().filter((task: any) => task.payload.context?.messagingOrigin);
            expect(jobs).toHaveLength(2);
            for (const task of jobs) {
                expect(task.payload.context.spawnedFromProcessId).toBe(task.payload.context.messagingOrigin.connector === 'teams' ? teamsParent : parent);
                expect(task.payload.images).toEqual([`data:image/png;base64,${bytes.toString('base64')}`]);
                expect(fs.readFileSync(task.payload.attachments[0].path)).toEqual(bytes);
                expect(task.payload.imageTempDir).toContain(path.join(dataDir!, 'repos', GLOBAL, 'attachments'));
            }
            const continuation = teamsDeps.relayQueue.getAll().find((task: any) => task.payload.prompt === 'continue');
            expect(continuation?.processId).toBe(teamsParent);
            expect(new TeamsUserStateStore(dataDir!).get('sender').lastActiveTopic).toBe(teamsParent);
            const ledger = JSON.parse(fs.readFileSync(path.join(dataDir!, 'repos', GLOBAL, 'messaging-job-notices.json'), 'utf8'));
            expect(ledger).toHaveLength(2);
            expect(ledger.map((entry: any) => entry.origin.connector).sort()).toEqual(['teams', 'whatsapp']);
        } finally { manager.dispose(); vi.restoreAllMocks(); }
    });

    it('both connectors share one hand-off that queues a tracked job from a queued sentinel', { timeout: 20_000 }, async () => {
        await start(false);
        expect(captured.teams.handOff).toBe(captured.whatsapp.handOff);
        const sentinelId = 'wa-sentinel';
        await captured.whatsapp.enqueue(GLOBAL, 'hi', undefined, toQueueProcessId(sentinelId), sentinelId);
        const target = await captured.whatsapp.handOff.resolve(toQueueProcessId(sentinelId), 'autopilot');
        expect(target).toEqual({ mode: 'autopilot', workspaceId: GLOBAL, parentProcessId: toQueueProcessId(sentinelId) });

        const origin = { connector: 'whatsapp', chatKey: 'group@g.us' };
        const jobId = await captured.whatsapp.handOff.start(target, 'fix it', origin);
        const res = await fetch(`${server!.url}/api/queue/${encodeURIComponent(jobId.replace(/^queue_/, ''))}`);
        const body = await res.json() as { task?: { payload?: Record<string, unknown> } };
        expect(body.task?.payload).toMatchObject({ mode: 'autopilot', prompt: 'fix it',
            context: { spawnedFromProcessId: toQueueProcessId(sentinelId), messagingOrigin: origin } });
        const ledger = JSON.parse(fs.readFileSync(path.join(dataDir!, 'repos', GLOBAL, 'messaging-job-notices.json'), 'utf8'));
        expect(ledger).toEqual([expect.objectContaining({ processId: jobId, origin })]);
    });
});
