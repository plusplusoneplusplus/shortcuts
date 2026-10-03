/**
 * Integration test for the send_to_conversation post-mode delivery binding.
 *
 * Proves the tool is functional end-to-end against the *real* follow-up delivery
 * machinery that `POST /api/processes/:id/message` uses:
 * `createSendToConversationTool` wired to a `sendMessage` callback that resolves
 * the target process and runs `ProcessMessageDeliveryService.deliver` against a
 * real ProcessStore. Calling the handler with `{ processId, content }` posts the
 * message into that existing conversation and returns the appended user-turn
 * index.
 *
 * Uses the production `createSendMessageCapability` binding that
 * `registerAllRoutes` publishes.
 */

import { describe, it, expect, vi } from 'vitest';

import { createMockProcessStore } from '../../helpers/mock-process-store';
import { createSendToConversationTool } from '../../../src/server/llm-tools/send-to-conversation-tool';
import { createSendMessageCapability } from '../../../src/server/processes/send-message-capability';

const WS_ID = 'ws-post';

/** A minimal queue bridge exposing only what `deliver()` touches. */
function makeBridge(overrides: Record<string, unknown> = {}) {
    return {
        enqueue: vi.fn(async () => 'task-1'),
        findTaskByProcessId: vi.fn(() => undefined),
        steerProcess: vi.fn(async () => true),
        ...overrides,
    };
}

function setup(bridgeOverrides: Record<string, unknown> = {}) {
    const store = createMockProcessStore();
    const bridge = makeBridge(bridgeOverrides);
    const sendMessage = createSendMessageCapability(store as any, bridge as any);
    // enqueueChat is required by the tool factory but must never run in post mode.
    const enqueueChat = vi.fn(async () => {
        throw new Error('enqueueChat must not be called in post mode');
    });
    const { tool } = createSendToConversationTool({
        store: store as any,
        workspaceId: WS_ID,
        enqueueChat,
        sendMessage,
    });
    return { store, bridge, tool, enqueueChat };
}

