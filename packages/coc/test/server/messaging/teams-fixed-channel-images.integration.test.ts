import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { ImageDownloadError } from '@plusplusoneplusplus/coc-connector';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsChannelBindings } from '../../../src/server/messaging/teams-channel-binding';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { incomingImageTaskPayload } from '../../../src/server/messaging/incoming-images';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { getRepoDataPath } from '../../../src/server/paths';

const PNG = Buffer.from('89504e470d0a1a0a010203', 'hex');

describe('fixed Teams Sentinel image admission', () => {
    let dir: string;
    let store: SqliteProcessStore;
    let queue: MultiRepoQueueRouter;
    let manager: TeamsMessagingManager;
    let handle: (message: InboundTeamsMessage) => Promise<void>;
    let send: ReturnType<typeof vi.fn>;
    const message = (messageId: string, text: string, images?: InboundTeamsMessage['images'], replyToMessageId?: string): InboundTeamsMessage => ({
        channelId: 'channel', messageId, text, senderAadId: 'sender', images, replyToMessageId,
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-fixed-images-'));
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
        manager = new TeamsMessagingManager(dir);
        vi.spyOn(manager, 'getStatus').mockReturnValue({ ...manager.getStatus(), enabled: true,
            status: 'connected', teamId: 'team', channelId: 'channel' });
        vi.spyOn(manager, 'getMirrorAccountKey').mockReturnValue('account');
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(callback => { handle = msg => callback(msg, () => {}); });
        send = vi.fn().mockResolvedValue('outbound');
        vi.spyOn(manager, 'sendMessage').mockImplementation(send);
        registerTeamsMessagingRoutes([], {
            dataDir: dir, store, manager, relayQueue: queue.createAggregateQueueFacade(),
            getAnswerRelayEnabled: () => true,
            enqueueChat: vi.fn(), executeFollowUp: vi.fn(), enqueueRelayChat: vi.fn(),
            admitRelayFollowUp: async (process, prompt, requestId, _mode, taskId, images) => ({
                taskId: await queue.enqueue({ id: taskId, type: 'chat', repoId: 'ws-a', processId: process.id,
                    priority: 'normal', config: {}, payload: { kind: 'chat', mode: 'sentinel',
                        workspaceId: 'ws-a', processId: process.id, prompt, relayRequestId: requestId,
                        ...incomingImageTaskPayload(images) } }),
            }),
        });
    });
    afterEach(() => {
        manager.dispose(); queue.dispose(); store.close();
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('persists and deduplicates a captioned image on the bound Sentinel', async () => {
        const download = vi.fn(async () => {
            const receipts = getRepoDataPath(dir, 'ws-a', 'teams-answer-relay');
            expect(fs.readdirSync(receipts)).toHaveLength(1);
            return PNG;
        });
        const input = message('image', 'inspect', [{ mimeType: 'image/png', download }]);
        await Promise.all([handle(input), handle(input)]);
        const tasks = queue.createAggregateQueueFacade().getAll();
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ repoId: 'ws-a', processId: 'sentinel',
            payload: { prompt: 'inspect', images: [`data:image/png;base64,${PNG.toString('base64')}`] } });
        expect(download).toHaveBeenCalledOnce();
    });

    it('does not execute or retain files for a rejected image and allows retry', async () => {
        const download = vi.fn().mockRejectedValueOnce(new ImageDownloadError('size-limit')).mockResolvedValue(PNG);
        const input = message('image', 'inspect', [{ mimeType: 'image/png', download }]);
        await handle(input);
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
        expect(send).toHaveBeenCalledWith(new ImageDownloadError('size-limit').message, 'image');
        await handle(input);
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(1);
        expect(download).toHaveBeenCalledTimes(2);
    });

    it('delivers captionless images with instructions in the same thread', async () => {
        const download = vi.fn().mockResolvedValue(PNG);
        await handle(message('image-root', '', [{ mimeType: 'image/png', download }]));
        expect(download).not.toHaveBeenCalled();
        await handle(message('instruction', 'inspect', undefined, 'image-root'));
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(1);
        expect(download).toHaveBeenCalledOnce();
    });

    it.each(['unsupported-type', 'size-limit', 'timeout', 'cancelled', 'access-denied'] as const)(
        'surfaces %s without queueing or leaking the image', async code => {
            const download = vi.fn().mockRejectedValue(new ImageDownloadError(code));
            await handle(message('image', 'inspect', [{ mimeType: 'image/png', download }]));
            expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
            expect(send).toHaveBeenCalledWith(new ImageDownloadError(code).message, 'image');
        },
    );

    it.each(['/help', '/select repo ws-a', '/unknown'])('rejects image-bearing control %s', async text => {
        const download = vi.fn().mockResolvedValue(PNG);
        await handle(message('image', text, [{ mimeType: 'image/png', download }]));
        expect(download).not.toHaveBeenCalled();
        expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
        expect(send).toHaveBeenCalledWith(expect.stringContaining('separately from control'), 'image');
    });

    it('keeps multiple images ordered in one Sentinel follow-up', async () => {
        const jpeg = Buffer.from('ffd8ff010203', 'hex');
        await handle(message('image', 'inspect', [
            { mimeType: 'image/png', download: async () => PNG },
            { mimeType: 'image/jpeg', download: async () => jpeg },
        ]));
        const tasks = queue.createAggregateQueueFacade().getAll();
        expect(tasks).toHaveLength(1);
        expect(tasks[0].payload.images).toEqual([
            `data:image/png;base64,${PNG.toString('base64')}`,
            `data:image/jpeg;base64,${jpeg.toString('base64')}`,
        ]);
    });

    it.each(['botAuthored', 'initializationReplay', 'historicalSelectionReplay'] as const)(
        'does not acquire %s images', async flag => {
            const download = vi.fn().mockResolvedValue(PNG);
            await handle({ ...message('image', 'inspect', [{ mimeType: 'image/png', download }]), [flag]: true });
            expect(download).not.toHaveBeenCalled();
            expect(queue.createAggregateQueueFacade().getAll()).toHaveLength(0);
        },
    );
});
