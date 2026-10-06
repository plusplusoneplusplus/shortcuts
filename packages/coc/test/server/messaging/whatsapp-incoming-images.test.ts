import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { ImageDownloadError, type InboundImage } from '@plusplusoneplusplus/coc-connector';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { incomingImageTaskPayload, type PreparedIncomingImages } from '../../../src/server/messaging/incoming-images';
import { getRepoDataPath } from '../../../src/server/paths';

const PNG = Buffer.from('89504e470d0a1a0a010203', 'hex');
const GROUP = 'group@g.us';
const GLOBAL = 'global-workspace-00';

describe('WhatsApp admitted captioned-image delivery', () => {
    let dir: string;
    let bindings: WhatsAppBindings;
    let queue: TaskQueueManager;
    let router: WhatsAppCommandRouter;
    let send: ReturnType<typeof vi.fn>;
    let enqueue: ReturnType<typeof vi.fn>;
    let react: ReturnType<typeof vi.fn>;
    let questions: { tryAnswer: ReturnType<typeof vi.fn> };
    let store: WhatsAppRouterDeps['store'];
    const processes = [
        { id: 'topic-a', metadata: { workspaceId: 'ws-a' } },
        { id: 'topic-b', metadata: { workspaceId: 'ws-b' } },
    ];
    const message = (text: string, patch: Partial<InboundWAMessage> = {}): InboundWAMessage => ({
        chatJid: GROUP, senderJid: GROUP, participantJid: 'self@s.whatsapp.net',
        fromMe: true, messageId: 'image-message', text, ...patch,
    });
    const image = (): InboundImage & { download: ReturnType<typeof vi.fn> } => ({
        mimeType: 'image/png', download: vi.fn(async () => {
            // The receipt must be durable before acquiring media.
            const receipt = getRepoDataPath(dir, bindings.entries()[0].workspaceId, 'whatsapp-bindings.json');
            expect(fs.readFileSync(receipt, 'utf8')).toContain('image-message');
            return PNG;
        }),
    });
    const files = (workspaceId = GLOBAL) => {
        const root = getRepoDataPath(dir, workspaceId, 'attachments');
        return fs.existsSync(root) ? fs.readdirSync(root) : [];
    };
    const createRouter = (patch: Partial<WhatsAppRouterDeps> = {}) => new WhatsAppCommandRouter({
        dataDir: dir, store, bindings, groupJid: () => GROUP, enqueue,
        getTask: id => queue.getTask(id), send, react, questions, ...patch,
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-images-'));
        bindings = new WhatsAppBindings(dir);
        queue = new TaskQueueManager();
        queue.pause();
        store = {
            getWorkspaces: vi.fn(async () => [{ id: GLOBAL }, { id: 'ws-a' }, { id: 'ws-b' }]),
            getAllProcesses: vi.fn(async () => processes),
            getProcess: vi.fn(async (id: string) => processes.find(row => row.id === id)),
            updateProcess: vi.fn(),
        } as unknown as WhatsAppRouterDeps['store'];
        await bindings.restore(store);
        send = vi.fn(async () => 'reply-id');
        react = vi.fn(async () => {});
        questions = { tryAnswer: vi.fn(async () => false) };
        enqueue = vi.fn(async (workspaceId, prompt, mode, processId, id, _control, media?: PreparedIncomingImages) =>
            queue.enqueue({ id, type: 'chat', repoId: workspaceId, processId, config: {}, priority: 'normal',
                payload: { kind: 'chat', workspaceId, prompt, mode,
                    ...(processId !== toQueueProcessId(id) ? { processId } : {}),
                    relayRequestId: id, ...incomingImageTaskPayload(media) },
            }));
        router = createRouter();
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('queues SDK files and durable image history for a first turn in Global', async () => {
        const media = image();
        await router.handle(message('/ask describe this', { images: [media] }));
        const [task] = queue.getAll();
        expect(task.repoId).toBe(GLOBAL);
        expect(task.payload).toMatchObject({ prompt: 'describe this', mode: 'ask', images: [`data:image/png;base64,${PNG.toString('base64')}`] });
        expect(task.payload.processId).toBeUndefined();
        const prepared = enqueue.mock.calls[0][6] as PreparedIncomingImages;
        expect(task.payload.attachments).toEqual(prepared.sdkAttachments);
        expect(task.payload.imageTempDir).toBe(prepared.imageTempDir);
        expect(fs.readFileSync(prepared.sdkAttachments[0].path)).toEqual(PNG);
        expect(prepared.fileAttachmentMeta).toEqual([{ name: 'image-1', mimeType: 'image/png', size: PNG.length, category: 'image' }]);
        expect(media.download).toHaveBeenCalledTimes(1);
        expect(react).toHaveBeenCalledWith('image-message');
    });

    it.each(['selected', 'explicit', 'quoted'])('preserves %s workspace/topic and follow-up mode routing', async target => {
        bindings.selectRepo('ws-a');
        bindings.selectTopic('ws-a', 'topic-a');
        if (target === 'quoted') {
            bindings.add({ groupJid: GROUP, workspaceId: 'ws-b', processId: 'topic-b', taskId: 'earlier',
                inboundId: 'earlier-image', outboundIds: ['answer-b'], nextPart: 0, status: 'queued' });
        }
        const media: InboundImage = { mimeType: 'image/png', download: vi.fn(async () => PNG) };
        await router.handle(message(target === 'explicit' ? '/autopilot [topic-b] fix this' : '/autopilot fix this', {
            images: [media], ...(target === 'quoted' ? { quotedMessageId: 'answer-b' } : {}),
        }));
        const [task] = queue.getAll();
        const ws = target === 'selected' ? 'ws-a' : 'ws-b';
        expect(task).toMatchObject({ repoId: ws, processId: target === 'selected' ? 'topic-a' : 'topic-b',
            payload: { prompt: 'fix this', mode: 'autopilot', workspaceId: ws, processId: target === 'selected' ? 'topic-a' : 'topic-b' } });
        expect(path.dirname(task.payload.imageTempDir as string)).toBe(getRepoDataPath(dir, ws, 'attachments'));
        expect(task.payload.attachments).toHaveLength(1);
        expect(task.payload.images).toHaveLength(1);
    });

    it('deduplicates concurrent and restored deliveries before downloading', async () => {
        const media = image();
        const msg = message('describe', { images: [media] });
        await Promise.all([router.handle(msg), router.handle(msg)]);
        await router.handle(msg);
        const restored = new WhatsAppBindings(dir);
        await restored.restore(store);
        await createRouter({ bindings: restored }).handle(msg);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(media.download).toHaveBeenCalledTimes(1);
        expect(queue.getAll()).toHaveLength(1);
    });

    it.each(['download', 'unsupported', 'size-limit', 'cancelled', 'timeout', 'access-denied'] as const)(
        'rejects %s media without launching a caption-only turn and allows retry', async code => {
            const media = image();
            media.download.mockRejectedValueOnce(new ImageDownloadError(code));
            await router.handle(message('describe', { images: [media] }));
            expect(send).toHaveBeenLastCalledWith(new ImageDownloadError(code).message, 'image-message');
            expect(enqueue).not.toHaveBeenCalled();
            expect(bindings.isKnownMessage('image-message')).toBe(false);
            expect(files()).toEqual([]);
            await router.handle(message('describe', { images: [media] }));
            expect(enqueue).toHaveBeenCalledTimes(1);
        });

    it('removes prepared files and rejected admission when the queue fails', async () => {
        enqueue.mockRejectedValueOnce(new Error('queue full'));
        await router.handle(message('describe', { images: [image()] }));
        expect(queue.getAll()).toHaveLength(0);
        expect(bindings.isKnownMessage('image-message')).toBe(false);
        expect(files()).toEqual([]);
        expect(send).toHaveBeenLastCalledWith('Could not queue the request. Please try again.', 'image-message');
    });

    it('keeps accepted files when a taskAdded observer or confirmation fails', async () => {
        const ordinary = enqueue.getMockImplementation()!;
        enqueue.mockImplementation(async (...args) => { await ordinary(...args); throw new Error('observer failed'); });
        react.mockRejectedValueOnce(new Error('reaction failed'));
        await router.handle(message('describe', { images: [image()] }));
        expect(queue.getAll()).toHaveLength(1);
        expect(files()).toHaveLength(1);
        expect(bindings.isKnownMessage('image-message')).toBe(true);
        expect(send).not.toHaveBeenCalled();
    });

    it('sends a captioned image as a turn rather than consuming it as an ask_user answer', async () => {
        questions.tryAnswer.mockResolvedValue(true);
        await router.handle(message('yes', { images: [image()] }));
        expect(questions.tryAnswer).not.toHaveBeenCalled();
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it.each(['help', 'select repo ws-a', '/invalid'])('rejects %s with media before download or selection mutation', async text => {
        const media = image();
        await router.handle(message(text, { images: [media] }));
        expect(media.download).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        expect(bindings.selectedRepo).toBeNull();
        expect(send).toHaveBeenLastCalledWith('Send the images with chat instructions, separately from control commands.', 'image-message');
    });

    it('does not acquire images for unauthorized groups/senders or unavailable targets', async () => {
        const media = image();
        await router.handle(message('describe', { fromMe: false, images: [media] }));
        await router.handle(message('describe', { chatJid: 'other@g.us', images: [media] }));
        await router.handle(message('[missing] describe', { images: [media] }));
        expect(media.download).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('fails closed when no image storage is wired', async () => {
        router = createRouter({ dataDir: undefined });
        const media = image();
        await router.handle(message('describe', { images: [media] }));
        expect(media.download).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        expect(send).toHaveBeenLastCalledWith('Could not save the images. Check server storage and send them again.', 'image-message');
    });

    it('fails closed for sentinel image handoffs until their media admission is wired', async () => {
        const handOff = { resolve: vi.fn(async () => ({ workspaceId: GLOBAL, parentProcessId: 'sentinel', mode: 'ask' as const })), start: vi.fn() };
        router = createRouter({ handOff });
        const media = image();
        await router.handle(message('/ask describe', { images: [media] }));
        expect(handOff.start).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        expect(media.download).not.toHaveBeenCalled();
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('regular chat topic'), 'image-message');
    });
});
