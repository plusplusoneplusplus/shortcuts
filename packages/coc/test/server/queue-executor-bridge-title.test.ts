/**
 * Queue Executor Bridge — Title Generation Tests
 *
 * Tests for the AI-generated title feature in CLITaskExecutor:
 * - Title generated after first task execution via the SDK transform boundary
 * - Title generated after follow-up execution
 * - Idempotency: title not regenerated when already set
 * - Failure resilience: title generation errors don't abort the task
 * - Product policy: gpt-5.4-mini model, truncation/data-minimization, and the
 *   transform's safe isolation defaults (no MCP/tools, denied permissions)
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
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockTransform, mockCreateClient } = sdkMocks;

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
vi.mock('@plusplusoneplusplus/coc-server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-server')>();
    return {
        ...actual,
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

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function mockChatAndTitleResponses(chatResponse = 'AI response text', titleResponse = 'Generated Title'): void {
    mockSendMessage.mockResolvedValue({ success: true, response: chatResponse, sessionId: 'session-123' });
    mockTransform.mockResolvedValue({ success: true, text: titleResponse, effectiveModel: 'gpt-5.4-mini' });
}

/** Calls to the SDK transform boundary (each is `[prompt, options]`). */
function getTitleCalls(): any[][] {
    return mockTransform.mock.calls as any[][];
}

/** The prompt (first arg) passed to the first transform call. */
function getTitlePrompt(): string {
    return getTitleCalls()[0]?.[0] as string;
}

