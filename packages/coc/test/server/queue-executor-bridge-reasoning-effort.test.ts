/**
 * Queue Executor Bridge — reasoningEffort Wiring Tests
 *
 * Regression tests ensuring that:
 * - executeWithAI() passes task.config.reasoningEffort ?? 'high' to sendMessage
 * - executeFollowUp() always passes 'high' to sendMessage
 * - A custom reasoningEffort in task.config overrides the default
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

import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()),
}));

const mockLoadImages = vi.fn().mockResolvedValue([]);
const mockCleanupTempDir = vi.fn();
vi.mock('@plusplusoneplusplus/coc-server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-server')>();
    return {
        ...actual,
        cleanupTempDir: (...args: any[]) => mockCleanupTempDir(...args),
        ImageBlobStore: {
            loadImages: (...args: any[]) => mockLoadImages(...args),
            saveImages: vi.fn(),
            deleteImages: vi.fn(),
            getBlobsDir: vi.fn(),
        },
    };
});

// ============================================================================
// Helpers
// ============================================================================

function chatTask(reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'): QueuedTask {
    return {
        id: 'task-re-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Hello' },
        config: { timeoutMs: 30000, ...(reasoningEffort ? { reasoningEffort } : {}) },
        displayName: 'Hello',
    };
}

function followUpTask(processId: string): QueuedTask {
    return {
        id: 'fu-task-re-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat', processId, prompt: 'follow up' },
        config: {},
        displayName: 'follow up',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('reasoningEffort wiring in queue executor bridge', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        mockLoadImages.mockReset();
        mockLoadImages.mockResolvedValue([]);
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'ok',
            sessionId: 'sess-1',
        });
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() defaults reasoningEffort to "high" when not set in config', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask(); // no reasoningEffort in config

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('high');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() uses task.config.reasoningEffort when explicitly set', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask('low');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('low');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() passes "xhigh" when explicitly set', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask('xhigh');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('xhigh');
    });

    // -------------------------------------------------------------------------
    it('executeFollowUp() always passes reasoningEffort "high"', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-re-1', 'sess-re-1');
        await store.addProcess(proc);

        const task = followUpTask('proc-re-1');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('high');
    });
});
