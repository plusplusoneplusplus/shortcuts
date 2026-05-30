/**
 * Memory V2 cross-path parity tests.
 *
 * These invariant tests verify:
 * 1. Every active chat executor path (ask, plan, ralph, follow-up) calls
 *    buildChatTurnContext WITHOUT includeMemoryV2: false (defaults to true).
 * 2. AutopilotExecutor explicitly passes includeMemoryV2: false.
 * 3. When buildChatTurnContext returns a context with Memory V2 tools and
 *    excludedTools, each opted-in executor forwards those values to
 *    aiService.sendMessage.
 * 4. AutopilotExecutor never forwards memory tools or excludedTools.
 * 5. When the context has no Memory V2 (empty addon), no memory tools or
 *    excludedTools appear in sendMessage for any executor.
 *
 * By mocking buildChatTurnContext at the module boundary these tests guarantee
 * that the contract cannot be silently broken by future executor refactoring.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { PlanExecutor } from '../../../src/server/executors/plan-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import { RalphExecutor } from '../../../src/server/executors/ralph-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
            mkdir: vi.fn().mockResolvedValue(undefined),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../../src/server/streaming/sse-handler', () => ({
    emitMessageSteering: vi.fn(),
}));

vi.mock('../../../src/server/executors/note-chat-executor', () => ({
    readNoteContent: vi.fn().mockResolvedValue(undefined),
    appendNoteEditSnapshot: vi.fn().mockResolvedValue(undefined),
    SNAPSHOT_SIZE_LIMIT: 200_000,
}));

// ============================================================================
// Mock buildChatTurnContext — the common builder under test
// ============================================================================

const mockBuildChatTurnContext = vi.fn();

vi.mock('../../../src/server/executors/chat-turn-context-builder', () => ({
    buildChatTurnContext: (...args: any[]) => mockBuildChatTurnContext(...args),
}));

// ============================================================================
// Stub context factories
// ============================================================================

const MEMORY_V2_TOOLS = [{ name: 'save_memory' }, { name: 'recall_memory' }];
const MEMORY_V2_EXCLUDED_BUILTINS = ['vote_memory', 'store_memory'];

function makeAskUserHandles() {
    return {
        answerQuestion: vi.fn(() => false),
        skipQuestion: vi.fn(() => false),
        cancelAll: vi.fn(),
        hasPending: vi.fn(() => false),
        answerQuestions: vi.fn(),
    };
}

/** Context returned when Memory V2 is active (includeMemoryV2 not false). */
function makeActiveMemoryContext() {
    return {
        tools: [...MEMORY_V2_TOOLS, { name: 'search_conversations' }],
        toolGuidance: 'memory + search guidance',
        memoryV2: {
            systemMessageSuffix: '<memory_snapshot>High priority: prefer TypeScript</memory_snapshot>',
            excludedBuiltinTools: MEMORY_V2_EXCLUDED_BUILTINS,
            tools: MEMORY_V2_TOOLS,
            suffix: '\n\nYou have a persistent `memory` tool.',
            dispose: vi.fn(),
        },
        excludedTools: MEMORY_V2_EXCLUDED_BUILTINS,
        askUser: makeAskUserHandles(),
        dispose: vi.fn(),
    };
}

/** Context returned when Memory V2 is disabled or opted out. */
function makeEmptyMemoryContext() {
    return {
        tools: [{ name: 'search_conversations' }],
        toolGuidance: 'search guidance',
        memoryV2: {
            systemMessageSuffix: undefined,
            excludedBuiltinTools: [],
            tools: [],
            suffix: '',
            dispose: vi.fn(),
        },
        excludedTools: [],
        askUser: makeAskUserHandles(),
        dispose: vi.fn(),
    };
}

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
        payload: { kind: 'chat', mode, prompt: 'Hello', workspaceId: 'ws-parity-test' },
        config: {},
        displayName: 'Hello',
    };
}

function makeRalphTask(id = 'ralph-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: 'ralph',
            prompt: 'Implement the next subtask',
            workspaceId: 'ws-parity-ralph',
            context: {
                ralph: {
                    originalGoal: 'Build something',
                    currentIteration: 1,
                    maxIterations: 10,
                    sessionId: 'sess-ralph',
                },
            },
        },
        config: {},
        displayName: 'Ralph task',
    };
}

