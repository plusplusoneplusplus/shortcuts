import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createCipheriv, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import axios from 'axios';
import { getMediaKeys, proto } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type InboundImage, ImageDownloadError } from '@plusplusoneplusplus/coc-connector';
import { createWhatsAppImage } from '../../../../coc-connector/src/whatsapp/inbound-image';
import { GraphChannelReader } from '../../../../coc-connector/src/teams/graph/channel-reader';
import { MAX_ATTACHMENT_SIZE } from '../../../src/server/core/attachment-utils';
import * as attachmentUtils from '../../../src/server/core/attachment-utils';
import { cleanupTempDir } from '../../../src/server/core/image-utils';
import { getRepoDataPath } from '../../../src/server/paths';
import {
    prepareIncomingImages, MAX_MESSAGING_IMAGES, MAX_MESSAGING_IMAGE_BATCH_BYTES,
} from '../../../src/server/messaging/incoming-images';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let dataDir: string;
const stops: Array<() => void> = [];

beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-incoming-image-test-')); });
afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Real native metadata and transport/decryption code, with only HTTP mocked. */
async function nativeImage(platform: 'whatsapp' | 'teams', options: {
    data?: Buffer; mimeType?: string; failure?: boolean; stall?: boolean; declaredSize?: number; fileReference?: boolean;
} = {}) {
    const bytes = options.data ?? png;
    const mimeType = options.mimeType ?? 'image/png';
    if (platform === 'whatsapp') {
        const lifetime = new AbortController();
        stops.push(() => lifetime.abort());
        const mediaKey = Buffer.alloc(32, 7);
        const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, 'image');
        const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
        const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
        const mac = createHmac('sha256', macKey).update(iv).update(encrypted).digest().subarray(0, 10);
        const request = vi.spyOn(axios, 'get').mockImplementation(async () => {
            if (options.failure) throw new Error('Authorization: private-token https://private.example');
            if (options.stall) return new Promise(() => {});
            return { data: Readable.from([Buffer.concat([encrypted, mac])]) };
        });
        const image = createWhatsAppImage(proto.Message.ImageMessage.fromObject({
            mimetype: mimeType, caption: '/ask describe this', mediaKey,
            directPath: '/v/t62.7118-24/image.enc', fileLength: options.declaredSize ?? bytes.length,
        }), lifetime.signal);
        return { image, request, stop: () => lifetime.abort() };
    }
    const account = { tenantId: 'tenant', objectId: 'reader' };
    const token = 'header.' + Buffer.from(JSON.stringify({ tid: account.tenantId, oid: account.objectId,
        aud: 'https://graph.microsoft.com', scp: 'ChannelMessage.Read.All Files.Read',
        exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.signature';
    const reader = new GraphChannelReader(account, { acquireToken: async () => token }, true);
    stops.push(() => reader.stop());
    const request = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ value: [{
        id: 'message', createdDateTime: '2026-01-01T00:00:01Z',
        from: { user: { id: 'sender', displayName: 'Person' } },
        body: { contentType: 'html', content: options.fileReference ? '<p>/ask describe this</p>'
            : '<p>/ask describe this<img src="../hostedContents/image/$value"></p>' },
        ...(options.fileReference ? { attachments: [{ id: 'file', contentType: 'reference',
            name: 'photo.png', contentUrl: 'https://tenant.sharepoint.com/sites/test/photo.png' }] } : {}),
    }] })));
    vi.stubGlobal('fetch', request);
    await reader.initialize();
    const page = await reader.page('team', 'channel');
    request.mockClear();
    request.mockImplementation(async () => {
        if (options.failure) return new Response('private-token', { status: 500 });
        if (options.stall) return new Promise(() => {});
        return new Response(bytes, { headers: { 'Content-Type': mimeType,
            'Content-Length': String(options.declaredSize ?? bytes.length) } });
    });
    return { image: page.messages[0].images![0], request, stop: () => reader.stop() };
}

function descriptor(data = png, mimeType = 'image/png'): InboundImage {
    return { mimeType, download: vi.fn(async () => data) };
}

