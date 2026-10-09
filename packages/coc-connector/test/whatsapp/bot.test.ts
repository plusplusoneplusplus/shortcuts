/**
 * Tests for WhatsAppBot — mocks Baileys via the connection module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsAppBot } from '../../src/whatsapp/bot';
import type { InboundWAMessage, WASocket } from '../../src/whatsapp/types';

// Mock the connection module so Baileys is never loaded
vi.mock('../../src/whatsapp/connection', () => ({
    createBaileysConnection: vi.fn(),
}));

import { createBaileysConnection } from '../../src/whatsapp/connection';
const mockCreateConnection = vi.mocked(createBaileysConnection);

function createMockSocket(): WASocket & { handlers: Map<string, Function> } {
    const handlers = new Map<string, Function>();
    return {
        handlers,
        ev: {
            on: (event: string, handler: Function) => {
                handlers.set(event, handler);
            },
            off: (event: string) => {
                handlers.delete(event);
            },
        },
        sendMessage: vi.fn().mockResolvedValue({ key: { id: 'wamid.test123' } }),
        end: vi.fn(),
    };
}

describe('WhatsAppBot', () => {
    let mockSocket: ReturnType<typeof createMockSocket>;
    let receivedMessages: InboundWAMessage[];

    beforeEach(() => {
        vi.clearAllMocks();
        mockSocket = createMockSocket();
        receivedMessages = [];

        mockCreateConnection.mockImplementation(async (opts) => {
            // Simulate connected state — pass socket back as Baileys does on reconnect
            setTimeout(() => opts.onConnected(mockSocket as any), 0);
            return mockSocket;
        });
    });

    it('should start and connect', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });

        await bot.start();
        // Allow the setTimeout(onConnected) to fire
        await new Promise(r => setTimeout(r, 10));

        expect(mockCreateConnection).toHaveBeenCalledOnce();
        expect(bot.isConnected()).toBe(true);

        await bot.stop();
        expect(bot.isConnected()).toBe(false);
        expect(mockSocket.end).toHaveBeenCalled();
    });

    it('exposes only an opaque paired-account pin stable across device suffixes', async () => {
        const bot = new WhatsAppBot({ sessionDir: 'session', onMessage: async () => {}, printQR: false });
        expect(bot.getMirrorAccountKey()).toBeUndefined();
        mockSocket.user = { id: 'synthetic-account:1@s.whatsapp.net' };
        await bot.start();
        const pin = bot.getMirrorAccountKey();
        expect(pin).toMatch(/^[a-f0-9]{64}$/);
        mockSocket.user = { id: 'synthetic-account:2@s.whatsapp.net' };
        expect(bot.getMirrorAccountKey()).toBe(pin);
        mockSocket.user = { id: 'different-account:1@s.whatsapp.net' };
        expect(bot.getMirrorAccountKey()).not.toBe(pin);
        await bot.stop();
        expect(bot.getMirrorAccountKey()).toBeUndefined();
    });

    it('should cancel the connection and ignore late connection callbacks after stop', async () => {
        let connected: ((sock: WASocket) => void) | undefined;
        let signal: AbortSignal | undefined;
        mockCreateConnection.mockImplementation(async (opts) => {
            signal = opts.signal;
            connected = opts.onConnected;
            return mockSocket;
        });
        const bot = new WhatsAppBot({ sessionDir: 'session', onMessage: async () => {}, printQR: false });
        await bot.start();
        await bot.stop();
        expect(signal?.aborted).toBe(true);
        connected?.(mockSocket);
        expect(bot.getNativeStatus()).toBe('disconnected');
        expect(mockSocket.handlers.has('messages.upsert')).toBe(false);
    });

    it('should send messages and return message ID', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
        });
        await bot.start();

        const msgId = await bot.send('group@g.us', 'Hello world');
        expect(msgId).toBe('wamid.test123');
        expect(mockSocket.sendMessage).toHaveBeenCalledWith('group@g.us', { text: 'Hello world' }, undefined);
    });

    it('should throw when sending before start', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
        });
        await expect(bot.send('jid', 'text')).rejects.toThrow('WhatsAppBot is not started');
        await expect(bot.react('jid', 'msg', '👍')).rejects.toThrow('WhatsAppBot is not started');
    });

    it('should react to a message and propagate send failures', async () => {
        const bot = new WhatsAppBot({ sessionDir: 'session', onMessage: async () => {}, printQR: false });
        await bot.start();
        await bot.react('group@g.us', 'incoming-id', '👍');
        expect(mockSocket.sendMessage).toHaveBeenCalledWith('group@g.us', {
            react: { text: '👍', key: { remoteJid: 'group@g.us', id: 'incoming-id', fromMe: true } },
        });

        vi.mocked(mockSocket.sendMessage).mockRejectedValueOnce(new Error('reaction rejected'));
        await expect(bot.react('group@g.us', 'incoming-id', '👍')).rejects.toThrow('reaction rejected');
    });

    it('should time out a stalled reaction after five seconds', async () => {
        const bot = new WhatsAppBot({ sessionDir: 'session', onMessage: async () => {}, printQR: false });
        await bot.start();
        vi.mocked(mockSocket.sendMessage).mockImplementationOnce(() => new Promise(() => {}));
        vi.useFakeTimers();
        try {
            const reaction = bot.react('group@g.us', 'incoming-id', '👍');
            const rejected = expect(reaction).rejects.toThrow('WhatsApp reaction timed out');
            await vi.advanceTimersByTimeAsync(5_000);
            await rejected;
        } finally {
            vi.useRealTimers();
        }
    });

    it('should send with quoted message for reply threading', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
        });
        await bot.start();

        const msgId = await bot.send('group@g.us', 'Reply text', { replyToId: 'wamid.original' });
        expect(msgId).toBe('wamid.test123');
        expect(mockSocket.sendMessage).toHaveBeenCalledWith(
            'group@g.us',
            { text: 'Reply text' },
            {
                quoted: {
                    key: { remoteJid: 'group@g.us', id: 'wamid.original', fromMe: true },
                    message: { conversation: '' },
                },
            },
        );
    });

    it('should quote the cached body of inbound and previously sent messages', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));
        const inbound = { extendedTextMessage: { text: 'list repos', contextInfo: { stanzaId: 'older' } } };
        await mockSocket.handlers.get('messages.upsert')!({
            type: 'notify',
            messages: [{ key: { remoteJid: 'group@g.us', id: 'wamid.in', fromMe: true }, message: inbound }],
        });

        await bot.send('group@g.us', 'First reply', { replyToId: 'wamid.in' });
        expect(vi.mocked(mockSocket.sendMessage).mock.calls[0][2]?.quoted?.message).toEqual(inbound);

        await bot.send('group@g.us', 'Second reply', { replyToId: 'wamid.test123' });
        expect(vi.mocked(mockSocket.sendMessage).mock.calls[1][2]?.quoted?.message)
            .toEqual({ conversation: 'First reply' });
    });

    // Regression: a key-only quote made Baileys throw
    // "Cannot read properties of undefined (reading 'undefined')", so no reply was ever sent.
    it('should build quoted options that real Baileys can turn into a reply', async () => {
        const { generateWAMessageFromContent } = await import('@whiskeysockets/baileys');
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));
        await mockSocket.handlers.get('messages.upsert')!({
            type: 'notify',
            messages: [{ key: { remoteJid: 'group@g.us', id: 'wamid.in', fromMe: true }, message: { conversation: 'test' } }],
        });

        await bot.send('group@g.us', 'Cached reply', { replyToId: 'wamid.in' });
        await bot.send('group@g.us', 'Uncached reply', { replyToId: 'wamid.unknown' });

        for (const [jid, content, options] of vi.mocked(mockSocket.sendMessage).mock.calls) {
            const built = generateWAMessageFromContent(jid, { extendedTextMessage: content as { text: string } },
                { userJid: 'me@s.whatsapp.net', quoted: options!.quoted as any });
            expect(built.message?.extendedTextMessage?.contextInfo?.stanzaId).toBe(options!.quoted!.key.id);
        }
        expect(generateWAMessageFromContent('group@g.us', { extendedTextMessage: { text: 'x' } }, {
            userJid: 'me@s.whatsapp.net',
            quoted: vi.mocked(mockSocket.sendMessage).mock.calls[0][2]!.quoted as any,
        }).message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation).toBe('test');
    });

    it('should handle inbound text messages', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();
        // Wait for onConnected to fire and register message handler
        await new Promise(r => setTimeout(r, 10));

        const handler = mockSocket.handlers.get('messages.upsert');
        expect(handler).toBeDefined();

        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'alice@s.whatsapp.net', id: 'msg-001', fromMe: false },
                message: { conversation: 'Hello from WA' },
                pushName: 'Alice',
            }],
        });

        // Wait for async onMessage
        await new Promise(r => setTimeout(r, 10));

        expect(receivedMessages).toHaveLength(1);
        expect(receivedMessages[0]).toEqual({
            chatJid: 'alice@s.whatsapp.net',
            participantJid: undefined,
            fromMe: false,
            senderJid: 'alice@s.whatsapp.net',
            messageId: 'msg-001',
            text: 'Hello from WA',
            senderName: 'Alice',
        });
    });

    it('should handle quoted messages (extendedTextMessage)', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));

        const handler = mockSocket.handlers.get('messages.upsert');
        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'group@g.us', participant: 'bob@s.whatsapp.net', id: 'msg-002', fromMe: false },
                message: {
                    extendedTextMessage: {
                        text: 'Reply to agent',
                        contextInfo: { stanzaId: 'original-msg-id' },
                    },
                },
                pushName: 'Bob',
            }],
        });

        await new Promise(r => setTimeout(r, 10));

        expect(receivedMessages).toHaveLength(1);
        expect(receivedMessages[0].quotedMessageId).toBe('original-msg-id');
        expect(receivedMessages[0].chatJid).toBe('group@g.us');
        expect(receivedMessages[0].participantJid).toBe('bob@s.whatsapp.net');
        expect(receivedMessages[0].fromMe).toBe(false);
        expect(receivedMessages[0].text).toBe('Reply to agent');
    });

    it('should skip bot-sent messages but allow user-typed fromMe messages', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));

        // Bot sends a message — this ID gets tracked
        const sentId = await bot.send('group@g.us', 'Bot message');

        const handler = mockSocket.handlers.get('messages.upsert');

        // Echo of bot-sent message should be skipped
        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'group@g.us', id: sentId, fromMe: true },
                message: { conversation: 'Bot message' },
            }],
        });
        await new Promise(r => setTimeout(r, 10));
        expect(receivedMessages).toHaveLength(0);

        // User typing on phone (fromMe but not bot-sent) should be delivered
        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'group@g.us', id: 'user-typed-001', fromMe: true },
                message: { conversation: 'User typed on phone' },
                pushName: 'Me',
            }],
        });
        await new Promise(r => setTimeout(r, 10));
        expect(receivedMessages).toHaveLength(1);
        expect(receivedMessages[0].text).toBe('User typed on phone');
        expect(receivedMessages[0].chatJid).toBe('group@g.us');
        expect(receivedMessages[0].fromMe).toBe(true);
    });

    it('should skip status broadcasts', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));

        const handler = mockSocket.handlers.get('messages.upsert');
        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'status@broadcast', id: 'msg-004', fromMe: false },
                message: { conversation: 'Status update' },
            }],
        });

        await new Promise(r => setTimeout(r, 10));
        expect(receivedMessages).toHaveLength(0);
    });

    it('should skip non-notify upserts', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));

        const handler = mockSocket.handlers.get('messages.upsert');
        await handler!({
            type: 'append',
            messages: [{
                key: { remoteJid: 'alice@s.whatsapp.net', id: 'msg-005', fromMe: false },
                message: { conversation: 'Appended message' },
            }],
        });

        await new Promise(r => setTimeout(r, 10));
        expect(receivedMessages).toHaveLength(0);
    });

    it('should skip messages without text', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));

        const handler = mockSocket.handlers.get('messages.upsert');
        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'alice@s.whatsapp.net', id: 'msg-006', fromMe: false },
                message: { imageMessage: { url: 'http://example.com/img.jpg' } },
            }],
        });

        await new Promise(r => setTimeout(r, 10));
        expect(receivedMessages).toHaveLength(0);
    });

    it('delivers opted-in captioned and captionless images with sender and quote routing', async () => {
        mockCreateConnection.mockImplementation(async opts => {
            opts.onConnected(mockSocket);
            return mockSocket;
        });
        const bot = new WhatsAppBot({
            sessionDir: 'session', printQR: false, receiveImages: true,
            onMessage: async msg => { receivedMessages.push(msg); },
        });
        await bot.start();
        const imageMessage = {
            mimetype: 'image/png', directPath: '/v/image.enc', mediaKey: Buffer.alloc(32),
            caption: '[chat-123] /ask explain this', contextInfo: { stanzaId: 'answer-123' },
        };
        const upsert = mockSocket.handlers.get('messages.upsert')!;
        await upsert({ type: 'notify', messages: [
            { key: { remoteJid: 'group@g.us', participant: 'alice@s.whatsapp.net', id: 'image-1' },
                message: { imageMessage }, pushName: 'Alice' },
            { key: { remoteJid: 'group@g.us', id: 'image-2', fromMe: true },
                message: { ephemeralMessage: { message: { imageMessage: { ...imageMessage, caption: '' } } } } },
        ] });
        expect(receivedMessages).toHaveLength(2);
        expect(receivedMessages[0]).toMatchObject({
            chatJid: 'group@g.us', senderJid: 'group@g.us', participantJid: 'alice@s.whatsapp.net',
            fromMe: false, messageId: 'image-1', text: '[chat-123] /ask explain this',
            senderName: 'Alice', quotedMessageId: 'answer-123',
            images: [{ mimeType: 'image/png', download: expect.any(Function) }],
        });
        expect(receivedMessages[1]).toMatchObject({ text: '', fromMe: true, images: [{ mimeType: 'image/png' }] });
        await bot.send('group@g.us', 'Reply', { replyToId: 'image-1' });
        expect(vi.mocked(mockSocket.sendMessage).mock.calls[0][2]?.quoted?.message).toEqual({ imageMessage });

        // A retained descriptor cannot download after stop or a new start.
        await bot.stop();
        await expect(receivedMessages[0].images![0].download({ maxBytes: 100 }))
            .rejects.toMatchObject({ code: 'cancelled' });
        await upsert({ type: 'notify', messages: [{ key: { remoteJid: 'group@g.us', id: 'late-image' },
            message: { imageMessage } }] });
        expect(receivedMessages).toHaveLength(2);
    });

    it('keeps replay, broadcast and own-message suppression ahead of image delivery', async () => {
        mockCreateConnection.mockImplementation(async opts => { opts.onConnected(mockSocket); return mockSocket; });
        const bot = new WhatsAppBot({
            sessionDir: 'session', printQR: false, receiveImages: true,
            onMessage: async msg => { receivedMessages.push(msg); },
        });
        await bot.start();
        const sentId = await bot.send('group@g.us', 'sent');
        const upsert = mockSocket.handlers.get('messages.upsert')!;
        const message = { imageMessage: { mimetype: 'image/png', caption: 'instructions' } };
        await upsert({ type: 'append', messages: [{ key: { remoteJid: 'group@g.us', id: 'history' }, message }] });
        await upsert({ type: 'notify', messages: [
            { key: { remoteJid: 'status@broadcast', id: 'status' }, message },
            { key: { remoteJid: 'group@g.us', id: sentId, fromMe: true }, message },
            { key: { remoteJid: 'group@g.us', id: 'audio' }, message: { audioMessage: {} } },
            { key: { remoteJid: 'group@g.us', id: 'video' }, message: { videoMessage: { caption: 'video' } } },
            { key: { remoteJid: 'group@g.us', id: 'document' }, message: { documentMessage: { caption: 'document' } } },
        ] });
        expect(receivedMessages).toHaveLength(0);
        await bot.stop();
    });

    it('keeps images opt-in, including image captions, and leaves text unchanged', async () => {
        mockCreateConnection.mockImplementation(async opts => { opts.onConnected(mockSocket); return mockSocket; });
        const bot = new WhatsAppBot({
            sessionDir: 'session', printQR: false,
            onMessage: async msg => { receivedMessages.push(msg); },
        });
        await bot.start();
        await mockSocket.handlers.get('messages.upsert')!({ type: 'notify', messages: [
            { key: { remoteJid: 'group@g.us', id: 'caption' }, message: { imageMessage: { caption: 'caption' } } },
            { key: { remoteJid: 'group@g.us', id: 'text' }, message: { conversation: '/ask ordinary text' } },
        ] });
        expect(receivedMessages).toHaveLength(1);
        expect(receivedMessages[0].text).toBe('/ask ordinary text');
        expect(receivedMessages[0]).not.toHaveProperty('images');
        await bot.stop();
    });

    it('should handle onMessage errors gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => { throw new Error('handler failure'); },
            printQR: false,
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));

        const handler = mockSocket.handlers.get('messages.upsert');
        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'alice@s.whatsapp.net', id: 'msg-007', fromMe: false },
                message: { conversation: 'Trigger error' },
            }],
        });

        await new Promise(r => setTimeout(r, 10));
        expect(consoleSpy).toHaveBeenCalledWith(
            '[whatsapp-bot] Error handling message:',
            expect.any(Error),
        );
        consoleSpy.mockRestore();
    });

    it('should track status transitions', async () => {
        const statuses: string[] = [];
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
            onStatusChange: (s) => { statuses.push(s); },
        });

        expect(bot.getStatus()).toBe('disconnected');

        await bot.start();
        await new Promise(r => setTimeout(r, 10));

        expect(statuses).toContain('connecting');
        expect(statuses).toContain('connected');
        expect(bot.getStatus()).toBe('connected');

        await bot.stop();
        expect(bot.getStatus()).toBe('disconnected');
        expect(statuses).toContain('disconnected');
    });

    it('should notify the restored status after creating a group', async () => {
        const statuses: string[] = [];
        (mockSocket as any).groupCreate = vi.fn().mockResolvedValue({ id: '456@g.us' });
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
            onStatusChange: (s) => { statuses.push(s); },
        });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));
        statuses.length = 0;

        expect(await bot.createGroup('CoC')).toBe('456@g.us');
        expect(statuses).toEqual(['creating-group', 'connected']);
        expect(bot.getNativeStatus()).toBe('connected');

        // A failed creation must also notify the restore.
        statuses.length = 0;
        (mockSocket as any).groupCreate.mockRejectedValueOnce(new Error('rate limited'));
        await expect(bot.createGroup('CoC')).rejects.toThrow('rate limited');
        expect(statuses).toEqual(['creating-group', 'connected']);
    });

    it('should not revive a connection that dropped while creating a group', async () => {
        let disconnect!: (loggedOut: boolean) => void;
        mockCreateConnection.mockImplementation(async (opts) => {
            disconnect = opts.onDisconnected;
            setTimeout(() => opts.onConnected(mockSocket as any), 0);
            return mockSocket;
        });
        (mockSocket as any).groupCreate = vi.fn(async () => {
            disconnect(false);
            return { id: '456@g.us' };
        });
        const bot = new WhatsAppBot({ sessionDir: '/tmp/test-session', onMessage: async () => {}, printQR: false });
        await bot.start();
        await new Promise(r => setTimeout(r, 10));

        await bot.createGroup('CoC');
        expect(bot.getNativeStatus()).toBe('disconnected');
    });

    it('should track QR code and clear on connect', async () => {
        mockCreateConnection.mockImplementation(async (opts) => {
            // Simulate QR then connect
            setTimeout(() => {
                opts.onQR('test-qr-string');
                setTimeout(() => opts.onConnected(mockSocket as any), 5);
            }, 0);
            return mockSocket;
        });

        let receivedQR: string | null = null;
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
            onQR: (qr) => { receivedQR = qr; },
        });

        expect(bot.getLastQR()).toBeNull();

        await bot.start();
        await new Promise(r => setTimeout(r, 5));

        expect(receivedQR).toBe('test-qr-string');
        expect(bot.getLastQR()).toBe('test-qr-string');
        // getStatus() is normalized; the native 'qr-pending' maps to 'pairing'.
        expect(bot.getStatus()).toBe('pairing');
        expect(bot.getNativeStatus()).toBe('qr-pending');

        // Wait for connect
        await new Promise(r => setTimeout(r, 15));
        expect(bot.getLastQR()).toBeNull();
        expect(bot.getStatus()).toBe('connected');
    });
});
