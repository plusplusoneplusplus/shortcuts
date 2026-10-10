import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileProcessStore, toQueueProcessId, type AIProcess, type CreateTaskInput, type QueuedTask } from '@plusplusoneplusplus/forge';
import {
    captureMirrorUploads, mirrorAttachmentBytes, MirrorAttachmentError,
} from '../../../src/server/messaging/sentinel-mirror-attachments';
import { SentinelMirrorOutbox } from '../../../src/server/messaging/sentinel-mirror-outbox';
import { SentinelMirrorService } from '../../../src/server/messaging/sentinel-mirror-service';
import { createWhatsAppMirrorAdapter } from '../../../src/server/messaging/sentinel-mirror-adapters';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppNotConnectedError, type WhatsAppMessagingManager } from '../../../src/server/messaging/whatsapp-messaging-manager';
import { ProcessMessageDeliveryService, type FollowUpMessageInput } from '../../../src/server/processes/process-message-delivery-service';
import { ProcessOperationAdmission } from '../../../src/server/processes/process-operation-admission';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';
import { getRepoDataPath } from '../../../src/server/paths';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const upload = (name = 'notes.txt', mimeType = 'text/plain', bytes = Buffer.from('uploaded text')) => ({
    name, mimeType, size: bytes.length, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
});
const header = (requestId: string, part: number, total: number, role = 'user') =>
    `CoC · Desktop ${role} · Request ${requestId} · Part ${part}/${total}`;
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    vi.restoreAllMocks();
});

