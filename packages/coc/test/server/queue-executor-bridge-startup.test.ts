import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, type CreateTaskInput, type QueuedTask } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor, createQueueExecutorBridge } from '../../src/server/queue/queue-executor-bridge';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';

function makeChatTask(prompt = 'Run queued task'): CreateTaskInput {
    return {
        type: 'chat',
        priority: 'normal',
        payload: {
            kind: 'chat',
            mode: 'ask',
            prompt,
        },
        config: { timeoutMs: 1_000 },
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('Timed out waiting for condition');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

describe('createQueueExecutorBridge startup contract', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('wires the queue executor before default auto-start begins pre-populated queue work', async () => {
        const queueManager = new TaskQueueManager();
        queueManager.enqueue(makeChatTask());
        const store = createMockProcessStore();
        const sdk = createMockSDKService();
        const observedWiring: boolean[] = [];
        const executeSpy = vi.spyOn(CLITaskExecutor.prototype, 'execute').mockImplementation(function (_task: QueuedTask) {
            observedWiring.push(Boolean((this as unknown as { queueExecutor?: unknown }).queueExecutor));
            return Promise.resolve({ success: true, durationMs: 0 });
        });

        const { executor } = createQueueExecutorBridge(queueManager, store, { aiService: sdk.service as any });

        try {
            await waitFor(() => observedWiring.length === 1);
            expect(executor.isRunning()).toBe(true);
            expect(observedWiring).toEqual([true]);
            expect(executeSpy).toHaveBeenCalledTimes(1);
        } finally {
            executor.dispose();
        }
    });

    it('preserves manual startup when autoStart is false', async () => {
        const queueManager = new TaskQueueManager();
        queueManager.enqueue(makeChatTask());
        const store = createMockProcessStore();
        const sdk = createMockSDKService();
        const executeSpy = vi.spyOn(CLITaskExecutor.prototype, 'execute').mockResolvedValue({ success: true, durationMs: 0 });

        const { executor } = createQueueExecutorBridge(queueManager, store, {
            aiService: sdk.service as any,
            autoStart: false,
        });

        try {
            expect(executor.isRunning()).toBe(false);
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(executeSpy).not.toHaveBeenCalled();
        } finally {
            executor.dispose();
        }
    });
});
