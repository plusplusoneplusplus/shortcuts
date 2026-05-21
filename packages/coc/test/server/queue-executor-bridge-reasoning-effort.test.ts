/**
 * Queue Executor Bridge — reasoningEffort Wiring Tests
 *
 * Regression tests ensuring that:
 * - executeWithAI() resolves reasoningEffort from live model metadata
 * - executeFollowUp() resolves reasoningEffort from process/task model metadata
 * - A custom reasoningEffort in task.config overrides the default
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

import type { ModelInfo, QueuedTask } from '@plusplusoneplusplus/forge';
import { modelMetadataStore } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
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
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
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

function modelInfo(
    id: string,
    options: {
        rawEfforts?: string[];
        supportedEfforts?: string[];
        defaultEffort?: string;
        supportsReasoning?: boolean;
        family?: string;
    },
): ModelInfo {
    const supportsReasoning = options.supportsReasoning
        ?? (options.supportedEfforts !== undefined || options.rawEfforts !== undefined);

    return {
        id,
        name: id,
        capabilities: {
            ...(options.family ? { family: options.family } : {}),
            supports: {
                vision: false,
                reasoningEffort: supportsReasoning,
                ...(options.rawEfforts ? { reasoning_effort: options.rawEfforts } : {}),
            },
            limits: { max_context_window_tokens: 200_000 },
        },
        ...(options.supportedEfforts ? { supportedReasoningEfforts: options.supportedEfforts } : {}),
        ...(options.defaultEffort ? { defaultReasoningEffort: options.defaultEffort } : {}),
    };
}

function chatTask(reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh', model?: string): QueuedTask {
    return {
        id: 'task-re-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Hello' },
        config: { timeoutMs: 30000, ...(reasoningEffort ? { reasoningEffort } : {}), ...(model ? { model } : {}) },
        displayName: 'Hello',
    };
}

function followUpTask(processId: string, model?: string): QueuedTask {
    return {
        id: 'fu-task-re-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat', processId, prompt: 'follow up', ...(model ? { model } : {}) },
        config: {},
        displayName: 'follow up',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('reasoningEffort wiring in queue executor bridge', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let getModelSpy: ReturnType<typeof vi.spyOn>;
    let isInitializedSpy: ReturnType<typeof vi.spyOn>;
    let initializeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        getModelSpy = vi.spyOn(modelMetadataStore, 'getModel').mockReturnValue(undefined);
        isInitializedSpy = vi.spyOn(modelMetadataStore, 'isInitialized').mockReturnValue(true);
        initializeSpy = vi.spyOn(modelMetadataStore, 'initialize').mockResolvedValue(undefined);
        mockLoadImages.mockReset();
        mockLoadImages.mockResolvedValue([]);
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'ok',
            sessionId: 'sess-1',
        });
    });

    afterEach(() => {
        getModelSpy.mockRestore();
        isInitializedSpy.mockRestore();
        initializeSpy.mockRestore();
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() omits reasoningEffort when no model metadata is available', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask();

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() uses task.config.reasoningEffort when explicitly set', async () => {
        getModelSpy.mockImplementation((id: string) =>
            id === 'low-model'
                ? modelInfo(id, { supportedEfforts: ['low', 'medium', 'high'] })
                : undefined,
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask('low', 'low-model');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('low');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() passes "xhigh" when explicitly set', async () => {
        getModelSpy.mockImplementation((id: string) =>
            id === 'xhigh-model'
                ? modelInfo(id, { supportedEfforts: ['xhigh'] })
                : undefined,
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask('xhigh', 'xhigh-model');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('xhigh');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() sends the only supported effort from model metadata', async () => {
        getModelSpy.mockImplementation((id: string) =>
            id === 'claude-opus-4.7-high'
                ? modelInfo(id, {
                    family: 'claude-opus-4.7',
                    rawEfforts: ['high'],
                    supportedEfforts: ['medium'],
                    defaultEffort: 'medium',
                })
                : undefined,
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask(undefined, 'claude-opus-4.7-high');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('claude-opus-4.7');
        expect(call.reasoningEffort).toBe('high');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() initializes model metadata before resolving reasoning effort', async () => {
        let warmed = false;
        isInitializedSpy.mockReturnValue(false);
        initializeSpy.mockImplementation(async () => {
            warmed = true;
        });
        getModelSpy.mockImplementation((id: string) =>
            warmed && id === 'claude-opus-4.7-high'
                ? modelInfo(id, {
                    family: 'claude-opus-4.7',
                    rawEfforts: ['high'],
                    supportedEfforts: ['medium'],
                    defaultEffort: 'medium',
                })
                : undefined,
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask(undefined, 'claude-opus-4.7-high');

        await executor.execute(task);

        expect(initializeSpy).toHaveBeenCalledWith(sdkMocks.service);
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('claude-opus-4.7');
        expect(call.reasoningEffort).toBe('high');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() sends medium for a medium-only model instead of blindly defaulting to high', async () => {
        getModelSpy.mockImplementation((id: string) =>
            id === 'medium-only'
                ? modelInfo(id, { supportedEfforts: ['medium'] })
                : undefined,
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask(undefined, 'medium-only');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('medium');
    });

    // -------------------------------------------------------------------------
    it('executeFollowUp() omits reasoningEffort when no model metadata is available', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-re-1', 'sess-re-1');
        await store.addProcess(proc);

        const task = followUpTask('proc-re-1');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    it('executeFollowUp() resolves reasoningEffort from process model metadata', async () => {
        getModelSpy.mockImplementation((id: string) =>
            id === 'claude-opus-4.7-high'
                ? modelInfo(id, {
                    family: 'claude-opus-4.7',
                    rawEfforts: ['high'],
                    supportedEfforts: ['medium'],
                    defaultEffort: 'medium',
                })
                : undefined,
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-re-1', 'sess-re-1');
        proc.metadata = { type: 'chat', model: 'claude-opus-4.7-high' };
        await store.addProcess(proc);

        const task = followUpTask('proc-re-1');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('claude-opus-4.7');
        expect(call.reasoningEffort).toBe('high');
    });
});
