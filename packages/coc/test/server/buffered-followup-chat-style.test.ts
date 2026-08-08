/**
 * Buffered Follow-Up Chat Style Tests
 *
 * A follow-up that changes Style is buffered rather than steered, so the style
 * the user picked has to survive the round trip through `pendingMessages` and
 * reach the drained follow-up task. `PendingMessage.chatStyle` is a
 * product-neutral string on the forge side, so the drain path re-validates it.
 */

import { describe, it, expect, vi } from 'vitest';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

// Mock SDK service so CLITaskExecutor construction doesn't probe the real one.
const sdkMocks = createMockSDKService();
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

function makeProcessWithPending(chatStyle: unknown): AIProcess {
    return {
        id: 'proc-style',
        type: 'clarification',
        promptPreview: 'first',
        fullPrompt: 'first',
        status: 'running',
        startTime: new Date(),
        sdkSessionId: 'sess-style',
        metadata: { chatStyle: 'direct' },
        conversationTurns: [
            { role: 'user', content: 'first', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'response', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
        pendingMessages: [
            {
                id: 'pending-1',
                content: 'now summarize it',
                displayContent: 'now summarize it',
                ...(chatStyle === undefined ? {} : { chatStyle: chatStyle as string }),
                createdAt: new Date().toISOString(),
            },
        ],
    } as AIProcess;
}

async function drain(chatStyle: unknown): Promise<{ payload: any; pendingAfter: number }> {
    const store = createMockProcessStore();
    const queueManager = new TaskQueueManager();
    const executor = new CLITaskExecutor(store);
    executor.setQueueManager(queueManager);

    await store.addProcess(makeProcessWithPending(chatStyle));
    await (executor as any).drainPendingMessages('proc-style', 'task-original');

    const queued = queueManager.getQueued() as QueuedTask[];
    expect(queued).toHaveLength(1);
    const after = await store.getProcess('proc-style');
    return { payload: queued[0].payload as any, pendingAfter: after?.pendingMessages?.length ?? 0 };
}

describe('drainPendingMessages – buffered chat style', () => {
    it.each(['human', 'direct', 'analytical', 'structured'])(
        'carries the buffered style %s onto the drained follow-up payload',
        async (style) => {
            const { payload, pendingAfter } = await drain(style);
            expect(payload.kind).toBe('chat');
            expect(payload.processId).toBe('proc-style');
            expect(payload.chatStyle).toBe(style);
            // Removed only after a successful enqueue, so a queue failure cannot
            // lose the style-changing message.
            expect(pendingAfter).toBe(0);
        },
    );

    it('omits chatStyle when the buffered message carried none (legacy path)', async () => {
        const { payload } = await drain(undefined);
        expect(payload.chatStyle).toBeUndefined();
    });

    it.each([['nonsense'], ['Human'], [42], [null]])(
        'drops the invalid buffered value %j rather than passing it through',
        async (style) => {
            const { payload } = await drain(style);
            expect(payload.chatStyle).toBeUndefined();
        },
    );
});
