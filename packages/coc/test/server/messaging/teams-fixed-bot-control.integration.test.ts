import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsChannelBindings } from '../../../src/server/messaging/teams-channel-binding';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

describe('fixed Teams Sentinel bot control', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let queue: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;
    let manager: TeamsMessagingManager;
    let handle: (message: InboundTeamsMessage) => Promise<void>;
    let controlEnabled: boolean;
    const message = (messageId: string): InboundTeamsMessage => ({
        channelId: 'channel', messageId, text: 'continue', senderAadId: 'sender',
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-fixed-control-'));
        store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        await store.registerWorkspace({ id: 'ws-a', name: 'A', rootPath: dir });
        await store.addProcess({ id: 'sentinel', type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: '', fullPrompt: '', metadata: { workspaceId: 'ws-a', mode: 'sentinel' } });
        await new TeamsChannelBindings(dir, store).bind(
            { accountKey: 'account', teamId: 'team', channelId: 'channel' }, 'ws-a', 'sentinel');
        queue = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            aiService: createMockSDKService().service, dataDir: dir, autoStart: false,
        });
        queue.registerRepoId('ws-a', dir);
        persistence = new SqliteQueuePersistence(queue, store.getDatabase());
        manager = new TeamsMessagingManager(dir);
        vi.spyOn(manager, 'getStatus').mockReturnValue({ ...manager.getStatus(), enabled: true,
            status: 'connected', teamId: 'team', channelId: 'channel' });
        vi.spyOn(manager, 'getMirrorAccountKey').mockReturnValue('account');
        vi.spyOn(manager, 'sendMessage').mockResolvedValue('outbound');
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(callback => { handle = msg => callback(msg, () => {}); });
        controlEnabled = true;
        registerTeamsMessagingRoutes([], {
            dataDir: dir, store, manager, relayQueue: queue.createAggregateQueueFacade(),
            getAnswerRelayEnabled: () => true, getBotManagedConversationsEnabled: () => controlEnabled,
            enqueueChat: vi.fn(), executeFollowUp: vi.fn(), enqueueRelayChat: vi.fn(),
            admitRelayFollowUp: async (process, prompt, requestId, _mode, taskId, _images, admissionHeld) => ({
                taskId: await (admissionHeld ? queue.enqueueAdmitted : queue.enqueue).call(queue, {
                    id: taskId, type: 'chat', repoId: 'ws-a', processId: process.id,
                    priority: 'normal', config: {}, payload: { kind: 'chat', mode: 'sentinel',
                        workspaceId: 'ws-a', processId: process.id, prompt, relayRequestId: requestId },
                }),
            }),
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        manager.dispose(); persistence.dispose(); queue.dispose(); store.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('claims the Sentinel and deduplicates replayed requests', async () => {
        await handle(message('first'));
        await handle(message('first'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(1);
        expect((await store.getProcess('sentinel'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('does not claim the Sentinel when bot control is disabled', async () => {
        controlEnabled = false;
        await handle(message('first'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(1);
        expect((await store.getProcess('sentinel'))?.metadata?.botControl).toBeUndefined();
    });

    it('rolls back a rejected admission and allows the same message to retry', async () => {
        store.getDatabase().exec("CREATE TRIGGER reject_fixed_control BEFORE INSERT ON queue_tasks BEGIN SELECT RAISE(ABORT, 'reject'); END;");
        await handle(message('first'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
        expect((await store.getProcess('sentinel'))?.metadata?.botControl).toBeUndefined();
        store.getDatabase().exec('DROP TRIGGER reject_fixed_control');
        await handle(message('first'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(1);
        expect((await store.getProcess('sentinel'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('does not replace another integration’s control or enqueue its request', async () => {
        const process = (await store.getProcess('sentinel'))!;
        const control = createBotControlMetadata('whatsapp');
        await store.updateProcess('sentinel', { metadata: { ...process.metadata, botControl: control } });
        await handle(message('conflict'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
        expect((await store.getProcess('sentinel'))?.metadata?.botControl).toEqual(control);
    });

    it('retains the accepted task and claim when a queue observer throws', async () => {
        queue.registry.getQueueForRepo(dir).on('taskAdded', () => { throw new Error('observer failure'); });
        await handle(message('first'));
        await handle(message('first'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(1);
        expect((await store.getProcess('sentinel'))?.metadata?.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it('fails before queue admission when receipt persistence is unavailable', async () => {
        const repoDir = path.join(dir, 'repos', 'ws-a');
        fs.mkdirSync(repoDir, { recursive: true });
        const receiptDir = path.join(repoDir, 'teams-answer-relay');
        fs.writeFileSync(receiptDir, 'not a directory');
        await handle(message('first'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
        expect((await store.getProcess('sentinel'))?.metadata?.botControl).toBeUndefined();
        fs.unlinkSync(receiptDir);
        await handle(message('first'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(1);
    });

    it('fails closed when the bound Sentinel is removed or changed to another mode', async () => {
        const process = (await store.getProcess('sentinel'))!;
        await store.updateProcess('sentinel', { metadata: { ...process.metadata, mode: 'ask' } });
        await handle(message('wrong-mode'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
        await store.removeProcess('sentinel');
        await handle(message('deleted'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
    });
});
