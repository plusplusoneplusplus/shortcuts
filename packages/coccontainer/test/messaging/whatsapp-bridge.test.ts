/**
 * Tests for WhatsAppBridge — mocks bot, SSERelay, store, and agent store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Track all created bot instances
let botInstances: Array<{
    opts: any;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('@plusplusoneplusplus/whatsapp-bot', () => {
    return {
        WhatsAppBot: class MockWhatsAppBot {
            opts: any;
            start = vi.fn();
            stop = vi.fn();
            send = vi.fn().mockResolvedValue('wamid.out-001');
            constructor(opts: any) {
                this.opts = opts;
                botInstances.push(this as any);
            }
        },
    };
});

import { WhatsAppBridge, type WhatsAppBridgeOptions } from '../../src/messaging/whatsapp-bridge';
import type { SSEEvent } from '../../src/proxy/sse-relay';

function createMockAgentStore() {
    return {
        add: vi.fn(),
        remove: vi.fn(),
        rename: vi.fn(),
        update: vi.fn(),
        list: vi.fn().mockReturnValue([
            { id: 'agent-a', name: 'Agent-A', address: 'http://localhost:4000', status: 'online' as const, lastSeenAt: null, createdAt: '' },
        ]),
        get: vi.fn().mockImplementation((id: string) => {
            if (id === 'agent-a') return { id: 'agent-a', name: 'Agent-A', address: 'http://localhost:4000', status: 'online', lastSeenAt: null, createdAt: '' };
            return undefined;
        }),
        updateStatus: vi.fn(),
        close: vi.fn(),
    };
}

function createMockTunnelBridge() {
    return {
        start: vi.fn(),
        stop: vi.fn(),
        stopAll: vi.fn(),
        getLocalUrl: vi.fn().mockReturnValue(undefined),
        list: vi.fn().mockReturnValue([]),
    };
}

/** Get the last created mock bot instance. */
function lastBot() {
    return botInstances[botInstances.length - 1];
}

describe('WhatsAppBridge', () => {
    let tmpDir: string;
    let sseRelay: EventEmitter;
    let opts: WhatsAppBridgeOptions;

    beforeEach(() => {
        botInstances = [];
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-bridge-test-'));
        sseRelay = new EventEmitter();

        opts = {
            config: {
                enabled: true,
                sessionDir: path.join(tmpDir, 'wa-session'),
                groupJid: 'group@g.us',
                userName: 'CoC',
            },
            dataDir: tmpDir,
            sseRelay: sseRelay as any,
            agentStore: createMockAgentStore() as any,
            tunnelBridge: createMockTunnelBridge() as any,
        };
    });

    afterEach(async () => {
        await new Promise(r => setTimeout(r, 50));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows EBUSY */ }
    });

    it('should start and attach SSE listener', async () => {
        const bridge = new WhatsAppBridge(opts);
        await bridge.start();

        expect(botInstances).toHaveLength(1);
        expect(lastBot().start).toHaveBeenCalledOnce();
        expect(sseRelay.listenerCount('event')).toBe(1);

        await bridge.stop();
        expect(sseRelay.listenerCount('event')).toBe(0);
        expect(lastBot().stop).toHaveBeenCalledOnce();
    });

    describe('outbound (CoC → WA)', () => {
        it('should forward turn:complete events to WhatsApp group', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            const event: SSEEvent = {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: JSON.stringify({
                    type: 'turn:complete',
                    role: 'assistant',
                    text: 'Fixed the bug',
                    processId: 'proc-001',
                    workspaceName: 'frontend',
                }),
            };

            sseRelay.emit('event', event);
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '*Agent-A:frontend*\nFixed the bug'
            );

            await bridge.stop();
        });

        it('should format user turns with sender name', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            sseRelay.emit('event', {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: JSON.stringify({
                    type: 'turn:complete',
                    role: 'user',
                    text: 'Fix login bug',
                    userName: 'Alice',
                    processId: 'proc-001',
                    workspaceName: 'frontend',
                }),
            });
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '*Alice → Agent-A:frontend*\nFix login bug'
            );

            await bridge.stop();
        });

        it('should skip non turn:complete events', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            sseRelay.emit('event', {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: JSON.stringify({ type: 'turn:start', text: 'Starting...' }),
            });
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).not.toHaveBeenCalled();
            await bridge.stop();
        });

        it('should skip events with empty text', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            sseRelay.emit('event', {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: JSON.stringify({ type: 'turn:complete', role: 'assistant', text: '', processId: 'p1' }),
            });
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).not.toHaveBeenCalled();
            await bridge.stop();
        });

        it('should skip when no groupJid configured', async () => {
            opts.config.groupJid = undefined;
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            sseRelay.emit('event', {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: JSON.stringify({ type: 'turn:complete', role: 'assistant', text: 'Hello', processId: 'p1', workspaceName: 'test' }),
            });
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).not.toHaveBeenCalled();
            await bridge.stop();
        });

        it('should skip invalid JSON data', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            sseRelay.emit('event', {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: 'not json',
            });
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).not.toHaveBeenCalled();
            await bridge.stop();
        });
    });

    describe('inbound (WA → CoC)', () => {
        it('should route quoted messages to the correct process', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

            // First send an outbound to create a binding
            sseRelay.emit('event', {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: JSON.stringify({
                    type: 'turn:complete',
                    role: 'assistant',
                    text: 'Found bug on line 42',
                    processId: 'proc-001',
                    workspaceName: 'frontend',
                }),
            });
            await new Promise(r => setTimeout(r, 10));

            // Now simulate inbound message quoting that outbound
            const bot = lastBot();
            await bot.opts.onMessage({
                senderJid: 'alice@s.whatsapp.net',
                messageId: 'wamid.in-001',
                quotedMessageId: 'wamid.out-001',
                text: 'Can you add a test?',
            });

            expect(fetchSpy).toHaveBeenCalledWith(
                'http://localhost:4000/api/queue/follow-up',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ processId: 'proc-001', message: 'Can you add a test?' }),
                }),
            );

            fetchSpy.mockRestore();
            await bridge.stop();
        });

        it('should create global session for plain messages', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            const fetchSpy = vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'proc-global-001' })));

            await lastBot().opts.onMessage({
                senderJid: 'bob@s.whatsapp.net',
                messageId: 'wamid.in-002',
                text: 'What is the status?',
            });

            expect(fetchSpy).toHaveBeenCalledWith(
                'http://localhost:4000/api/queue',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        type: 'chat',
                        payload: { workspaceId: 'ws-global', prompt: 'What is the status?', mode: 'ask' },
                    }),
                }),
            );

            fetchSpy.mockRestore();
            await bridge.stop();
        });

        it('should reuse existing global session', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            const fetchSpy = vi.spyOn(globalThis, 'fetch')
                .mockResolvedValue(new Response(JSON.stringify({ id: 'proc-global-001' })));

            // First message creates global session
            await lastBot().opts.onMessage({
                senderJid: 'bob@s.whatsapp.net',
                messageId: 'wamid.in-003',
                text: 'First message',
            });

            fetchSpy.mockClear();
            fetchSpy.mockResolvedValue(new Response('{}'));

            // Second message should reuse session (follow-up, not new chat)
            await lastBot().opts.onMessage({
                senderJid: 'bob@s.whatsapp.net',
                messageId: 'wamid.in-004',
                text: 'Second message',
            });

            expect(fetchSpy).toHaveBeenCalledWith(
                'http://localhost:4000/api/queue/follow-up',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ processId: 'proc-global-001', message: 'Second message' }),
                }),
            );

            fetchSpy.mockRestore();
            await bridge.stop();
        });
    });
});
