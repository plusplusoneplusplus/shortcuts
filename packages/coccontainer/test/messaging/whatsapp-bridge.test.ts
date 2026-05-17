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
            getStatus = vi.fn().mockReturnValue('connected');
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
        it('should forward new turns with structured format', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({
                    process: {
                        id: 'proc-001',
                        workspaceId: 'ws-frontend',
                        title: 'Fix bug XYZ',
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
            // User turn — shows configured userName with icon
            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '💬 *CoC*\n*Chat:*\n  Agent: Agent-A\n  Repo: frontend\n  Title: Fix bug XYZ\n\n*Message:*\nFix the bug',
            );
            // Assistant turn — shows "CoC Agent" with icon
            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '🤖 *CoC Agent*\n*Chat:*\n  Agent: Agent-A\n  Repo: frontend\n  Title: Fix bug XYZ\n\n*Message:*\nFixed the bug on line 42',
            );

            fetchSpy.mockRestore();
            await bridge.stop();
        });

        it('should show "You" when userName is not set', async () => {
            opts.config.userName = '';
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({
                    process: {
                        conversationTurns: [
                            { role: 'user', content: 'Hello' },
                        ],
                    },
                }))
            );

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-noname', workspaceId: 'ws-test', workspaceName: 'test', status: 'completed' },
            });
            await new Promise(r => setTimeout(r, 50));

            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '💬 *You*\n*Chat:*\n  Agent: Agent-A\n  Repo: test\n\n*Message:*\nHello',
            );

            vi.restoreAllMocks();
            await bridge.stop();
        });

        it('should omit title when not available', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({
                    process: {
                        conversationTurns: [
                            { role: 'assistant', content: 'Done' },
                        ],
                    },
                }))
            );

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-notitle', workspaceId: 'ws-test', workspaceName: 'test', status: 'completed' },
            });
            await new Promise(r => setTimeout(r, 50));

            expect(lastBot().send).toHaveBeenCalledWith(
                'group@g.us',
                '🤖 *CoC Agent*\n*Chat:*\n  Agent: Agent-A\n  Repo: test\n\n*Message:*\nDone',
            );

            vi.restoreAllMocks();
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

            // Second update: 4 turns (2 new — user + assistant)
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({
                    process: {
                        conversationTurns: [
                            { role: 'user', content: 'Hello' },
                            { role: 'assistant', content: 'Hi there' },
                            { role: 'user', content: 'One more thing' },
                            { role: 'assistant', content: 'Sure, here it is' },
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

            vi.restoreAllMocks();
            await bridge.stop();
        });
    });

    describe('inbound (WA → CoC)', () => {
        it('should ignore messages from non-configured groups', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            const fetchSpy = vi.spyOn(globalThis, 'fetch');

            await lastBot().opts.onMessage({
                senderJid: 'other-group@g.us',
                messageId: 'wamid.in-other',
                text: 'Should be ignored',
            });

            expect(fetchSpy).not.toHaveBeenCalled();
            fetchSpy.mockRestore();
            await bridge.stop();
        });

        it('should create global session for plain messages', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            const fetchSpy = vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'proc-global-001' })));

            await lastBot().opts.onMessage({
                senderJid: 'group@g.us',
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

        it('should send follow-up when replying to a bound message', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            // First: outbound message creates a binding
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(JSON.stringify({
                    process: {
                        conversationTurns: [
                            { role: 'assistant', content: 'Task done' },
                        ],
                    },
                }))
            );
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-reply-001', workspaceId: 'ws-myrepo', workspaceName: 'myrepo', status: 'completed' },
            });
            await new Promise(r => setTimeout(r, 50));
            expect(lastBot().send).toHaveBeenCalledTimes(1);

            const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}'));

            // Now reply to that WA message
            await lastBot().opts.onMessage({
                senderJid: 'group@g.us',
                messageId: 'wamid.in-reply',
                text: 'Can you also fix the tests?',
                quotedMessageId: 'wamid.out-001',
            });

            expect(fetchSpy).toHaveBeenCalledWith(
                'http://localhost:4000/api/processes/proc-reply-001/message?workspaceId=ws-myrepo',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ content: 'Can you also fix the tests?' }),
                }),
            );

            fetchSpy.mockRestore();
            await bridge.stop();
        });

        it('should fall back to global session for unknown quoted message', async () => {
            const bridge = new WhatsAppBridge(opts);
            await bridge.start();

            const fetchSpy = vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'proc-fallback' })));

            await lastBot().opts.onMessage({
                senderJid: 'group@g.us',
                messageId: 'wamid.in-005',
                text: 'Reply to unknown',
                quotedMessageId: 'wamid.unknown-999',
            });

            // Should create a new chat (global session) since quoted message not found
            expect(fetchSpy).toHaveBeenCalledWith(
                'http://localhost:4000/api/queue',
                expect.objectContaining({ method: 'POST' }),
            );

            fetchSpy.mockRestore();
            await bridge.stop();
        });
    });
});
