/**
 * Queue Executor Bridge — reasoningEffort Wiring Tests
 *
 * Regression tests ensuring that:
 * - executeWithAI() resolves reasoningEffort from live model metadata
 * - executeFollowUp() resolves reasoningEffort from process/task model metadata
 * - A custom reasoningEffort in task.config overrides the default
 * - Provider-scoped Auto resolution: Codex uses cfg.models.providers.codex.reasoningEfforts;
 *   Copilot falls back to the legacy global cfg.models.reasoningEfforts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Config mock — must be hoisted so the factory can close over the fn ref.
// ---------------------------------------------------------------------------
const mockLoadConfigFile = vi.hoisted(() => vi.fn().mockReturnValue(null));

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

vi.mock('../../src/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/config')>();
    return {
        ...actual,
        loadConfigFile: mockLoadConfigFile,
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

function chatTaskWithProvider(provider: string, model: string, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'): QueuedTask {
    return {
        id: 'task-re-provider',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Hello', provider: provider as any, model },
        config: { timeoutMs: 30000, model, ...(reasoningEffort ? { reasoningEffort } : {}) },
        displayName: 'Hello',
    };
}

function followUpTask(processId: string, model?: string, reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'): QueuedTask {
    return {
        id: 'fu-task-re-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            processId,
            prompt: 'follow up',
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
        },
        config: { ...(reasoningEffort ? { reasoningEffort } : {}) },
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
        // Reset config mock to return null (no persisted preferences) by default.
        mockLoadConfigFile.mockReturnValue(null);
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

    // -------------------------------------------------------------------------
    it('executeFollowUp() honours payload.reasoningEffort as a per-turn override', async () => {
        // Active model supports both `low` and `high`; per-turn override must
        // win over the model's default and any persisted preference.
        getModelSpy.mockImplementation((id: string) =>
            id === 'multi-effort-model'
                ? modelInfo(id, { supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium' })
                : undefined,
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-re-2', 'sess-re-2');
        proc.metadata = { type: 'chat', model: 'multi-effort-model' };
        await store.addProcess(proc);

        const task = followUpTask('proc-re-2', 'multi-effort-model', 'low');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('multi-effort-model');
        expect(call.reasoningEffort).toBe('low');
    });

    // -------------------------------------------------------------------------
    it('executeFollowUp() preserves "xhigh" per-turn override end-to-end (AC: queued/buffered/drained follow-ups)', async () => {
        // Verifies that xhigh flows intact through the queue → executor → SDK call.
        // This covers the acceptance criterion "Queued, buffered, and drained
        // follow-ups preserve xhigh".
        getModelSpy.mockImplementation((id: string) =>
            id === 'gpt-5.5'
                ? modelInfo(id, {
                    supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
                    defaultEffort: 'medium',
                })
                : undefined,
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-re-xhigh', 'sess-re-xhigh');
        proc.metadata = { type: 'chat', model: 'gpt-5.5', provider: 'codex' };
        await store.addProcess(proc);

        const task = followUpTask('proc-re-xhigh', 'gpt-5.5', 'xhigh');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('gpt-5.5');
        expect(call.reasoningEffort).toBe('xhigh');
    });

    // =========================================================================
    // Provider-scoped Auto resolution
    // =========================================================================

    it('executeWithAI() uses provider-scoped reasoningEfforts for Codex (Auto path)', async () => {
        // When no per-turn override is present, chat-base-executor must read
        // cfg.models.providers.codex.reasoningEfforts, not the legacy global map.
        getModelSpy.mockImplementation((id: string) =>
            id === 'gpt-5.5'
                ? modelInfo(id, { supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' })
                : undefined,
        );
        mockLoadConfigFile.mockReturnValue({
            models: {
                providers: {
                    codex: { reasoningEfforts: { 'gpt-5.5': 'xhigh' } },
                },
            },
        });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTaskWithProvider('codex', 'gpt-5.5');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('xhigh');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() falls back to legacy global reasoningEfforts for Copilot (Auto path)', async () => {
        // Copilot must still honour the legacy cfg.models.reasoningEfforts map
        // when no provider-scoped map is present.
        getModelSpy.mockImplementation((id: string) =>
            id === 'copilot-model-1'
                ? modelInfo(id, { supportedEfforts: ['low', 'medium', 'high'] })
                : undefined,
        );
        mockLoadConfigFile.mockReturnValue({
            models: {
                reasoningEfforts: { 'copilot-model-1': 'low' }, // legacy global key
            },
        });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTaskWithProvider('copilot', 'copilot-model-1');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('low');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() does NOT use global reasoningEfforts for Codex (isolation)', async () => {
        // The global cfg.models.reasoningEfforts entry for gpt-5.5 must NOT
        // bleed into a Codex task; Auto falls through to the catalog default.
        getModelSpy.mockImplementation((id: string) =>
            id === 'gpt-5.5'
                ? modelInfo(id, { supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' })
                : undefined,
        );
        mockLoadConfigFile.mockReturnValue({
            models: {
                reasoningEfforts: { 'gpt-5.5': 'high' }, // global — must be ignored for Codex
            },
        });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTaskWithProvider('codex', 'gpt-5.5');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        // Should use catalog default 'medium', NOT the global 'high'.
        expect(call.reasoningEffort).toBe('medium');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() resolves Claude effort from the provider catalog when absent from the shared store', async () => {
        // The shared modelMetadataStore is warmed from the default (Copilot)
        // provider, so Claude models (default/opus/haiku) are missing from it.
        // The executor must fall back to the Claude service's own listModels()
        // so a supported effort ("high" for "opus") validates instead of
        // throwing "Unsupported reasoning effort ... Supported efforts: unknown".
        getModelSpy.mockReturnValue(undefined); // shared store has no Claude models
        sdkMocks.mockListModels.mockResolvedValue([
            modelInfo('opus', { supportedEfforts: ['low', 'medium', 'high', 'xhigh'] }),
            modelInfo('haiku', {}),
        ]);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTaskWithProvider('claude', 'opus', 'high');
        await executor.execute(task);

        expect(sdkMocks.mockListModels).toHaveBeenCalled();
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('opus');
        expect(call.reasoningEffort).toBe('high');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() caches the Claude provider catalog across turns', async () => {
        getModelSpy.mockReturnValue(undefined);
        sdkMocks.mockListModels.mockResolvedValue([
            modelInfo('opus', { supportedEfforts: ['low', 'medium', 'high', 'xhigh'] }),
        ]);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        await executor.execute(chatTaskWithProvider('claude', 'opus', 'xhigh'));
        await executor.execute(chatTaskWithProvider('claude', 'opus', 'high'));

        // Two turns, but the provider catalog is fetched only once.
        expect(sdkMocks.mockListModels).toHaveBeenCalledTimes(1);
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(2);
        expect((sdkMocks.mockSendMessage.mock.calls[1][0] as Record<string, unknown>).reasoningEffort).toBe('high');
    });

    // =========================================================================
    // Claude catalog alias bridging
    // =========================================================================

    /** Mirror of the live Claude CLI initialize-response catalog. */
    function claudeCliCatalog(): ModelInfo[] {
        return [
            { id: 'default', name: 'Default (recommended)', description: 'Sonnet 4.6 · Best for everyday tasks', supportedReasoningEfforts: ['low', 'medium', 'high'] },
            { id: 'opus', name: 'Opus', description: 'Opus 4.8 · Most capable for complex work', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
            { id: 'haiku', name: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
        ] as unknown as ModelInfo[];
    }

    // -------------------------------------------------------------------------
    it("executeWithAI() resolves the Claude high-tier default ('opus' + xhigh) against the CLI alias catalog", async () => {
        getModelSpy.mockReturnValue(undefined);
        sdkMocks.mockListModels.mockResolvedValue(claudeCliCatalog());

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        await executor.execute(chatTaskWithProvider('claude', 'opus', 'xhigh'));

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('opus');
        expect(call.reasoningEffort).toBe('xhigh');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() resolves a legacy dashed Claude id via family matching (regression: xhigh → "Supported efforts: unknown")', async () => {
        // Stored configs and old tier defaults carry ids like 'claude-opus-4-7'
        // that the CLI catalog (default/opus/haiku) does not list. Family
        // matching must bridge them so xhigh validates instead of throwing.
        getModelSpy.mockReturnValue(undefined);
        sdkMocks.mockListModels.mockResolvedValue(claudeCliCatalog());

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        await executor.execute(chatTaskWithProvider('claude', 'claude-opus-4-7', 'xhigh'));

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('claude-opus-4-7');
        expect(call.reasoningEffort).toBe('xhigh');
    });

    // -------------------------------------------------------------------------
    it("executeWithAI() resolves the 'sonnet' tier alias via the default entry's description", async () => {
        getModelSpy.mockReturnValue(undefined);
        sdkMocks.mockListModels.mockResolvedValue(claudeCliCatalog());

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        await executor.execute(chatTaskWithProvider('claude', 'sonnet', 'high'));

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBe('sonnet');
        expect(call.reasoningEffort).toBe('high');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() validates an explicit effort against the default catalog entry when no model is set (regression: model "unknown")', async () => {
        // A Claude chat with an effort but no model used to throw
        // 'Unsupported reasoning effort "..." requested for model "unknown".
        // Supported efforts: unknown' because metadata lookup required a model
        // id. The provider-default turn must validate against the catalog's
        // own 'default' entry instead.
        getModelSpy.mockReturnValue(undefined);
        sdkMocks.mockListModels.mockResolvedValue(claudeCliCatalog());

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task: QueuedTask = {
            id: 'task-re-claude-default',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Hello', provider: 'claude' as any },
            config: { timeoutMs: 30000, reasoningEffort: 'high' },
            displayName: 'Hello',
        };
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.model).toBeUndefined();
        expect(call.reasoningEffort).toBe('high');
    });

    // -------------------------------------------------------------------------
    it('executeWithAI() still rejects an effort the resolved Claude catalog entry does not support', async () => {
        // The default entry (Sonnet) advertises low/medium/high — an explicit
        // xhigh on a provider-default turn must fail loud with the resolved
        // supported list rather than "Supported efforts: unknown".
        getModelSpy.mockReturnValue(undefined);
        sdkMocks.mockListModels.mockResolvedValue(claudeCliCatalog());

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task: QueuedTask = {
            id: 'task-re-claude-default-xhigh',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Hello', provider: 'claude' as any },
            config: { timeoutMs: 30000, reasoningEffort: 'xhigh' },
            displayName: 'Hello',
        };
        const result = await executor.execute(task);

        expect(sdkMocks.mockSendMessage).not.toHaveBeenCalled();
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('Unsupported reasoning effort "xhigh"');
        expect(result.error?.message).toContain('low, medium, high');
        expect(result.error?.message).not.toContain('Supported efforts: unknown');
    });

    // -------------------------------------------------------------------------
    it('executeFollowUp() uses provider-scoped reasoningEfforts for Codex session (Auto path)', async () => {
        getModelSpy.mockImplementation((id: string) =>
            id === 'gpt-5.5'
                ? modelInfo(id, { supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' })
                : undefined,
        );
        mockLoadConfigFile.mockReturnValue({
            models: {
                providers: {
                    codex: { reasoningEfforts: { 'gpt-5.5': 'xhigh' } },
                },
            },
        });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-scoped-1', 'sess-scoped-1');
        // Process metadata records provider=codex so follow-up-executor picks the right provider.
        proc.metadata = { type: 'chat', model: 'gpt-5.5', provider: 'codex' };
        await store.addProcess(proc);

        const task = followUpTask('proc-scoped-1');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('xhigh');
    });

    // -------------------------------------------------------------------------
    it('executeFollowUp() falls back to legacy global reasoningEfforts for Copilot session (Auto path)', async () => {
        getModelSpy.mockImplementation((id: string) =>
            id === 'copilot-model-2'
                ? modelInfo(id, { supportedEfforts: ['low', 'medium', 'high'] })
                : undefined,
        );
        mockLoadConfigFile.mockReturnValue({
            models: {
                reasoningEfforts: { 'copilot-model-2': 'low' },
            },
        });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-scoped-2', 'sess-scoped-2');
        proc.metadata = { type: 'chat', model: 'copilot-model-2' }; // no provider → defaults to copilot
        await store.addProcess(proc);

        const task = followUpTask('proc-scoped-2');
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
        expect(call.reasoningEffort).toBe('low');
    });
});
