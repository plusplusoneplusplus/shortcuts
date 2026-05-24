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
    const mockTransport = {
        initialize: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue('transport-msg-001'),
        poll: vi.fn().mockResolvedValue({ messages: [], nextSince: '' }),
        listChannels: vi.fn().mockResolvedValue([]),
        resolveTeamAndChannel: vi.fn().mockResolvedValue({ teamId: 'team-123', channelId: 'channel-456' }),
        setToken: vi.fn(),
        setChannelId: vi.fn(),
        stop: vi.fn(),
    };
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
        createTransport: vi.fn().mockReturnValue(mockTransport),
        GraphClient: class MockGraphClient {
            constructor(_opts: any) {}
            resolveOrCreateTeamAndChannel = vi.fn().mockResolvedValue({ teamId: 'team-123', channelId: 'channel-456' });
            setTeamId = vi.fn();
            findChannelByName = vi.fn().mockResolvedValue({ id: 'channel-456', displayName: 'test' });
            createChannel = vi.fn().mockResolvedValue('channel-new');
        },
        acquireTokenViaAzCli: vi.fn().mockResolvedValue('mock-az-token'),
        acquireMcpOAuthToken: vi.fn().mockResolvedValue('mock-oauth-token'),
    };
});

import { TeamsBridge, extractTimelineContentChunks, type TeamsBridgeOptions } from '../../src/messaging/teams-bridge';

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
    let sseRelay: EventEmitter & { on: any; off: any; emit: any };
    let agentStore: ReturnType<typeof createMockAgentStore>;
    let tunnelBridge: ReturnType<typeof createMockTunnelBridge>;

    beforeEach(() => {
        botInstances = [];
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-bridge-test-'));
        wsRelay = new EventEmitter() as any;
        sseRelay = new EventEmitter() as any;
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
                mode: 'graph',
                mcpServerUrl: 'https://test.teams.mcp/server',
                channelId: 'channel-test',
                teamId: 'team-test',
                botName: 'TestBot',
                pollIntervalMs: 3000,
                ...configOverrides,
            },
            dataDir: tmpDir,
            wsRelay: wsRelay as any,
            sseRelay: sseRelay as any,
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

        it('should subscribe to both WS relay and SSE relay', async () => {
            const bridge = createBridge();
            await bridge.start();

            expect(wsRelay.listenerCount('message')).toBe(1);
            expect(sseRelay.listenerCount('event')).toBe(1);

            await bridge.stop();

            expect(wsRelay.listenerCount('message')).toBe(0);
            expect(sseRelay.listenerCount('event')).toBe(0);
        });

        it('should dispatch SSE events same as WS events', async () => {
            const bridge = createBridge();
            await bridge.start();

            agentStore.list.mockReturnValue([{ id: 'agent-a', name: 'Agent-A', address: 'http://localhost:4001' }]);

            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-sse',
                        status: 'completed',
                        conversationTurns: [
                            { role: 'user', content: 'SSE test' },
                            { role: 'assistant', content: 'SSE response', toolCalls: [
                                { name: 'task_complete', args: { summary: 'SSE response' }, status: 'completed' },
                            ] },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch);

            // Emit via SSE relay instead of WS relay
            sseRelay.emit('event', {
                agentId: 'agent-a',
                agentName: 'Agent-A',
                data: JSON.stringify({
                    type: 'process-updated',
                    process: { id: 'proc-sse', status: 'completed', workspaceId: 'ws-1' },
                }),
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            // Should have processed the event and sent to Teams
            expect(lastBot().send).toHaveBeenCalled();
            const calls = lastBot().send.mock.calls;
            expect(calls.some((c: any[]) => c[1]?.includes('SSE response'))).toBe(true);

            await bridge.stop();
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

            // Mock fetch for process turns — includes task_complete tool call
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-1',
                        status: 'completed',
                        conversationTurns: [
                            { role: 'user', content: 'Hello' },
                            { role: 'assistant', content: 'Hi there!', toolCalls: [
                                { name: 'task_complete', args: { summary: 'Hi there!' }, status: 'completed' },
                            ] },
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
            // First call is user turn (forwarded immediately)
            expect(calls[0][1]).toContain('Hello');
            // Second call is the task_complete summary
            expect(calls[1][1]).toContain('CoC Agent');
            expect(calls[1][1]).toContain('Hi there!');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should only send task_complete summary on completion (not process.result fallback)', async () => {
            const bridge = createBridge();
            await bridge.start();

            // Process with task_complete tool call in turns
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-1',
                        status: 'completed',
                        result: 'Long verbose reasoning that should NOT be sent...',
                        conversationTurns: [
                            { role: 'user', content: 'Disable the test' },
                            { role: 'assistant', content: 'Long intermediate reasoning...', toolCalls: [
                                { name: 'task_complete', args: { summary: 'Disabled the test successfully.' }, status: 'completed' },
                            ] },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-1', status: 'completed', workspaceId: 'ws-1' },
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(lastBot().send).toHaveBeenCalledTimes(2);
            const calls = lastBot().send.mock.calls;
            // First: user turn forwarded
            expect(calls[0][1]).toContain('Disable the test');
            // Second: task_complete summary (not verbose reasoning)
            expect(calls[1][1]).toContain('Disabled the test successfully.');
            expect(calls[1][1]).not.toContain('Long intermediate reasoning');
            expect(calls[1][1]).not.toContain('Long verbose reasoning');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should send task_complete summary even when watermark is already at end (no new turns)', async () => {
            const bridge = createBridge();
            await bridge.start();

            // First event: running with user turn — user turn forwarded immediately
            const mockFetch1 = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-wm',
                        status: 'running',
                        conversationTurns: [
                            { role: 'user', content: 'Plan auth feature' },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch1);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-wm', status: 'running', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(lastBot().send).toHaveBeenCalledTimes(1); // user turn sent

            // Second event: completed with task_complete tool call
            const mockFetch2 = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-wm',
                        status: 'completed',
                        conversationTurns: [
                            { role: 'user', content: 'Plan auth feature' },
                            { role: 'assistant', content: 'Long verbose planning...', toolCalls: [
                                { name: 'task_complete', args: { summary: 'Here is the auth plan with 10 tasks.' }, status: 'completed' },
                            ] },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch2);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-wm', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            // Should send task_complete summary even though watermark covered the assistant turn
            expect(lastBot().send).toHaveBeenCalledTimes(2);
            expect(lastBot().send.mock.calls[1][1]).toContain('Here is the auth plan with 10 tasks.');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should not re-send task_complete on duplicate completion events', async () => {
            const bridge = createBridge();
            await bridge.start();

            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-dup',
                        status: 'completed',
                        conversationTurns: [
                            { role: 'user', content: 'Do something' },
                            { role: 'assistant', content: 'Done', toolCalls: [
                                { name: 'task_complete', args: { summary: 'Task done.' }, status: 'completed' },
                            ] },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch);

            // First completion event
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-dup', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(lastBot().send).toHaveBeenCalledTimes(2); // user + task_complete

            // Duplicate completion event (same turns, same status)
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-dup', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            // Should NOT re-send — watermark already past task_complete
            expect(lastBot().send).toHaveBeenCalledTimes(2);

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

        it('should send only the last content chunk when timeline has multiple content items', async () => {
            const bridge = createBridge();
            await bridge.start();

            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-chunked',
                        status: 'completed',
                        conversationTurns: [
                            { role: 'user', content: 'Show Batch 4 details' },
                            {
                                role: 'assistant',
                                content: 'Chunk one text. Chunk two text. Chunk three text.',
                                timeline: [
                                    { type: 'content', content: 'Chunk one text.' },
                                    { type: 'tool-start', toolCall: { id: 'tc1', toolName: 'grep' } },
                                    { type: 'tool-complete', toolCall: { id: 'tc1', toolName: 'grep' } },
                                    { type: 'content', content: 'Chunk two text.' },
                                    { type: 'tool-start', toolCall: { id: 'tc2', toolName: 'view' } },
                                    { type: 'tool-complete', toolCall: { id: 'tc2', toolName: 'view' } },
                                    { type: 'content', content: 'Chunk three text.' },
                                ],
                                toolCalls: [
                                    { name: 'grep', args: {} },
                                    { name: 'view', args: {} },
                                ],
                            },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-chunked', status: 'completed', workspaceId: 'ws-1' },
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            // Expect: 1 user turn + 1 last-chunk assistant message = 2 sends
            expect(lastBot().send).toHaveBeenCalledTimes(2);
            const calls = lastBot().send.mock.calls;
            // First call: user turn forwarded
            expect(calls[0][1]).toContain('Show Batch 4 details');
            // Second: only the last chunk
            expect(calls[1][1]).toContain('Chunk three text.');
            expect(calls[1][1]).not.toContain('Chunk one text.');
            expect(calls[1][1]).not.toContain('Chunk two text.');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should send single message when timeline has only one content item', async () => {
            const bridge = createBridge();
            await bridge.start();

            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-single',
                        status: 'completed',
                        conversationTurns: [
                            { role: 'user', content: 'Quick question' },
                            {
                                role: 'assistant',
                                content: 'Here is the answer.',
                                timeline: [
                                    { type: 'content', content: 'Here is the answer.' },
                                ],
                            },
                        ],
                    },
                }),
            });
            vi.stubGlobal('fetch', mockFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-single', status: 'completed', workspaceId: 'ws-1' },
            });

            await new Promise(resolve => setTimeout(resolve, 50));

            // 1 user turn + 1 single final message = 2 sends
            expect(lastBot().send).toHaveBeenCalledTimes(2);
            const calls = lastBot().send.mock.calls;
            expect(calls[1][1]).toContain('Here is the answer.');

            vi.unstubAllGlobals();
            await bridge.stop();
        });
    });

    describe('extractTimelineContentChunks', () => {
        it('should extract content chunks from timeline', () => {
            const timeline = [
                { type: 'content', content: 'First chunk' },
                { type: 'tool-start', toolCall: { id: 'tc1' } },
                { type: 'tool-complete', toolCall: { id: 'tc1' } },
                { type: 'content', content: 'Second chunk' },
                { type: 'content', content: 'Third chunk' },
            ];
            expect(extractTimelineContentChunks(timeline)).toEqual(['First chunk', 'Second chunk', 'Third chunk']);
        });

        it('should return empty array for undefined/null timeline', () => {
            expect(extractTimelineContentChunks(undefined)).toEqual([]);
            expect(extractTimelineContentChunks(null)).toEqual([]);
            expect(extractTimelineContentChunks([])).toEqual([]);
        });

        it('should skip empty content items', () => {
            const timeline = [
                { type: 'content', content: 'Valid' },
                { type: 'content', content: '   ' },
                { type: 'content', content: '' },
                { type: 'content', content: 'Also valid' },
            ];
            expect(extractTimelineContentChunks(timeline)).toEqual(['Valid', 'Also valid']);
        });

        it('should return empty array when no content items exist', () => {
            const timeline = [
                { type: 'tool-start', toolCall: { id: 'tc1' } },
                { type: 'tool-complete', toolCall: { id: 'tc1' } },
            ];
            expect(extractTimelineContentChunks(timeline)).toEqual([]);
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
                                    { role: 'assistant', content: 'Hello Alice!', toolCalls: [
                                        { name: 'task_complete', args: { summary: 'Hello Alice!' }, status: 'completed' },
                                    ] },
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
                            { role: 'assistant', content: 'Done', toolCalls: [
                                { name: 'task_complete', args: { summary: 'Done' }, status: 'completed' },
                            ] },
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

    describe('outbound locking — messages sent in all scenarios', () => {
        function mockProcessFetch(turns: Array<{ role: string; content: string; streaming?: boolean; toolCalls?: Array<{ name: string; args?: any; status?: string }> }>) {
            return vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: {
                        id: 'proc-lock',
                        status: 'completed',
                        conversationTurns: turns,
                    },
                }),
            });
        }

        it('should send messages after a completed process receives a follow-up', async () => {
            const bridge = createBridge();
            await bridge.start();

            // First completion
            const mockFetch = mockProcessFetch([
                { role: 'assistant', content: 'First response', toolCalls: [
                    { name: 'task_complete', args: { summary: 'First response' }, status: 'completed' },
                ] },
            ]);
            vi.stubGlobal('fetch', mockFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(lastBot().send).toHaveBeenCalledTimes(1);

            // Second completion (simulating follow-up response — same processId)
            const mockFetch2 = mockProcessFetch([
                { role: 'assistant', content: 'First response', toolCalls: [
                    { name: 'task_complete', args: { summary: 'First response' }, status: 'completed' },
                ] },
                { role: 'user', content: 'Follow-up question' },
                { role: 'assistant', content: 'Second response', toolCalls: [
                    { name: 'task_complete', args: { summary: 'Second response' }, status: 'completed' },
                ] },
            ]);
            vi.stubGlobal('fetch', mockFetch2);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            // Should have sent user turn + final assistant turn for the follow-up round
            expect(lastBot().send).toHaveBeenCalledTimes(3);

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should send messages after a process fetch returns empty turns', async () => {
            const bridge = createBridge();
            await bridge.start();

            // First event: empty turns
            const emptyFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    process: { id: 'proc-lock', status: 'completed', conversationTurns: [] },
                }),
            });
            vi.stubGlobal('fetch', emptyFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(lastBot().send).not.toHaveBeenCalled();

            // Second event: now has turns — should NOT be blocked
            const goodFetch = mockProcessFetch([
                { role: 'assistant', content: 'Now I have something', toolCalls: [
                    { name: 'task_complete', args: { summary: 'Now I have something' }, status: 'completed' },
                ] },
            ]);
            vi.stubGlobal('fetch', goodFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(lastBot().send).toHaveBeenCalledTimes(1);
            expect(lastBot().send.mock.calls[0][1]).toContain('Now I have something');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should send messages after a process fetch fails (non-200)', async () => {
            const bridge = createBridge();
            await bridge.start();

            // First event: fetch fails
            const failFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
            vi.stubGlobal('fetch', failFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(lastBot().send).not.toHaveBeenCalled();

            // Second event: fetch succeeds — should NOT be blocked
            const goodFetch = mockProcessFetch([
                { role: 'assistant', content: 'Recovered!', toolCalls: [
                    { name: 'task_complete', args: { summary: 'Recovered!' }, status: 'completed' },
                ] },
            ]);
            vi.stubGlobal('fetch', goodFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(lastBot().send).toHaveBeenCalledTimes(1);
            expect(lastBot().send.mock.calls[0][1]).toContain('Recovered!');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should send messages after a fetch throws an exception', async () => {
            const bridge = createBridge();
            await bridge.start();

            // First event: fetch throws
            const throwFetch = vi.fn().mockRejectedValue(new Error('Network error'));
            vi.stubGlobal('fetch', throwFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(lastBot().send).not.toHaveBeenCalled();

            // Second event: succeeds — should NOT be blocked
            const goodFetch = mockProcessFetch([
                { role: 'assistant', content: 'After error', toolCalls: [
                    { name: 'task_complete', args: { summary: 'After error' }, status: 'completed' },
                ] },
            ]);
            vi.stubGlobal('fetch', goodFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(lastBot().send).toHaveBeenCalledTimes(1);
            expect(lastBot().send.mock.calls[0][1]).toContain('After error');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should skip intermediate assistant turns during running status', async () => {
            const bridge = createBridge();
            await bridge.start();

            const mockFetch = mockProcessFetch([
                { role: 'assistant', content: 'Streaming done' },
            ]);
            vi.stubGlobal('fetch', mockFetch);

            // First running event — only assistant turn, should be skipped
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'running', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(lastBot().send).toHaveBeenCalledTimes(0);

            // Second running event with more assistant turns — still skipped
            const mockFetch2 = mockProcessFetch([
                { role: 'assistant', content: 'Streaming done' },
                { role: 'assistant', content: 'More content' },
            ]);
            vi.stubGlobal('fetch', mockFetch2);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'running', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            // Intermediate assistant turns are not sent during running
            expect(lastBot().send).toHaveBeenCalledTimes(0);

            // Completion event — only task_complete summary is sent
            const mockFetch3 = mockProcessFetch([
                { role: 'assistant', content: 'Streaming done' },
                { role: 'assistant', content: 'More content' },
                { role: 'assistant', content: 'Final answer', toolCalls: [
                    { name: 'task_complete', args: { summary: 'Final answer' }, status: 'completed' },
                ] },
            ]);
            vi.stubGlobal('fetch', mockFetch3);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(lastBot().send).toHaveBeenCalledTimes(1);
            expect(lastBot().send.mock.calls[0][1]).toContain('Final answer');

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should not send when bot is disconnected but should send after reconnect', async () => {
            const bridge = createBridge();
            await bridge.start();

            // Bot is disconnected
            lastBot().getStatus.mockReturnValue('disconnected');

            const mockFetch = mockProcessFetch([
                { role: 'assistant', content: 'Should not arrive', toolCalls: [
                    { name: 'task_complete', args: { summary: 'Should not arrive' }, status: 'completed' },
                ] },
            ]);
            vi.stubGlobal('fetch', mockFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(lastBot().send).not.toHaveBeenCalled();

            // Bot reconnects
            lastBot().getStatus.mockReturnValue('connected');

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-lock', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(lastBot().send).toHaveBeenCalledTimes(1);

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should handle multiple different processes independently', async () => {
            const bridge = createBridge();
            await bridge.start();

            const mockFetch = vi.fn().mockImplementation((url: string) => {
                const id = url.includes('proc-A') ? 'proc-A' : 'proc-B';
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        process: {
                            id,
                            status: 'completed',
                            conversationTurns: [
                                { role: 'assistant', content: `Response from ${id}`, toolCalls: [
                                    { name: 'task_complete', args: { summary: `Response from ${id}` }, status: 'completed' },
                                ] },
                            ],
                        },
                    }),
                });
            });
            vi.stubGlobal('fetch', mockFetch);

            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-A', status: 'completed', workspaceId: 'ws-1' },
            });
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-B', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(lastBot().send).toHaveBeenCalledTimes(2);
            const messages = lastBot().send.mock.calls.map((c: any[]) => c[1]);
            expect(messages.some((m: string) => m.includes('proc-A'))).toBe(true);
            expect(messages.some((m: string) => m.includes('proc-B'))).toBe(true);

            vi.unstubAllGlobals();
            await bridge.stop();
        });
    });

    describe('[chatId] prefix routing', () => {
        it('should route message to specific process when [chatId] prefix is used', async () => {
            const bridge = createBridge();
            await bridge.start();

            // First, send an outbound message to create a binding for proc-target
            const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
                if (url.includes('/api/processes/proc-target')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            process: {
                                id: 'proc-target',
                                status: 'completed',
                                conversationTurns: [
                                    { role: 'assistant', content: 'First response', toolCalls: [
                                        { name: 'task_complete', args: { summary: 'First response' }, status: 'completed' },
                                    ] },
                                ],
                            },
                        }),
                    });
                }
                // Follow-up call
                if (opts?.method === 'POST' && url.includes('/follow-up')) {
                    return Promise.resolve({ ok: true, json: async () => ({ id: 'proc-target' }) });
                }
                return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
            });
            vi.stubGlobal('fetch', mockFetch);

            // Emit outbound to create binding in store
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-target', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 100));

            // Now simulate inbound with [chatId] prefix
            const bot = lastBot();
            await bot.opts.onMessage({
                channelId: 'channel-test',
                messageId: 'teams-inbound-prefix',
                text: '[proc-target] Can you continue?',
                senderName: 'Alice',
                senderAadId: 'aad-alice-123',
            });
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify that follow-up was sent to the correct process
            const fetchCalls = mockFetch.mock.calls.map((c: any[]) => c[0]);
            const followUpCall = fetchCalls.find((u: string) => u.includes('follow-up') || u.includes('proc-target'));
            expect(followUpCall).toBeDefined();

            vi.unstubAllGlobals();
            await bridge.stop();
        });

        it('should strip [chatId] prefix from message text before sending', async () => {
            const bridge = createBridge();
            await bridge.start();

            const followUpBody: string[] = [];
            const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
                if (url.includes('/api/processes/proc-strip') && !opts?.method) {
                    // GET process data
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            process: {
                                id: 'proc-strip',
                                status: 'completed',
                                conversationTurns: [
                                    { role: 'assistant', content: 'Done', toolCalls: [
                                        { name: 'task_complete', args: { summary: 'Done' }, status: 'completed' },
                                    ] },
                                ],
                            },
                        }),
                    });
                }
                if (opts?.method === 'POST' && url.includes('/api/processes/proc-strip/message')) {
                    // Follow-up message
                    if (opts.body) followUpBody.push(opts.body);
                    return Promise.resolve({ ok: true, json: async () => ({}) });
                }
                if (opts?.method === 'POST') {
                    // resolveGlobalSession or other POST
                    if (opts.body) followUpBody.push(opts.body);
                    return Promise.resolve({ ok: true, json: async () => ({ id: 'proc-strip' }) });
                }
                return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
            });
            vi.stubGlobal('fetch', mockFetch);

            // Create binding via outbound message
            emitProcessUpdate(wsRelay, 'agent-a', 'Agent-A', {
                type: 'process-updated',
                process: { id: 'proc-strip', status: 'completed', workspaceId: 'ws-1' },
            });
            await new Promise(resolve => setTimeout(resolve, 100));

            // Inbound with prefix
            const bot = lastBot();
            await bot.opts.onMessage({
                channelId: 'channel-test',
                messageId: 'teams-inbound-strip',
                text: '[proc-strip] What is the status?',
                senderName: 'Bob',
            });
            await new Promise(resolve => setTimeout(resolve, 100));

            // The follow-up body should contain the stripped message (without [proc-strip] prefix)
            const bodyWithMessage = followUpBody.find(b => b.includes('What is the status?'));
            expect(bodyWithMessage).toBeDefined();
            if (bodyWithMessage) {
                expect(bodyWithMessage).not.toContain('[proc-strip]');
            }

            vi.unstubAllGlobals();
            await bridge.stop();
        });
    });
});
