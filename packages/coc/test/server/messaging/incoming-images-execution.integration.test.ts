import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCipheriv, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import axios from 'axios';
import { getMediaKeys, proto } from '@whiskeysockets/baileys';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, toQueueProcessId, type SendMessageOptions } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import type { InboundWAMessage, WASocket } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBot } from '../../../../coc-connector/src/whatsapp/bot';
import { createBaileysConnection } from '../../../../coc-connector/src/whatsapp/connection';
import { GraphChannelReader } from '../../../../coc-connector/src/teams/graph/channel-reader';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter } from '../../../src/server/messaging/whatsapp-command-router';
import { WhatsAppAnswerRelay } from '../../../src/server/messaging/whatsapp-answer-relay';
import { incomingImageTaskPayload } from '../../../src/server/messaging/incoming-images';
import { createMessagingHandOff } from '../../../src/server/messaging/job-handoff';
import { PENDING_IMAGE_TTL_MS } from '../../../src/server/messaging/pending-images';
import { CHAT_IMAGE_FAILURE_TEXT } from '../../../src/server/executors/chat-image-policy';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { getRepoDataPath } from '../../../src/server/paths';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('../../../../coc-connector/src/whatsapp/connection', () => ({ createBaileysConnection: vi.fn() }));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const IMAGE_URL = `data:image/png;base64,${PNG.toString('base64')}`;
const GROUP = 'group@g.us';
const cleanup: Array<() => void | Promise<void>> = [];
type Deliver = (id: string, text: string, images?: boolean | number, replyTo?: string, sender?: string) => Promise<void>;

