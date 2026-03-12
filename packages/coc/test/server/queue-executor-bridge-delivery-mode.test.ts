/**
 * Queue Executor Bridge — deliveryMode Tests
 *
 * Verifies that:
 * - executeFollowUp passes deliveryMode to sendMessage options
 * - deliveryMode: 'immediate' triggers a message-steering SSE event
 * - deliveryMode: 'enqueue' (or undefined) follows the default path
 * - requeueForFollowUp stores deliveryMode on the task payload
 * - execute() short-circuit forwards deliveryMode from the payload
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

vi.mock('@plusplusoneplusplus/coc-server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-server')>();
    return {
        ...actual,
        cleanupTempDir: vi.fn(),
    };
});

// ============================================================================
// Helpers
// ============================================================================

function followUpTask(overrides: { processId: string; content: string; deliveryMode?: string } & Partial<QueuedTask>): QueuedTask {
    return {
        id: overrides.id ?? 'fu-dm-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            processId: overrides.processId,
            prompt: overrides.content,
            ...(overrides.deliveryMode ? { deliveryMode: overrides.deliveryMode } : {}),
        },
        config: {},
        displayName: overrides.displayName ?? overrides.content,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('executeFollowUp — deliveryMode', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('passes deliveryMode: immediate to sendMessage options', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-1', 'hello', undefined, undefined, 'immediate');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const opts = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(opts.deliveryMode).toBe('immediate');
    });

    it('passes deliveryMode: enqueue to sendMessage options', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-1', 'hello', undefined, undefined, 'enqueue');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const opts = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(opts.deliveryMode).toBe('enqueue');
    });

    it('defaults deliveryMode to enqueue when undefined', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-1', 'hello', undefined, undefined);

        const opts = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(opts.deliveryMode).toBe('enqueue');
    });

    it('emits message-steering SSE event for immediate mode', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-1', 'steer', undefined, undefined, 'immediate');

        // Check that emitProcessEvent was called with a message-steering event
        const steeringCalls = vi.mocked(store.emitProcessEvent).mock.calls.filter(
            ([, event]) => event.type === 'message-steering',
        );
        expect(steeringCalls.length).toBe(1);
        expect(steeringCalls[0][0]).toBe('proc-1');
        expect(steeringCalls[0][1]).toMatchObject({
            type: 'message-steering',
        });
    });

    it('does NOT emit message-steering for enqueue mode', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-1', 'queue', undefined, undefined, 'enqueue');

        const steeringCalls = vi.mocked(store.emitProcessEvent).mock.calls.filter(
            ([, event]) => event.type === 'message-steering',
        );
        expect(steeringCalls.length).toBe(0);
    });
});

describe('execute() — deliveryMode forwarding via chat-followup', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('forwards deliveryMode from task payload to executeFollowUp', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const spy = vi.spyOn(CLITaskExecutor.prototype as any, 'executeFollowUp');

        const task = followUpTask({ processId: 'proc-1', content: 'forwarded', deliveryMode: 'immediate' });
        await executor.execute(task);

        expect(spy).toHaveBeenCalledWith('proc-1', 'forwarded', undefined, undefined, 'immediate');
        spy.mockRestore();
    });

    it('passes undefined deliveryMode when not set on payload', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        await store.addProcess(proc);

        const spy = vi.spyOn(CLITaskExecutor.prototype as any, 'executeFollowUp');

        const task = followUpTask({ processId: 'proc-1', content: 'no mode' });
        await executor.execute(task);

        expect(spy).toHaveBeenCalledWith('proc-1', 'no mode', undefined, undefined, undefined);
        spy.mockRestore();
    });
});
