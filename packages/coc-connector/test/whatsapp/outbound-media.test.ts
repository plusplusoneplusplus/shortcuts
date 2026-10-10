import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    WhatsAppBot, WhatsAppMediaError, WHATSAPP_MEDIA_MAX_BYTES, validateWhatsAppMedia,
    type WhatsAppOutboundMedia, type WASocket,
} from '../../src/whatsapp';
import { createBaileysConnection, type ConnectionOptions } from '../../src/whatsapp/connection';

vi.mock('../../src/whatsapp/connection', () => ({ createBaileysConnection: vi.fn() }));

describe('WhatsApp outbound media (stub transport)', () => {
    let bot: WhatsAppBot;
    let sock: WASocket;
    let connection: ConnectionOptions;
    let inbound: (...args: unknown[]) => void;
    let onMessage: ReturnType<typeof vi.fn>;
    const document: WhatsAppOutboundMedia = {
        bytes: Buffer.from('synthetic document'),
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        caption: 'Attachment caption',
    };

    beforeEach(async () => {
        onMessage = vi.fn().mockResolvedValue(undefined);
        sock = {
            ev: { on: (_event, handler) => { inbound = handler; } },
            sendMessage: vi.fn().mockResolvedValue({ key: { id: 'media-id' } }),
            groupCreate: vi.fn(),
            groupFetchAllParticipating: vi.fn(),
            end: vi.fn(),
        };
        vi.mocked(createBaileysConnection).mockImplementation(async opts => {
            connection = opts;
            opts.onConnected(sock);
            return sock;
        });
        bot = new WhatsAppBot({ sessionDir: 'synthetic-session', onMessage, printQR: false });
        await bot.start();
    });

    afterEach(async () => {
        await bot.stop();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it.each([
        ['image/png', 'capture.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
        ['image/jpeg', 'capture.jpg', Buffer.from([255, 216, 255])],
        ['image/gif', 'capture.gif', Buffer.from('GIF89a')],
        ['image/webp', 'capture.webp', Buffer.from('RIFF0000WEBP')],
    ])('sends %s as a native image preserving bytes and metadata', async (mimeType, filename, bytes) => {
        expect(await bot.sendMedia('group@g.us', { bytes, filename, mimeType, caption: 'Capture' })).toBe('media-id');
        expect(sock.sendMessage).toHaveBeenCalledExactlyOnceWith('group@g.us', {
            image: bytes, mimetype: mimeType, fileName: filename, caption: 'Capture',
        }, undefined);
        expect(vi.mocked(sock.sendMessage).mock.calls[0][1]).toHaveProperty('image', bytes);
    });

    it.each(['application/pdf', 'application/octet-stream', 'audio/mpeg', 'video/mp4', 'image/svg+xml', 'text/plain'])(
        'sends %s as a document without special audio/video handling', async mimeType => {
            await bot.sendMedia('group@g.us', { ...document, mimeType });
            expect(sock.sendMessage).toHaveBeenCalledExactlyOnceWith('group@g.us', {
                document: document.bytes, mimetype: mimeType, fileName: document.filename, caption: document.caption,
            }, undefined);
        },
    );

    it('allows an absent or empty caption and normalizes MIME case', async () => {
        await bot.sendMedia('group@g.us', { ...document, caption: undefined, mimeType: 'APPLICATION/PDF' });
        expect(vi.mocked(sock.sendMessage).mock.calls[0][1]).toEqual({
            document: document.bytes, mimetype: 'application/pdf', fileName: document.filename,
        });
        await bot.sendMedia('group@g.us', { ...document, caption: '' });
        expect(vi.mocked(sock.sendMessage).mock.calls[1][1]).toHaveProperty('caption', '');
    });

    it('quotes cached text, inbound bodies and the empty fallback exactly like text sends', async () => {
        await bot.send('group@g.us', 'Original text');
        await bot.sendMedia('group@g.us', document, { replyToId: 'media-id' });
        expect(vi.mocked(sock.sendMessage).mock.calls[1][2]?.quoted).toEqual({
            key: { remoteJid: 'group@g.us', id: 'media-id', fromMe: true },
            message: { conversation: 'Original text' },
        });
        const body = { extendedTextMessage: { text: 'Inbound text' } };
        await inbound({
            type: 'notify',
            messages: [{ key: { remoteJid: 'group@g.us', id: 'incoming-id' }, message: body }],
        });
        await bot.sendMedia('group@g.us', document, { replyToId: 'incoming-id' });
        expect(vi.mocked(sock.sendMessage).mock.calls[2][2]?.quoted?.message).toEqual(body);
        await bot.sendMedia('group@g.us', document, { replyToId: 'missing-id' });
        expect(vi.mocked(sock.sendMessage).mock.calls[3][2]?.quoted).toEqual({
            key: { remoteJid: 'group@g.us', id: 'missing-id', fromMe: true },
            message: { conversation: '' },
        });
    });

    it('caches the encoded receipt for subsequent quotes and suppresses the sent echo', async () => {
        const encoded = { documentMessage: { caption: 'Encoded caption', mimetype: 'application/pdf' } };
        vi.mocked(sock.sendMessage).mockResolvedValueOnce({ key: { id: 'encoded-id' }, message: encoded });
        await bot.sendMedia('group@g.us', document);
        await bot.send('group@g.us', 'Reply', { replyToId: 'encoded-id' });
        expect(vi.mocked(sock.sendMessage).mock.calls[1][2]?.quoted?.message).toEqual(encoded);
        await inbound({
            type: 'notify',
            messages: [{ key: { remoteJid: 'group@g.us', id: 'encoded-id', fromMe: true }, message: { conversation: 'echo' } }],
        });
        expect(onMessage).not.toHaveBeenCalled();
    });

    it.each([
        { bytes: Buffer.alloc(0) },
        { bytes: 'not a buffer' },
        { mimeType: '' },
        { mimeType: 'unsupported' },
        { mimeType: 'text/plain; charset=utf-8' },
        { mimeType: 'application/pdf\n' },
        { filename: '' },
        { filename: '../report.pdf' },
        { filename: 'folder\\report.pdf' },
        { filename: 'report\n.pdf' },
        { caption: 42 },
        { mimeType: 'image/png' },
        { mimeType: 'image/jpeg' },
        { mimeType: 'image/gif' },
        { mimeType: 'image/webp' },
    ])('rejects invalid attachments before transport: %j', async overrides => {
        await expect(bot.sendMedia('group@g.us', { ...document, ...overrides } as WhatsAppOutboundMedia))
            .rejects.toMatchObject({ name: 'WhatsAppMediaError', code: 'invalid', outcome: 'not-attempted' });
        expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects oversized decoded bytes but accepts the exact 10 MiB limit', async () => {
        await expect(bot.sendMedia('group@g.us', { ...document, bytes: Buffer.alloc(WHATSAPP_MEDIA_MAX_BYTES + 1) }))
            .rejects.toMatchObject({ code: 'size-limit', outcome: 'not-attempted' });
        expect(sock.sendMessage).not.toHaveBeenCalled();
        await bot.sendMedia('group@g.us', { ...document, bytes: Buffer.alloc(WHATSAPP_MEDIA_MAX_BYTES) });
        expect(sock.sendMessage).toHaveBeenCalledOnce();
    });

    it('validates synchronously without network, timers or mutating decoded bytes', () => {
        vi.useFakeTimers();
        const original = Buffer.from(document.bytes);
        expect(validateWhatsAppMedia(document)).toBeUndefined();
        expect(document.bytes.equals(original)).toBe(true);
        expect(sock.sendMessage).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(() => validateWhatsAppMedia({ ...document, mimeType: 'image/png' })).toThrow(WhatsAppMediaError);
        try {
            validateWhatsAppMedia({ ...document, bytes: Buffer.alloc(0) });
        } catch (error) {
            expect(error).toMatchObject({ code: 'invalid', outcome: 'not-attempted' });
        }
        expect(() => validateWhatsAppMedia({ ...document, bytes: Buffer.alloc(WHATSAPP_MEDIA_MAX_BYTES + 1) }))
            .toThrow(WhatsAppMediaError);
    });

    it.each(['before-start', 'closed-socket', 'stopped'])('rejects disconnected media sends (%s)', async state => {
        if (state === 'before-start') {
            bot = new WhatsAppBot({ sessionDir: 'synthetic-session', onMessage, printQR: false });
        } else if (state === 'closed-socket') {
            connection.onDisconnected(false);
        } else {
            await bot.stop();
        }
        await expect(bot.sendMedia('group@g.us', document))
            .rejects.toMatchObject({ code: 'disconnected', outcome: 'not-attempted' });
        expect(sock.sendMessage).not.toHaveBeenCalled();
    });

    it.each([undefined, {}, { key: {} }, { key: { id: '' } }, { key: { id: ' ' } }, { key: { id: 42 } }])(
        'rejects an unknown receipt without retry for %j', async result => {
            vi.mocked(sock.sendMessage).mockResolvedValueOnce(result as Awaited<ReturnType<WASocket['sendMessage']>>);
            await expect(bot.sendMedia('group@g.us', document)).rejects.toMatchObject({
                code: 'send', outcome: 'unknown',
            });
            expect(sock.sendMessage).toHaveBeenCalledOnce();
        },
    );

    it.each(['reject', 'throw'])('sanitizes uncertain transport %s without retries or changing connectivity', async mode => {
        const unsafe = new Error('provider body with private-path and credentials');
        if (mode === 'reject') vi.mocked(sock.sendMessage).mockRejectedValueOnce(unsafe);
        else vi.mocked(sock.sendMessage).mockImplementationOnce(() => { throw unsafe; });
        const error = await bot.sendMedia('group@g.us', document).catch(e => e);
        expect(error).toBeInstanceOf(WhatsAppMediaError);
        expect(error).toMatchObject({ code: 'send', outcome: 'unknown' });
        expect(error.message).not.toContain(unsafe.message);
        expect(error.cause).toBeUndefined();
        expect(sock.sendMessage).toHaveBeenCalledOnce();
        expect(bot.isConnected()).toBe(true);
    });

    it('times out after thirty seconds, never retries and ignores a late receipt', async () => {
        vi.useFakeTimers();
        let resolve!: (result: { key: { id: string } }) => void;
        vi.mocked(sock.sendMessage).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        const sending = bot.sendMedia('group@g.us', document);
        const rejection = expect(sending).rejects.toMatchObject({ code: 'timeout', outcome: 'unknown' });
        await vi.advanceTimersByTimeAsync(29_999);
        expect(sock.sendMessage).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(vi.getTimerCount()).toBe(0);
        resolve({ key: { id: 'late-id' } });
        await Promise.resolve();
        await bot.send('group@g.us', 'Reply', { replyToId: 'late-id' });
        expect(vi.mocked(sock.sendMessage).mock.calls[1][2]?.quoted?.message).toEqual({ conversation: '' });
    });
});