afterEach(async () => {
    for (const stop of cleanup.splice(0).reverse()) await stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function whatsappTransport(dataDir: string, handle: (msg: InboundWAMessage) => Promise<void>) {
    let onUpsert: ((...args: unknown[]) => void) | undefined;
    let handling = Promise.resolve();
    const socket: WASocket = {
        ev: { on: (event, listener) => { if (event === 'messages.upsert') onUpsert = listener; } },
        sendMessage: vi.fn(async () => ({ key: { id: 'outbound' } })),
        groupCreate: vi.fn(async () => ({ id: GROUP })),
        groupFetchAllParticipating: vi.fn(async () => ({})),
        end: vi.fn(),
    };
    vi.mocked(createBaileysConnection).mockImplementation(async options => {
        options.onConnected(socket);
        return socket;
    });
    const bot = new WhatsAppBot({
        sessionDir: path.join(dataDir, 'test-session'), printQR: false, receiveImages: true,
        onMessage: msg => { handling = handle(msg); return handling; },
    });
    cleanup.push(() => bot.stop());
    await bot.start();
    const mediaKey = Buffer.alloc(32, 7);
    const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, 'image');
    const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
    const encrypted = Buffer.concat([cipher.update(PNG), cipher.final()]);
    const mac = createHmac('sha256', macKey).update(iv).update(encrypted).digest().subarray(0, 10);
    let failing = false;
    let stalling = false;
    const http = vi.spyOn(axios, 'get').mockImplementation(async () => {
        if (stalling) return new Promise<never>(() => {});
        if (failing) throw new Error('Transport fixture credentials must not reach the user');
        return { data: Readable.from([Buffer.concat([encrypted, mac])]) };
    });
    const deliver: Deliver = async (id, text, images = false, replyTo, sender = 'sender') => {
        const contextInfo = replyTo ? { stanzaId: replyTo } : undefined;
        const message = images ? { imageMessage: proto.Message.ImageMessage.fromObject({
            caption: text, mimetype: 'image/png', mediaKey, fileLength: PNG.length,
            directPath: '/v/t62.7118-24/image.enc', contextInfo,
        }) } : { extendedTextMessage: { text, contextInfo } };
        if (!onUpsert) throw new Error('Test connection has no inbound listener');
        await onUpsert({ type: 'notify', messages: [{
            key: { id, remoteJid: GROUP, participant: `${sender}@s.whatsapp.net`, fromMe: sender === 'sender' }, message,
        }] });
        await handling;
    };
    return { deliver, downloadCount: () => http.mock.calls.length,
        failDownloads: (value: boolean) => { failing = value; },
        stallDownloads: (value: boolean) => { stalling = value; },
        cancelDownloads: (): void | Promise<void> => bot.stop() };
}

async function teamsTransport(handle: (msg: InboundTeamsMessage) => Promise<void>) {
    const account = { tenantId: 'tenant', objectId: 'reader' };
    const token = 'header.' + Buffer.from(JSON.stringify({
        tid: account.tenantId, oid: account.objectId, aud: 'https://graph.microsoft.com',
        scp: 'ChannelMessage.Read.All', exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url') + '.signature';
    const reader = new GraphChannelReader(account, { acquireToken: async () => token }, true);
    cleanup.push(() => reader.stop());
    await reader.initialize();
    let native: Record<string, unknown>;
    let downloads = 0;
    const downloadUrls: string[] = [];
    let failing = false;
    let stalling = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
        const address = String(url);
        expect(new URL(address).origin).toBe('https://graph.microsoft.com');
        expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
        if (address.endsWith('/$value')) {
            expect(init?.redirect).toBe('error');
            downloads++;
            downloadUrls.push(address);
            if (stalling) return new Promise<never>(() => {});
            if (failing) return new Response('Transport fixture credentials must not reach the user', { status: 500 });
            return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
        }
        return new Response(JSON.stringify({ value: [native] }));
    }));
    const deliver: Deliver = async (id, text, images = false, replyTo, sender = 'sender') => {
        const count = typeof images === 'number' ? images : images ? 1 : 0;
        const html = Array.from({ length: count }, (_, index) => `<img src="../hostedContents/image-${index}/$value">`).join('');
        native = { id, createdDateTime: new Date().toISOString(), from: { user: { id: sender, displayName: 'Person' } },
            body: { contentType: 'html', content: `<p>${text}${html}</p>` } };
        const page = await reader.page('team', 'channel', replyTo);
        await handle(page.messages[0]);
    };
    return { deliver, downloadUrls, downloadCount: () => downloads,
        failDownloads: (value: boolean) => { failing = value; },
        stallDownloads: (value: boolean) => { stalling = value; },
        cancelDownloads: () => reader.stop() };
}

async function harness(platform: 'whatsapp' | 'teams', provider: 'copilot' | 'opencode' = 'copilot', vision = true) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incoming-execution-'));
    cleanup.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
    cleanup.push(() => store.close());
    for (const id of ['ws-a', 'ws-b']) {
        const rootPath = path.join(dataDir, id);
        fs.mkdirSync(rootPath);
        await store.registerWorkspace({ id, name: id, rootPath });
        if (provider === 'copilot') writeRepoPreferences(dataDir, id, { defaultModel: 'gpt-4.1' });
    }
    const ai = createMockSDKService({ listModelsResult: [{
        id: 'gpt-4.1', name: 'Fixture model',
        capabilities: { supports: { vision, reasoningEffort: false }, limits: { max_context_window_tokens: 0 } },
    }] });
    const received: Array<{ prompt: string; bytes: Buffer[]; paths: string[] }> = [];
    ai.mockSendMessage.mockImplementation(async (options: SendMessageOptions) => {
        received.push({ prompt: options.prompt,
            bytes: options.attachments?.map(attachment => fs.readFileSync(attachment.path)) ?? [],
            paths: options.attachments?.map(attachment => attachment.path) ?? [] });
        return { success: true, response: 'Image received', sessionId: 'test-session' };
    });
    const queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
        aiService: ai.service, dataDir, provider, autoStart: false, followUpSuggestions: { enabled: false, count: 0 },
    });
    cleanup.push(() => queue.dispose());
    for (const workspace of await store.getWorkspaces()) queue.registerRepoId(workspace.id, workspace.rootPath!);
    const facade = queue.createAggregateQueueFacade();
    const sends: string[] = [];
    const questions = { register: vi.fn(), tryAnswer: vi.fn(async () => false) };
    const handOff = createMessagingHandOff({
        store, queue: facade, enqueue: input => queue.enqueue(input), jobNotices: { track: vi.fn() },
    });
    let transport: Awaited<ReturnType<typeof whatsappTransport>>;
    let disconnect: () => void;
    if (platform === 'whatsapp') {
        const bindings = new WhatsAppBindings(dataDir);
        await bindings.restore(store);
        const send = vi.fn(async (text: string) => { sends.push(text); return `out-${sends.length}`; });
        const relay = new WhatsAppAnswerRelay({ bindings, store, queue: facade, connected: () => true, groupJid: () => GROUP, send });
        cleanup.push(() => relay.dispose());
        const router = new WhatsAppCommandRouter({
            dataDir, bindings, store, groupJid: () => GROUP, getTask: id => facade.getTask(id),
            send, react: vi.fn(async () => {}),
            questions,
            handOff,
            enqueue: (workspaceId, prompt, mode, processId, id, botControl, images) => queue.enqueue({
                id, processId, botControl, type: 'chat', repoId: workspaceId, priority: 'normal', config: {},
                payload: { kind: 'chat', prompt, mode: mode ?? 'ask', workspaceId, relayRequestId: id,
                    ...(processId !== toQueueProcessId(id) ? { processId } : {}), ...incomingImageTaskPayload(images) },
            }),
        });
        cleanup.push(() => router.dispose());
        disconnect = () => router.resetPendingImages();
        transport = await whatsappTransport(dataDir, msg => router.handle(msg));
    } else {
        const manager = new TeamsMessagingManager(dataDir);
        cleanup.push(() => manager.dispose());
        disconnect = () => { void manager.disconnect(); };
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId: 'team', channelId: 'channel',
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(manager, 'sendMessage').mockImplementation(async text => { sends.push(text); return `out-${sends.length}`; });
        let handle!: (msg: InboundTeamsMessage) => Promise<void>;
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => { handle = msg => handler(msg, () => {}); });
        registerTeamsMessagingRoutes([], {
            dataDir, store, manager, relayQueue: facade, getAnswerRelayEnabled: () => true,
            questionRelay: questions,
            handOff,
            getBotManagedConversationsEnabled: () => false,
            enqueueChat: async () => { throw new Error('Expected admitted image turn'); },
            executeFollowUp: async () => { throw new Error('Expected admitted image follow-up'); },
            enqueueRelayChat: (workspaceId, prompt, id, mode, botControl, images) => queue.enqueue({
                id, processId: toQueueProcessId(id), botControl, type: 'chat', repoId: workspaceId, priority: 'normal', config: {},
                payload: { kind: 'chat', prompt, mode: mode ?? 'ask', workspaceId, ...incomingImageTaskPayload(images) },
            }),
            admitRelayFollowUp: async (process, prompt, requestId, mode, id, images) => ({ taskId: await queue.enqueue({
                id, processId: process.id, type: 'chat', repoId: String(process.metadata.workspaceId), priority: 'normal', config: {},
                payload: { kind: 'chat', prompt, mode: mode ?? 'ask', workspaceId: process.metadata.workspaceId,
                    processId: process.id, relayRequestId: requestId, ...incomingImageTaskPayload(images) },
            }) }),
            enqueuePendingRelayFollowUp: (workspaceId, processId, prompt, requestId, mode, id, images) => queue.enqueue({
                id, processId, type: 'chat', repoId: workspaceId, priority: 'normal', config: {},
                payload: { kind: 'chat', prompt, mode: mode ?? 'ask', workspaceId,
                    processId, relayRequestId: requestId, ...incomingImageTaskPayload(images) },
            }),
        });
        transport = await teamsTransport(msg => handle(msg));
    }
    await transport.deliver('select', '/select repo ws-a');
    const settle = async () => {
        queue.activateQueueProcessing();
        await vi.waitFor(() => expect(facade.getAll().every(task => ['completed', 'failed'].includes(task.status))).toBe(true), { timeout: 10_000 });
    };
    return { dataDir, store, queue, facade, received, sends, questions, disconnect, settle, ...transport };
}

