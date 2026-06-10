/**
 * Queue Executor Bridge – Executor Dispatch Integration Tests
 *
 * Verifies that CLITaskExecutor correctly dispatches each task type to the
 * appropriate specialized executor module and that pre-execution cancellation
 * propagates to all modes without invoking the underlying executor.
 *
 * Tested scenarios:
 * - run-workflow → WorkflowExecutor.execute() is invoked
 * - run-script   → ShellExecutor.execute() is invoked
 * - follow-up    → FollowUpExecutor.executeFollowUp() is invoked
 * - Cancellation before run-workflow does not call WorkflowExecutor
 * - Cancellation before run-script does not call ShellExecutor
 * - Legacy plan-mode chat dispatches to Ask semantics
 * - Cancellation before follow-up reverts process to 'completed'
 */

import * as fs from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';

// ============================================================================
// Hoisted mocks — must be declared before any import of the module under test
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

// WorkflowExecutor mock — records calls for dispatch assertions
const mockWorkflowExecute = vi.fn();
vi.mock('../../src/server/executors/workflow-executor', function () { return ({
    WorkflowExecutor: vi.fn().mockImplementation(function () { return ({
        execute: mockWorkflowExecute,
    }); }),
}); });

// ShellExecutor mock — records calls for dispatch assertions
const mockShellExecute = vi.fn();
vi.mock('../../src/server/executors/shell-executor', function () { return ({
    ShellExecutor: vi.fn().mockImplementation(function () { return ({
        execute: mockShellExecute,
    }); }),
}); });

// FollowUpExecutor mock — records calls for dispatch assertions
const mockFollowUpExecuteFollowUp = vi.fn();
vi.mock('../../src/server/executors/follow-up-executor', function () { return ({
    FollowUpExecutor: vi.fn().mockImplementation(function () { return ({
        executeFollowUp: mockFollowUpExecuteFollowUp,
    }); }),
}); });

// ChatExecutor mock — records calls for dispatch assertions
const mockChatExecute = vi.fn();
vi.mock('../../src/server/executors/chat-executor', function () { return ({
    ChatExecutor: vi.fn().mockImplementation(function () { return ({
        execute: mockChatExecute,
    }); }),
}); });

// DreamTaskExecutor mock — records calls for dispatch assertions
const mockDreamTaskExecute = vi.fn();
vi.mock('../../src/server/executors/dream-task-executor', function () { return ({
    DreamTaskExecutor: vi.fn().mockImplementation(function () { return ({
        execute: mockDreamTaskExecute,
    }); }),
}); });

// AutopilotExecutor mock — records calls for dispatch assertions
const mockAutopilotExecute = vi.fn();
vi.mock('../../src/server/executors/autopilot-executor', function () { return ({
    AutopilotExecutor: vi.fn().mockImplementation(function () { return ({
        execute: mockAutopilotExecute,
    }); }),
}); });

// Forge mock — prevent real getCopilotSDKService and other side-effects
const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
        resolveSkillSync: vi.fn().mockReturnValue(undefined),
        gatherFeatureContext: vi.fn().mockResolvedValue({}),
    };
});

vi.mock('../../src/ai-invoker', function () { return ({
    createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()),
}); });

vi.mock('../../src/server/queue/image-blob-store', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/server/queue/image-blob-store')>();
    return {
        ...actual,
        ImageBlobStore: {
            loadImages: vi.fn().mockResolvedValue([]),
            saveImages: vi.fn(),
            deleteImages: vi.fn(),
            getBlobsDir: vi.fn(),
        },
    };
});

// Import AFTER all vi.mock() declarations
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';

// ============================================================================
// Helpers
// ============================================================================

function makeWorkflowTask(id = 'wf-task-1'): QueuedTask {
    return {
        id,
        type: 'run-workflow',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'run-workflow' as const,
            workflowPath: '/ws/.vscode/workflows/my-pipeline',
            workingDirectory: '/ws',
        },
        config: {},
        displayName: 'Run Workflow',
    };
}

function makeScriptTask(id = 'sh-task-1'): QueuedTask {
    return {
        id,
        type: 'run-script',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'run-script' as const,
            script: 'echo hello',
            workingDirectory: '/ws',
        },
        config: {},
        displayName: 'Run Script',
    };
}

