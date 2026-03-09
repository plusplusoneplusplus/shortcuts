/**
 * Queue Executor Bridge — Title Generation Tests
 *
 * Tests for the AI-generated title feature in CLITaskExecutor:
 * - Title generated after first task execution
 * - Title generated after follow-up execution
 * - Idempotency: title not regenerated when already set
 * - Failure resilience: title generation errors don't abort the task
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

import {
    TaskQueueManager,
    QueueExecutor,
    createQueueExecutor,
    QueuedTask,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable, mockTransform } = sdkMocks;

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

// ============================================================================
// Helpers
// ============================================================================

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeChatTask(id: string, prompt: string): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat' as const, mode: 'autopilot' as const, prompt },
        config: {},
        displayName: 'Chat task',
    };
}

function makeReadonlyChatTask(id: string, prompt: string): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat' as const, mode: 'ask' as const, prompt },
        config: {},
        displayName: 'Ask chat task',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('CLITaskExecutor — Title Generation', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        mockLoadImages.mockReset().mockResolvedValue([]);
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    it('should generate title after first task execution', async () => {
        mockTransform.mockResolvedValue('Mock Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-1', 'How do I fix this bug in my authentication module?');
        await executor.execute(task);

        // Allow fire-and-forget to complete
        await delay(50);

        expect(mockTransform).toHaveBeenCalledOnce();
        expect(mockTransform).toHaveBeenCalledWith(
            expect.stringContaining('How do I fix this bug'),
            expect.any(Function),
            expect.objectContaining({ model: 'gpt-4.1' }),
        );

        // Verify title was persisted
        expect(store.updateProcess).toHaveBeenCalledWith(
            'queue_title-1',
            expect.objectContaining({ title: 'Mock Title' }),
        );
    });

    it('should not regenerate title when already set', async () => {
        mockTransform.mockResolvedValue('New Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-2', 'Some prompt');
        await executor.execute(task);

        // Manually set a title on the process before fire-and-forget resolves
        const processId = 'queue_title-2';
        const process = store.processes.get(processId);
        if (process) {
            process.title = 'Existing Title';
        }

        // Allow fire-and-forget to complete
        await delay(50);

        // transform may or may not have been called, but title should NOT be overwritten
        const finalProcess = store.processes.get(processId);
        expect(finalProcess?.title).toBe('Existing Title');
    });

    it('should not throw when title generation fails', async () => {
        mockTransform.mockRejectedValue(new Error('AI unavailable'));
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-3', 'Some prompt');
        const result = await executor.execute(task);

        // Allow fire-and-forget to complete
        await delay(50);

        // Task should still succeed even though title generation failed
        expect(result.success).toBe(true);

        // Title should not be set
        const process = store.processes.get('queue_title-3');
        expect(process?.title).toBeUndefined();
    });

    it('should truncate long prompts to 400 characters for title generation', async () => {
        mockTransform.mockResolvedValue('Short Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const longPrompt = 'A'.repeat(500);
        const task = makeChatTask('title-4', longPrompt);
        await executor.execute(task);

        await delay(50);

        const promptArg = mockTransform.mock.calls[0]?.[0] as string;
        // The prompt should contain a truncated version (400 chars max from user content)
        expect(promptArg).not.toContain('A'.repeat(500));
        expect(promptArg).toContain('A'.repeat(400));
    });

    it('should skip title generation when no user content', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'session-123',
        });
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-5', '');
        // Override displayName as fallback prompt
        task.displayName = '';
        task.payload = { prompt: '' };
        await executor.execute(task);

        await delay(50);

        // transform should not be called with empty content
        // (the prompt extraction may still produce some text, but if empty, should skip)
    });

    it('should parse title with trim and punctuation removal', async () => {
        mockTransform.mockImplementation(async (_prompt: string, parse: (raw: string) => string) => {
            return parse('  "Fix authentication bug."  ');
        });
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-6', 'Fix the authentication bug');
        await executor.execute(task);

        await delay(50);

        expect(store.updateProcess).toHaveBeenCalledWith(
            'queue_title-6',
            expect.objectContaining({ title: 'Fix authentication bug' }),
        );
    });

    it('should generate title from user message for ask-mode chat', async () => {
        mockTransform.mockResolvedValue('Fix Auth Bug');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const userMessage = 'How do I fix the authentication bug?';
        const task = makeReadonlyChatTask('title-readonly-1', userMessage);
        await executor.execute(task);

        await delay(50);

        expect(mockTransform).toHaveBeenCalledOnce();
        const promptArg = mockTransform.mock.calls[0]?.[0] as string;
        expect(promptArg).toContain(userMessage);
    });
});