async function fixture() {
    const directory = path.join(process.cwd(), `.sentinel-attachment-test-${randomUUID()}`);
    fs.mkdirSync(directory);
    cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new FileProcessStore({ dataDir: directory });
    await store.registerWorkspace({ id: 'workspace-a', rootPath: directory, name: 'Workspace A' });
    await store.registerWorkspace({ id: 'workspace-b', rootPath: path.join(directory, 'b'), name: 'Workspace B' });
    const processId = toQueueProcessId('origin-task');
    await store.addProcess({
        id: processId, type: 'clarification', status: 'completed', startTime: new Date(),
        promptPreview: 'initial', fullPrompt: 'initial', workingDirectory: directory,
        metadata: { type: 'chat', mode: 'sentinel', provider: 'copilot', workspaceId: 'workspace-a' },
        conversationTurns: [
            { role: 'user', content: 'initial', turnIndex: 0, timestamp: new Date(), timeline: [] },
            { role: 'assistant', content: 'old answer', turnIndex: 1, timestamp: new Date(), timeline: [] },
        ],
    } as AIProcess);
    const tasks = new Map<string, QueuedTask>();
    const queue = Object.assign(new EventEmitter(), {
        getTask: (id: string) => tasks.get(id),
        getAll: () => [...tasks.values()],
    });
    const bindings = new WhatsAppBindings(directory, { store, queue: { getTask: queue.getTask, replaceBotControl: () => {} } });
    await bindings.restore(store);
    bindings.add({
        workspaceId: 'workspace-a', processId, taskId: 'origin-task',
        groupJid: 'bound@g.us', inboundId: 'root', outboundIds: [], nextPart: 0, status: 'delivered',
    });
    let enabled = true;
    let connected = true;
    let bound = true;
    let account = 'account-pin';
    const calls: Array<{ kind: 'text' | 'media'; text: string; filename?: string; mimeType?: string; bytes?: Buffer }> = [];
    const sendTo = vi.fn(async (_chatKey: string, text: string, _threadId?: string) => {
        calls.push({ kind: 'text', text });
        return `sent-${calls.length}`;
    });
    const sendMediaTo = vi.fn(async (_chatKey: string, media: {
        bytes: Buffer; filename: string; mimeType: string; caption?: string;
    }, _threadId?: string) => {
        calls.push({ kind: 'media', text: media.caption ?? '', filename: media.filename, mimeType: media.mimeType, bytes: media.bytes });
        return `sent-${calls.length}`;
    });
    const manager = {
        getStatus: () => ({
            enabled: true, status: connected ? 'connected' : 'disconnected', groupJid: 'bound@g.us',
            groupName: 'Group', deviceName: 'CoC', qr: null, error: null,
        }),
        getMirrorAccountKey: () => account,
        sendTo, sendMediaTo,
    } as unknown as WhatsAppMessagingManager;
    const outbound = vi.spyOn(bindings, 'recordOutbound');
    const adapter = createWhatsAppMirrorAdapter(manager, bindings);
    const destinations = adapter.destinations;
    adapter.destinations = owner => bound ? destinations(owner) : [];
    const availability = adapter.availability;
    adapter.availability = row => bound ? availability(row) : 'unbound';
    const createMirror = () => new SentinelMirrorService({
        dataDir: directory, store, queue, enabled: () => enabled, adapters: [adapter],
    });
    let mirror = createMirror();
    cleanups.push(() => mirror.dispose());
    const capture = (content = 'desktop text', uploads = [upload()], requestId = 'attachment-request') =>
        mirror.capture('workspace-a', processId, content, { attachments: uploads }, requestId);
    const admit = async (content = 'desktop text', uploads = [upload()], requestId = 'attachment-request') => {
        const row = await capture(content, uploads, requestId);
        expect(row).toBeDefined();
        await store.appendConversationTurn(processId, turnIndex => ({
            role: 'user', content, relayRequestId: row!.requestId, turnIndex, timestamp: new Date(), timeline: [],
        }));
        mirror.accepted(row!);
        await mirror.flush();
        return row!;
    };
    const bridge = {
        getTask: queue.getTask,
        findTaskByProcessId: () => undefined,
        enqueueAdmitted: vi.fn(async (input: CreateTaskInput) => {
            const id = input.id ?? `task-${tasks.size}`;
            tasks.set(id, { ...input, id, repoId: input.payload.workspaceId, status: 'queued', createdAt: new Date() } as QueuedTask);
            return id;
        }),
        steerProcess: vi.fn(async () => true),
    };
    Object.assign(bridge, { enqueue: bridge.enqueueAdmitted });
    const deliver = async (input: Partial<FollowUpMessageInput>) => {
        const delivery = new ProcessMessageDeliveryService({
            store, bridge: bridge as unknown as QueueExecutorBridge, sentinelMirror: mirror,
            admission: new ProcessOperationAdmission(),
        });
        return delivery.deliver((await store.getProcess(processId, 'workspace-a'))!, {
            content: 'desktop text', displayContent: 'desktop text', deliveryMode: 'enqueue',
            pasteExternalized: false, mode: 'sentinel', provider: 'copilot', ...input,
        });
    };
    return {
        directory, store, processId, tasks, adapter, calls, sendTo, sendMediaTo, outbound, capture, admit, deliver,
        get mirror() { return mirror; },
        row: (requestId = 'attachment-request') => mirror.outbox.list('workspace-a').find(row => row.role === 'user' && row.requestId === requestId)!,
        setEnabled: (value: boolean) => { enabled = value; },
        setConnected: (value: boolean) => { connected = value; },
        setBound: (value: boolean) => { bound = value; },
        setAccount: (value: string) => { account = value; },
        restart: async () => {
            mirror.dispose();
            mirror = createMirror();
            await mirror.flush();
        },
    };
}

