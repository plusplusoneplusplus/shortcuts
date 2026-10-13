import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { cocToolBridgeServer } from '../../src/llm-tools/bridge-server';
import type { RuntimeToolInventory } from '../../src/tool-inventory';

const started = { type: 'thread.started', thread_id: 'thread-inventory' };
const response = { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'ok' } };

describe('Codex startup tool inventory', () => {
    let service: CodexSDKService;

    afterEach(() => {
        service?.dispose();
        cocToolBridgeServer.closeAll();
    });

    function setup(events: Record<string, unknown>[], beforeEvent?: () => void) {
        service = new CodexSDKService();
        const closed = vi.fn();
        const thread = {
            id: null,
            runStreamed: vi.fn(async (_input: unknown, _options: { signal: AbortSignal }) => ({
                events: (async function* () {
                    try {
                        for (const event of events) {
                            beforeEvent?.();
                            yield event;
                        }
                    } finally {
                        closed();
                    }
                })(),
            })),
        };
        const client = { startThread: vi.fn(() => thread), resumeThread: vi.fn(() => thread) };
        const internals = service as unknown as { sdk: unknown; availabilityCache: unknown; codexCtor: unknown };
        internals.sdk = client;
        internals.availabilityCache = { available: true };
        internals.codexCtor = vi.fn(function () { return client; });
        return { thread, client, closed };
    }

    it('awaits unavailable capture after startup and before response delivery, once per turn', async () => {
        const { client } = setup([started, { type: 'turn.started' }, response]);
        const order: string[] = [];
        const onToolInventory = vi.fn(async (inventory: RuntimeToolInventory) => {
            expect(inventory.provider).toBe('codex');
            expect(inventory.tools).toEqual([]);
            expect(inventory.truncated).toBe(false);
            expect(Number.isNaN(Date.parse(inventory.capturedAt))).toBe(false);
            expect(inventory.categories.map(({ source, status }) => ({ source, status }))).toEqual([
                { source: 'builtin', status: 'unavailable' },
                { source: 'coc', status: 'unavailable' },
                { source: 'mcp', status: 'unavailable' },
            ]);
            order.push('capture');
            await Promise.resolve();
            order.push('persisted');
        });
        const result = await service.sendMessage({ prompt: 'hi', onToolInventory,
            onSessionCreated: () => order.push('session'),
            onStreamingChunk: chunk => { if (chunk) order.push('response'); },
        });
        expect(result.success).toBe(true);
        expect(order).toEqual(['session', 'capture', 'persisted', 'response']);
        expect(onToolInventory).toHaveBeenCalledTimes(1);
        expect(client.startThread).toHaveBeenCalledTimes(1);
        expect(client.resumeThread).not.toHaveBeenCalled();
    });

    it('does not infer inventory from configured or invoked CoC and external MCP tools', async () => {
        setup([started, { type: 'item.started', item: { id: 'mcp', type: 'mcp_tool_call',
            server: 'external', tool: 'read', arguments: { secret: 'private' }, status: 'in_progress' } }, response]);
        const onToolInventory = vi.fn();
        const onToolEvent = vi.fn(() => expect(onToolInventory).toHaveBeenCalledTimes(1));
        const result = await service.sendMessage({ prompt: 'hi', onToolInventory,
            onToolEvent,
            tools: [{ name: 'never_called', description: 'configured tool', parameters: { type: 'object' }, handler: async () => 'ok' }],
        });
        expect(result.success).toBe(true);
        expect(onToolInventory).toHaveBeenCalledTimes(1);
        expect(onToolEvent).toHaveBeenCalled();
        expect(onToolInventory.mock.calls[0][0].tools).toEqual([]);
        expect(JSON.stringify(onToolInventory.mock.calls[0][0])).not.toContain('private');
        expect(cocToolBridgeServer.activeCount).toBe(0);
    });

    it.each([{ events: [] }, { events: [response] }])('captures unavailable for streams without a startup frame: %j', async ({ events }) => {
        setup(events);
        const onToolInventory = vi.fn();
        const result = await service.sendMessage({ prompt: 'hi', sessionId: 'resumed', onToolInventory });
        expect(result.success).toBe(true);
        expect(onToolInventory).toHaveBeenCalledTimes(1);
        expect(onToolInventory.mock.calls[0][0].categories.every((c: { status: string }) => c.status === 'unavailable')).toBe(true);
    });

    it('captures a fresh snapshot on every resumed turn', async () => {
        const { client } = setup([started, response]);
        const onToolInventory = vi.fn();
        for (let i = 0; i < 2; i++) {
            expect((await service.sendMessage({ prompt: 'hi', sessionId: 'resumed', onToolInventory })).success).toBe(true);
        }
        expect(client.resumeThread).toHaveBeenCalledTimes(2);
        expect(onToolInventory).toHaveBeenCalledTimes(2);
        expect(onToolInventory.mock.calls[0][0]).not.toBe(onToolInventory.mock.calls[1][0]);
    });

    it('stops response delivery and cleans the bridge when persistence rejects', async () => {
        const { thread, closed } = setup([started, response]);
        const onStreamingChunk = vi.fn();
        const result = await service.sendMessage({ prompt: 'hi', onStreamingChunk,
            tools: [{ name: 'read', description: 'read', parameters: {}, handler: async () => 'ok' }],
            onToolInventory: async () => { throw new Error('inventory storage failed'); },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('inventory storage failed');
        expect(onStreamingChunk).not.toHaveBeenCalled();
        expect(thread.runStreamed.mock.calls[0][1].signal.aborted).toBe(true);
        expect(closed).toHaveBeenCalledOnce();
        expect(cocToolBridgeServer.activeCount).toBe(0);
        expect(service.hasActiveSession('thread-inventory')).toBe(false);
    });

    it('suppresses late capture when aborted during startup', async () => {
        const controller = new AbortController();
        setup([started, response], () => controller.abort());
        const onToolInventory = vi.fn();
        const onStreamingChunk = vi.fn();
        const result = await service.sendMessage({ prompt: 'hi', signal: controller.signal, onToolInventory, onStreamingChunk });
        expect(result.success).toBe(false);
        expect(onToolInventory).not.toHaveBeenCalled();
        expect(onStreamingChunk).not.toHaveBeenCalled();
    });

    it('rechecks cancellation after awaiting persistence', async () => {
        const controller = new AbortController();
        setup([started, response]);
        const onStreamingChunk = vi.fn();
        const result = await service.sendMessage({ prompt: 'hi', signal: controller.signal, onStreamingChunk,
            onToolInventory: async () => { controller.abort(); },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Request aborted');
        expect(onStreamingChunk).not.toHaveBeenCalled();
    });
});
