/**
 * Tests for TeamsBridge — mocks bot, WS relay, store, and agent store.
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
    setChannelId: ReturnType<typeof vi.fn>;
    getChannelId: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    getLastError: ReturnType<typeof vi.fn>;
    getDeviceCode: ReturnType<typeof vi.fn>;
    listChannels: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('@plusplusoneplusplus/teams-bot', () => {
    return {
        TeamsBot: class MockTeamsBot {
            opts: any;
            start = vi.fn().mockResolvedValue(undefined);
            stop = vi.fn().mockResolvedValue(undefined);
            send = vi.fn().mockResolvedValue('teams-msg-001');
            setChannelId = vi.fn();
            getChannelId = vi.fn().mockReturnValue(null);
            getStatus = vi.fn().mockReturnValue('connected');
            getLastError = vi.fn().mockReturnValue(null);
            listChannels = vi.fn().mockResolvedValue([]);
            constructor(opts: any) {
                this.opts = opts;
                botInstances.push(this as any);
            }
        },
        GraphClient: class MockGraphClient {
            constructor(_opts: any) {}
            resolveOrCreateTeamAndChannel = vi.fn().mockResolvedValue({ teamId: 'team-123', channelId: 'channel-456' });
            setTeamId = vi.fn();
            findChannelByName = vi.fn().mockResolvedValue({ id: 'channel-456', displayName: 'test' });
            createChannel = vi.fn().mockResolvedValue('channel-new');
        },
        acquireTokenViaAzCli: vi.fn().mockResolvedValue('mock-az-token'),
    };
});

import { TeamsBridge, type TeamsBridgeOptions } from '../../src/messaging/teams-bridge';

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

describe('TeamsBridge', () => {
    let tmpDir: string;
    let wsRelay: EventEmitter & { on: any; off: any; emit: any };
    let agentStore: ReturnType<typeof createMockAgentStore>;
    let tunnelBridge: ReturnType<typeof createMockTunnelBridge>;

    beforeEach(() => {
        botInstances = [];
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-bridge-test-'));
        wsRelay = new EventEmitter() as any;
        agentStore = createMockAgentStore();
        tunnelBridge = createMockTunnelBridge();
    });

    afterEach(async () => {
        // Stop all bot instances to release resources
        for (const bot of botInstances) {
            await bot.stop();
        }
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
            // On Windows, SQLite db may still be locked briefly
        }
    });

    function createBridge(configOverrides?: Partial<TeamsBridgeOptions['config']>): TeamsBridge {
        return new TeamsBridge({
            config: {
                enabled: true,
                mcpServerUrl: 'https://test.teams.mcp/server',
                channelId: 'channel-test',
                botName: 'TestBot',
                pollIntervalMs: 3000,
                ...configOverrides,
            },
            dataDir: tmpDir,
            wsRelay: wsRelay as any,
            agentStore: agentStore as any,
            tunnelBridge: tunnelBridge as any,
        });
    }

    describe('start / stop', () => {
        it('should create TeamsBot and start it', async () => {
            const bridge = createBridge();
            await bridge.start();

            expect(botInstances).toHaveLength(1);
            expect(lastBot().start).toHaveBeenCalled();
            expect(lastBot().setChannelId).toHaveBeenCalledWith('channel-test');

            await bridge.stop();
            expect(lastBot().stop).toHaveBeenCalled();
        });

        it('should pass config to TeamsBot', async () => {
            const bridge = createBridge({ mcpServerUrl: 'https://my-teams.mcp', botName: 'MyBot' });
            await bridge.start();

            const bot = lastBot();
            expect(bot.opts.mcpServerUrl).toBe('https://my-teams.mcp');
            expect(bot.opts.botName).toBe('MyBot');

            await bridge.stop();
        });
    });

    describe('getTeamsStatus', () => {
        it('should return current status', async () => {
            const bridge = createBridge();
            await bridge.start();

            const status = bridge.getTeamsStatus();
            expect(status.enabled).toBe(true);
            expect(status.status).toBe('connected');
            expect(status.error).toBeNull();
            expect(status.channelId).toBe('channel-test');
            expect(status.botName).toBe('TestBot');

            await bridge.stop();
        });
    });

    describe('updateConfig', () => {
        it('should update botName and persist', async () => {
            const bridge = createBridge();
            await bridge.start();

            await bridge.updateConfig({ botName: 'NewBot' });

            const status = bridge.getTeamsStatus();
            expect(status.botName).toBe('NewBot');

            // Check persisted config
            const configPath = path.join(tmpDir, 'config.yaml');
            expect(fs.existsSync(configPath)).toBe(true);
            const content = fs.readFileSync(configPath, 'utf8');
            expect(content).toContain('NewBot');

            await bridge.stop();
        });

        it('should update channelId and call setChannelId on bot', async () => {
            const bridge = createBridge();
            await bridge.start();

            await bridge.updateConfig({ channelId: 'new-channel' });

            expect(lastBot().setChannelId).toHaveBeenCalledWith('new-channel');

            await bridge.stop();
        });
    });

    describe('reconnect', () => {
        it('should stop old bot and create a new one', async () => {
            const bridge = createBridge();
            await bridge.start();

            expect(botInstances).toHaveLength(1);

            await bridge.reconnect();

            expect(botInstances).toHaveLength(2);
            expect(botInstances[0].stop).toHaveBeenCalled();
            expect(botInstances[1].start).toHaveBeenCalled();

            await bridge.stop();
        });
    });

    describe('outbound messages (process-updated → Teams)', () => {
        it('should send outbound message to Teams on process-updated', async () => {
            const bridge = createBridge();
            await bridge.start();

            // Mock fetch for process turns
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-1',
                        status: 'completed',
                        conversationTurns: [
                            { role: 'user', content: 'Hello' },
                            { role: 'assistant', content: 'Hi there!' },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-1', status: 'completed', workspaceId: 'ws-1' },
            });

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(lastBot().send).toHaveBeenCalledTimes(2);
            const calls = lastBot().send.mock.calls;
            // First call is user turn with botName as sender
            expect(calls[0][1]).toContain('TestBot');
            expect(calls[0][1]).toContain('Hello');
            // Second call is assistant turn with 'CoC Agent' as sender
            expect(calls[1][1]).toContain('CoC Agent');
            expect(calls[1][1]).toContain('Hi there!');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should ignore non-process-updated events', async () => {
            const bridge = createBridge();
            await bridge.start();

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'agent-connected',
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(lastBot().send).not.toHaveBeenCalled();

            await bridge.stop();
        });
    });

    describe('formatOutboundMessage', () => {
        it('should format user message correctly', async () => {
            const bridge = createBridge();
            await bridge.start();

            const msg = bridge.formatOutboundMessage({
                role: 'user',
                agent: 'Agent-A',
                repo: 'my-repo',
                title: 'Task 1',
                content: 'Please help',
                botName: 'TestBot',
            });

            expect(msg).toContain('TestBot');
            expect(msg).not.toContain('**');
            expect(msg).toContain('Agent: Agent-A');
            expect(msg).toContain('Repo: my-repo');
            expect(msg).toContain('Title: Task 1');
            expect(msg).toContain('Message:');
            expect(msg).toContain('Please help');

            await bridge.stop();
        });

        it('should format assistant message correctly', async () => {
            const bridge = createBridge();
            await bridge.start();

            const msg = bridge.formatOutboundMessage({
                role: 'assistant',
                agent: 'Agent-B',
                repo: 'other-repo',
                title: '',
                content: 'Done!',
            });

            expect(msg).toContain('CoC Agent');
            expect(msg).not.toContain('**');
            expect(msg).not.toContain('Title:');
            expect(msg).toContain('Message:');
            expect(msg).toContain('Done!');

            await bridge.stop();
        });

        it('should include @mention tag when mentionName is provided', async () => {
            const bridge = createBridge();
            await bridge.start();

            const msg = bridge.formatOutboundMessage({
                role: 'assistant',
                agent: 'Agent-A',
                repo: 'my-repo',
                title: 'Task 1',
                content: 'Done!',
                mentionName: 'John Doe',
            });

            expect(msg).toContain('<at id="0">John Doe</at>');
            expect(msg).toContain('CoC Agent');
            expect(msg).toContain('Done!');

            await bridge.stop();
        });

        it('should not include @mention tag when mentionName is undefined', async () => {
            const bridge = createBridge();
            await bridge.start();

            const msg = bridge.formatOutboundMessage({
                role: 'assistant',
                agent: 'Agent-A',
                repo: 'my-repo',
                title: '',
                content: 'Hello',
            });

            expect(msg).not.toContain('<at');

            await bridge.stop();
        });
    });

    describe('outbound @mentions (process sender tracking)', () => {
        it('should pass mentions to bot.send when sender is known', async () => {
            const bridge = createBridge();
            await bridge.start();

            // Mock fetch: first call for resolveGlobalSession, subsequent for process data
            const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
                if (opts?.method === 'POST' && url.includes('/api/queue')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({ id: 'proc-alice-001' }),
                    });
                }
                if (url.includes('/api/processes/proc-alice-001')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            process: {
                                id: 'proc-alice-001',
                                status: 'completed',
                                conversationTurns: [
                                    { role: 'assistant', content: 'Hello Alice!' },
                                ],
                            },
                        }),
                    });
                }
                return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
            });
            vi.stubGlobal('fetch', mockFetch);

            // Simulate inbound message — this stores sender info
            const bot = lastBot();
            await bot.opts.onMessage({
                channelId: 'channel-test',
                messageId: 'teams-inbound-1',
                text: 'Hello bot',
                senderName: 'Alice',
                senderAadId: 'aad-alice-123',
            });

            // Wait for inbound processing (resolveGlobalSession fetch)
            await new Promise(resolve => setTimeout(resolve, 100));

            // Now emit process-updated for proc-alice-001
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-alice-001', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 100));

            // Check that send was called with mentions
            const sendCalls = bot.send.mock.calls;
            const outboundCall = sendCalls.find((c: any[]) => c[1]?.includes('Hello Alice!'));
            expect(outboundCall).toBeDefined();
            // Message content should have @mention tag
            expect(outboundCall![1]).toContain('<at id="0">Alice</at>');
            // Mentions array should be passed
            expect(outboundCall![2]?.mentions).toEqual([
                { aadId: 'aad-alice-123', displayName: 'Alice' },
            ]);

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should send without mentions when sender is unknown', async () => {
            const bridge = createBridge();
            await bridge.start();

            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-unknown',
                        status: 'completed',
                        conversationTurns: [
                            { role: 'assistant', content: 'Done' },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-unknown', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 100));

            const bot = lastBot();
            const sendCalls = bot.send.mock.calls;
            // Should still send but without mentions
            if (sendCalls.length > 0) {
                const lastCall = sendCalls[sendCalls.length - 1];
                // No mentions arg or mentions is undefined
                expect(lastCall[2]?.mentions).toBeUndefined();
                // Message should not contain <at> tags
                expect(lastCall[1]).not.toContain('<at');
            }

            vi.unstubAllGlobals();
            await bridge.stop();
        });
    });
});
