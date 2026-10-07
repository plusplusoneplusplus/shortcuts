import { createCipheriv, createHmac } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import axios from 'axios';
import { getMediaKeys, proto } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWhatsAppImage } from '../../src/whatsapp/inbound-image';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const mediaKey = Buffer.alloc(32, 7);
const directPath = '/v/t62.7118-24/image.enc?token=private-token';
const nativeImage = (overrides = {}) => proto.Message.ImageMessage.fromObject({
    mimetype: 'image/png', mediaKey, directPath, fileLength: String(png.length),
    url: 'https://untrusted.example/steal', ...overrides,
});

async function encryptedImage(data: Buffer): Promise<Buffer> {
    const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, 'image');
    const cipher = createCipheriv('aes-256-cbc', cipherKey, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const mac = createHmac('sha256', macKey).update(iv).update(encrypted).digest().subarray(0, 10);
    return Buffer.concat([encrypted, mac]);
}

describe('WhatsApp image transport (real Baileys decryption, mocked HTTP)', () => {
    let lifetime: AbortController;
    beforeEach(() => { lifetime = new AbortController(); });
    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

    it('decrypts real media response bytes and keeps requests on the fixed media origin', async () => {
        const encrypted = await encryptedImage(png);
        const http = vi.spyOn(axios, 'get').mockResolvedValue({ data: Readable.from([encrypted]) });
        const image = createWhatsAppImage(nativeImage(), lifetime.signal);
        expect(http).not.toHaveBeenCalled();
        expect(image.mimeType).toBe('image/png');
        expect(await image.download({ maxBytes: png.length })).toEqual(png);
        expect(http).toHaveBeenCalledWith(`https://mmg.whatsapp.net${directPath}`, expect.objectContaining({
            signal: expect.any(AbortSignal), timeout: 30_000, maxRedirects: 0, responseType: 'stream',
        }));
    });

    it('normalizes MIME parameters', () => {
        expect(createWhatsAppImage(nativeImage({ mimetype: 'IMAGE/PNG; charset=binary' }), lifetime.signal).mimeType)
            .toBe('image/png');
    });

    it('rejects declared and actual oversize bytes without trusting a smaller declared size', async () => {
        const http = vi.spyOn(axios, 'get').mockResolvedValue({ data: Readable.from([await encryptedImage(png)]) });
        await expect(createWhatsAppImage(nativeImage(), lifetime.signal).download({ maxBytes: png.length - 1 }))
            .rejects.toMatchObject({ code: 'size-limit' });
        expect(http).not.toHaveBeenCalled();
        await expect(createWhatsAppImage(nativeImage({ fileLength: '1' }), lifetime.signal)
            .download({ maxBytes: png.length - 1 })).rejects.toMatchObject({ code: 'size-limit' });
        expect(http).toHaveBeenCalledOnce();
    });

    it.each([
        { directPath: undefined }, { directPath: '//untrusted.example/image' },
        { directPath: 'https://untrusted.example/image' }, { mediaKey: Buffer.alloc(0) },
    ])('rejects malformed media locations and keys without HTTP', async overrides => {
        const http = vi.spyOn(axios, 'get');
        await expect(createWhatsAppImage(nativeImage(overrides), lifetime.signal).download({ maxBytes: 100 }))
            .rejects.toMatchObject({ code: 'download' });
        expect(http).not.toHaveBeenCalled();
    });

    it('returns safe feedback for HTTP failure', async () => {
        vi.spyOn(axios, 'get').mockRejectedValue(new Error(`401: ${directPath}; Authorization: secret`));
        await expect(createWhatsAppImage(nativeImage(), lifetime.signal).download({ maxBytes: 100 }))
            .rejects.toThrow('Could not download the image. Send the image again.');
    });

    it('rejects unsupported MIME and decrypted content', async () => {
        const http = vi.spyOn(axios, 'get').mockResolvedValue({ data: Readable.from([await encryptedImage(Buffer.from('<svg/>'))]) });
        await expect(createWhatsAppImage(nativeImage({ mimetype: 'image/svg+xml' }), lifetime.signal)
            .download({ maxBytes: 100 })).rejects.toMatchObject({ code: 'unsupported' });
        expect(http).not.toHaveBeenCalled();
        await expect(createWhatsAppImage(nativeImage(), lifetime.signal).download({ maxBytes: 100 }))
            .rejects.toMatchObject({ code: 'unsupported' });
    });

    it('cancels stalled HTTP acquisition when the connector stops', async () => {
        const http = vi.spyOn(axios, 'get').mockImplementation(async (_url, config) => {
            return new Promise((_, reject) => {
                config!.signal!.addEventListener!('abort', () => reject(new Error('aborted secret HTTP details')));
            });
        });
        const result = createWhatsAppImage(nativeImage(), lifetime.signal).download({ maxBytes: 100 });
        const rejection = expect(result).rejects.toMatchObject({ code: 'cancelled' });
        await vi.waitFor(() => expect(http).toHaveBeenCalledOnce());
        lifetime.abort();
        await rejection;
        expect(http.mock.calls[0][1]?.signal?.aborted).toBe(true);
    });

    it('times out a stalled encrypted response and aborts its HTTP signal', async () => {
        const encryptedStream = new PassThrough();
        const http = vi.spyOn(axios, 'get').mockResolvedValue({ data: encryptedStream });
        vi.useFakeTimers();
        const result = createWhatsAppImage(nativeImage(), lifetime.signal).download({ maxBytes: 100, timeoutMs: 30_000 });
        const rejection = expect(result).rejects.toMatchObject({ code: 'timeout' });
        // Dynamic import/key derivation can need real event-loop work before HTTP.
        // Start the stalled-stream assertion only once acquisition has completed.
        await vi.waitFor(() => expect(http).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        expect(http.mock.calls[0][1]?.signal?.aborted).toBe(true);
        encryptedStream.destroy();
    });
});