describe('Sentinel mirror upload authority and integrity', () => {
    it('captures actual raw bytes, names, MIME and digest without trusting a reported size', () => {
        const raw = upload('note.txt');
        const [attachment] = captureMirrorUploads({ attachments: [{ ...raw, size: 1 }] });
        expect(attachment).toEqual({
            name: raw.name, mimeType: raw.mimeType, size: Buffer.from('uploaded text').length,
            sha256: createHash('sha256').update('uploaded text').digest('hex'), data: Buffer.from('uploaded text').toString('base64'),
        });
        expect(mirrorAttachmentBytes(attachment)).toEqual(Buffer.from('uploaded text'));
    });

    it('captures legacy raw images only when explicit uploaded attachments are absent', () => {
        const image = upload('pixel.png', 'image/png', png);
        expect(captureMirrorUploads({ images: [image.dataUrl] })[0]).toMatchObject({
            name: 'image-1', mimeType: 'image/png', data: png.toString('base64'),
        });
        expect(captureMirrorUploads({ attachments: [upload()], images: [image.dataUrl] })).toHaveLength(1);
    });

    it('strips path-shaped upload names without retaining filesystem authority', () => {
        for (const name of ['private/notes.txt', 'C:\\private\\notes.txt']) {
            expect(captureMirrorUploads({ attachments: [upload(name)] })[0].name).toBe('notes.txt');
        }
    });

    it.each([
        ['missing bytes', { name: 'notes.txt', mimeType: 'text/plain', size: 1 }],
        ['SDK path', { type: 'file', path: 'private/notes.txt' }],
        ['empty bytes', { ...upload(), dataUrl: 'data:text/plain;base64,' }],
        ['invalid base64', { ...upload(), dataUrl: 'data:text/plain;base64,@@@@' }],
        ['noncanonical base64', { ...upload(), dataUrl: 'data:text/plain;base64,YQ' }],
        ['URL reference', { ...upload(), dataUrl: 'https://example.invalid/notes.txt' }],
        ['MIME mismatch', { ...upload(), mimeType: 'application/pdf' }],
        ['invalid MIME', upload('bad.bin', 'not-a-mime')],
    ])('rejects %s', (_label, raw) => {
        expect(() => captureMirrorUploads({ attachments: [raw] })).toThrow(MirrorAttachmentError);
    });

    it('rejects more than ten files and more than 10 MiB of aggregate decoded bytes', () => {
        expect(() => captureMirrorUploads({ attachments: Array.from({ length: 11 }, () => upload()) })).toThrow(MirrorAttachmentError);
        const large = Buffer.alloc(6 * 1024 * 1024, 1);
        expect(() => captureMirrorUploads({ attachments: [upload('a.bin', 'application/octet-stream', large), upload('b.bin', 'application/octet-stream', large)] }))
            .toThrow('10 MiB');
        expect(() => captureMirrorUploads({ attachments: [upload('large.bin', 'application/octet-stream', Buffer.alloc(10 * 1024 * 1024 + 1))] }))
            .toThrow('10 MiB');
    });

    it('accepts the exact decoded batch boundary independently of reported sizes', () => {
        const bytes = Buffer.alloc(5 * 1024 * 1024, 1);
        const attachments = captureMirrorUploads({
            attachments: [upload('first.bin', 'application/octet-stream', bytes), upload('second.bin', 'application/octet-stream', bytes)],
        });
        expect(attachments.reduce((total, attachment) => total + attachment.size, 0)).toBe(10 * 1024 * 1024);
        expect(attachments.every(attachment => mirrorAttachmentBytes(attachment).equals(bytes))).toBe(true);
    });

    it.each([
        { attachments: upload() },
        { attachments: 'private/notes.txt' },
        { images: upload().dataUrl },
        { attachments: [upload()], images: {} },
    ])('rejects malformed upload containers without silently dropping them', source => {
        expect(() => captureMirrorUploads(source)).toThrow(MirrorAttachmentError);
    });

    it.each([undefined, null, '12', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 10 * 1024 * 1024 + 1])(
        'rejects missing, unsafe or oversize reported metadata (%s)', size => {
            expect(() => captureMirrorUploads({ attachments: [{ ...upload(), size }] })).toThrow(MirrorAttachmentError);
        },
    );

    it('accepts bounded safe size metadata while deriving the actual decoded size', () => {
        for (const size of [0, 1, 10 * 1024 * 1024]) {
            expect(captureMirrorUploads({ attachments: [{ ...upload(), size }] })[0].size).toBe(Buffer.from('uploaded text').length);
        }
    });

    it.each(['data', 'size', 'sha256'] as const)('rejects stored %s tampering before media delivery', field => {
        const attachment = captureMirrorUploads({ attachments: [upload()] })[0];
        const corrupted = { ...attachment, [field]: field === 'size' ? attachment.size + 1 : field === 'sha256' ? '0'.repeat(64) : Buffer.from('tampered').toString('base64') };
        expect(() => mirrorAttachmentBytes(corrupted)).toThrow('integrity');
    });

    it('cannot decode a terminal receipt after upload bytes have been removed', () => {
        const attachment = captureMirrorUploads({ attachments: [upload()] })[0];
        delete attachment.data;
        expect(() => mirrorAttachmentBytes(attachment)).toThrow('unavailable');
    });
});

