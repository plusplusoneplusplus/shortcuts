/**
 * Tests for WhatsAppBridge — mocks bot, WS relay, store, and agent store.
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

/** Helper: emit a WS relay process-updated message and wait for async processing. */
function emitProcessUpdate(wsRelay: EventEmitter, agentId: string, agentName: string, processUpdate: Record<string, unknown>) {
    wsRelay.emit('message', {
        agentId,
        agentName,
        data: JSON.stringify(processUpdate),
    });
}

describe('WhatsAppBridge', () => {
    let tmpDir: string;
    let wsRelay: EventEmitter;
    let opts: WhatsAppBridgeOptions;

    beforeEach(() => {
        botInstances = [];
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-bridge-test-'));
        wsRelay = new EventEmitter();

        opts = {
            config: {
                enabled: true,
                sessionDir: path.join(tmpDir, 'wa-session'),
                groupJid: 'group@g.us',
                userName: 'CoC',
            },
            dataDir: tmpDir,
            wsRelay: wsRelay as any,
            agentStore: createMockAgentStore() as any,
            tunnelBridge: createMockTunnelBridge() as any,
        };
    });

    afterEach(async () => {
        await new Promise(r => setTimeout(r, 50));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows EBUSY */ }
    });

    it('should start and attach WS listener', async () => {
        const bridge = new WhatsAppBridge(opts);
        await bridge.start();

        expect(botInstances).toHaveLength(1);
        expect(lastBot().start).toHaveBeenCalledOnce();
        expect(wsRelay.listenerCount('message')).toBe(1);

        await bridge.stop();
        expect(wsRelay.listenerCount('message')).toBe(0);
        expect(lastBot().stop).toHaveBeenCalledOnce();
    });

    describe('outbound (CoC → WA)', () => {
        it('should forward new turns from process-updated events', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            // Mock fetch to return process with conversationTurns (matches real CoC API shape)
            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({
                    process: {
                        id: 'proc-001',
                        workspaceId: 'ws-frontend',
                        conversationTurns: [
                            { role: 'user', content: 'Fix the bug' },
                            { role: 'assistant', content: 'Fixed the bug on line 42' },
                        ],
                    },
                }))
            );

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-001', workspaceId: 'ws-frontend', workspaceName: 'frontend', status: 'completed' },
            });
            await new Promise(r => setTimeout(r, 50));

            expect(fetchSpy).toHaveBeenCalledWith(
                'http://localhost:4000/api/processes/proc-001?workspaceId=ws-frontend'
            );
            expect(lastBot().send).toHaveBeenCalledTimes(2);
            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '*CoC → Agent-A:frontend*\nFix the bug'
            );
            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '*Agent-A:frontend*\nFixed the bug on line 42'
            );

            fetchSpy.mockRestore();
            await bridge.stop();
        });

        it('should skip non process-updated events', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-added',
                process: { id: 'proc-001', status: 'queued' },
            });
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).not.toHaveBeenCalled();
            await bridge.stop();
        });

        it('should skip when no groupJid configured', async () => {
            opts.config.groupJid = undefined;
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-001', status: 'completed', workspaceId: 'ws-test' },
            });
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).not.toHaveBeenCalled();
            await bridge.stop();
        });

        it('should skip invalid JSON data', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            wsRelay.emit('message', {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: 'not json',
            });
            await new Promise(r => setTimeout(r, 10));

            expect(lastBot().send).not.toHaveBeenCalled();
            await bridge.stop();
        });

        it('should only send new turns on subsequent updates', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            // First update: 2 turns
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({
                    process: {
                        conversationTurns: [
                            { role: 'user', content: 'Hello' },
                            { role: 'assistant', content: 'Hi there' },
                        ],
                    },
                }))
            );
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-002', workspaceId: 'ws-test', workspaceName: 'test', status: 'running' },
            });
            await new Promise(r => setTimeout(r, 50));
            expect(lastBot().send).toHaveBeenCalledTimes(2);

            lastBot().send.mockClear();

            // Second update: 3 turns (1 new)
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({
                    process: {
                        conversationTurns: [
                            { role: 'user', content: 'Hello' },
                            { role: 'assistant', content: 'Hi there' },
                            { role: 'user', content: 'One more thing' },
                        ],
                    },
                }))
            );
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-002', workspaceId: 'ws-test', workspaceName: 'test', status: 'running' },
            });
            await new Promise(r => setTimeout(r, 50));
            expect(lastBot().send).toHaveBeenCalledTimes(1);
            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '*CoC → Agent-A:test*\nOne more thing'
            );

            vi.restoreAllMocks();
            await bridge.stop();
        });
    });

    describe('inbound (WA → CoC)', () => {
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