describe.each(['whatsapp', 'teams'] as const)('%s native images through execution and recorded chat', platform => {
    it.each([false, true])('preserves first and follow-up attachments (await instructions=%s)', { timeout: 20_000 }, async captionless => {
        const ctx = await harness(platform);
        if (captionless) {
            await ctx.deliver('image-first', '', true);
            expect(ctx.facade.getAll()).toHaveLength(0);
            expect(ctx.downloadCount()).toBe(0);
            expect(ctx.sends.at(-1)).toMatch(/instructions|what would you like/i);
            await ctx.deliver('first', '/ask describe the image');
        } else await ctx.deliver('first', '/ask describe the image', true);
        const initial = ctx.facade.getAll()[0];
        expect(initial.payload).toMatchObject({ mode: 'ask', images: [IMAGE_URL], attachments: [expect.objectContaining({ type: 'file' })] });
        await ctx.settle();
        if (captionless) {
            await ctx.deliver('image-follow', '', true, 'first');
            expect(ctx.received).toHaveLength(1);
            await ctx.deliver('follow', '/autopilot compare the image', false, 'first');
        } else await ctx.deliver('follow', '/autopilot compare the image', true, 'first');
        await ctx.settle();
        const follow = ctx.facade.getAll().find(task => task.id !== initial.id)!;
        expect(follow).toMatchObject({ repoId: 'ws-a', processId: initial.processId, payload: { mode: 'autopilot' } });
        expect(ctx.received).toHaveLength(2);
        expect(ctx.received.map(turn => turn.bytes)).toEqual([[PNG], [PNG]]);
        expect(ctx.received[0].prompt).toContain('describe the image');
        expect(ctx.received[1].prompt).toContain('compare the image');
        for (const turn of ctx.received) {
            expect(path.dirname(path.dirname(turn.paths[0]))).toBe(getRepoDataPath(ctx.dataDir, 'ws-a', 'attachments'));
            expect(fs.existsSync(turn.paths[0])).toBe(false);
        }
        const userTurns = (await ctx.store.getProcess(initial.processId!))?.conversationTurns?.filter(turn => turn.role === 'user');
        expect(userTurns?.map(turn => turn.content)).toEqual([expect.stringContaining('describe the image'), 'compare the image']);
        expect(userTurns?.map(turn => turn.images)).toEqual([[IMAGE_URL], [IMAGE_URL]]);
        expect(ctx.downloadCount()).toBe(2);
        expect(fs.existsSync(getRepoDataPath(ctx.dataDir, 'ws-b', 'attachments'))).toBe(false);
        await ctx.deliver(captionless ? 'image-follow' : 'follow', captionless ? '' : '/autopilot compare the image', true, 'first');
        expect(ctx.facade.getAll()).toHaveLength(2);
        expect(ctx.downloadCount()).toBe(2);
    });

    it('returns safe unsupported-provider feedback without an image-less SDK turn', { timeout: 20_000 }, async () => {
        const ctx = await harness(platform, 'opencode');
        await ctx.deliver('first', '/ask describe the image', true);
        await ctx.settle();
        expect(ctx.facade.getAll()[0].status).toBe('failed');
        expect(ctx.received).toEqual([]);
        await vi.waitFor(() => expect(ctx.sends.some(text => text.includes(CHAT_IMAGE_FAILURE_TEXT.provider))).toBe(true));
        expect(fs.readdirSync(getRepoDataPath(ctx.dataDir, 'ws-a', 'attachments'))).toEqual([]);
    });

    it.each([false, true])('returns safe non-vision-model feedback without SDK image execution (follow-up=%s)', { timeout: 20_000 }, async followUp => {
        const ctx = await harness(platform, 'copilot', false);
        if (followUp) {
            await ctx.deliver('seed', '/ask text-only request');
            await ctx.settle();
            expect(ctx.received).toHaveLength(1);
        }
        await ctx.deliver('image', '/ask describe the image', true, followUp ? 'seed' : undefined);
        await ctx.settle();
        const imageTask = ctx.facade.getAll().find(task => task.payload.prompt === 'describe the image')!;
        expect((await ctx.store.getProcess(imageTask.processId!))?.status).toBe('failed');
        expect(ctx.received).toHaveLength(followUp ? 1 : 0);
        await vi.waitFor(() => expect(ctx.sends.some(text => text.includes(CHAT_IMAGE_FAILURE_TEXT.model))).toBe(true));
        expect(fs.readdirSync(getRepoDataPath(ctx.dataDir, 'ws-a', 'attachments'))).toEqual([]);
    });

    it.each(['missing-file', 'changed-file', 'missing-blob', 'corrupt-blob', 'invalid-history', 'empty-attachments', 'other-workspace'] as const)(
        'rejects %s before initial and resumed SDK image execution', { timeout: 30_000 }, async damage => {
            for (const followUp of [false, true]) {
                const ctx = await harness(platform);
                if (followUp) {
                    await ctx.deliver('seed', '/ask text-only request');
                    await ctx.settle();
                    ctx.facade.pause();
                }
                await ctx.deliver('image', '/ask describe the image', true, followUp ? 'seed' : undefined);
                const task = ctx.facade.getAll().find(task => task.payload.prompt === 'describe the image')!;
                const payload = task.payload as any;
                const file = payload.attachments[0].path;
                if (damage === 'missing-file') fs.unlinkSync(file);
                if (damage === 'changed-file') fs.writeFileSync(file, Buffer.from('not an image'));
                if (damage === 'missing-blob' || damage === 'corrupt-blob') {
                    payload.images = [];
                    payload.imagesFilePath = path.join(ctx.dataDir, 'damaged-images.json');
                    if (damage === 'corrupt-blob') fs.writeFileSync(payload.imagesFilePath, '{bad json');
                }
                if (damage === 'invalid-history') payload.images = [123];
                if (damage === 'empty-attachments') payload.attachments = [];
                if (damage === 'other-workspace') {
                    const other = getRepoDataPath(ctx.dataDir, 'ws-b', 'attachments');
                    fs.mkdirSync(other, { recursive: true });
                    const otherDir = fs.mkdtempSync(path.join(other, 'incoming-'));
                    const otherFile = path.join(otherDir, 'image.png');
                    fs.writeFileSync(otherFile, PNG);
                    payload.attachments[0].path = otherFile;
                }
                if (followUp) ctx.facade.resume();
                await ctx.settle();
                expect((await ctx.store.getProcess(task.processId!))?.status).toBe('failed');
                expect(ctx.received).toHaveLength(followUp ? 1 : 0);
                await vi.waitFor(() => expect(ctx.sends.some(text => text.includes(CHAT_IMAGE_FAILURE_TEXT.storage))).toBe(true));
                expect(fs.readdirSync(getRepoDataPath(ctx.dataDir, 'ws-a', 'attachments'))).toEqual([]);
                // Durable source admission still prevents re-execution of damaged batches.
                const taskCount = ctx.facade.getAll().length;
                await ctx.deliver('image', '/ask describe the image', true, followUp ? 'seed' : undefined);
                expect(ctx.facade.getAll()).toHaveLength(taskCount);
            }
        },
    );

    it.each([false, true])('rejects failed media without executing instructions (await instructions=%s)', { timeout: 20_000 }, async captionless => {
        const ctx = await harness(platform);
        ctx.failDownloads(true);
        if (captionless) await ctx.deliver('image', '', true);
        await ctx.deliver('instructions', '/ask describe the image', !captionless);
        expect(ctx.facade.getAll()).toHaveLength(0);
        expect(ctx.sends.at(-1)).toContain('Could not download the image');
        expect(ctx.sends.at(-1)).not.toContain('fixture credentials');
        await ctx.deliver('instructions', '/ask describe the image', !captionless);
        expect(ctx.facade.getAll()).toHaveLength(0);
        ctx.failDownloads(false);
        if (captionless) await ctx.deliver('resent-image', '', true);
        await ctx.deliver('resent-instructions', '/ask describe the image', !captionless);
        await ctx.settle();
        expect(ctx.received.map(turn => turn.bytes)).toEqual([[PNG]]);
    });

    it('keeps a native image batch together in one recorded turn', { timeout: 20_000 }, async () => {
        const ctx = await harness(platform);
        if (platform === 'teams') await ctx.deliver('batch', '/ask compare both images', 2);
        else {
            await ctx.deliver('image-1', '', true);
            await ctx.deliver('image-2', '', true);
            expect(ctx.facade.getAll()).toHaveLength(0);
            await ctx.deliver('batch', '/ask compare both images');
        }
        await ctx.settle();
        expect(ctx.facade.getAll()).toHaveLength(1);
        expect(ctx.received.map(turn => turn.bytes)).toEqual([[PNG, PNG]]);
        const process = await ctx.store.getProcess(ctx.facade.getAll()[0].processId!);
        expect(process?.conversationTurns?.find(turn => turn.role === 'user')?.images).toEqual([IMAGE_URL, IMAGE_URL]);
    });

    it.each(['help', 'quota', '/ask'])('does not consume pending images on %s', async control => {
        const ctx = await harness(platform);
        await ctx.deliver('image', '', true);
        await ctx.deliver('control', control);
        expect(ctx.facade.getAll()).toHaveLength(0);
        await ctx.deliver('instructions', '/ask inspect');
        expect(ctx.facade.getAll()[0].payload.images).toEqual([IMAGE_URL]);
    });

    it('invalidates pending images on explicit repo reselection', async () => {
        const ctx = await harness(platform);
        await ctx.deliver('image', '', true);
        await ctx.deliver('reselect', '/select repo ws-a');
        await ctx.deliver('instructions', '/ask inspect');
        expect(ctx.facade.getAll()[0].payload.images).toBeUndefined();
        expect(ctx.downloadCount()).toBe(0);
    });

    it('reports expiry and suppresses repeated instructional delivery without dispatch', async () => {
        const ctx = await harness(platform);
        await ctx.deliver('image', '', true);
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + PENDING_IMAGE_TTL_MS);
        await ctx.deliver('instructions', '/ask inspect');
        expect(ctx.sends.at(-1)).toContain('expired');
        await ctx.deliver('instructions', '/ask inspect');
        expect(ctx.facade.getAll()).toHaveLength(0);
        expect(ctx.downloadCount()).toBe(0);
    });

    it('never borrows another sender image or instructions', async () => {
        const ctx = await harness(platform);
        await ctx.deliver('image-own', '', true);
        if (platform === 'teams') {
            await ctx.deliver('select-other', '/select repo ws-a', false, undefined, 'other');
            await ctx.deliver('image-other', '', true, undefined, 'other');
            await ctx.deliver('instructions-other', '/ask inspect other', false, undefined, 'other');
            expect(ctx.downloadCount()).toBe(1);
            expect(ctx.facade.getAll()).toHaveLength(1);
        } else {
            await ctx.deliver('image-other', '', true, undefined, 'other');
            await ctx.deliver('instructions-other', '/ask inspect other', false, undefined, 'other');
            expect(ctx.downloadCount()).toBe(0);
            expect(ctx.facade.getAll()).toHaveLength(0);
        }
        await ctx.deliver('instructions-own', '/ask inspect own');
        expect(ctx.facade.getAll().at(-1)?.payload.images).toEqual([IMAGE_URL]);
        expect(ctx.facade.getAll().at(-1)?.payload.prompt).toBe('inspect own');
    });

    it('rejects pending images after an explicit workspace boundary change', { timeout: 20_000 }, async () => {
        const ctx = await harness(platform);
        await ctx.deliver('seed-a', '/ask seed A');
        await ctx.settle();
        await ctx.deliver('select-b', '/select repo ws-b');
        await ctx.deliver('seed-b', '/ask seed B');
        await ctx.settle();
        const [first, second] = ctx.facade.getAll();
        await ctx.deliver('image-a', platform === 'teams' ? `[${first.processId}]` : '', true,
            platform === 'whatsapp' ? 'seed-a' : undefined);
        await ctx.deliver('instructions-b', platform === 'teams' ? `/ask [${second.processId}] inspect` : '/ask inspect', false,
            platform === 'whatsapp' ? 'seed-b' : undefined);
        expect(ctx.sends.at(-1)).toMatch(/repository or topic changed/i);
        expect(ctx.facade.getAll()).toHaveLength(2);
        expect(ctx.downloadCount()).toBe(0);
    });

    it('rejects combined pending/captioned overflow without losing the retained batch', async () => {
        const ctx = await harness(platform);
        for (let index = 0; index < 5; index++) await ctx.deliver(`image-${index}`, '', true);
        await ctx.deliver('overflow', '/ask compare all', true);
        expect(ctx.sends.at(-1)).toContain('at most 5');
        expect(ctx.downloadCount()).toBe(0);
        expect(ctx.facade.getAll()).toHaveLength(0);
        await ctx.deliver('instructions', '/ask compare retained');
        expect(ctx.facade.getAll()[0].payload.images).toHaveLength(5);
        expect(ctx.downloadCount()).toBe(5);
    });

    it('cancels native acquisition on connector shutdown without queueing incomplete instructions', async () => {
        const ctx = await harness(platform);
        await ctx.deliver('image', '', true);
        ctx.stallDownloads(true);
        const handling = ctx.deliver('instructions', '/ask inspect');
        await vi.waitFor(() => expect(ctx.downloadCount()).toBe(1));
        await ctx.cancelDownloads();
        await handling;
        expect(ctx.facade.getAll()).toHaveLength(0);
        expect(ctx.received).toHaveLength(0);
        expect(ctx.sends.at(-1)).toContain('cancelled');
    });

    it('routes pending-image instructions instead of consuming them as an ask_user answer', async () => {
        const ctx = await harness(platform);
        ctx.questions.tryAnswer.mockClear().mockResolvedValue(true);
        await ctx.deliver('image', '', true);
        await ctx.deliver('instructions', 'yes');
        expect(ctx.questions.tryAnswer).not.toHaveBeenCalled();
        expect(ctx.facade.getAll()[0].payload.images).toEqual([IMAGE_URL]);
        await ctx.deliver('answer', 'another answer');
        expect(ctx.questions.tryAnswer).toHaveBeenCalledOnce();
        expect(ctx.facade.getAll()).toHaveLength(1);
    });

    it('rejects control-caption images without consuming images already awaiting instructions', async () => {
        const ctx = await harness(platform);
        await ctx.deliver('image', '', true);
        await ctx.deliver('rejected-control-image', 'help', true);
        expect(ctx.sends.at(-1)).toContain('separately from control commands');
        expect(ctx.downloadCount()).toBe(0);
        await ctx.deliver('instructions', '/ask inspect');
        expect(ctx.downloadCount()).toBe(1);
        expect(ctx.facade.getAll()[0].payload.images).toEqual([IMAGE_URL]);
    });

    it('hands pending images to a mode-prefixed job without running a sentinel follow-up', { timeout: 20_000 }, async () => {
        const ctx = await harness(platform);
        await ctx.deliver('dispatcher', '/sentinel dispatcher');
        await ctx.settle();
        const parent = ctx.facade.getAll()[0];
        await ctx.deliver('image', '', true, 'dispatcher');
        await ctx.deliver('instructions', '/autopilot fix screenshot', false, 'dispatcher');
        expect(ctx.facade.getAll()).toHaveLength(2);
        const job = ctx.facade.getAll().find(task => task.id !== parent.id)!;
        expect(job).toMatchObject({ repoId: 'ws-a', payload: { mode: 'autopilot', prompt: 'fix screenshot',
            images: [IMAGE_URL], context: { spawnedFromProcessId: parent.processId,
                messagingOrigin: { connector: platform } } } });
        expect(job.processId).not.toBe(parent.processId);
        await ctx.settle();
        expect(ctx.received.map(turn => turn.bytes)).toEqual([[], [PNG]]);
        const parentTurns = (await ctx.store.getProcess(parent.processId!))?.conversationTurns?.filter(turn => turn.role === 'user');
        expect(parentTurns).toHaveLength(1);
    });
});

