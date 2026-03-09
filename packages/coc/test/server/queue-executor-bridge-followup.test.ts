/**
 * Queue Executor Bridge — Follow-Up Reuse Tests
 *
 * Tests for the execute() short-circuit introduced for chat-followup tasks:
 * - Bypasses store.addProcess() for chat-followup tasks
 * - Reuses the original process entry (no ghost process)
 * - Delegates to executeFollowUp() with correct arguments
 * - Success and failure return shapes
 * - imageTempDir cleanup on both success and failure (finally block)
 * - Cancellation guard: reverts original process to 'completed'
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

import type { QueuedTask } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()),
}));

const mockLoadImages = vi.fn().mockResolvedValue([]);
vi.mock('../../src/server/image-blob-store', () => ({
    ImageBlobStore: {
        loadImages: (...args: any[]) => mockLoadImages(...args),
        saveImages: vi.fn(),
        deleteImages: vi.fn(),
        getBlobsDir: vi.fn(),
    },
}));

const mockCleanupTempDir = vi.fn();
vi.mock('@plusplusoneplusplus/coc-server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-server')>();
    return {
        ...actual,
        cleanupTempDir: (...args: any[]) => mockCleanupTempDir(...args),
    };
});

// ============================================================================
// Helpers
// ============================================================================

function followUpTask(overrides: { processId: string; content: string } & Partial<QueuedTask> & { attachments?: any; imageTempDir?: string }): QueuedTask {
    return {
        id: overrides.id ?? 'fu-task-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            processId: overrides.processId,
            prompt: overrides.content,
            attachments: overrides.attachments,
            imageTempDir: overrides.imageTempDir,
        },
        config: {},
        displayName: overrides.displayName ?? overrides.content,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('execute() short-circuit for chat-followup tasks', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        mockCleanupTempDir.mockReset();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'Follow-up response',
            sessionId: 'sess-fu',
        });
    });

    // 1 -----------------------------------------------------------------------
    it('should NOT call store.addProcess for chat-followup tasks', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-1', content: 'follow up' });

        // Clear the seeding call so we can assert no subsequent calls
        (store.addProcess as ReturnType<typeof vi.fn>).mockClear();

        await executor.execute(task);

        expect(store.addProcess).not.toHaveBeenCalled();
    });

    // 2 -----------------------------------------------------------------------
    it('should call executeFollowUp with correct arguments', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const spy = vi.spyOn(CLITaskExecutor.prototype as any, 'executeFollowUp');

        const attachments = [{ type: 'file', path: '/a.ts' }];
        const task = followUpTask({ processId: 'proc-1', content: 'follow up', attachments });

        await executor.execute(task);

        expect(spy).toHaveBeenCalledWith('proc-1', 'follow up', attachments, undefined);

        spy.mockRestore();
    });

    // 3 -----------------------------------------------------------------------
    it('should return success result on follow-up completion', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-1', content: 'follow up' });

        const result = await executor.execute(task);

        expect(result.success).toBe(true);
        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    // 4 -----------------------------------------------------------------------
    it('should return failure result on follow-up error', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const spy = vi.spyOn(CLITaskExecutor.prototype as any, 'executeFollowUp');
        spy.mockRejectedValue(new Error('boom'));

        const task = followUpTask({ processId: 'proc-1', content: 'follow up' });

        const result = await executor.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toContain('boom');
        expect(typeof result.durationMs).toBe('number');

        spy.mockRestore();
    });

    // 5 -----------------------------------------------------------------------
    it('should clean up imageTempDir on follow-up completion', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-1', content: 'follow up', imageTempDir: '/tmp/img-123' });

        await executor.execute(task);

        expect(mockCleanupTempDir).toHaveBeenCalledWith('/tmp/img-123');
    });

    // 6 -----------------------------------------------------------------------
    it('should clean up imageTempDir on follow-up failure', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const spy = vi.spyOn(CLITaskExecutor.prototype as any, 'executeFollowUp');
        spy.mockRejectedValue(new Error('boom'));

        const task = followUpTask({ processId: 'proc-1', content: 'follow up', imageTempDir: '/tmp/img-456' });

        await executor.execute(task);

        expect(mockCleanupTempDir).toHaveBeenCalledWith('/tmp/img-456');

        spy.mockRestore();
    });

    // 7 -----------------------------------------------------------------------
    it('should revert original process to completed when follow-up task is cancelled', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        // Simulate api-handler having set the process to 'running' before enqueueing
        await store.addProcess({ ...proc, status: 'running' });

        const task = followUpTask({ processId: 'proc-1', content: 'follow up' });

        executor.cancel(task.id);
        const result = await executor.execute(task);

        expect(store.updateProcess).toHaveBeenCalledWith('proc-1', expect.objectContaining({ status: 'completed' }));
        expect(result.success).toBe(false);
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toBe('Task cancelled');
        expect(result.durationMs).toBe(0);
    });

    // 8 -----------------------------------------------------------------------
    it('should NOT create ghost process entry for follow-up tasks', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const task = followUpTask({ id: 'fu-task-1', processId: 'proc-1', content: 'follow up' });

        // Clear seeding call
        (store.addProcess as ReturnType<typeof vi.fn>).mockClear();

        await executor.execute(task);

        expect(store.addProcess).not.toHaveBeenCalled();
        expect(await store.getProcess('queue_fu-task-1')).toBeUndefined();
        expect(await store.getProcess('proc-1')).toBeDefined();
    });

    // 9 -----------------------------------------------------------------------
    it('should not perform extra queue transitions while executing a requeued follow-up', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        // Wire up a mock queue manager
        const mockQueueManager = {
            reActivate: vi.fn(),
            requeueFromHistory: vi.fn(),
            returnToHistory: vi.fn(),
            markCompleted: vi.fn(),
            updateTask: vi.fn(),
        };
        executor.setQueueManager(mockQueueManager as any);

        const task = followUpTask({
            processId: 'proc-1',
            content: 'follow up',
        });

        await executor.execute(task);

        expect(mockQueueManager.reActivate).not.toHaveBeenCalled();
        expect(mockQueueManager.requeueFromHistory).not.toHaveBeenCalled();
        expect(mockQueueManager.returnToHistory).not.toHaveBeenCalled();
        expect(mockQueueManager.markCompleted).not.toHaveBeenCalled();
    });
});
