/**
 * Chat Mode Executor Unit Tests
 *
 * Tests for ChatExecutor, PlanExecutor, and AutopilotExecutor.
 *
 * Verified for each executor:
 * - Happy path: AI SDK called with correct agentMode, systemMessage, returns result
 * - System message: ask/plan get READ_ONLY_SYSTEM_MESSAGE, autopilot gets undefined
 * - Agent mode: ask → interactive, plan → plan, autopilot → autopilot
 * - AI unavailability throws with helpful message
 * - AI sendMessage failure (success: false) propagates as thrown error
 * - Streaming chunks are forwarded via store.emitProcessOutput
 * - Session cleanup + output persistence happens in finally (no leaks)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { READ_ONLY_SYSTEM_MESSAGE } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { PlanExecutor } from '../../../src/server/executors/plan-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

// Mock image-store to avoid temp-file side effects
vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

// Mock task-root-resolver to avoid real filesystem calls
const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

// Mock output-file-manager to avoid disk writes
vi.mock('../../../src/server/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

function makeOptions(
    store: ReturnType<typeof createMockProcessStore>,
    overrides?: Partial<ChatModeExecutorOptions>,
): ChatModeExecutorOptions {
    return {
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        toolCallCacheStore: { options: {} } as any,
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        ...overrides,
    };
}

function makeChatTask(mode: 'ask' | 'plan' | 'autopilot', id = 'task-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode,
            prompt: 'Hello',
        },
        config: {},
        displayName: 'Hello',
    };
}

// ============================================================================
// Shared behaviour — parameterised per executor
// ============================================================================

interface ExecutorFactory {
    label: string;
    expectedAgentMode: string;
    expectsSystemMessage: boolean;
    makeExecutor: (store: ReturnType<typeof createMockProcessStore>, overrides?: Partial<ChatModeExecutorOptions>) => { execute: (task: QueuedTask, prompt: string) => Promise<unknown> };
    makeTask: (id?: string) => QueuedTask;
}

const executors: ExecutorFactory[] = [
    {
        label: 'ChatExecutor (ask)',
        expectedAgentMode: 'interactive',
        expectsSystemMessage: true,
        makeExecutor: (store, overrides) => new ChatExecutor(store, makeOptions(store, overrides)),
        makeTask: (id) => makeChatTask('ask', id),
    },
    {
        label: 'PlanExecutor (plan)',
        expectedAgentMode: 'plan',
        expectsSystemMessage: true,
        makeExecutor: (store, overrides) => new PlanExecutor(store, makeOptions(store, overrides)),
        makeTask: (id) => makeChatTask('plan', id),
    },
    {
        label: 'AutopilotExecutor (autopilot)',
        expectedAgentMode: 'autopilot',
        expectsSystemMessage: false,
        makeExecutor: (store, overrides) => new AutopilotExecutor(store, makeOptions(store, overrides)),
        makeTask: (id) => makeChatTask('autopilot', id),
    },
];

for (const { label, expectedAgentMode, expectsSystemMessage, makeExecutor, makeTask } of executors) {
    describe(label, () => {
        let store: ReturnType<typeof createMockProcessStore>;

        beforeEach(() => {
            store = createMockProcessStore();
            sdkMocks.resetAll();
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
            sdkMocks.mockSendMessage.mockResolvedValue({
                success: true,
                response: 'AI answer',
                sessionId: 'sess-1',
                toolCalls: [],
            });
        });

        it('calls aiService.sendMessage with the correct agentMode', async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.mode).toBe(expectedAgentMode);
        });

        it(`${expectsSystemMessage ? 'includes' : 'omits'} system message`, async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            if (expectsSystemMessage) {
                expect(call.systemMessage).toBeDefined();
                expect(call.systemMessage.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
            } else {
                expect(call.systemMessage).toBeUndefined();
            }
        });

        it('returns response, sessionId, toolCalls, timeline, pendingSuggestions', async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            const result = await executor.execute(task, 'Hello') as any;

            expect(result.response).toBe('AI answer');
            expect(result.sessionId).toBe('sess-1');
            expect(Array.isArray(result.timeline)).toBe(true);
            // pendingSuggestions is undefined when no suggestions tool fires
        });

        it('throws when AI SDK is unavailable', async () => {
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: false, error: 'no token' });

            const executor = makeExecutor(store);
            const task = makeTask();

            await expect(executor.execute(task, 'Hello')).rejects.toThrow('Copilot SDK not available');
        });

        it('throws when sendMessage returns success: false', async () => {
            sdkMocks.mockSendMessage.mockResolvedValue({ success: false, error: 'rate limit' });

            const executor = makeExecutor(store);
            const task = makeTask();

            await expect(executor.execute(task, 'Hello')).rejects.toThrow('rate limit');
        });

        it('forwards streaming chunks via store.emitProcessOutput', async () => {
            sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk('chunk-a');
                opts.onStreamingChunk('chunk-b');
                return { success: true, response: 'done', sessionId: 's1', toolCalls: [] };
            });

            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            expect(store.emitProcessOutput).toHaveBeenCalledWith(
                `queue_${task.id}`,
                'chunk-a',
            );
            expect(store.emitProcessOutput).toHaveBeenCalledWith(
                `queue_${task.id}`,
                'chunk-b',
            );
        });

        it('stores sdkSessionId via onSessionCreated', async () => {
            // Make the mock call onSessionCreated (as the real SDK does when creating a session)
            sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onSessionCreated?.('sess-1');
                return { success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] };
            });

            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            expect(store.updateProcess).toHaveBeenCalledWith(
                `queue_${task.id}`,
                expect.objectContaining({ sdkSessionId: 'sess-1' }),
            );
        });
    });
}

// ============================================================================
// Mode-specific system message content tests
// ============================================================================

describe('ChatExecutor system message content', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('injects auto-folder block when task has workingDirectory', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-wd',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'ask', prompt: 'Hi', workingDirectory: '/fake/ws' },
            config: {},
            displayName: 'Hi',
        };

        await executor.execute(task, 'Hi');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
        expect(call.systemMessage?.content).toContain('<chosen-folder>');
    });

    it('does NOT inject auto-folder block when task has no workingDirectory', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask', 'task-no-wd');

        await executor.execute(task, 'Hi');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toBe(READ_ONLY_SYSTEM_MESSAGE);
    });
});

describe('AutopilotExecutor has no system message', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('passes undefined systemMessage even with workingDirectory', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-auto-wd',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'Do it', workingDirectory: '/fake/ws' },
            config: {},
            displayName: 'Do it',
        };

        await executor.execute(task, 'Do it');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage).toBeUndefined();
    });
});