describe('Sentinel desktop WhatsApp attachment delivery', () => {
    it.each([
        ['pixel.png', 'image/png', png],
        ['report.pdf', 'application/pdf', Buffer.from('%PDF-1.7 test document')],
        ['notes.txt', 'text/plain', Buffer.from('text is a native document, not prompt context')],
        ['vector.svg', 'image/svg+xml', Buffer.from('<svg/>')],
        ['recording.mp3', 'audio/mpeg', Buffer.from('audio document')],
        ['clip.mp4', 'video/mp4', Buffer.from('video document')],
    ])('forwards %s as exact native media with a request-labelled caption', async (name, mimeType, bytes) => {
        const f = await fixture();
        const raw = upload(name, mimeType, bytes);
        const captured = await f.capture('desktop text', [raw]);
        expect(captured!.attachments).toEqual(captureMirrorUploads({ attachments: [raw] }));
        expect(f.calls).toEqual([]);
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: 'desktop text', relayRequestId: captured!.requestId,
            turnIndex, timestamp: new Date(), timeline: [],
        }));
        f.mirror.accepted(captured!);
        await f.mirror.flush();
        expect(f.calls.map(call => call.kind)).toEqual(['text', 'media']);
        expect(f.calls[0].text).toBe(`${header(captured!.requestId, 1, 2)}\n\ndesktop text`);
        expect(f.sendMediaTo).toHaveBeenCalledWith('bound@g.us', {
            bytes, filename: name, mimeType, caption: `${header(captured!.requestId, 2, 2)}\n\n${name}`,
        }, 'root');
        expect(f.calls[1]).toMatchObject({ filename: name, mimeType, bytes });
        expect(f.calls[1].text).not.toContain('cannot be mirrored');
        expect(f.outbound).toHaveBeenCalledWith('sent-1');
        expect(f.outbound).toHaveBeenCalledWith('sent-2');
        expect(f.row()).toMatchObject({ state: 'delivered', nextPart: 2, outboundIds: ['sent-1', 'sent-2'] });
        expect(f.row().attachments![0].data).toBeUndefined();
    });

    it('sends attachment-only submissions without an empty text message', async () => {
        const f = await fixture();
        await f.admit('', [upload()]);
        expect(f.sendTo).not.toHaveBeenCalled();
        expect(f.sendMediaTo).toHaveBeenCalledTimes(1);
        expect(f.calls[0].text).toBe(`${header('attachment-request', 1, 1)}\n\nnotes.txt`);
    });

    it('orders multipart text before multiple media and correlates only the matching answer', async () => {
        const f = await fixture();
        const text = 'Long desktop request. '.repeat(500);
        const row = await f.admit(text, [upload('first.txt'), upload('second.pdf', 'application/pdf')]);
        const kinds = f.calls.map(call => call.kind);
        const firstMedia = kinds.indexOf('media');
        expect(firstMedia).toBeGreaterThan(1);
        expect(kinds.slice(0, firstMedia).every(kind => kind === 'text')).toBe(true);
        expect(kinds.slice(firstMedia)).toEqual(['media', 'media']);
        for (const [index, call] of f.calls.entries()) {
            expect(call.text).toContain(header(row.requestId, index + 1, f.calls.length));
        }
        expect(f.calls.slice(firstMedia).map(call => call.filename)).toEqual(['first.txt', 'second.pdf']);
        const userParts = f.calls.length;
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'matching answer', turnIndex, timestamp: new Date(), timeline: [],
        }));
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: 'unrelated later request', relayRequestId: 'another-request', turnIndex, timestamp: new Date(), timeline: [],
        }));
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'assistant', content: 'unrelated later answer', turnIndex, timestamp: new Date(), timeline: [],
        }));
        await f.mirror.flush();
        await f.mirror.flush();
        expect(f.calls.slice(userParts)).toEqual([{ kind: 'text', text: `${header(row.requestId, 1, 1, 'assistant')}\n\nmatching answer` }]);
        expect(f.sendMediaTo).toHaveBeenCalledTimes(2);
    });

    it.each(['default-off', 'unbound', 'normal-chat', 'wrong-owner', 'unknown-workspace', 'other-server'] as const)(
        'never stages or sends uploads for %s', async exclusion => {
            const f = await fixture();
            if (exclusion === 'default-off') f.setEnabled(false);
            if (exclusion === 'unbound') f.setBound(false);
            if (exclusion === 'normal-chat') {
                await f.store.updateProcess(f.processId, { metadata: { workspaceId: 'workspace-a', mode: 'ask', provider: 'copilot' } });
            }
            const workspaceId = exclusion === 'wrong-owner' ? 'workspace-b' : exclusion === 'unknown-workspace' ? 'unknown' : 'workspace-a';
            const processId = exclusion === 'other-server' ? 'remote-process' : f.processId;
            expect(await f.mirror.capture(workspaceId, processId, 'must stay local', { attachments: [upload()] })).toBeUndefined();
            await f.mirror.flush();
            expect(f.mirror.outbox.list('workspace-a')).toEqual([]);
            expect(f.calls).toEqual([]);
        },
    );

    it('server/connector submissions and source history never create desktop attachment intents', async () => {
        const f = await fixture();
        await f.deliver({ mirrorUploads: { attachments: [upload()] } });
        await f.mirror.flush();
        await f.restart();
        expect(f.mirror.outbox.list('workspace-a')).toEqual([]);
        expect(f.calls).toEqual([]);
    });

    it('mirrors raw desktop text and text-file bytes rather than executor-expanded attachment context', async () => {
        const f = await fixture();
        await f.deliver({
            origin: 'desktop', mirrorContent: 'raw desktop caption', mirrorUploads: { attachments: [upload()] },
            content: 'executor-expanded prompt', displayContent: 'display prompt',
            contentWithContext: 'executor-expanded prompt\n\nprivate SDK context',
            attachments: [{ type: 'file', path: 'private/sdk-file.txt' }],
        });
        await f.mirror.flush();
        const row = f.mirror.outbox.list('workspace-a')[0];
        expect(row.content).toBe('raw desktop caption');
        expect(f.calls[0].text).toBe(`${header(row.requestId, 1, 2)}\n\nraw desktop caption`);
        expect(f.calls[1].bytes).toEqual(Buffer.from('uploaded text'));
        expect(f.calls.some(call => /executor-expanded|private SDK|sdk-file/.test(call.text))).toBe(false);
    });

    it.each([
        ['missing upload bytes', { name: 'notes.txt', mimeType: 'text/plain', size: 12 }],
        ['malformed bytes', { ...upload(), dataUrl: 'data:text/plain;base64,***' }],
        ['corrupt image', upload('pixel.png', 'image/png', Buffer.from('not a png'))],
    ])('rejects %s atomically before text or media network attempts', async (_label, raw) => {
        const f = await fixture();
        await expect(f.mirror.capture('workspace-a', f.processId, 'never forward this text', { attachments: [raw] }))
            .rejects.toThrow(MirrorAttachmentError);
        await f.mirror.flush();
        expect(f.mirror.outbox.list('workspace-a')).toEqual([]);
        expect(f.sendTo).not.toHaveBeenCalled();
        expect(f.sendMediaTo).not.toHaveBeenCalled();
    });

    it('rejects aggregate oversize uploads without forwarding the valid preceding file or text', async () => {
        const f = await fixture();
        const raw = upload('large.bin', 'application/octet-stream', Buffer.alloc(6 * 1024 * 1024, 1));
        await expect(f.mirror.capture('workspace-a', f.processId, 'must not leak', { attachments: [raw, raw] }))
            .rejects.toThrow('10 MiB');
        expect(f.calls).toEqual([]);
        expect(f.mirror.outbox.list('workspace-a')).toEqual([]);
    });

    it('rejects an entire mixed batch when a later image is invalid', async () => {
        const f = await fixture();
        await expect(f.mirror.capture('workspace-a', f.processId, 'must not forward', {
            attachments: [upload(), upload('invalid.png', 'image/png', Buffer.from('invalid image'))],
        })).rejects.toThrow(MirrorAttachmentError);
        expect(f.mirror.outbox.list('workspace-a')).toEqual([]);
        expect(f.calls).toEqual([]);
    });

    it.each([
        { attachments: upload() },
        { attachments: 'private/notes.txt' },
        { images: upload().dataUrl },
        { attachments: [upload()], images: {} },
    ])('rejects malformed upload containers before forwarding text or valid sibling files', async source => {
        const f = await fixture();
        await expect(f.mirror.capture('workspace-a', f.processId, 'must not forward', source))
            .rejects.toThrow(MirrorAttachmentError);
        expect(f.mirror.outbox.list('workspace-a')).toEqual([]);
        expect(f.calls).toEqual([]);
    });

    it('forwards non-raster legacy image MIME bytes as an attachment rather than rejecting them', async () => {
        const f = await fixture();
        const row = await f.mirror.capture('workspace-a', f.processId, 'desktop text', {
            images: [upload('vector.svg', 'image/svg+xml', Buffer.from('<svg/>')).dataUrl],
        });
        expect(row).toBeDefined();
        f.mirror.accepted(row!);
        await f.mirror.flush();
        expect(f.sendMediaTo).toHaveBeenCalledWith('bound@g.us', {
            bytes: Buffer.from('<svg/>'), filename: 'image-1', mimeType: 'image/svg+xml',
            caption: `${header(row!.requestId, 2, 2)}\n\nimage-1`,
        }, 'root');
    });

    it('never reads SDK file references, including a symlink to private bytes', async () => {
        const f = await fixture();
        const privateFile = path.join(f.directory, 'private.txt');
        const link = path.join(f.directory, 'linked.txt');
        fs.writeFileSync(privateFile, 'private bytes must not leave');
        try { fs.symlinkSync(privateFile, link, 'file'); }
        catch (error) {
            if (!['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        }
        vi.mocked(fs.readFileSync).mockClear();
        for (const reference of [privateFile, link, '../private.txt', 'file:///private.txt']) {
            await expect(f.mirror.capture('workspace-a', f.processId, 'do not forward', {
                attachments: [{ type: 'file', path: reference, name: 'private.txt' }],
            })).rejects.toThrow(MirrorAttachmentError);
        }
        const reads = vi.mocked(fs.readFileSync).mock.calls.map(([file]) => String(file));
        expect(reads).not.toContain(privateFile);
        expect(reads).not.toContain(link);
        expect(f.calls).toEqual([]);
    });

    it('retains embedded bytes on disconnect and sends after source deletion and restart', async () => {
        const f = await fixture();
        f.setConnected(false);
        const source = path.join(f.directory, 'source.txt');
        fs.writeFileSync(source, 'uploaded text');
        const raw = { ...upload(), path: source };
        await f.admit('desktop text', [raw]);
        expect(f.row()).toMatchObject({ state: 'pending', attachments: [{ data: Buffer.from('uploaded text').toString('base64') }] });
        expect(JSON.stringify(f.row())).not.toContain(source);
        fs.unlinkSync(source);
        vi.mocked(fs.readFileSync).mockClear();
        await f.restart();
        expect(f.calls).toEqual([]);
        expect(f.row().attachments![0].data).toBeDefined();
        f.setConnected(true);
        await f.mirror.flush();
        expect(f.calls[1].bytes).toEqual(Buffer.from('uploaded text'));
        expect(vi.mocked(fs.readFileSync).mock.calls.map(([file]) => String(file))).not.toContain(source);
        expect(f.row().attachments![0].data).toBeUndefined();
    });

    it('does not resend acknowledged text or first media after a definite partial failure and restart', async () => {
        const f = await fixture();
        f.sendMediaTo.mockImplementationOnce(async (_chat, media) => {
            f.calls.push({ kind: 'media', text: media.caption ?? '', filename: media.filename, bytes: media.bytes, mimeType: media.mimeType });
            return 'sent-2';
        }).mockRejectedValueOnce(new WhatsAppNotConnectedError());
        await f.admit('desktop text', [upload('first.txt'), upload('second.txt')]);
        expect(f.row()).toMatchObject({ state: 'retryable', nextPart: 2, outboundIds: ['sent-1', 'sent-2'] });
        expect(f.row().attachments![0].data).toBeUndefined();
        expect(f.row().attachments![1].data).toBeDefined();
        const retryAt = Date.parse(f.row().nextAttemptAt!);
        vi.spyOn(Date, 'now').mockReturnValue(retryAt + 1);
        await f.restart();
        expect(f.sendTo).toHaveBeenCalledTimes(1);
        expect(f.sendMediaTo.mock.calls.map(([, media]) => media.filename)).toEqual(['first.txt', 'second.txt', 'second.txt']);
        expect(f.row().state).toBe('delivered');
        expect(f.row().attachments!.every(attachment => attachment.data === undefined)).toBe(true);
    });

    it('quarantines unknown media outcomes across restart without replaying acknowledged text or media', async () => {
        const f = await fixture();
        f.sendMediaTo.mockRejectedValueOnce(new Error('unknown transport outcome'));
        await f.admit();
        expect(f.row()).toMatchObject({ state: 'ambiguous', failure: 'unknown', nextPart: 1 });
        expect(f.row().attachments![0].data).toBeDefined();
        await f.restart();
        await f.mirror.flush();
        expect(f.sendTo).toHaveBeenCalledTimes(1);
        expect(f.sendMediaTo).toHaveBeenCalledTimes(1);
        expect(f.row().state).toBe('ambiguous');
    });

    it('recognizes an uncertain native image caption echo only for its exact captured sender and destination', async () => {
        const f = await fixture();
        f.sendMediaTo.mockRejectedValueOnce(new Error('unknown transport outcome'));
        await f.admit('caption', [upload('pixel.png', 'image/png', png)]);
        const caption = f.row().chunks[1];
        await f.restart();
        const echo = {
            connector: 'whatsapp' as const, chatKey: 'bound@g.us', threadId: 'root',
            accountKey: 'account-pin', isSelf: true, workspaceId: 'workspace-a', processId: f.processId, text: caption,
        };
        expect(await f.mirror.isOwnMirrorMessage(echo)).toBe(true);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, accountKey: 'other-account' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, chatKey: 'other@g.us' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, workspaceId: 'workspace-b' })).toBe(false);
        expect(await f.mirror.isOwnMirrorMessage({ ...echo, isSelf: false })).toBe(false);
        expect(f.sendTo).toHaveBeenCalledTimes(1);
        expect(f.sendMediaTo).toHaveBeenCalledTimes(1);
    });

    it.each(['missing', 'base64', 'digest', 'size'] as const)(
        'cancels %s corrupted remaining bytes after restart with a fixed private display-only notice', async corruption => {
            const f = await fixture();
            f.sendMediaTo.mockImplementationOnce(async (_chat, media) => {
                f.calls.push({ kind: 'media', text: media.caption ?? '', filename: media.filename, bytes: media.bytes, mimeType: media.mimeType });
                f.setConnected(false);
                return 'sent-2';
            });
            await f.admit('desktop text', [upload('first.txt'), upload('second.txt')]);
            expect(f.row()).toMatchObject({ state: 'pending', nextPart: 2, outboundIds: ['sent-1', 'sent-2'] });
            expect(f.row().attachments![0].data).toBeUndefined();
            const ledger = getRepoDataPath(f.directory, 'workspace-a', 'sentinel-mirror-outbox.json');
            const rows = f.mirror.outbox.list('workspace-a');
            const attachment = rows[0].attachments![1];
            if (corruption === 'missing') delete attachment.data;
            if (corruption === 'base64') attachment.data = '!!!';
            if (corruption === 'digest') attachment.sha256 = '0'.repeat(64);
            if (corruption === 'size') attachment.size++;
            fs.writeFileSync(ledger, JSON.stringify(rows));
            f.setConnected(true);
            await f.restart();
            await f.mirror.flush();
            expect(f.sendTo).toHaveBeenCalledTimes(1);
            expect(f.sendMediaTo).toHaveBeenCalledTimes(1);
            expect(f.row()).toMatchObject({
                state: 'cancelled', failure: 'attachment-invalid', cancelRequested: true,
                nextPart: 2, outboundIds: ['sent-1', 'sent-2'],
            });
            expect(f.row().attachments!.every(value => value.data === undefined)).toBe(true);
            const proc = (await f.store.getProcess(f.processId, 'workspace-a'))!;
            const notices = proc.conversationTurns!.filter(turn =>
                turn.relayRequestId === `sentinel-mirror-status:${f.row().eventId}:attachment-invalid`);
            expect(notices).toHaveLength(1);
            expect(notices[0]).toMatchObject({
                displayOnly: true,
                content: 'Sentinel mirror: Stored attachment bytes are unavailable or invalid. Delivery stopped; already confirmed parts were not resent.',
            });
            expect(notices[0].content).not.toMatch(/second\.txt|uploaded text|!!!/);
            await f.restart();
            expect(f.sendTo).toHaveBeenCalledTimes(1);
            expect(f.sendMediaTo).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['request', 'unbinding', 'account-change'] as const)('cleans unsent bytes on %s cancellation', async reason => {
        const f = await fixture();
        f.setConnected(false);
        await f.admit();
        if (reason === 'request') await f.mirror.cancelRequest('workspace-a', f.processId, 'attachment-request');
        if (reason === 'unbinding') f.setBound(false);
        if (reason === 'account-change') {
            f.setAccount('replacement-account');
            f.setConnected(true);
        }
        await f.mirror.flush();
        expect(f.row().state).toBe('cancelled');
        expect(f.row().attachments![0].data).toBeUndefined();
        f.setConnected(true);
        await f.restart();
        expect(f.calls).toEqual([]);
    });

    it('cleans upload bytes when durable admission is rejected', async () => {
        const f = await fixture();
        const row = (await f.capture())!;
        expect(await f.mirror.rejected(row)).toBe(true);
        expect(f.row()).toMatchObject({ state: 'cancelled', failure: 'admission-rejected' });
        expect(f.row().attachments![0].data).toBeUndefined();
        expect(f.calls).toEqual([]);
    });

    it('keeps cancellation effective when an in-flight media send later acknowledges', async () => {
        const f = await fixture();
        let acknowledge!: (id: string) => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        f.sendMediaTo.mockImplementationOnce(async () => {
            entered();
            return new Promise<string>(resolve => { acknowledge = resolve; });
        });
        const row = (await f.capture())!;
        await f.store.appendConversationTurn(f.processId, turnIndex => ({
            role: 'user', content: 'desktop text', relayRequestId: row.requestId,
            turnIndex, timestamp: new Date(), timeline: [],
        }));
        f.mirror.accepted(row);
        await started;
        expect(f.row()).toMatchObject({ state: 'sending', nextPart: 1 });
        await f.mirror.cancelRequest('workspace-a', f.processId, row.requestId);
        expect(f.row().cancelRequested).toBe(true);
        expect(f.row().attachments![0].data).toBeDefined();
        acknowledge('media-ack');
        await f.mirror.flush();
        expect(f.row()).toMatchObject({ state: 'cancelled', nextPart: 2, outboundIds: ['sent-1', 'media-ack'] });
        expect(f.row().attachments![0].data).toBeUndefined();
        await f.restart();
        expect(f.sendMediaTo).toHaveBeenCalledTimes(1);
    });

    it('outbox rejects changed upload bytes for the same immutable request identity', async () => {
        const f = await fixture();
        const row = (await f.capture())!;
        expect(() => f.mirror.outbox.stage({
            workspaceId: row.workspaceId, processId: row.processId, requestId: row.requestId,
            destination: row.destination, role: row.role, content: row.content,
            attachments: captureMirrorUploads({ attachments: [upload('notes.txt', 'text/plain', Buffer.from('different bytes'))] }),
        })).toThrow('conflicts');
        expect(f.row().attachments).toEqual(row.attachments);
        expect(f.calls).toEqual([]);
    });

    it('keeps reference-only numeric input as a path-free text marker without native media', async () => {
        const f = await fixture();
        const row = await f.mirror.capture('workspace-a', f.processId, 'reference-only', 2);
        expect(row!.attachments).toBeUndefined();
        expect(row!.content).toBe('reference-only\n\n[2 attachment(s) cannot be mirrored; view them in the desktop chat.]');
        f.mirror.accepted(row!);
        await f.mirror.flush();
        expect(f.sendTo).toHaveBeenCalledTimes(1);
        expect(f.sendMediaTo).not.toHaveBeenCalled();
    });

    it('persists interrupted media attempts as ambiguous with embedded bytes and immutable captions', async () => {
        const f = await fixture();
        const row = (await f.capture('', [upload()]))!;
        const outbox = f.mirror.outbox;
        outbox.accept('workspace-a', row.eventId);
        outbox.prepare('workspace-a', row.eventId, [header(row.requestId, 1, 1)]);
        expect(outbox.beginPart('workspace-a', row.eventId)).toBeDefined();
        const restored = new SentinelMirrorOutbox(f.directory);
        restored.recover('workspace-a');
        expect(restored.list('workspace-a')[0]).toMatchObject({
            state: 'ambiguous', failure: 'unknown', nextPart: 0,
            chunks: [header(row.requestId, 1, 1)], attachments: captureMirrorUploads({ attachments: [upload()] }),
        });
        expect(restored.beginPart('workspace-a', row.eventId)).toBeUndefined();
        expect(f.calls).toEqual([]);
    });
});