describe('Teams native pending thread boundaries', () => {
    it('accepts instructions replying to the captionless image root and keeps that thread bound', { timeout: 20_000 }, async () => {
        const ctx = await harness('teams');
        await ctx.deliver('image-root', '', true);
        expect(ctx.facade.getAll()).toHaveLength(0);
        await ctx.deliver('instructions', '/ask inspect', false, 'image-root');
        expect(ctx.facade.getAll()[0]?.payload.images).toEqual([IMAGE_URL]);
        await ctx.settle();
        const first = ctx.facade.getAll()[0];
        await ctx.deliver('follow', '/ask more', false, 'image-root');
        await ctx.settle();
        const follow = ctx.facade.getAll().find(task => task.id !== first.id);
        expect(follow?.processId).toBe(first.processId);
        expect(ctx.received.map(turn => turn.bytes)).toEqual([[PNG], []]);
    });

    it('keeps independent thread/workspace batches bound despite root selection changes', async () => {
        const ctx = await harness('teams');
        await ctx.deliver('select-a', '/select repo ws-a', false, 'root-a');
        await ctx.deliver('select-b', '/select repo ws-b', false, 'root-b');
        await ctx.deliver('image-a', '', true, 'root-a');
        await ctx.deliver('image-b', '', true, 'root-b');
        await ctx.deliver('root-selection', '/select repo ws-b');
        await ctx.deliver('instructions-b', '/ask inspect B', false, 'root-b');
        await ctx.deliver('instructions-a', '/ask inspect A', false, 'root-a');
        expect(ctx.facade.getAll().map(task => task.repoId)).toEqual(['ws-b', 'ws-a']);
        expect(ctx.facade.getAll().map(task => task.payload.images)).toEqual([[IMAGE_URL], [IMAGE_URL]]);
    });

    it('a shared selection in an image-root alias invalidates its whole retained batch', async () => {
        const ctx = await harness('teams');
        await ctx.deliver('image-a', '', true);
        await ctx.deliver('image-b', '', true);
        await ctx.deliver('reselect', '/select repo ws-a', false, 'image-b', 'other');
        await ctx.deliver('instructions', '/ask inspect', false, 'image-a');
        expect(ctx.facade.getAll()[0]?.payload.images).toBeUndefined();
        expect(ctx.downloadCount()).toBe(0);
    });

    it('shared thread reselection invalidates pending batches of every sender', { timeout: 20_000 }, async () => {
        const ctx = await harness('teams');
        await ctx.deliver('select-thread', '/select repo ws-a', false, 'root');
        await ctx.deliver('image-own', '', true, 'root');
        await ctx.deliver('image-other', '', true, 'root', 'other');
        await ctx.deliver('reselect-thread', '/select repo ws-a', false, 'root', 'third');
        await ctx.deliver('instructions-own', '/ask own', false, 'root');
        await ctx.settle();
        await ctx.deliver('instructions-other', '/ask other', false, 'root', 'other');
        await ctx.settle();
        expect(ctx.received.map(turn => turn.bytes)).toEqual([[], []]);
        expect(ctx.downloadCount()).toBe(0);
    });
});

