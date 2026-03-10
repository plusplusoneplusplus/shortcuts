/**
 * Queue Executor Bridge — Ask Mode System Message Tests
 *
 * Tests for read-only system message injection in ask mode:
 * - Initial chat in ask mode includes READ_ONLY_SYSTEM_MESSAGE
 * - Initial chat in autopilot/plan mode does NOT include read-only message
 * - Follow-up with mode change ask → autopilot creates fresh session via sendMessage
 * - Follow-up with mode change autopilot → ask creates fresh session with read-only message
 * - Follow-up with same ask mode creates fresh session (no special handling needed)
 * - Transitions between autopilot ↔ plan do NOT need special handling
 * - Multiple transitions: ask → autopilot → ask
 * - Process metadata is updated with current and previous mode
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
import { READ_ONLY_SYSTEM_MESSAGE } from '@plusplusoneplusplus/pipeline-core';
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

function chatTask(mode: 'ask' | 'plan' | 'autopilot', prompt = 'Hello'): QueuedTask {
    return {
        id: 'task-' + Math.random().toString(36).substring(7),
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode,
            prompt,
        },
        config: {},
        displayName: prompt,
    };
}

function followUpTask(processId: string, prompt: string, mode?: 'ask' | 'plan' | 'autopilot'): QueuedTask {
    return {
        id: 'fu-' + Math.random().toString(36).substring(7),
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            processId,
            prompt,
            mode: mode ?? 'ask',
        },
        config: {},
        displayName: prompt,
    };
}

function createProcessWithMode(id: string, sessionId: string, mode: string) {
    return createProcessFixture({
        id,
        status: 'completed',
        sdkSessionId: sessionId,
        metadata: { type: 'chat', mode },
        conversationTurns: [
            { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    });
}

// ============================================================================
// Tests — Initial Chat Session
// ============================================================================

describe('ask mode system message — initial chat', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'sess-1',
        });
    });

    it('should include read-only systemMessage when chat starts in ask mode', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask('ask');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.systemMessage).toEqual({
            mode: 'append',
            content: READ_ONLY_SYSTEM_MESSAGE,
        });
    });

    it('should NOT include read-only systemMessage when chat starts in autopilot mode', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask('autopilot');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.systemMessage).toBeUndefined();
    });

    it('should NOT include read-only systemMessage when chat starts in plan mode', async () => {
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = chatTask('plan');

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.systemMessage).toBeUndefined();
    });
});

// ============================================================================
// Tests — Follow-Up Mode Transitions
// ============================================================================

describe('ask mode system message — follow-up transitions', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Follow-up response',
            sessionId: 'sess-1',
        });
    });

    it('should create fresh session via sendMessage when transitioning from ask → autopilot', async () => {
        const proc = createProcessWithMode('proc-1', 'sess-1', 'ask');
        await store.addProcess(proc);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = followUpTask('proc-1', 'do something', 'autopilot');

        await executor.execute(task);

        // Follow-up creates a fresh session via sendMessage — no session destroy needed
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.mode).toBe('autopilot');
        // Should NOT include read-only system message for autopilot mode
        if (callArgs.systemMessage) {
            expect(callArgs.systemMessage.content).not.toContain(READ_ONLY_SYSTEM_MESSAGE);
        }
    });

    it('should create fresh session with read-only message when transitioning from autopilot → ask', async () => {
        const proc = createProcessWithMode('proc-1', 'sess-1', 'autopilot');
        await store.addProcess(proc);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = followUpTask('proc-1', 'what is this?', 'ask');

        await executor.execute(task);

        // Follow-up creates a fresh session via sendMessage — no session destroy needed
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        const callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.mode).toBe('interactive');
        // Should include read-only system message for ask mode
        expect(callArgs.systemMessage).toBeDefined();
        expect(callArgs.systemMessage.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
    });

    it('should NOT destroy session when follow-up stays in ask mode', async () => {
        const proc = createProcessWithMode('proc-1', 'sess-1', 'ask');
        await store.addProcess(proc);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = followUpTask('proc-1', 'another question', 'ask');

        await executor.execute(task);

        // No session re-creation needed when mode doesn't change
    });

    it('should NOT destroy session for autopilot → plan transition', async () => {
        const proc = createProcessWithMode('proc-1', 'sess-1', 'autopilot');
        await store.addProcess(proc);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = followUpTask('proc-1', 'create a plan', 'plan');

        await executor.execute(task);

        // No session re-creation for non-ask transitions
    });

    it('should NOT destroy session for plan → autopilot transition', async () => {
        const proc = createProcessWithMode('proc-1', 'sess-1', 'plan');
        await store.addProcess(proc);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = followUpTask('proc-1', 'execute plan', 'autopilot');

        await executor.execute(task);
    });

    it('should update process metadata with current and previous mode', async () => {
        const proc = createProcessWithMode('proc-1', 'sess-1', 'ask');
        await store.addProcess(proc);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const task = followUpTask('proc-1', 'implement it', 'autopilot');

        await executor.execute(task);

        // Check that metadata was updated
        const updated = await store.getProcess('proc-1');
        expect(updated?.metadata?.mode).toBe('autopilot');
        expect(updated?.metadata?.previousMode).toBe('ask');
    });

    it('should handle multiple transitions: ask → autopilot → ask', async () => {
        // Start with ask mode
        const proc = createProcessWithMode('proc-1', 'sess-1', 'ask');
        await store.addProcess(proc);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });

        // ask → autopilot: fresh session, no read-only message
        const task1 = followUpTask('proc-1', 'implement', 'autopilot');
        await executor.execute(task1);
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        let callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.mode).toBe('autopilot');

        sdkMocks.mockSendMessage.mockClear();
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true, response: 'ok', sessionId: 'sess-2',
        });

        // autopilot → ask: fresh session, read-only message injected
        const task2 = followUpTask('proc-1', 'explain', 'ask');
        await executor.execute(task2);
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        callArgs = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(callArgs.mode).toBe('interactive');
        expect(callArgs.systemMessage).toBeDefined();
        expect(callArgs.systemMessage.content).toContain(READ_ONLY_SYSTEM_MESSAGE);

        // No session destroy needed — each follow-up creates a fresh session

        // Verify final metadata
        const final = await store.getProcess('proc-1');
        expect(final?.metadata?.mode).toBe('ask');
        expect(final?.metadata?.previousMode).toBe('autopilot');
    });
});

// ============================================================================
// Tests — READ_ONLY_SYSTEM_MESSAGE constant
// ============================================================================

describe('READ_ONLY_SYSTEM_MESSAGE constant', () => {
    it('should contain the COC read-only marker', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('<!-- COC_READ_ONLY_MODE -->');
    });

    it('should mention read-only mode', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('read-only mode');
    });

    it('should mention prohibited tool names', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('edit_file');
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('create_file');
    });

    it('should allow plan file exception', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('plan file');
    });
});
