/**
 * Ralph Executor Tests
 *
 * Tests for RalphExecutor and Ralph system-message builders.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { RalphExecutor, buildRalphFinalCheckSystemMessage, buildRalphSystemMessage } from '../../../src/server/executors/ralph-executor';
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
// buildRalphSystemMessage unit tests
// ============================================================================

describe('buildRalphSystemMessage', () => {
    it('always includes base Ralph instructions', () => {
        const msg = buildRalphSystemMessage({});
        expect(msg).toContain('Ralph mode');
        expect(msg).toContain('RALPH_COMPLETE');
        expect(msg).toContain('RALPH_NEXT');
    });

    it('instructs the AI to append a strict-grammar section header to the journal', () => {
        const msg = buildRalphSystemMessage({});
        expect(msg).toContain('## Iteration <N>');
        expect(msg).toContain('Files:');
        expect(msg).toContain('Decisions:');
        expect(msg).toContain('Remaining:');
    });

    it('keeps RALPH_PROGRESS: as a documented fallback', () => {
        const msg = buildRalphSystemMessage({});
        expect(msg).toContain('RALPH_PROGRESS:');
    });

    it('includes goal spec when originalGoal is provided', () => {
        const msg = buildRalphSystemMessage({ originalGoal: 'Build a REST API' });
        expect(msg).toContain('## Goal Spec');
        expect(msg).toContain('Build a REST API');
    });

    it('omits goal spec section when originalGoal is absent', () => {
        const msg = buildRalphSystemMessage({});
        expect(msg).not.toContain('## Goal Spec');
    });

    it('references the progress journal by absolute path when provided', () => {
        const msg = buildRalphSystemMessage({ progressPath: '/tmp/ralph-sessions/sess-1/progress.md' });
        expect(msg).toContain('## Progress Journal');
        expect(msg).toContain('/tmp/ralph-sessions/sess-1/progress.md');
        expect(msg).toContain('## Iteration N');
    });

    it('omits the progress journal section when no path is provided', () => {
        const msg = buildRalphSystemMessage({});
        expect(msg).not.toContain('## Progress Journal');
    });

    it('does not inline accumulated progress text into the prompt', () => {
        const msg = buildRalphSystemMessage({ progressPath: '/p/progress.md' });
        // The plan removes inlined history; the prompt only references the file path.
        expect(msg).not.toContain('## Progress from Previous Iterations');
    });

    it('includes iteration counter with defaults', () => {
        const msg = buildRalphSystemMessage({});
        expect(msg).toContain('Iteration 1 of 20.');
    });

    it('includes custom iteration counter', () => {
        const msg = buildRalphSystemMessage({ currentIteration: 3, maxIterations: 5 });
        expect(msg).toContain('Iteration 3 of 5.');
    });

    it('includes all sections when fully populated', () => {
        const msg = buildRalphSystemMessage({
            originalGoal: 'Build a REST API',
            progressPath: '/p/progress.md',
            currentIteration: 2,
            maxIterations: 8,
        });
        expect(msg).toContain('## Goal Spec');
        expect(msg).toContain('Build a REST API');
        expect(msg).toContain('## Progress Journal');
        expect(msg).toContain('/p/progress.md');
        expect(msg).toContain('Iteration 2 of 8.');
    });
});

// ============================================================================
// buildRalphFinalCheckSystemMessage unit tests
// ============================================================================

describe('buildRalphFinalCheckSystemMessage', () => {
    it('keeps final-check autopilot read-only and validation-focused', () => {
        const msg = buildRalphFinalCheckSystemMessage({});

        expect(msg).toContain('read-only validation agent');
        expect(msg).toContain('autopilot execution capabilities');
        expect(msg).toMatch(/must not change repository\s+or CoC state/);
        expect(msg).toContain('Do not edit, create, delete, rename, or format files');
        expect(msg).toContain('Do not commit');
        expect(msg).toContain('RALPH_FINAL_CHECK_RESULT');
    });

    it('does not include normal Ralph implementation-loop instructions', () => {
        const msg = buildRalphFinalCheckSystemMessage({});

        expect(msg).not.toContain('Pick the next logical subtask');
        expect(msg).not.toContain('implement one subtask');
        expect(msg).not.toContain('then commit');
        expect(msg).not.toContain('RALPH_PROGRESS:');
        expect(msg).not.toContain('End the response with exactly one of');
        expect(msg).toContain('Do not end with RALPH_NEXT or RALPH_COMPLETE');
    });

    it('references the goal and progress journal as read-only evidence', () => {
        const msg = buildRalphFinalCheckSystemMessage({
            originalGoal: 'Ship the feature',
            progressPath: 'C:\\tmp\\ralph\\progress.md',
            currentIteration: 4,
            maxIterations: 4,
        });

        expect(msg).toContain('## Goal Spec');
        expect(msg).toContain('Ship the feature');
        expect(msg).toContain('## Progress Journal');
        expect(msg).toContain('C:\\tmp\\ralph\\progress.md');
        expect(msg).toContain('Do not append to or edit it');
        expect(msg).toContain('Final check for Ralph iteration 4 of 4.');
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

    it('includes a system message with Ralph instructions', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({ originalGoal: 'Build a REST API' });

        await executor.execute(task, 'Run next iteration');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage).toBeDefined();
        expect(call.systemMessage.content).toContain('RALPH_PROGRESS:');
        expect(call.systemMessage.content).toContain('Build a REST API');
    });

    it('keeps final-check tasks in autopilot but uses validation-only system instructions', async () => {
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
        expect(call.mode).toBe('autopilot');
        expect(call.systemMessage.content).toContain('read-only validation agent');
        expect(call.systemMessage.content).toContain('RALPH_FINAL_CHECK_RESULT');
        expect(call.systemMessage.content).toContain('Do not edit, create, delete, rename, or format files');
        expect(call.systemMessage.content).not.toContain('Pick the next logical subtask');
        expect(call.systemMessage.content).not.toContain('RALPH_PROGRESS:');
        expect(call.systemMessage.content).toContain('Do not end with RALPH_NEXT or RALPH_COMPLETE');
    });

    it('includes accumulated-progress journal path in system message', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({
            originalGoal: 'Add auth',
            sessionId: 'sess-xyz',
            currentIteration: 2,
        });

        await executor.execute(task, 'Continue');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        // Journal path is referenced (not inlined)
        expect(call.systemMessage.content).toContain('## Progress Journal');
        expect(call.systemMessage.content).toContain('sess-xyz');
        expect(call.systemMessage.content).toContain('progress.md');
        expect(call.systemMessage.content).toContain('Iteration 2 of 20.');
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
        expect(call.systemMessage?.content).toContain('Ralph mode');
        expect(call.systemMessage?.content).not.toContain('## Goal Spec');
    });
});
