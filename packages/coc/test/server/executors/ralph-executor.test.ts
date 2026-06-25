/**
 * Ralph Executor Tests
 *
 * Tests for RalphExecutor — verifies the zero-system-prompt-injection design:
 * - system message contains NO Ralph-specific content (AC-01, AC-02)
 * - execution user prompt contains the skill pointer, progress/context paths,
 *   iteration counter, and <goal> block
 * - final-check user prompt is the buildFinalCheckPrompt output (AC-02)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { RalphExecutor } from '../../../src/server/executors/ralph-executor';
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

function makeRalphTask(ralphCtx?: {
    originalGoal?: string;
    currentIteration?: number;
    maxIterations?: number;
    sessionId?: string;
    finalCheck?: {
        kind: 'goal-gap-check';
        checkIndex: number;
        sourceIteration: number;
        loopIndex: number;
    };
}, id = 'ralph-task-1'): QueuedTask {
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
            workspaceId: 'ws-id',
            context: ralphCtx ? { ralph: ralphCtx as any } : undefined,
        },
        config: {},
        displayName: 'Ralph task',
    };
}

// ============================================================================
// System-message cleanliness (AC-01 + AC-02)
// ============================================================================

describe('RalphExecutor system message — execution (AC-01)', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'RALPH_NEXT',
            sessionId: 'sess-ralph',
            toolCalls: [],
        });
    });

    it('system message contains NO Ralph-specific strings', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({ originalGoal: 'Build a REST API', sessionId: 'sess-1' });

        await executor.execute(task, 'Run next iteration');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const sys = call.systemMessage?.content ?? '';
        expect(sys).not.toContain('RALPH_NEXT');
        expect(sys).not.toContain('RALPH_COMPLETE');
        expect(sys).not.toContain('## Goal Spec');
        expect(sys).not.toContain('## Progress Journal');
        expect(sys).not.toContain('Iteration 1 of');
        expect(sys).not.toContain('ultra-ralph');
    });

    it('user prompt contains the ultra-ralph skill pointer', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({ originalGoal: 'Build a REST API' });

        await executor.execute(task, 'Run next iteration');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('ultra-ralph');
        expect(call.prompt).toContain('execution');
    });

    it('user prompt contains <goal> block with the original goal', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({ originalGoal: 'Build a REST API' });

        await executor.execute(task, 'Run next iteration');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('<goal>');
        expect(call.prompt).toContain('Build a REST API');
        expect(call.prompt).toContain('</goal>');
    });

    it('user prompt contains iteration counter and session paths when sessionId and workspaceId are set', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({
            originalGoal: 'Add auth',
            sessionId: 'sess-xyz',
            currentIteration: 2,
            maxIterations: 10,
        });

        await executor.execute(task, 'Continue');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('Iteration 2 of 10.');
        expect(call.prompt).toContain('sess-xyz');
        expect(call.prompt).toContain('progress.md');
        expect(call.prompt).toContain('Context map:');
        expect(call.prompt).toContain('context.md');
        expect(call.prompt).toContain('read this first');
        expect(call.prompt).toContain('rewrite it at the end');
    });
});

describe('RalphExecutor system message — final-check (AC-02)', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'RALPH_FINAL_CHECK_RESULT\n```json\n{"marker":"RALPH_FINAL_CHECK_RESULT","hasGaps":false,"summary":"ok","gaps":[]}\n```',
            sessionId: 'sess-final',
            toolCalls: [],
        });
    });

    it('final-check system message contains NO Ralph-specific strings', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({
            originalGoal: 'Validate completed work',
            sessionId: 'sess-final-check',
            currentIteration: 3,
            maxIterations: 3,
            finalCheck: {
                kind: 'goal-gap-check',
                checkIndex: 1,
                sourceIteration: 3,
                loopIndex: 1,
            },
        });

        await executor.execute(task, 'Run final check');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const sys = call.systemMessage?.content ?? '';
        expect(sys).not.toContain('RALPH_FINAL_CHECK_RESULT');
        expect(sys).not.toContain('## Goal Spec');
        expect(sys).not.toContain('## Progress Journal');
        expect(sys).not.toContain('ultra-ralph');
        expect(sys).not.toContain('RALPH_NEXT');
        expect(sys).not.toContain('RALPH_COMPLETE');
    });

    it('still uses agentMode=autopilot for final-check', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({
            originalGoal: 'Validate completed work',
            finalCheck: { kind: 'goal-gap-check', checkIndex: 1, sourceIteration: 3, loopIndex: 1 },
        });

        await executor.execute(task, 'Run final check');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.mode).toBe('autopilot');
    });

    it('does not add a context map path to final-check prompts', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({
            originalGoal: 'Validate completed work',
            sessionId: 'sess-final-check',
            finalCheck: { kind: 'goal-gap-check', checkIndex: 1, sourceIteration: 3, loopIndex: 1 },
        });

        await executor.execute(task, 'Run final check');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toBe('Run final check');
        expect(call.prompt).not.toContain('Context map:');
        expect(call.prompt).not.toContain('context.md');
    });
});

// ============================================================================
// RalphExecutor integration tests
// ============================================================================

describe('RalphExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'RALPH_PROGRESS:\nDone some work\n\nRALPH_NEXT',
            sessionId: 'sess-ralph',
            toolCalls: [],
        });
    });

    it('uses agentMode=autopilot', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask();

        await executor.execute(task, 'Run next iteration');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.mode).toBe('autopilot');
    });

    it('returns AI response and sessionId', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask();

        const result = await executor.execute(task, 'Run') as any;

        expect(result.response).toContain('RALPH_NEXT');
        expect(result.sessionId).toBe('sess-ralph');
    });

    it('works without ralph context (plain prompt mode)', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask(undefined);

        await executor.execute(task, 'Just do it');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.mode).toBe('autopilot');
        // system message should be generic (no Ralph content)
        expect(call.systemMessage?.content ?? '').not.toContain('## Goal Spec');
        // user prompt should have skill pointer but no goal block
        expect(call.prompt).toContain('ultra-ralph');
        expect(call.prompt).not.toContain('<goal>');
    });
});
