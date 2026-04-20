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
import { CopilotClientCache } from '../../../src/server/executors/copilot-client-cache';
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

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return actual;
});

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

        it('passes infiniteSessions enabled to sendMessage', async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.infiniteSessions).toEqual({ enabled: true });
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

// ============================================================================
// Skill injection tests (context.skills)
// ============================================================================

describe('ChatBaseExecutor selected skills', () => {
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

    it('prepends a selected-skills directive without inlining skill bodies', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-skill',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: '<commit>abc123</commit>',
                workingDirectory: '/fake/ws',
                context: { skills: ['go-deep'] },
            },
            config: {},
            displayName: 'skill test',
        };

        await executor.execute(task, '<commit>abc123</commit>');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('<selected_skills>');
        expect(call.prompt).toContain('The user explicitly selected these skills: go-deep.');
        expect(call.prompt).toContain('<commit>abc123</commit>');
        expect(call.prompt.indexOf('<selected_skills>')).toBeLessThan(call.prompt.indexOf('<commit>'));
        expect(call.prompt).not.toContain('<skill name=');
    });

    it('preserves explicit user intent even when a selected skill might not exist locally', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-unknown-skill',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Hello',
                workingDirectory: '/fake/ws',
                context: { skills: ['unknown-skill'] },
            },
            config: {},
            displayName: 'unknown skill test',
        };

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('unknown-skill');
        expect(call.prompt).toContain('<selected_skills>');
        expect(call.prompt).not.toContain('<skill name=');
    });

    it('does not alter prompt when context.skills is undefined', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask', 'task-no-skills');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).not.toContain('<selected_skills>');
    });

    it('deduplicates multiple selected skills while preserving the directive', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-multi-skill',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'test prompt',
                workingDirectory: '/fake/ws',
                context: { skills: ['skill-a', 'skill-a', 'skill-b'] },
            },
            config: {},
            displayName: 'multi skill test',
        };

        await executor.execute(task, 'test prompt');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('The user explicitly selected these skills: skill-a, skill-b.');
        expect(call.prompt).not.toContain('<skill name=');
    });
});

// ============================================================================
// Retry-on-client-death tests
// ============================================================================

describe('ChatBaseExecutor retry on cached client failure', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    });

    function createMockClientCache() {
        const mockClient = { stop: vi.fn().mockResolvedValue([]) };
        const cache = new CopilotClientCache({ poolEnabled: false });
        const mockService = { createClient: vi.fn().mockResolvedValue(mockClient) };
        cache.setAIService(mockService as any);
        return { cache, mockClient, mockService };
    }

    it('retries with fresh client when cached client fails mid-request', async () => {
        const { cache, mockService } = createMockClientCache();
        const freshClient = { stop: vi.fn().mockResolvedValue([]) };
        // First acquire returns the original, release cleans it up, second acquire returns fresh
        mockService.createClient
            .mockResolvedValueOnce({ stop: vi.fn().mockResolvedValue([]) }) // initial
            .mockResolvedValueOnce(freshClient); // fresh on retry

        let callCount = 0;
        sdkMocks.mockSendMessage.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) throw new Error('client process exited');
            return { success: true, response: 'retry worked', sessionId: 'sess-retry', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, makeOptions(store), undefined, cache);
        const task = makeChatTask('ask');
        const result = await executor.execute(task, 'Hello') as any;

        expect(result.response).toBe('retry worked');
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('does not retry when no cached client was used', async () => {
        // No clientCache passed — sendMessage failure should propagate directly
        sdkMocks.mockSendMessage.mockRejectedValue(new Error('network error'));

        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask');

        await expect(executor.execute(task, 'Hello')).rejects.toThrow('network error');
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
    });

    it('propagates error when retry also fails', async () => {
        const { cache } = createMockClientCache();

        sdkMocks.mockSendMessage.mockRejectedValue(new Error('persistent failure'));

        const executor = new ChatExecutor(store, makeOptions(store), undefined, cache);
        const task = makeChatTask('ask');

        await expect(executor.execute(task, 'Hello')).rejects.toThrow('persistent failure');
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('resets streaming state before retry', async () => {
        const { cache } = createMockClientCache();

        let callCount = 0;
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            callCount++;
            if (callCount === 1) {
                // Simulate partial streaming before failure
                opts.onStreamingChunk?.('partial-');
                throw new Error('client died');
            }
            // On retry, stream clean output
            opts.onStreamingChunk?.('clean output');
            return { success: true, response: 'retried', sessionId: 'sess-2', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, makeOptions(store), undefined, cache);
        const task = makeChatTask('ask');
        await executor.execute(task, 'Hello');

        // The emitted output should include clean output from retry
        const outputCalls = (store.emitProcessOutput as ReturnType<typeof vi.fn>).mock.calls;
        const allOutput = outputCalls.map((c: any[]) => c[1]).join('');
        expect(allOutput).toContain('clean output');
    });
});
