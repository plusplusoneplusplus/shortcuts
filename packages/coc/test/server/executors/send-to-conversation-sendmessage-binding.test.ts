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
 * Mirrors the binding built at the route layer in `registerAllRoutes`:
 *   sendMessage = (input) => {
 *     const proc = resolve(input.processId);
 *     return deliveryService.deliver(proc, buildFollowUpInput(input));
 *   }
 */

import { describe, it, expect, vi } from 'vitest';

import { isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';

import { createMockProcessStore } from '../../helpers/mock-process-store';
import { createSendToConversationTool, type SendMessageFn } from '../../../src/server/llm-tools/send-to-conversation-tool';
import { ProcessMessageDeliveryService, type FollowUpMessageInput } from '../../../src/server/processes/process-message-delivery-service';

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

/**
 * Replicates the route-layer `setSendMessage` binding from `registerAllRoutes`
 * so this test exercises the same resolve → build-input → deliver path the
 * production binding runs.
 */
function makeSendMessageBinding(store: any, bridge: any): SendMessageFn {
    return async (input) => {
        let proc = await store.getProcess(input.processId);
        if (!proc && isQueueProcessId(input.processId)) {
            proc = await store.getProcess(toTaskId(input.processId));
        }
        if (!proc) {
            throw new Error(`Process '${input.processId}' not found.`);
        }
        const resolvedDeliveryMode: 'immediate' | 'enqueue' =
            input.deliveryMode === 'immediate' || input.deliveryMode === 'steer' ? 'immediate' : 'enqueue';
        const deliveryInput: FollowUpMessageInput = {
            content: input.content,
            displayContent: input.content,
            deliveryMode: resolvedDeliveryMode,
            pasteExternalized: false,
            ...(input.mode ? { mode: input.mode } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.effort ? { effort: input.effort } : {}),
        };
        const result = await new ProcessMessageDeliveryService({ store, bridge }).deliver(proc, deliveryInput);
        return { turnIndex: result.turnIndex };
    };
}

function setup(bridgeOverrides: Record<string, unknown> = {}) {
    const store = createMockProcessStore();
    const bridge = makeBridge(bridgeOverrides);
    const sendMessage = makeSendMessageBinding(store, bridge);
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
        expect(proc.conversationTurns[0].content).toBe('follow up please');
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
        const sendMessage = makeSendMessageBinding(store, bridge);
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
});