describe('send_to_conversation post-mode delivery binding (real ProcessMessageDeliveryService path)', () => {
    it('posts content into an existing conversation and returns the appended turnIndex', async () => {
        const { store, bridge, tool, enqueueChat } = setup();
        // Terminal status → deliver enqueues a fresh turn (turnIndex 0).
        await store.addProcess({
            id: 'queue_target',
            status: 'completed',
            metadata: { type: 'chat', workspaceId: WS_ID },
            conversationTurns: [],
        } as any);

        const result = await tool.handler({ processId: 'queue_target', content: 'follow up please' }) as any;

        expect(result.error).toBeUndefined();
        expect(result.processId).toBe('queue_target');
        expect(result.openLink).toBe('#/process/queue_target');
        expect(result.turnIndex).toBe(0);

        // The message was delivered through the real enqueue path...
        expect(bridge.enqueue).toHaveBeenCalledTimes(1);
        expect(enqueueChat).not.toHaveBeenCalled();
        // ...and the user turn is persisted in the conversation.
        const proc = await store.getProcess('queue_target') as any;
        expect(proc.conversationTurns).toHaveLength(1);
        expect(proc.conversationTurns[0].role).toBe('user');
        expect(proc.conversationTurns[0].content).toMatch(/follow up please$/);
    });

    it('resolves a queue_-prefixed processId stored under its bare task id', async () => {
        const { store, tool } = setup();
        await store.addProcess({
            id: 'bare-uuid',
            status: 'completed',
            metadata: { type: 'chat', workspaceId: WS_ID },
            conversationTurns: [],
        } as any);

        const result = await tool.handler({ processId: 'queue_bare-uuid', content: 'hi' }) as any;

        expect(result.error).toBeUndefined();
        expect(result.turnIndex).toBe(0);
    });

    it('applies post-mode effortTier using the existing conversation provider without changing provider metadata', async () => {
        const { store, bridge, tool } = setup();
        await store.addProcess({
            id: 'queue_target',
            status: 'completed',
            metadata: { type: 'chat', workspaceId: WS_ID, provider: 'claude' },
            conversationTurns: [],
        } as any);

        const result = await tool.handler({
            processId: 'queue_target',
            content: 'follow up with tier',
            provider: 'codex',
            effortTier: 'medium',
        }) as any;

        expect(result.error).toBeUndefined();
        expect(bridge.enqueue).toHaveBeenCalledTimes(1);
        const enqueued = (bridge.enqueue as any).mock.calls[0][0];
        expect(enqueued.payload.provider).toBeUndefined();
        expect(enqueued.payload.model).toBe('opus');
        expect(enqueued.payload.reasoningEffort).toBe('medium');
        expect(enqueued.config.reasoningEffort).toBe('medium');
        const proc = await store.getProcess('queue_target') as any;
        expect(proc.metadata.provider).toBe('claude');
    });

    it("maps deliveryMode 'steer' onto immediate delivery (steers a running process)", async () => {
        const bridge = {
            enqueue: vi.fn(async () => 'task-x'),
            findTaskByProcessId: vi.fn(() => ({ status: 'running' })),
            steerProcess: vi.fn(async () => true),
        };
        const store = createMockProcessStore();
        const sendMessage = createSendMessageCapability(store as any, bridge as any);
        const { tool } = createSendToConversationTool({
            store: store as any,
            workspaceId: WS_ID,
            enqueueChat: vi.fn(async () => 'unused') as any,
            sendMessage,
        });
        await store.addProcess({
            id: 'queue_run',
            status: 'running',
            metadata: { type: 'chat', workspaceId: WS_ID },
            conversationTurns: [],
        } as any);

        const result = await tool.handler({ processId: 'queue_run', content: 'steer me', deliveryMode: 'steer' }) as any;

        expect(result.error).toBeUndefined();
        expect(result.turnIndex).toBe(0);
        // Steered, not enqueued.
        expect(bridge.steerProcess).toHaveBeenCalledWith('queue_run', 'steer me');
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('returns an error when the target conversation does not exist', async () => {
        const { tool } = setup();

        const result = await tool.handler({ processId: 'missing', content: 'x' }) as any;

        expect(result.processId).toBeUndefined();
        expect(result.error).toMatch(/not found/i);
    });

    describe('mode', () => {
        async function addChat(store: any, mode: string) {
            await store.addProcess({
                id: 'queue_target',
                status: 'completed',
                metadata: { type: 'chat', workspaceId: WS_ID, mode },
                conversationTurns: [],
            } as any);
        }

        it('keeps the conversation mode when mode is omitted (regression: autopilot was switched to ask)', async () => {
            const { store, bridge, tool } = setup();
            await addChat(store, 'autopilot');

            const result = await tool.handler({ processId: 'queue_target', content: 'keep going' }) as any;

            expect(result.error).toBeUndefined();
            expect((bridge.enqueue as any).mock.calls[0][0].payload.mode).toBe('autopilot');
            const proc = await store.getProcess('queue_target') as any;
            expect(proc.conversationTurns[0].mode).toBe('autopilot');
            expect(proc.conversationTurns[0].content).toBe('keep going');
        });

        it('buffers an omitted mode as the conversation mode while the chat is running', async () => {
            const { store, tool } = setup();
            await store.addProcess({
                id: 'queue_target',
                status: 'running',
                metadata: { type: 'chat', workspaceId: WS_ID, mode: 'autopilot' },
                conversationTurns: [],
            } as any);

            const result = await tool.handler({ processId: 'queue_target', content: 'next' }) as any;

            expect(result.error).toBeUndefined();
            const proc = await store.getProcess('queue_target') as any;
            expect(proc.pendingMessages[0].mode).toBe('autopilot');
        });

        it('switches the conversation mode when mode is explicit', async () => {
            const { store, bridge, tool } = setup();
            await addChat(store, 'autopilot');

            const result = await tool.handler({ processId: 'queue_target', content: 'just look', mode: 'ask' }) as any;

            expect(result.error).toBeUndefined();
            expect((bridge.enqueue as any).mock.calls[0][0].payload.mode).toBe('ask');
        });

        it('keeps a sentinel conversation in sentinel even when ask is requested', async () => {
            const { store, bridge, tool } = setup();
            await addChat(store, 'sentinel');

            const result = await tool.handler({ processId: 'queue_target', content: 'hi', mode: 'ask' }) as any;

            expect(result.error).toBeUndefined();
            expect((bridge.enqueue as any).mock.calls[0][0].payload.mode).toBe('sentinel');
        });
    });
});
