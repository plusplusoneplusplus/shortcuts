/**
 * Tests for WhatsAppBot — mocks Baileys via the connection module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhatsAppBot } from '../src/bot';
import type { InboundWAMessage, WASocket } from '../src/types';

// Mock the connection module so Baileys is never loaded
vi.mock('../src/connection', () => ({
    createBaileysConnection: vi.fn(),
}));

import { createBaileysConnection } from '../src/connection';
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
            // Simulate connected state
            setTimeout(() => opts.onConnected(), 0);
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

    it('should send messages and return message ID', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
        });
        await bot.start();

        const msgId = await bot.send('group@g.us', 'Hello world');
        expect(msgId).toBe('wamid.test123');
        expect(mockSocket.sendMessage).toHaveBeenCalledWith('group@g.us', { text: 'Hello world' });
    });

    it('should throw when sending before start', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => {},
            printQR: false,
        });
        await expect(bot.send('jid', 'text')).rejects.toThrow('WhatsAppBot is not started');
    });

    it('should handle inbound text messages', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();

        // Simulate messages.upsert
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

        const handler = mockSocket.handlers.get('messages.upsert');
        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'group@g.us', id: 'msg-002', fromMe: false },
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
        expect(receivedMessages[0].text).toBe('Reply to agent');
    });

    it('should skip own messages', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();

        const handler = mockSocket.handlers.get('messages.upsert');
        await handler!({
            type: 'notify',
            messages: [{
                key: { remoteJid: 'group@g.us', id: 'msg-003', fromMe: true },
                message: { conversation: 'My own message' },
            }],
        });

        await new Promise(r => setTimeout(r, 10));
        expect(receivedMessages).toHaveLength(0);
    });

    it('should skip status broadcasts', async () => {
        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async (msg) => { receivedMessages.push(msg); },
            printQR: false,
        });
        await bot.start();

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

    it('should handle onMessage errors gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const bot = new WhatsAppBot({
            sessionDir: '/tmp/test-session',
            onMessage: async () => { throw new Error('handler failure'); },
            printQR: false,
        });
        await bot.start();

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

        // connecting → connected
        expect(statuses).toContain('connecting');
        expect(statuses).toContain('connected');
        expect(bot.getStatus()).toBe('connected');

        await bot.stop();
        expect(bot.getStatus()).toBe('disconnected');
        expect(statuses).toContain('disconnected');
    });

    it('should track QR code and clear on connect', async () => {
        mockCreateConnection.mockImplementation(async (opts) => {
            // Simulate QR then connect
            setTimeout(() => {
                opts.onQR('test-qr-string');
                setTimeout(() => opts.onConnected(), 5);
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
        expect(bot.getStatus()).toBe('qr-pending');

        // Wait for connect
        await new Promise(r => setTimeout(r, 15));
        expect(bot.getLastQR()).toBeNull();
        expect(bot.getStatus()).toBe('connected');
    });
});