function makeProcess(id = 'proc-1', wsId = 'ws-parity-test'): AIProcess {
    return {
        id,
        type: 'chat',
        status: 'completed',
        startTime: new Date(),
        promptPreview: 'initial prompt',
        metadata: { type: 'chat', workspaceId: wsId },
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi there', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Memory V2 buildChatTurnContext call contract', () => {
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
        mockBuildChatTurnContext.mockReset().mockResolvedValue(makeActiveMemoryContext());
    });

    it('ChatExecutor calls buildChatTurnContext without includeMemoryV2: false', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('ask', 'ask-contract'), 'Hello');

        expect(mockBuildChatTurnContext).toHaveBeenCalledOnce();
        const args = mockBuildChatTurnContext.mock.calls[0][0];
        expect(args.includeMemoryV2).not.toBe(false);
    });

    it('PlanExecutor calls buildChatTurnContext without includeMemoryV2: false', async () => {
        const executor = new PlanExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('plan', 'plan-contract'), 'Hello');

        expect(mockBuildChatTurnContext).toHaveBeenCalledOnce();
        const args = mockBuildChatTurnContext.mock.calls[0][0];
        expect(args.includeMemoryV2).not.toBe(false);
    });

    it('RalphExecutor calls buildChatTurnContext without includeMemoryV2: false', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        await executor.execute(makeRalphTask('ralph-contract'), 'Implement');

        expect(mockBuildChatTurnContext).toHaveBeenCalledOnce();
        const args = mockBuildChatTurnContext.mock.calls[0][0];
        expect(args.includeMemoryV2).not.toBe(false);
    });

    it('FollowUpExecutor calls buildChatTurnContext without includeMemoryV2: false', async () => {
        const proc = makeProcess('proc-fu-contract');
        await store.addProcess(proc);
        const executor = new FollowUpExecutor(store, makeOptions(store) as any);
        await executor.executeFollowUp('proc-fu-contract', 'follow-up');

        expect(mockBuildChatTurnContext).toHaveBeenCalledOnce();
        const args = mockBuildChatTurnContext.mock.calls[0][0];
        expect(args.includeMemoryV2).not.toBe(false);
    });

    it('AutopilotExecutor explicitly passes includeMemoryV2: false', async () => {
        // Autopilot operates in full-access mode and opts out of Memory V2
        mockBuildChatTurnContext.mockResolvedValue(makeEmptyMemoryContext());
        const executor = new AutopilotExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('autopilot', 'auto-contract'), 'Hello');

        expect(mockBuildChatTurnContext).toHaveBeenCalledOnce();
        const args = mockBuildChatTurnContext.mock.calls[0][0];
        expect(args.includeMemoryV2).toBe(false);
    });
});

// ============================================================================
// Tool parity: opted-in executors get save_memory/recall_memory + excludedTools
// ============================================================================

describe('Memory V2 tool parity across executor paths', () => {
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
        // All opted-in paths receive active Memory V2 context
        mockBuildChatTurnContext.mockReset().mockResolvedValue(makeActiveMemoryContext());
    });

    it('ChatExecutor (ask): sendMessage receives save_memory, recall_memory, and excludedTools', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('ask', 'ask-parity'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('save_memory');
        expect(toolNames).toContain('recall_memory');
        expect(call.excludedTools).toEqual(MEMORY_V2_EXCLUDED_BUILTINS);
    });

    it('PlanExecutor: sendMessage receives save_memory, recall_memory, and excludedTools', async () => {
        const executor = new PlanExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('plan', 'plan-parity'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('save_memory');
        expect(toolNames).toContain('recall_memory');
        expect(call.excludedTools).toEqual(MEMORY_V2_EXCLUDED_BUILTINS);
    });

    it('RalphExecutor: sendMessage receives save_memory, recall_memory, and excludedTools', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        await executor.execute(makeRalphTask('ralph-parity'), 'Implement');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('save_memory');
        expect(toolNames).toContain('recall_memory');
        expect(call.excludedTools).toEqual(MEMORY_V2_EXCLUDED_BUILTINS);
    });

    it('FollowUpExecutor: sendMessage receives save_memory, recall_memory, and excludedTools', async () => {
        const proc = makeProcess('proc-fu-parity');
        await store.addProcess(proc);
        const executor = new FollowUpExecutor(store, makeOptions(store) as any);
        await executor.executeFollowUp('proc-fu-parity', 'follow-up question');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('save_memory');
        expect(toolNames).toContain('recall_memory');
        expect(call.excludedTools).toEqual(MEMORY_V2_EXCLUDED_BUILTINS);
    });

    it('AutopilotExecutor: sendMessage receives NO memory tools and NO excludedTools', async () => {
        // Autopilot opts out — the mocked context has no memory tools/excludedTools
        mockBuildChatTurnContext.mockResolvedValue(makeEmptyMemoryContext());
        const executor = new AutopilotExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('autopilot', 'auto-parity'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).not.toContain('save_memory');
        expect(toolNames).not.toContain('recall_memory');
        // AutopilotExecutor does not pass excludedTools back from buildModeOptions
        expect(call.excludedTools).toBeUndefined();
    });
});

// ============================================================================
// Memory V2 disabled — empty context produces no memory artifacts
// ============================================================================

describe('Memory V2 disabled — no memory tools for any executor', () => {
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
        // All executors receive an empty Memory V2 context
        mockBuildChatTurnContext.mockReset().mockResolvedValue(makeEmptyMemoryContext());
    });

    it('ChatExecutor: no memory tools and no excludedTools when context is empty', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('ask', 'ask-empty'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).not.toContain('save_memory');
        expect(toolNames).not.toContain('recall_memory');
        expect(call.excludedTools).toBeUndefined();
    });

    it('PlanExecutor: no memory tools and no excludedTools when context is empty', async () => {
        const executor = new PlanExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('plan', 'plan-empty'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).not.toContain('save_memory');
        expect(toolNames).not.toContain('recall_memory');
        expect(call.excludedTools).toBeUndefined();
    });

    it('RalphExecutor: no memory tools and no excludedTools when context is empty', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        await executor.execute(makeRalphTask('ralph-empty'), 'Implement');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).not.toContain('save_memory');
        expect(toolNames).not.toContain('recall_memory');
        expect(call.excludedTools).toBeUndefined();
    });

    it('FollowUpExecutor: no memory tools and no excludedTools when context is empty', async () => {
        const proc = makeProcess('proc-fu-empty');
        await store.addProcess(proc);
        const executor = new FollowUpExecutor(store, makeOptions(store) as any);
        await executor.executeFollowUp('proc-fu-empty', 'follow-up');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).not.toContain('save_memory');
        expect(toolNames).not.toContain('recall_memory');
        expect(call.excludedTools).toBeUndefined();
    });
});
