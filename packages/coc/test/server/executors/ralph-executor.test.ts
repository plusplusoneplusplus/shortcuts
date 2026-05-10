/**
 * Ralph Executor Tests
 *
 * Tests for RalphExecutor and buildRalphSystemMessage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { RalphExecutor, buildRalphSystemMessage } from '../../../src/server/executors/ralph-executor';
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
        toolCallCacheStore: { options: {} } as any,
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        ...overrides,
    };
}

function makeRalphTask(ralphCtx?: {
    originalGoal?: string;
    accumulatedProgress?: string;
    currentIteration?: number;
    maxIterations?: number;
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
        expect(msg).toContain('RALPH_PROGRESS:');
        expect(msg).toContain('RALPH_COMPLETE');
        expect(msg).toContain('RALPH_NEXT');
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

    it('includes accumulated progress when provided', () => {
        const msg = buildRalphSystemMessage({ accumulatedProgress: 'Auth done, routes pending' });
        expect(msg).toContain('## Progress from Previous Iterations');
        expect(msg).toContain('Auth done, routes pending');
    });

    it('omits progress section when accumulatedProgress is absent', () => {
        const msg = buildRalphSystemMessage({});
        expect(msg).not.toContain('## Progress from Previous Iterations');
    });

    it('includes iteration counter with defaults', () => {
        const msg = buildRalphSystemMessage({});
        expect(msg).toContain('Iteration 1 of 10.');
    });

    it('includes custom iteration counter', () => {
        const msg = buildRalphSystemMessage({ currentIteration: 3, maxIterations: 5 });
        expect(msg).toContain('Iteration 3 of 5.');
    });

    it('includes all sections when fully populated', () => {
        const msg = buildRalphSystemMessage({
            originalGoal: 'Build a REST API',
            accumulatedProgress: 'Auth done',
            currentIteration: 2,
            maxIterations: 8,
        });
        expect(msg).toContain('## Goal Spec');
        expect(msg).toContain('Build a REST API');
        expect(msg).toContain('## Progress from Previous Iterations');
        expect(msg).toContain('Auth done');
        expect(msg).toContain('Iteration 2 of 8.');
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

    it('includes accumulated progress in system message', async () => {
        const executor = new RalphExecutor(store, makeOptions(store));
        const task = makeRalphTask({
            originalGoal: 'Add auth',
            accumulatedProgress: 'Routes are done',
            currentIteration: 2,
        });

        await executor.execute(task, 'Continue');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage.content).toContain('Routes are done');
        expect(call.systemMessage.content).toContain('Iteration 2 of 10.');
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