/** The options (second arg) passed to the first transform call. */
function getTitleOptions(): any {
    return getTitleCalls()[0]?.[1];
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
        mockChatAndTitleResponses();
    });

    it('should generate title after first task execution', async () => {
        mockChatAndTitleResponses('AI response text', 'Mock Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-1', 'How do I fix this bug in my authentication module?');
        await executor.execute(task);

        // Allow fire-and-forget to complete
        await delay(50);

        expect(getTitleCalls()).toHaveLength(1);
        const promptArg = getTitlePrompt();
        // Should include user message
        expect(promptArg).toContain('How do I fix this bug');
        // Should include assistant response (mockSendMessage returns 'AI response text')
        expect(promptArg).toContain('AI response text');
        // Should use conversation-style prompt when assistant content is present
        expect(promptArg).toContain('Focus on what was actually done or discussed');

        // Product policy: gpt-5.4-mini via the transform boundary.
        const titleOptions = getTitleOptions();
        expect(titleOptions).toEqual(expect.objectContaining({ model: 'gpt-5.4-mini' }));
        // Data-minimization: the transform must not opt into MCP servers/tools
        // or relax permissions — it relies on the transform's safe defaults.
        expect(titleOptions.loadDefaultMcpConfig).not.toBe(true);
        expect(titleOptions).not.toHaveProperty('onPermissionRequest');
        // The transform boundary is isolated: no reusable client is created.
        expect(mockCreateClient).not.toHaveBeenCalled();

        // Verify title was persisted
        expect(store.updateProcess).toHaveBeenCalledWith(
            'queue_title-1',
            expect.objectContaining({ title: 'Mock Title' }),
        );
    });

    it('should not regenerate title when already set', async () => {
        mockChatAndTitleResponses('AI response text', 'New Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
        const mockQueueManager = {
            updateTask: vi.fn(),
        } as unknown as TaskQueueManager;
        executor.setQueueManager(mockQueueManager);

        const processId = 'queue_title-2';
        store.processes.set(processId, {
            id: processId,
            status: 'completed',
            startedAt: new Date().toISOString(),
            title: 'Existing Title',
            turns: [],
        } as any);

        (executor as any).generateTitleIfNeeded(processId, [
            { role: 'user', content: 'Some prompt', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Some reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ]);

        await delay(50);

        expect(getTitleCalls()).toHaveLength(0);
        expect(store.processes.get(processId)?.title).toBe('Existing Title');
        expect(mockQueueManager.updateTask).toHaveBeenCalledWith(
            'title-2',
            expect.objectContaining({ displayName: 'Existing Title' }),
        );
    });

    it('should not throw when title generation fails', async () => {
        mockSendMessage.mockResolvedValue({ success: true, response: 'AI response text', sessionId: 'session-123' });
        mockTransform.mockResolvedValue({ success: false, text: '', error: 'AI unavailable' });
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

    it('should not persist a title when the provider used a different effective model', async () => {
        mockSendMessage.mockResolvedValue({ success: true, response: 'AI response text', sessionId: 'session-123' });
        // Provider silently fell back to a different model — must not be trusted.
        mockTransform.mockResolvedValue({ success: true, text: 'Wrong Model Title', effectiveModel: 'gpt-4.1' });
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-effmodel', 'Some prompt');
        const result = await executor.execute(task);
        await delay(50);

        expect(result.success).toBe(true);
        expect(store.processes.get('queue_title-effmodel')?.title).toBeUndefined();
    });

    it('should truncate long prompts to 400 characters for title generation', async () => {
        mockChatAndTitleResponses('AI response text', 'Short Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const longPrompt = 'A'.repeat(500);
        const task = makeChatTask('title-4', longPrompt);
        await executor.execute(task);

        await delay(50);

        const promptArg = getTitlePrompt();
        // User content should be truncated to 400 chars
        expect(promptArg).not.toContain('A'.repeat(500));
        expect(promptArg).toContain('A'.repeat(400));
        // Assistant content ('AI response text') is short, so no truncation needed for it
        expect(promptArg).toContain('AI response text');
    });

    it('should truncate long assistant response to 400 characters', async () => {
        const longResponse = 'B'.repeat(500);
        mockChatAndTitleResponses(longResponse, 'Short Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-4b', 'Some prompt');
        await executor.execute(task);

        await delay(50);

        const promptArg = getTitlePrompt();
        // Assistant content should be truncated to 400 chars
        expect(promptArg).not.toContain('B'.repeat(500));
        expect(promptArg).toContain('B'.repeat(400));
    });

    it('should skip title generation when no user content', async () => {
        mockChatAndTitleResponses('AI response', 'Fix Auth Bug');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-5', '');
        // Override displayName as fallback prompt
        task.displayName = '';
        task.payload = { prompt: '' };
        await executor.execute(task);

        await delay(50);

        // title generation should not be called with empty content
        // (the prompt extraction may still produce some text, but if empty, should skip)
        expect(getTitleCalls()).toHaveLength(0);
    });

    it('should parse title with trim and punctuation removal', async () => {
        mockChatAndTitleResponses('AI response text', '  "Fix authentication bug."  ');
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
        mockChatAndTitleResponses('AI response text', 'Fix Auth Bug');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const userMessage = 'How do I fix the authentication bug?';
        const task = makeReadonlyChatTask('title-readonly-1', userMessage);
        await executor.execute(task);

        await delay(50);

        expect(getTitleCalls()).toHaveLength(1);
        const promptArg = getTitlePrompt();
        expect(promptArg).toContain(userMessage);
    });

    it('should propagate generated title to queue task displayName', async () => {
        mockChatAndTitleResponses('AI response text', 'AI Generated Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const mockQueueManager = {
            updateTask: vi.fn(),
        } as unknown as TaskQueueManager;
        executor.setQueueManager(mockQueueManager);

        const task = makeChatTask('title-qm-1', 'Explain how the auth module works');
        await executor.execute(task);

        await delay(50);

        expect(mockQueueManager.updateTask).toHaveBeenCalledWith(
            'title-qm-1',
            expect.objectContaining({ displayName: 'AI Generated Title' }),
        );
    });

    it('should not call updateTask when queueManager is not set', async () => {
        mockChatAndTitleResponses('AI response text', 'Some Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
        // No setQueueManager call

        const task = makeChatTask('title-noqm-1', 'A prompt without queue manager');
        // Should not throw even though queueManager is undefined
        await expect(executor.execute(task)).resolves.toBeTruthy();
        await delay(50);

        // Title is still persisted to the process store
        expect(store.updateProcess).toHaveBeenCalledWith(
            'queue_title-noqm-1',
            expect.objectContaining({ title: 'Some Title' }),
        );
    });

    it('should generate outcome-based title for delegation prompts', async () => {
        // Simulate a delegation-style prompt where the user just says "Follow plan X"
        // and the assistant describes what was actually done
        mockChatAndTitleResponses(
            'I moved the flat/tree toggle from the inline git tab to repo-level preferences and updated the settings UI.',
            'Move files view toggle to preferences',
        );
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        const task = makeChatTask('title-delegation-1', 'Follow the instruction C:\\Users\\User\\.copilot\\plan.md');
        await executor.execute(task);

        await delay(50);

        const promptArg = getTitlePrompt();
        // Should include both user delegation and assistant outcome
        expect(promptArg).toContain('Follow the instruction');
        expect(promptArg).toContain('moved the flat/tree toggle');
        // Should instruct AI to focus on outcome, not the instruction
        expect(promptArg).toContain('Focus on what was actually done or discussed');
    });

    it('should skip title generation when no assistant response', async () => {
        // The title generator requires at least one assistant response before
        // generating a title. When only user turns are present it returns early.
        mockChatAndTitleResponses('AI response text', 'Fix Auth Bug');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        // Create a process first so the store has it
        const processId = 'queue_title-fallback-1';
        store.processes.set(processId, {
            id: processId,
            status: 'completed',
            startedAt: new Date().toISOString(),
            turns: [],
        } as any);

        // Call generateTitleIfNeeded directly with only user turns (no assistant)
        (executor as any).generateTitleIfNeeded(processId, [
            { role: 'user', content: 'Fix the authentication bug', timestamp: new Date(), turnIndex: 0, timeline: [] },
        ]);

        await delay(50);

        // Should NOT call title generation — an assistant response is required
        expect(getTitleCalls()).toHaveLength(0);
    });

    it('should re-sync persisted AI title to displayName on follow-up turns', async () => {
        // Simulate the scenario where requeueForFollowUp overwrites displayName
        // with the follow-up message text. generateTitleIfNeeded must restore the
        // AI-generated title each turn.
        mockChatAndTitleResponses('AI response text', 'AI Generated Title');

        const mockQueueManager = {
            updateTask: vi.fn(),
        } as unknown as TaskQueueManager;

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
        executor.setQueueManager(mockQueueManager);

        // First turn: AI title gets generated and synced
        const task = makeChatTask('title-resync-1', 'Original first message');
        await executor.execute(task);
        await delay(50);

        // Confirm title was set on the process
        const processId = 'queue_title-resync-1';
        expect(store.processes.get(processId)?.title).toBe('AI Generated Title');

        // Simulate requeueForFollowUp overwriting displayName with follow-up text
        (mockQueueManager.updateTask as ReturnType<typeof vi.fn>).mockClear();
        const followUpText = 'A follow-up question that should NOT become the title';
        store.processes.set(processId, {
            ...store.processes.get(processId)!,
            // title stays set from first turn
        });

        // Simulate a second turn: generateTitleIfNeeded is called again after follow-up
        // It should detect existing title and re-sync it to displayName
        (executor as any).generateTitleIfNeeded(processId, [
            { role: 'user', content: 'Original first message', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Some reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
            { role: 'user', content: followUpText, timestamp: new Date(), turnIndex: 2, timeline: [] },
        ]);
        await delay(50);

        // title generation must NOT be called again (title already exists)
        expect(getTitleCalls()).toHaveLength(1);

        // displayName must be restored to the AI-generated title, not the follow-up text
        expect(mockQueueManager.updateTask).toHaveBeenCalledWith(
            'title-resync-1',
            expect.objectContaining({ displayName: 'AI Generated Title' }),
        );
    });

    it('should run an isolated transform per process without reusing a client', async () => {
        mockChatAndTitleResponses('AI response text', 'Isolated Transform Title');
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });

        for (const processId of ['queue_title-warm-1', 'queue_title-warm-2']) {
            store.processes.set(processId, {
                id: processId,
                status: 'completed',
                startedAt: new Date().toISOString(),
                turns: [],
            } as any);
            (executor as any).generateTitleIfNeeded(processId, [
                { role: 'user', content: `Prompt for ${processId}`, timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'Assistant reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ]);
            await delay(50);
        }

        // One transform per process; the transform boundary owns isolation, so no
        // reusable client is ever created.
        expect(getTitleCalls()).toHaveLength(2);
        expect(mockCreateClient).not.toHaveBeenCalled();
        expect(getTitleCalls().every(([, options]) => options?.model === 'gpt-5.4-mini')).toBe(true);
    });

    it('should generate a title even when createClient is unavailable', async () => {
        mockChatAndTitleResponses('AI response text', 'No Client Title');
        const serviceWithoutCreateClient = { ...sdkMocks.service, createClient: undefined };
        const executor = new CLITaskExecutor(store, { aiService: serviceWithoutCreateClient as any });
        const processId = 'queue_title-no-client';
        store.processes.set(processId, {
            id: processId,
            status: 'completed',
            startedAt: new Date().toISOString(),
            turns: [],
        } as any);

        (executor as any).generateTitleIfNeeded(processId, [
            { role: 'user', content: 'Prompt without warm client', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Assistant reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ]);
        await delay(50);

        // The transform boundary needs no client handle, so title generation works.
        expect(getTitleCalls()).toHaveLength(1);
        expect(getTitleOptions()).not.toHaveProperty('client');
        expect(store.processes.get(processId)?.title).toBe('No Client Title');
    });

    it('should suppress duplicate in-flight title generation for the same process', async () => {
        let resolveTitle!: (value: any) => void;
        const titleResponse = new Promise(resolve => { resolveTitle = resolve; });
        mockSendMessage.mockResolvedValue({ success: true, response: 'AI response text', sessionId: 'session-123' });
        mockTransform.mockImplementation(() => titleResponse);
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
        const processId = 'queue_title-dedupe';
        store.processes.set(processId, {
            id: processId,
            status: 'completed',
            startedAt: new Date().toISOString(),
            turns: [],
        } as any);
        const turns = [
            { role: 'user', content: 'Explain transform isolation', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Transforms run a single isolated request', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ];

        (executor as any).generateTitleIfNeeded(processId, turns);
        (executor as any).generateTitleIfNeeded(processId, turns);
        await delay(10);

        expect(getTitleCalls()).toHaveLength(1);

        resolveTitle({ success: true, text: 'Transform Isolation', effectiveModel: 'gpt-5.4-mini' });
        await delay(50);

        expect(store.processes.get(processId)?.title).toBe('Transform Isolation');
        expect(getTitleCalls()).toHaveLength(1);
    });
});
