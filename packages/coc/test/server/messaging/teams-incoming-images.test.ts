import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { ImageDownloadError, type InboundImage } from '@plusplusoneplusplus/coc-connector';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsUserStateStore } from '../../../src/server/messaging/teams-user-state';
import { registerTeamsMessagingRoutes, type TeamsMessagingRoutesOptions } from '../../../src/server/messaging/teams-messaging-handler';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { incomingImageTaskPayload } from '../../../src/server/messaging/incoming-images';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { getRepoDataPath } from '../../../src/server/paths';

const PNG = Buffer.from('89504e470d0a1a0a010203', 'hex');

describe('Teams admitted captioned-image delivery', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let queue: MultiRepoQueueRouter;
    let manager: TeamsMessagingManager;
    let persistence: SqliteQueuePersistence;
    let relayEnabled: boolean;
    let handle: (msg: InboundTeamsMessage) => Promise<void>;
    let send: ReturnType<typeof vi.fn>;
    let questions: { register: ReturnType<typeof vi.fn>; tryAnswer: ReturnType<typeof vi.fn> };
    let options: TeamsMessagingRoutesOptions;
    const tasks = () => queue.createAggregateQueueFacade().getAll();
    const files = (workspaceId = 'ws-a') => {
        const root = getRepoDataPath(dir, workspaceId, 'attachments');
        return fs.existsSync(root) ? fs.readdirSync(root) : [];
    };
    const inbound = (messageId: string, text = '/ask describe this', replyToMessageId?: string, images?: InboundImage[]): InboundTeamsMessage => ({
        channelId: 'channel', messageId, text, senderAadId: 'sender', replyToMessageId, images,
    });
    const image = (id: string, workspaceId = 'ws-a') => ({
        mimeType: 'image/png', download: vi.fn(async () => {
            // Acquisition must follow durable admission in the resolved workspace.
            const root = getRepoDataPath(dir, workspaceId, 'teams-answer-relay');
            expect(fs.readdirSync(root).some(file => fs.readFileSync(path.join(root, file), 'utf8').includes(`"messageId":"${id}"`))).toBe(true);
            return PNG;
        }),
    });
    const checkMedia = (task: ReturnType<typeof tasks>[number], workspaceId = 'ws-a') => {
        expect(task.repoId).toBe(workspaceId);
        expect(task.payload.images).toEqual([`data:image/png;base64,${PNG.toString('base64')}`]);
        const attachments = task.payload.attachments as Array<{ path: string }>;
        expect(attachments).toHaveLength(1);
        expect(fs.readFileSync(attachments[0].path)).toEqual(PNG);
        expect(task.payload.imageTempDir).toContain(getRepoDataPath(dir, workspaceId, 'attachments'));
    };
    const register = () => registerTeamsMessagingRoutes([], options);
    const existing = async (id = 'topic', workspaceId = 'ws-a') => store.addProcess({
        id, type: 'chat', status: 'completed', title: id, startTime: new Date(), promptPreview: '', fullPrompt: '',
        metadata: { workspaceId, mode: 'ask' },
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-images-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        for (const id of ['ws-a', 'ws-b']) {
            fs.mkdirSync(path.join(dir, id));
            await store.registerWorkspace({ id, name: id, rootPath: path.join(dir, id) });
        }
        new TeamsUserStateStore(dir).update('sender', { selectedRepo: 'ws-a' });
        queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
            followUpSuggestions: { enabled: false, count: 0 },
        });
        for (const id of ['ws-a', 'ws-b']) queue.registerRepoId(id, path.join(dir, id));
        persistence = new SqliteQueuePersistence(queue, store.getDatabase());
        manager = new TeamsMessagingManager(dir);
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId: 'team', channelId: 'channel',
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => { handle = msg => handler(msg, () => {}); });
        send = vi.fn(async () => 'outbound');
        vi.spyOn(manager, 'sendMessage').mockImplementation(send);
        questions = { register: vi.fn(), tryAnswer: vi.fn(async () => false) };
        relayEnabled = true;
        const enqueue: NonNullable<TeamsMessagingRoutesOptions['enqueueChat']> = async (workspaceId, prompt, mode, id, botControl, images) =>
            queue.enqueue({ id, botControl, ...(id ? { processId: toQueueProcessId(id) } : {}), type: 'chat', repoId: workspaceId, priority: 'normal',
                payload: { kind: 'chat', mode: mode ?? 'ask', workspaceId, prompt, ...incomingImageTaskPayload(images) }, config: {} });
        options = {
            dataDir: dir, store, manager, relayQueue: queue.createAggregateQueueFacade(),
            getAnswerRelayEnabled: () => relayEnabled, getBotManagedConversationsEnabled: () => false,
            questionRelay: questions,
            enqueueChat: enqueue,
            enqueueRelayChat: (ws, prompt, id, mode, control, images) => enqueue(ws, prompt, mode, id, control, images),
            executeFollowUp: vi.fn(async () => { throw new Error('Image turn bypassed durable admission'); }),
            admitRelayFollowUp: async (proc, prompt, requestId, mode, id, images) => ({ taskId: await queue.enqueue({
                id, type: 'chat', repoId: proc.metadata.workspaceId as string, processId: proc.id, priority: 'normal',
                payload: { kind: 'chat', mode: mode ?? 'ask', workspaceId: proc.metadata.workspaceId, processId: proc.id,
                    prompt, relayRequestId: requestId, ...incomingImageTaskPayload(images) }, config: {},
            }) }),
            enqueuePendingRelayFollowUp: (workspaceId, processId, prompt, requestId, mode, id, images) => queue.enqueue({
                id, type: 'chat', repoId: workspaceId, processId, priority: 'normal',
                payload: { kind: 'chat', mode: mode ?? 'ask', workspaceId, processId, prompt,
                    relayRequestId: requestId, ...incomingImageTaskPayload(images) }, config: {},
            }),
        };
        register();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        manager?.dispose(); persistence?.dispose(); queue?.dispose(); store?.close();
        fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks();
    });

    it.each([true, false])('queues first and pending follow-up images with relay enabled=%s and bot control off', async enabled => {
        relayEnabled = enabled;
        const first = image('first');
        await handle(inbound('first', '/ask describe this', undefined, [first]));
        const follow = image('follow');
        await handle(inbound('follow', '/autopilot compare this', undefined, [follow]));
        const [initial, next] = tasks();
        checkMedia(initial); checkMedia(next);
        expect(initial.payload).toMatchObject({ mode: 'ask', prompt: 'describe this' });
        expect(initial.payload.processId).toBeUndefined();
        expect(next.payload).toMatchObject({ mode: 'autopilot', prompt: 'compare this', processId: initial.processId, relayRequestId: expect.any(String) });
        expect(initial.botControl).toBeUndefined(); expect(next.botControl).toBeUndefined();
        await handle(inbound('first', '/ask describe this', undefined, [first]));
        await handle(inbound('follow', '/autopilot compare this', undefined, [follow]));
        expect(tasks()).toHaveLength(2); expect(first.download).toHaveBeenCalledTimes(1); expect(follow.download).toHaveBeenCalledTimes(1);
        expect(questions.tryAnswer).not.toHaveBeenCalled();
    });

    it.each(['selected', 'explicit', 'thread'])('preserves %s existing chat/workspace/mode routing', async target => {
        await existing('topic-b', 'ws-b');
        if (target === 'selected') {
            await handle(inbound('choose-repo', '/select repo ws-b'));
            await handle(inbound('choose-topic', '/select topic topic-b'));
        }
        if (target === 'thread') {
            await handle(inbound('choose-thread-repo', '/select repo ws-b', 'root'));
            await handle(inbound('choose-thread-topic', '/select topic topic-b', 'root'));
        }
        const media = image('image', 'ws-b');
        await handle(inbound('image', target === 'explicit' ? '/autopilot [topic-b] inspect' : '/autopilot inspect', target === 'thread' ? 'root' : undefined, [media]));
        expect(tasks()).toHaveLength(1); checkMedia(tasks()[0], 'ws-b');
        expect(tasks()[0].payload).toMatchObject({ processId: 'topic-b', mode: 'autopilot', prompt: 'inspect' });
        expect(files('ws-a')).toEqual([]);
    });

    it('preserves root selection and pending thread routing independently of sender selection', async () => {
        await handle(inbound('choose', '/select repo ws-b', 'root'));
        const first = image('thread-image', 'ws-b');
        await handle(inbound('thread-image', '/ask inspect', 'root', [first]));
        const follow = image('thread-follow', 'ws-b');
        await handle(inbound('thread-follow', '/autopilot compare', 'root', [follow]));
        expect(tasks()).toHaveLength(2); tasks().forEach(task => checkMedia(task, 'ws-b'));
        expect(tasks()[1].payload.processId).toBe(tasks()[0].processId);
        expect(files('ws-a')).toEqual([]);
    });

    it('admits existing chat images durably with both answer relay and bot control disabled', async () => {
        relayEnabled = false;
        await existing();
        const media = image('follow');
        await handle(inbound('follow', '/ask [topic] inspect', undefined, [media]));
        checkMedia(tasks()[0]);
        await handle(inbound('follow', '/ask [topic] inspect', undefined, [media]));
        expect(tasks()).toHaveLength(1); expect(media.download).toHaveBeenCalledTimes(1);
        expect(options.executeFollowUp).not.toHaveBeenCalled();
    });

    it('serializes concurrent redelivery without acquiring duplicate media', async () => {
        const media = image('same');
        await Promise.all([handle(inbound('same', '/ask inspect', undefined, [media])), handle(inbound('same', '/ask inspect', undefined, [media]))]);
        expect(tasks()).toHaveLength(1); expect(media.download).toHaveBeenCalledTimes(1); checkMedia(tasks()[0]);
    });

    it('restores receipt dedup without re-downloading or dispatching', async () => {
        const media = image('restart');
        await handle(inbound('restart', '/ask inspect', undefined, [media]));
        manager.dispose(); register();
        await handle(inbound('restart', '/ask inspect', undefined, [media]));
        expect(tasks()).toHaveLength(1); expect(media.download).toHaveBeenCalledTimes(1); checkMedia(tasks()[0]);
    });

    it.each(['first', 'pending', 'existing'])('cleans rejected %s queue files and retries the receipt', async target => {
        if (target === 'pending') await handle(inbound('origin', '/ask start', undefined, [image('origin')]));
        if (target === 'existing') await existing();
        const before = tasks().length;
        const beforeFiles = files();
        const media = image('retry');
        const msg = inbound('retry', target === 'existing' ? '/ask [topic] inspect' : '/ask inspect', undefined, [media]);
        store.getDatabase().exec("CREATE TRIGGER reject_image BEFORE INSERT ON queue_tasks BEGIN SELECT RAISE(ABORT, 'reject'); END;");
        await handle(msg);
        expect(tasks()).toHaveLength(before); expect(files()).toEqual(beforeFiles);
        store.getDatabase().exec('DROP TRIGGER reject_image');
        await handle(msg);
        expect(tasks()).toHaveLength(before + 1); checkMedia(tasks().at(-1)!); expect(media.download).toHaveBeenCalledTimes(2);
    });

    it.each(['first', 'pending', 'existing'].flatMap(target => [true, false].map(enabled => [target, enabled] as const)))('retains accepted %s files after an observer throws (relay %s)', async (target, enabled) => {
        relayEnabled = enabled;
        if (target === 'pending') await handle(inbound('origin', '/ask start', undefined, [image('origin')]));
        if (target === 'existing') await existing();
        const before = tasks().length;
        queue.registry.getQueueForRepo(path.join(dir, 'ws-a')).on('taskAdded', () => { throw new Error('observer'); });
        const media = image('accepted');
        const msg = inbound('accepted', target === 'existing' ? '/ask [topic] inspect' : '/ask inspect', undefined, [media]);
        await handle(msg); await handle(msg);
        expect(tasks()).toHaveLength(before + 1); checkMedia(tasks().at(-1)!); expect(media.download).toHaveBeenCalledTimes(1);
        if (target === 'pending') expect(tasks().at(-1)!.payload.processId).toBe(tasks()[0].processId);
        expect(send).toHaveBeenCalledWith(expect.stringContaining(target === 'first' ? 'New topic created' : 'Message sent'), 'accepted');
    });

    it.each(['unsupported-type', 'size-limit', 'timeout', 'cancelled', 'access-denied'] as const)('reports safe %s failure without executing the caption and allows retry', async code => {
        const media = image('retry');
        media.download.mockRejectedValueOnce(new ImageDownloadError(code));
        await handle(inbound('retry', '/ask inspect', undefined, [media]));
        expect(tasks()).toEqual([]); expect(files()).toEqual([]);
        expect(send).toHaveBeenCalledWith(new ImageDownloadError(code).message, 'retry');
        await handle(inbound('retry', '/ask inspect', undefined, [media])); checkMedia(tasks()[0]);
    });

    it.each(['botAuthored', 'initializationReplay', 'historicalSelectionReplay'] as const)('suppresses %s media without downloads', async flag => {
        const media = image('ignored');
        await handle({ ...inbound('ignored', '/ask inspect', undefined, [media]), [flag]: true });
        expect(tasks()).toEqual([]); expect(media.download).not.toHaveBeenCalled();
    });

    it.each(['/help', '/select repo ws-b', '/unknown'])('rejects control/invalid media caption %s', async caption => {
        const media = image('control');
        await handle(inbound('control', caption, undefined, [media]));
        expect(tasks()).toEqual([]); expect(media.download).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(expect.stringContaining('separately from control'), 'control');
    });

    it('never leaks arbitrary failures while relay is disabled', async () => {
        relayEnabled = false;
        options.enqueueChat = async () => { throw new Error('credential secret transport detail'); };
        register();
        await handle(inbound('failure', '/ask inspect', undefined, [image('failure')]));
        expect(tasks()).toEqual([]); expect(files()).toEqual([]);
        expect(send).toHaveBeenCalledWith('❌ Unable to accept the request. Please try again later.', 'failure');
        expect(JSON.stringify(send.mock.calls)).not.toContain('secret');
    });

    it('rejects unavailable channel and workspace ownership before downloading', async () => {
        const media = image('wrong-target');
        await handle({ ...inbound('wrong-target', '/ask inspect', undefined, [media]), channelId: 'other' });
        await existing('foreign', 'missing-workspace');
        await handle(inbound('wrong-workspace', '/ask [foreign] inspect', undefined, [media]));
        expect(tasks()).toEqual([]); expect(media.download).not.toHaveBeenCalled();
    });

    it('carries multiple images in order as one chat turn', async () => {
        const jpeg = Buffer.from('ffd8ff010203', 'hex');
        await handle(inbound('batch', '/ask compare these', undefined, [image('batch'), { mimeType: 'image/jpeg', download: async () => jpeg }]));
        expect(tasks()).toHaveLength(1);
        expect(tasks()[0].payload.images).toEqual([
            `data:image/png;base64,${PNG.toString('base64')}`, `data:image/jpeg;base64,${jpeg.toString('base64')}`,
        ]);
        const attachments = tasks()[0].payload.attachments as Array<{ path: string }>;
        expect(attachments.map(item => fs.readFileSync(item.path))).toEqual([PNG, jpeg]);
    });

    it('fails closed without durable relay wiring and on unavailable targets', async () => {
        options.relayQueue = undefined; register();
        const media = image('unwired');
        await handle(inbound('unwired', '/ask inspect', undefined, [media]));
        expect(tasks()).toEqual([]); expect(media.download).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Could not save'), 'unwired');
        await handle(inbound('missing', '/ask [missing] inspect', undefined, [media]));
        expect(media.download).not.toHaveBeenCalled();
    });

    it('rejects sentinel handoff images before recording a command or starting a job', async () => {
        await existing();
        options.handOff = { resolve: vi.fn(async () => ({ parentProcessId: 'topic', workspaceId: 'ws-a', mode: 'autopilot' as const })), start: vi.fn() };
        register();
        const media = image('handoff');
        await handle(inbound('handoff', '/autopilot [topic] fix', undefined, [media]));
        expect(tasks()).toEqual([]); expect(media.download).not.toHaveBeenCalled(); expect(options.handOff.start).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(expect.stringContaining('sentinel job handoffs'), 'handoff');
    });
});