function makeFollowUpTask(processId: string, id = 'fu-task-1', reasoningEffort?: string): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            processId,
            prompt: 'Follow-up question',
            ...(reasoningEffort ? { reasoningEffort } : {}),
        } as any,
        config: reasoningEffort ? { reasoningEffort } : {},
    };
}

function makeChatTask(mode: 'ask' | 'plan' | 'autopilot', id?: string): QueuedTask {
    return {
        id: id ?? `chat-${mode}-1`,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode,
            prompt: 'Hello from ' + mode,
        },
        config: {},
        displayName: 'Hello from ' + mode,
    };
}

function makeDreamTask(id = 'dream-task-1'): QueuedTask {
    return {
        id,
        type: 'dream-run',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'dream-run',
            workspaceId: 'ws-dream',
            trigger: 'manual',
            provider: 'claude',
            timeoutMs: 3_600_000,
        },
        config: { timeoutMs: 3_600_000 },
        displayName: 'Dream Run: Manual',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('CLITaskExecutor executor dispatch', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        mockWorkflowExecute.mockReset();
        mockShellExecute.mockReset();
        mockFollowUpExecuteFollowUp.mockReset();
        mockChatExecute.mockReset();
        mockAutopilotExecute.mockReset();
        mockDreamTaskExecute.mockReset();
    });

    // ========================================================================
    // Dispatch — run-workflow
    // ========================================================================

    describe('run-workflow dispatch', () => {
        it('delegates run-workflow task to WorkflowExecutor.execute()', async () => {
            mockWorkflowExecute.mockResolvedValue({
                response: 'Workflow completed',
                pipelineName: 'my-pipeline',
                stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
            });

            const executor = new CLITaskExecutor(store);
            const task = makeWorkflowTask();

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockWorkflowExecute).toHaveBeenCalledOnce();
            expect(mockWorkflowExecute).toHaveBeenCalledWith(task);
        });

        it('marks process as failed when WorkflowExecutor.execute() throws', async () => {
            mockWorkflowExecute.mockRejectedValue(new Error('Workflow error'));

            const executor = new CLITaskExecutor(store);
            const task = makeWorkflowTask('wf-fail-1');

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Workflow error');
            expect(store.updateProcess).toHaveBeenCalledWith(
                'queue_wf-fail-1',
                expect.objectContaining({ status: 'failed' }),
            );
        });
    });

    // ========================================================================
    // Dispatch — run-script
    // ========================================================================

    describe('run-script dispatch', () => {
        it('delegates run-script task to ShellExecutor.execute()', async () => {
            mockShellExecute.mockResolvedValue({
                success: true,
                response: 'Script output',
                result: { stdout: 'hello', stderr: '', exitCode: 0 },
                durationMs: 10,
                timedOut: false,
            });

            const executor = new CLITaskExecutor(store);
            const task = makeScriptTask();

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockShellExecute).toHaveBeenCalledOnce();
            expect(mockShellExecute).toHaveBeenCalledWith(task);
        });

        it('marks process as failed when ShellExecutor.execute() throws', async () => {
            mockShellExecute.mockRejectedValue(new Error('Script spawn failed'));

            const executor = new CLITaskExecutor(store);
            const task = makeScriptTask('sh-fail-1');

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Script spawn failed');
            expect(store.updateProcess).toHaveBeenCalledWith(
                'queue_sh-fail-1',
                expect.objectContaining({ status: 'failed' }),
            );
        });
    });

    // ========================================================================
    // Dispatch — dream-run
    // ========================================================================

    describe('dream-run dispatch', () => {
        it('delegates dream-run task to DreamTaskExecutor.execute()', async () => {
            mockDreamTaskExecute.mockResolvedValue({
                response: 'Dream run completed',
                run: { id: 'dream-run-1', status: 'completed' },
            });

            const executor = new CLITaskExecutor(store);
            const task = makeDreamTask();

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockDreamTaskExecute).toHaveBeenCalledOnce();
            expect(mockDreamTaskExecute).toHaveBeenCalledWith(task);
        });
    });

    // ========================================================================
    // Dispatch — follow-up
    // ========================================================================

    describe('follow-up dispatch', () => {
        it('delegates follow-up task to FollowUpExecutor.executeFollowUp()', async () => {
            mockFollowUpExecuteFollowUp.mockResolvedValue(undefined);

            const procId = 'proc-existing';
            store.processes.set(procId, {
                id: procId,
                type: 'chat',
                status: 'completed',
                startTime: new Date(),
                promptPreview: 'initial',
                fullPrompt: 'initial',
                sdkSessionId: 'sdk-1',
            });

            const executor = new CLITaskExecutor(store);
            const task = makeFollowUpTask(procId);

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockFollowUpExecuteFollowUp).toHaveBeenCalledOnce();
            expect(mockFollowUpExecuteFollowUp).toHaveBeenCalledWith(
                procId,
                'Follow-up question',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                // 10th arg = per-turn reasoningEffort override
                undefined,
            );
        });

        it('returns failure when FollowUpExecutor.executeFollowUp() throws', async () => {
            mockFollowUpExecuteFollowUp.mockRejectedValue(new Error('Follow-up failed'));

            const procId = 'proc-fu-fail';
            store.processes.set(procId, {
                id: procId,
                type: 'chat',
                status: 'completed',
                startTime: new Date(),
                promptPreview: 'initial',
                fullPrompt: 'initial',
            });

            const executor = new CLITaskExecutor(store);
            const task = makeFollowUpTask(procId, 'fu-fail-1');

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Follow-up failed');
        });

        it('passes "xhigh" per-turn override to FollowUpExecutor (AC: buffered/drained follow-ups preserve xhigh)', async () => {
            mockFollowUpExecuteFollowUp.mockResolvedValue(undefined);

            const procId = 'proc-xhigh';
            store.processes.set(procId, {
                id: procId,
                type: 'chat',
                status: 'completed',
                startTime: new Date(),
                promptPreview: 'initial',
                fullPrompt: 'initial',
                sdkSessionId: 'sdk-xhigh',
            });

            const executor = new CLITaskExecutor(store);
            const task = makeFollowUpTask(procId, 'fu-xhigh-1', 'xhigh');

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockFollowUpExecuteFollowUp).toHaveBeenCalledOnce();
            expect(mockFollowUpExecuteFollowUp).toHaveBeenCalledWith(
                procId,
                'Follow-up question',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                // 10th arg = per-turn reasoningEffort override
                'xhigh',
            );
        });
    });

    // ========================================================================
    // Cancellation propagation — all modes
    // ========================================================================

    describe('cancellation propagation via BaseExecutor.cancelledTasks', () => {
        it('prevents run-workflow execution when task is cancelled', async () => {
            const executor = new CLITaskExecutor(store);
            const task = makeWorkflowTask('wf-cancel-1');
            executor.cancel(task.id);

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            // WorkflowExecutor must not be invoked
            expect(mockWorkflowExecute).not.toHaveBeenCalled();
        });

        it('prevents run-script execution when task is cancelled', async () => {
            const executor = new CLITaskExecutor(store);
            const task = makeScriptTask('sh-cancel-1');
            executor.cancel(task.id);

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            // ShellExecutor must not be invoked
            expect(mockShellExecute).not.toHaveBeenCalled();
        });

        it('prevents follow-up execution and reverts process status when cancelled', async () => {
            const procId = 'proc-fu-cancel';
            store.processes.set(procId, {
                id: procId,
                type: 'chat',
                status: 'running',
                startTime: new Date(),
                promptPreview: 'initial',
                fullPrompt: 'initial',
            });

            const executor = new CLITaskExecutor(store);
            const task = makeFollowUpTask(procId, 'fu-cancel-1');
            executor.cancel(task.id);

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            // FollowUpExecutor must not be invoked
            expect(mockFollowUpExecuteFollowUp).not.toHaveBeenCalled();
            // Original process should be reverted to 'completed'
            expect(store.updateProcess).toHaveBeenCalledWith(
                procId,
                expect.objectContaining({ status: 'completed' }),
            );
        });

        it('cancel() is independent across executor instances (no cross-instance leakage)', () => {
            const executor1 = new CLITaskExecutor(store);
            const executor2 = new CLITaskExecutor(store);
            executor1.cancel('task-isolated');
            // executor2 must NOT see executor1's cancelled task
            // (BaseExecutor.cancelledTasks is an instance-level Set)
            expect((executor2 as any).cancelledTasks.has('task-isolated')).toBe(false);
        });

        it('clears cancelledTasks entry after execute() completes so requeued tasks are not blocked', async () => {
            mockChatExecute.mockResolvedValue({
                response: 'AI response',
                sessionId: 'sess-1',
                toolCalls: [],
                timeline: [],
                pendingSuggestions: undefined,
            });

            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('ask', 'requeue-task-1');

            // Cancel → execute (cancellation path)
            executor.cancel(task.id);
            const cancelResult = await executor.execute(task);
            expect(cancelResult.success).toBe(false);
            expect(cancelResult.error?.message).toContain('cancelled');

            // cancelledTasks entry must be cleared after execute()
            expect((executor as any).cancelledTasks.has(task.id)).toBe(false);

            // Re-execute the same task (simulates requeue) — should succeed
            const retryResult = await executor.execute(task);
            expect(retryResult.success).toBe(true);
            expect(mockChatExecute).toHaveBeenCalledOnce();
        });

        it('clears cancelledTasks entry even when execute() throws', async () => {
            mockChatExecute.mockRejectedValue(new Error('unexpected'));

            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('ask', 'throw-task-1');

            await executor.execute(task);

            expect((executor as any).cancelledTasks.has(task.id)).toBe(false);
        });
    });

    // ========================================================================
    // Dispatch — chat modes (ask / legacy plan / autopilot)
    // ========================================================================

    describe('chat mode dispatch', () => {
        const chatResult = {
            response: 'AI response',
            sessionId: 'sess-1',
            toolCalls: [],
            timeline: [],
            pendingSuggestions: undefined,
        };

        it('delegates ask-mode chat task to ChatExecutor.execute()', async () => {
            mockChatExecute.mockResolvedValue(chatResult);

            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('ask');

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockChatExecute).toHaveBeenCalledOnce();
            expect(mockChatExecute).toHaveBeenCalledWith(task, expect.any(String));
            expect(mockAutopilotExecute).not.toHaveBeenCalled();
        });

        it('normalizes legacy plan-mode chat task to ChatExecutor.execute()', async () => {
            mockChatExecute.mockResolvedValue(chatResult);

            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('plan');

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockChatExecute).toHaveBeenCalledOnce();
            expect(mockChatExecute).toHaveBeenCalledWith(task, expect.any(String));
            expect(mockAutopilotExecute).not.toHaveBeenCalled();
        });

        it('delegates autopilot-mode chat task to AutopilotExecutor.execute()', async () => {
            mockAutopilotExecute.mockResolvedValue(chatResult);

            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('autopilot');

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockAutopilotExecute).toHaveBeenCalledOnce();
            expect(mockAutopilotExecute).toHaveBeenCalledWith(task, expect.any(String));
            expect(mockChatExecute).not.toHaveBeenCalled();
        });

        it('marks process as failed when ChatExecutor.execute() throws', async () => {
            mockChatExecute.mockRejectedValue(new Error('Chat AI error'));

            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('ask', 'ask-fail-1');

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Chat AI error');
            expect(store.updateProcess).toHaveBeenCalledWith(
                'queue_ask-fail-1',
                expect.objectContaining({ status: 'failed' }),
            );
        });

        it('marks legacy plan-mode process as failed when ChatExecutor.execute() throws', async () => {
            mockChatExecute.mockRejectedValue(new Error('Ask AI error'));

            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('plan', 'plan-fail-1');

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Ask AI error');
            expect(store.updateProcess).toHaveBeenCalledWith(
                'queue_plan-fail-1',
                expect.objectContaining({ status: 'failed' }),
            );
        });

        it('marks process as failed when AutopilotExecutor.execute() throws', async () => {
            mockAutopilotExecute.mockRejectedValue(new Error('Autopilot AI error'));

            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('autopilot', 'autopilot-fail-1');

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Autopilot AI error');
            expect(store.updateProcess).toHaveBeenCalledWith(
                'queue_autopilot-fail-1',
                expect.objectContaining({ status: 'failed' }),
            );
        });

        it('prevents ask-mode execution when task is cancelled', async () => {
            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('ask', 'ask-cancel-1');
            executor.cancel(task.id);

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            expect(mockChatExecute).not.toHaveBeenCalled();
        });

        it('prevents legacy plan-mode execution when task is cancelled', async () => {
            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('plan', 'plan-cancel-1');
            executor.cancel(task.id);

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            expect(mockChatExecute).not.toHaveBeenCalled();
        });

        it('prevents autopilot-mode execution when task is cancelled', async () => {
            const executor = new CLITaskExecutor(store);
            const task = makeChatTask('autopilot', 'autopilot-cancel-1');
            executor.cancel(task.id);

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            expect(mockAutopilotExecute).not.toHaveBeenCalled();
        });
    });
});