describe.each(['whatsapp', 'teams'] as const)('%s incoming-image storage', platform => {
    it('stores authenticated bytes beneath the resolved workspace using real SDK attachments and history metadata', async () => {
        const fixture = await nativeImage(platform);
        expect(fixture.request).not.toHaveBeenCalled();
        const result = await prepareIncomingImages(dataDir, 'workspace-a', [fixture.image]);
        expect(fixture.request).toHaveBeenCalledOnce();
        expect(path.dirname(result.imageTempDir)).toBe(getRepoDataPath(dataDir, 'workspace-a', 'attachments'));
        expect(result.sdkAttachments).toEqual([{ type: 'file',
            path: path.join(result.imageTempDir, 'image-1.png'), displayName: 'image-1' }]);
        expect(fs.readFileSync(result.sdkAttachments[0].path)).toEqual(png);
        expect(result.validatedImages).toEqual([`data:image/png;base64,${png.toString('base64')}`]);
        expect(result.fileAttachmentMeta).toEqual([{ name: 'image-1', mimeType: 'image/png', size: png.length, category: 'image' }]);
        expect(result.textContext).toBe('');
        cleanupTempDir(result.imageTempDir);
        expect(fs.existsSync(result.imageTempDir)).toBe(false);
    });

    it('fails the whole batch on a transport failure with safe resend feedback and no files', async () => {
        const fixture = await nativeImage(platform, { failure: true });
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [descriptor(), fixture.image]))
            .rejects.toThrow('Could not download the image. Send the image again.');
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it.each([
        { data: Buffer.from('<svg/>'), mimeType: 'image/svg+xml' },
        { data: Buffer.from('not an image'), mimeType: 'image/png' },
    ])('rejects unsupported MIME or mismatched bytes without persistence', async options => {
        const fixture = await nativeImage(platform, options);
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [fixture.image]))
            .rejects.toMatchObject({ code: 'unsupported' });
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('enforces declared transport size before persistence', async () => {
        const fixture = await nativeImage(platform, { declaredSize: MAX_ATTACHMENT_SIZE + 1 });
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [fixture.image]))
            .rejects.toMatchObject({ code: 'size-limit' });
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('preserves connector-stop cancellation during stalled acquisition', async () => {
        const fixture = await nativeImage(platform, { stall: true });
        const result = prepareIncomingImages(dataDir, 'workspace-a', [fixture.image]);
        const rejected = expect(result).rejects.toMatchObject({ code: 'cancelled' });
        await vi.waitFor(() => expect(fixture.request).toHaveBeenCalledOnce());
        fixture.stop();
        await rejected;
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('preserves caller cancellation during stalled acquisition', async () => {
        const fixture = await nativeImage(platform, { stall: true });
        const controller = new AbortController();
        const result = prepareIncomingImages(dataDir, 'workspace-a', [fixture.image], controller.signal);
        const rejected = expect(result).rejects.toMatchObject({ code: 'cancelled' });
        await vi.waitFor(() => expect(fixture.request).toHaveBeenCalledOnce());
        controller.abort();
        await rejected;
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('bounds stalled acquisition to 30 seconds without leaving files', async () => {
        const fixture = await nativeImage(platform, { stall: true });
        vi.useFakeTimers();
        const result = prepareIncomingImages(dataDir, 'workspace-a', [fixture.image]);
        const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' });
        await vi.advanceTimersByTimeAsync(30_000);
        await rejected;
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });
});

describe('incoming-image batch storage boundaries', () => {
    it('stores native Teams file-reference bytes with response MIME resolved during download', async () => {
        const fixture = await nativeImage('teams', { fileReference: true });
        expect(fixture.image.mimeType).toBe('');
        const result = await prepareIncomingImages(dataDir, 'workspace-a', [fixture.image]);
        expect(fs.readFileSync(result.sdkAttachments[0].path)).toEqual(png);
        expect(result.fileAttachmentMeta?.[0].mimeType).toBe('image/png');
        expect(fixture.request.mock.calls[0][0]).toMatch(/^https:\/\/graph\.microsoft\.com\/beta\/shares\/u!/);
    });

    it('isolates workspaces and concurrent turns and never reuses a caller-supplied filename', async () => {
        const results = await Promise.all(['workspace-a', 'workspace-b', 'workspace-a'].map(workspace =>
            prepareIncomingImages(dataDir, workspace, [descriptor()])));
        expect(new Set(results.map(result => result.imageTempDir)).size).toBe(3);
        for (const [index, result] of results.entries()) {
            expect(path.dirname(result.imageTempDir)).toBe(getRepoDataPath(dataDir,
                index === 1 ? 'workspace-b' : 'workspace-a', 'attachments'));
            expect(fs.readdirSync(result.imageTempDir)).toEqual(['image-1.png']);
        }
        expect(fs.readdirSync(dataDir)).toEqual(['repos']);
    });

    it('keeps a full five-image batch in order with extensions matching response MIME', async () => {
        const inputs = [descriptor(), descriptor(Buffer.from([255, 216, 255, 1]), 'image/jpeg'),
            descriptor(Buffer.from('GIF89a1'), 'image/gif'), descriptor(Buffer.from('RIFF0000WEBP1'), 'image/webp'), descriptor()];
        const result = await prepareIncomingImages(dataDir, 'workspace-a', inputs);
        expect(result.sdkAttachments.map(attachment => path.basename(attachment.path)))
            .toEqual(['image-1.png', 'image-2.jpg', 'image-3.gif', 'image-4.webp', 'image-5.png']);
        expect(result.validatedImages).toHaveLength(MAX_MESSAGING_IMAGES);
        expect(result.fileAttachmentMeta?.map(meta => meta.mimeType)).toEqual(inputs.map(image => image.mimeType));
    });

    it.each([0, MAX_MESSAGING_IMAGES + 1])('rejects %i images without downloading or silently truncating', async count => {
        const image = descriptor();
        await expect(prepareIncomingImages(dataDir, 'workspace-a', Array(count).fill(image)))
            .rejects.toMatchObject({ code: 'batch-limit' });
        expect(image.download).not.toHaveBeenCalled();
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it.each(['', '..', '../workspace', '/workspace', 'a/b', 'a\\b', 'C:drive', 'ws\0id'])
    ('rejects unsafe workspace identifiers before download or filesystem writes: %s', async workspace => {
        const image = descriptor();
        await expect(prepareIncomingImages(dataDir, workspace, [image])).rejects.toMatchObject({ code: 'workspace' });
        expect(image.download).not.toHaveBeenCalled();
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('accepts the exact decoded batch byte limit and rejects a larger batch atomically', async () => {
        const large = Buffer.alloc(MAX_MESSAGING_IMAGE_BATCH_BYTES - png.length);
        png.copy(large);
        const result = await prepareIncomingImages(dataDir, 'workspace-a', [descriptor(large), descriptor()]);
        expect(result.fileAttachmentMeta?.reduce((total, meta) => total + meta.size, 0)).toBe(MAX_ATTACHMENT_SIZE);
        await expect(prepareIncomingImages(dataDir, 'workspace-b', [descriptor(large), descriptor(), descriptor()]))
            .rejects.toMatchObject({ code: 'size-limit' });
        expect(fs.existsSync(getRepoDataPath(dataDir, 'workspace-b', 'attachments'))).toBe(false);
    });

    it('rechecks actual bytes even when a descriptor ignores the limit', async () => {
        const large = Buffer.alloc(MAX_ATTACHMENT_SIZE + 1);
        png.copy(large);
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [descriptor(large)]))
            .rejects.toMatchObject({ code: 'size-limit' });
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('bounds the whole batch to 30 seconds even when a later image stalls', async () => {
        vi.useFakeTimers();
        const first: InboundImage = { mimeType: 'image/png', download: async () => {
            await new Promise(resolve => setTimeout(resolve, 20_000));
            return png;
        } };
        const second: InboundImage = { mimeType: 'image/png', download: vi.fn(async () => new Promise<Buffer>(() => {})) };
        const result = prepareIncomingImages(dataDir, 'workspace-a', [first, second]);
        let settled = false;
        void result.catch(() => { settled = true; });
        const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' });
        await vi.advanceTimersByTimeAsync(20_000);
        expect(second.download).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 10_000,
            maxBytes: MAX_MESSAGING_IMAGE_BATCH_BYTES - png.length, signal: expect.any(AbortSignal) }));
        await vi.advanceTimersByTimeAsync(9_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('does not start a download when already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        const image = descriptor();
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [image], controller.signal))
            .rejects.toMatchObject({ code: 'cancelled' });
        expect(image.download).not.toHaveBeenCalled();
    });

    it('cancels before storage if the caller aborts while the final image resolves', async () => {
        const controller = new AbortController();
        const image = { mimeType: 'image/png', download: async () => { controller.abort(); return png; } };
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [image], controller.signal))
            .rejects.toMatchObject({ code: 'cancelled' });
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('sanitizes unexpected transport errors instead of exposing credentials', async () => {
        const image = { mimeType: 'image/png', download: async () => { throw new Error('private-token secret URL'); } };
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [image])).rejects.toThrow(new ImageDownloadError('download').message);
    });

    it('returns storage-specific feedback when the workspace attachment root is unavailable', async () => {
        const root = getRepoDataPath(dataDir, 'workspace-a', 'attachments');
        fs.mkdirSync(path.dirname(root), { recursive: true });
        fs.writeFileSync(root, 'occupied');
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [descriptor()]))
            .rejects.toThrow('Could not save the images. Check server storage and send them again.');
        expect(fs.readFileSync(root, 'utf8')).toBe('occupied');
    });

    it('removes a partial batch when writing a later file fails', async () => {
        const original = attachmentUtils.processMessageAttachments;
        let firstFileWritten = false;
        vi.spyOn(attachmentUtils, 'processMessageAttachments').mockImplementation((body, dir) => {
            // A directory at the second output path causes a real filesystem error.
            fs.mkdirSync(path.join(dir, 'image-2.png'));
            try { return original(body, dir); }
            finally { firstFileWritten = fs.existsSync(path.join(dir, 'image-1.png')); }
        });
        await expect(prepareIncomingImages(dataDir, 'workspace-a', [descriptor(), descriptor()]))
            .rejects.toMatchObject({ code: 'storage' });
        expect(firstFileWritten).toBe(true);
        expect(fs.readdirSync(getRepoDataPath(dataDir, 'workspace-a', 'attachments'))).toEqual([]);
    });
});
