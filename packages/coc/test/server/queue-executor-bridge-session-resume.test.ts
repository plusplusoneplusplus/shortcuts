/**
 * Queue Executor Bridge — Session Resume in Follow-Up Tests
 *
 * Tests for the session resume behavior in executeFollowUp():
 * - Passes process.sdkSessionId to aiService.sendMessage() for session resumption
 * - Skips conversation history injection when sdkSessionId is present
 * - Injects conversation history when sdkSessionId is absent (legacy/fallback)
 * - onSessionCreated callback still fires to persist the new session ID
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
import { createMockProcessStore, createCompletedProcessWithSession, createProcessFixture } from '../helpers/mock-process-store';

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

vi.mock('../../src/server/image-blob-store', () => ({
    ImageBlobStore: {
        loadImages: vi.fn().mockResolvedValue([]),
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

function followUpTask(overrides: { processId: string; content: string } & Partial<QueuedTask>): QueuedTask {
    return {
        id: overrides.id ?? 'fu-resume-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            processId: overrides.processId,
            prompt: overrides.content,
        },
        config: {},
        displayName: overrides.displayName ?? overrides.content,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('executeFollowUp() — session resume behavior', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    });

    // 1 -----------------------------------------------------------------------
    it('should pass sdkSessionId to sendMessage when process has one', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-1', 'sess-abc');
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-1', content: 'next message' });
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.sessionId).toBe('sess-abc');
    });

    // 2 -----------------------------------------------------------------------
    it('should NOT pass sessionId when process has no sdkSessionId', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createProcessFixture({
            id: 'proc-no-sess',
            status: 'completed',
            // No sdkSessionId
            conversationTurns: [
                { role: 'user', content: 'hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'hi', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        });
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-no-sess', content: 'follow up' });
        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.sessionId).toBeUndefined();
    });

    // 3 -----------------------------------------------------------------------
    it('should skip conversation history injection when resuming a session', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-resume', 'sess-resume', [
            { role: 'user', content: 'first question', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'first answer with lots of detail', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ]);
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-resume', content: 'second question' });
        await executor.execute(task);

        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        // When resuming, systemMessage should NOT contain conversation_history
        const systemContent = callArgs.systemMessage?.content ?? '';
        expect(systemContent).not.toContain('<conversation_history>');
        expect(systemContent).not.toContain('first question');
        expect(systemContent).not.toContain('first answer');
    });

    // 4 -----------------------------------------------------------------------
    it('should inject conversation history when no sdkSessionId (legacy path)', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createProcessFixture({
            id: 'proc-legacy',
            status: 'completed',
            // No sdkSessionId — legacy process
            conversationTurns: [
                { role: 'user', content: 'original question', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'original answer', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        });
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-legacy', content: 'follow up' });
        await executor.execute(task);

        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        const systemContent = callArgs.systemMessage?.content ?? '';
        expect(systemContent).toContain('<conversation_history>');
        expect(systemContent).toContain('original question');
        expect(systemContent).toContain('original answer');
    });

    // 5 -----------------------------------------------------------------------
    it('should still invoke onSessionCreated callback to persist new session ID', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-cb', 'sess-old');
        await store.addProcess(proc);

        // Make sendMessage invoke onSessionCreated with a new session ID
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onSessionCreated?.('sess-new');
            return { success: true, response: 'ok', sessionId: 'sess-new' };
        });

        const task = followUpTask({ processId: 'proc-cb', content: 'message' });
        await executor.execute(task);

        // The onSessionCreated callback should have called store.updateProcess
        expect(store.updateProcess).toHaveBeenCalledWith(
            'proc-cb',
            expect.objectContaining({ sdkSessionId: 'sess-new' }),
        );
    });

    // 6 -----------------------------------------------------------------------
    it('should pass the prompt correctly regardless of session resume', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-prompt', 'sess-prompt');
        await store.addProcess(proc);

        const task = followUpTask({ processId: 'proc-prompt', content: 'specific question' });
        await executor.execute(task);

        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.prompt).toContain('specific question');
    });
});
