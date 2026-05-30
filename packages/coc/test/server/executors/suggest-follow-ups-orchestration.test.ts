/**
 * Suggest Follow-Ups Orchestration Tests (Mock-E2E)
 *
 * Exercises the `suggest_follow_ups` tool as it flows through the chat executor:
 * - Tool injection into `sendMessage` options when enabled/disabled
 * - `onToolEvent` interception → `pendingSuggestions` stored in session
 * - `emitProcessEvent` called with `{ type: 'suggestions', ... }` SSE event
 * - Malformed and empty results handled gracefully
 *
 * Uses the same mock setup as chat-mode-executors.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask, ToolEvent } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { PlanExecutor } from '../../../src/server/executors/plan-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// ============================================================================
// Mocks — same preamble as chat-mode-executors.test.ts
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

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return actual;
});

const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
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
        followUpSuggestions: { enabled: true, count: 3 },
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
// Tool injection tests
// ============================================================================

describe('suggest_follow_ups tool injection', () => {
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

    it('injects suggest_follow_ups tool when enabled', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            followUpSuggestions: { enabled: true, count: 3 },
        }));
        const task = makeChatTask('ask');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.tools).toBeDefined();
        const suggestTool = call.tools.find((t: any) => t.name === 'suggest_follow_ups');
        expect(suggestTool).toBeDefined();
        expect(suggestTool.name).toBe('suggest_follow_ups');
    });

    it('passes undefined tools when disabled and no other tools', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            followUpSuggestions: { enabled: false, count: 3 },
            askUser: { enabled: false },
        }));
        const task = makeChatTask('ask');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.tools).toBeUndefined();
    });

    it('injects tool for PlanExecutor when enabled', async () => {
        const executor = new PlanExecutor(store, makeOptions(store, {
            followUpSuggestions: { enabled: true, count: 3 },
        }));
        const task = makeChatTask('plan');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.tools).toBeDefined();
        const suggestTool = call.tools.find((t: any) => t.name === 'suggest_follow_ups');
        expect(suggestTool).toBeDefined();
    });

    it('injects tool for AutopilotExecutor when enabled', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store, {
            followUpSuggestions: { enabled: true, count: 3 },
        }));
        const task = makeChatTask('autopilot');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.tools).toBeDefined();
        const suggestTool = call.tools.find((t: any) => t.name === 'suggest_follow_ups');
        expect(suggestTool).toBeDefined();
    });
});

// ============================================================================
// onToolEvent interception + pendingSuggestions + SSE emission
// ============================================================================

describe('suggest_follow_ups onToolEvent orchestration', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('populates pendingSuggestions when tool-complete fires with valid suggestions', async () => {
        const suggestions = ['Do A', 'Do B', 'Do C'];
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            // Simulate the AI SDK emitting a tool-complete event for suggest_follow_ups
            const toolEvent: ToolEvent = {
                type: 'tool-complete',
                toolName: 'suggest_follow_ups',
                toolCallId: 'tc-1',
                result: JSON.stringify({ suggestions }),
            };
            opts.onToolEvent(toolEvent);
            return { success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask');

        const result = await executor.execute(task, 'Hello') as any;

        expect(result.pendingSuggestions).toEqual(suggestions);
    });

    it('emits suggestions SSE event via emitProcessEvent', async () => {
        const suggestions = ['Do A', 'Do B', 'Do C'];
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent({
                type: 'tool-complete',
                toolName: 'suggest_follow_ups',
                toolCallId: 'tc-1',
                result: JSON.stringify({ suggestions }),
            });
            return { success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask');

        await executor.execute(task, 'Hello');

        expect(store.emitProcessEvent).toHaveBeenCalledWith(
            `queue_${task.id}`,
            { type: 'suggestions', suggestions, turnIndex: 1 },
        );
    });

    it('returns undefined pendingSuggestions when tool does not fire', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI answer',
            sessionId: 'sess-1',
            toolCalls: [],
        });

        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask');

        const result = await executor.execute(task, 'Hello') as any;

        expect(result.pendingSuggestions).toBeUndefined();
    });

    it('ignores malformed tool result silently (non-JSON)', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent({
                type: 'tool-complete',
                toolName: 'suggest_follow_ups',
                toolCallId: 'tc-bad',
                result: 'this is not JSON',
            });
            return { success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask');

        const result = await executor.execute(task, 'Hello') as any;

        expect(result.pendingSuggestions).toBeUndefined();
    });

    it('ignores empty suggestions array', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent({
                type: 'tool-complete',
                toolName: 'suggest_follow_ups',
                toolCallId: 'tc-empty',
                result: JSON.stringify({ suggestions: [] }),
            });
            return { success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask');

        const result = await executor.execute(task, 'Hello') as any;

        expect(result.pendingSuggestions).toBeUndefined();
        // emitProcessEvent should NOT have been called with a 'suggestions' event
        const suggestionCalls = (store.emitProcessEvent as any).mock.calls.filter(
            (c: any[]) => c[1]?.type === 'suggestions',
        );
        expect(suggestionCalls).toHaveLength(0);
    });

    it('ignores result with non-array suggestions field', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent({
                type: 'tool-complete',
                toolName: 'suggest_follow_ups',
                toolCallId: 'tc-bad-type',
                result: JSON.stringify({ suggestions: 'not an array' }),
            });
            return { success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask');

        const result = await executor.execute(task, 'Hello') as any;

        expect(result.pendingSuggestions).toBeUndefined();
    });

    it('ignores result with undefined result string', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent({
                type: 'tool-complete',
                toolName: 'suggest_follow_ups',
                toolCallId: 'tc-undef',
                result: undefined as any,
            });
            return { success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask');

        const result = await executor.execute(task, 'Hello') as any;

        expect(result.pendingSuggestions).toBeUndefined();
    });
});