describe('WhatsApp pending image quote routing', () => {
    it('a reset releases the dispatch lane even when an older workspace lookup has not settled', async () => {
        const ctx = await harness('whatsapp');
        let finish!: (value: Awaited<ReturnType<SqliteProcessStore['getWorkspaces']>>) => void;
        vi.spyOn(ctx.store, 'getWorkspaces').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const stale = ctx.deliver('stale-image', '', true);
        await vi.waitFor(() => expect(finish).toBeDefined());
        ctx.disconnect();
        await ctx.deliver('new-image', '', true);
        await ctx.deliver('instructions', '/ask inspect');
        expect(ctx.facade.getAll()[0]?.payload.images).toEqual([IMAGE_URL]);
        finish(await ctx.store.getWorkspaces());
        await stale;
        expect(ctx.facade.getAll()).toHaveLength(1);
    });

    it.each(['image', 'instructions-request'])('preserves the captured workspace when instructions quote the %s', { timeout: 20_000 }, async target => {
        const ctx = await harness('whatsapp');
        await ctx.deliver('seed-a', '/ask seed A');
        await ctx.settle();
        const first = ctx.facade.getAll()[0];
        await ctx.deliver('select-b', '/select repo ws-b');
        await ctx.deliver('seed-b', '/ask seed B');
        await ctx.settle();
        await ctx.deliver('image', '', true, 'seed-a');
        const quoted = target === 'image' ? 'image' : `out-${ctx.sends.length}`;
        await ctx.deliver('instructions', '/ask inspect', false, quoted);
        const imageTask = ctx.facade.getAll().find(task => task.payload.prompt === 'inspect');
        expect(imageTask).toMatchObject({ repoId: 'ws-a', processId: first.processId, payload: { images: [IMAGE_URL] } });
        const restored = new WhatsAppBindings(ctx.dataDir);
        await restored.restore(ctx.store);
        expect(restored.findMessage(quoted)?.processId).toBe(first.processId);
    });
});
