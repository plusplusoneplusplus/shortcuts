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
vi.mock('../../src/server/executors/workflow-executor', () => ({
    WorkflowExecutor: vi.fn().mockImplementation(() => ({
        execute: mockWorkflowExecute,
    })),
}));

// ShellExecutor mock — records calls for dispatch assertions
const mockShellExecute = vi.fn();
vi.mock('../../src/server/executors/shell-executor', () => ({
    ShellExecutor: vi.fn().mockImplementation(() => ({
        execute: mockShellExecute,
    })),
}));

// FollowUpExecutor mock — records calls for dispatch assertions
const mockFollowUpExecuteFollowUp = vi.fn();
vi.mock('../../src/server/executors/follow-up-executor', () => ({
    FollowUpExecutor: vi.fn().mockImplementation(() => ({
        executeFollowUp: mockFollowUpExecuteFollowUp,
    })),
}));

// Forge mock — prevent real getCopilotSDKService and other side-effects
const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
        resolveSkillSync: vi.fn().mockReturnValue(undefined),
        gatherFeatureContext: vi.fn().mockResolvedValue({}),
    };
});

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()),
}));

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
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';

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

function makeFollowUpTask(processId: string, id = 'fu-task-1'): QueuedTask {
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
        } as any,
        config: {},
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
    });
});
