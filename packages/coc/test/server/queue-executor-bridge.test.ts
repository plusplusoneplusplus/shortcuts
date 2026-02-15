/**
 * Queue Executor Bridge Tests
 *
 * Tests for CLITaskExecutor and createQueueExecutorBridge:
 * - Task execution by type (ai-clarification, custom, follow-prompt)
 * - Process tracking in ProcessStore
 * - Cancellation handling
 * - Error handling and failure paths
 * - Queue executor integration (tasks move from queued → running → completed/failed)
 * - History population after execution
 * - Concurrent execution limits
 *
 * Uses mock CopilotSDKService to avoid real AI calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    TaskQueueManager,
    QueueExecutor,
    createQueueExecutor,
    QueuedTask,
    TaskExecutionResult,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor, createQueueExecutorBridge } from '../../src/server/queue-executor-bridge';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => ({
            sendMessage: mockSendMessage,
            isAvailable: mockIsAvailable,
        }),
    };
});

// ============================================================================
// Mock ProcessStore
// ============================================================================

function createMockStore(): ProcessStore & {
    processes: Map<string, AIProcess>;
    outputs: Map<string, string[]>;
    completions: Map<string, { status: string; duration: string }>;
} {
    const processes = new Map<string, AIProcess>();
    const outputs = new Map<string, string[]>();
    const completions = new Map<string, { status: string; duration: string }>();

    return {
        processes,
        outputs,
        completions,
        addProcess: vi.fn(async (process: AIProcess) => {
            processes.set(process.id, { ...process });
        }),
        updateProcess: vi.fn(async (id: string, updates: Partial<AIProcess>) => {
            const existing = processes.get(id);
            if (existing) {
                processes.set(id, { ...existing, ...updates });
            }
        }),
        getProcess: vi.fn(async (id: string) => processes.get(id)),
        getAllProcesses: vi.fn(async () => Array.from(processes.values())),
        removeProcess: vi.fn(async (id: string) => { processes.delete(id); }),
        clearProcesses: vi.fn(async () => {
            const count = processes.size;
            processes.clear();
            return count;
        }),
        getWorkspaces: vi.fn(async () => []),
        registerWorkspace: vi.fn(async () => {}),
        onProcessOutput: vi.fn((_id: string, _callback: any) => () => {}),
        emitProcessOutput: vi.fn((id: string, content: string) => {
            const existing = outputs.get(id) || [];
            existing.push(content);
            outputs.set(id, existing);
        }),
        emitProcessComplete: vi.fn((id: string, status: string, duration: string) => {
            completions.set(id, { status, duration });
        }),
    };
}

// ============================================================================
// Helpers
// ============================================================================

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('CLITaskExecutor', () => {
    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    // ========================================================================
    // AI Clarification Tasks
    // ========================================================================

    describe('ai-clarification tasks', () => {
        it('should execute an ai-clarification task successfully', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'Explain this code' },
                config: { timeoutMs: 30000 },
                displayName: 'Explain code',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(result.result).toEqual({
                response: 'AI response text',
                sessionId: 'session-123',
            });

            // Verify process was created in store
            expect(store.addProcess).toHaveBeenCalledOnce();
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.id).toBe('queue-task-1');
            expect(addedProcess.type).toBe('queue-ai-clarification');
            expect(addedProcess.status).toBe('running');
            expect(addedProcess.fullPrompt).toBe('Explain this code');

            // Verify process was marked completed
            expect(store.updateProcess).toHaveBeenCalledWith('queue-task-1', expect.objectContaining({
                status: 'completed',
            }));
            expect(store.emitProcessComplete).toHaveBeenCalledWith(
                'queue-task-1',
                'completed',
                expect.stringMatching(/\d+ms/)
            );
        });

        it('should use displayName as prompt fallback for ai-clarification', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: '' },
                config: {},
                displayName: 'My clarification task',
            };

            await executor.execute(task);

            // Prompt should fall back to displayName
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'My clarification task',
            }));
        });

        it('should pass model and timeout from task config', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-3',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test', workingDirectory: '/my/dir' },
                config: { model: 'gpt-4', timeoutMs: 60000 },
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                model: 'gpt-4',
                timeoutMs: 60000,
                workingDirectory: '/my/dir',
                usePool: false,
            }));
        });
    });

    // ========================================================================
    // Custom Tasks
    // ========================================================================

    describe('custom tasks', () => {
        it('should execute a custom task with data.prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-4',
                type: 'custom',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { data: { prompt: 'Analyze performance' } },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Analyze performance',
            }));
        });

        it('should use displayName for custom task without data.prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-5',
                type: 'custom',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { data: {} },
                config: {},
                displayName: 'Custom task name',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Custom task name',
            }));
        });
    });

    // ========================================================================
    // Follow-Prompt Tasks
    // ========================================================================

    describe('follow-prompt tasks', () => {
        it('should execute a follow-prompt task with file path', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    promptFilePath: '/nonexistent/prompt.md',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            // Should fall back to a descriptive prompt since file doesn't exist
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('prompt.md'),
                workingDirectory: '/my/workspace',
            }));
        });

        it('should execute a follow-prompt task with promptContent directly', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6b',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    promptContent: 'Analyze codebase for vulnerabilities.',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Analyze codebase for vulnerabilities.',
                workingDirectory: '/my/workspace',
            }));
        });

        it('should prefer promptContent over promptFilePath', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6c',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    promptContent: 'Direct prompt text.',
                    promptFilePath: '/some/file.md',
                    planFilePath: '/some/plan.md',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Direct prompt text.'),
            }));
            // Should NOT use file indirection
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.not.stringContaining('Follow the instruction'),
            }));
        });

        it('should append planFilePath and additionalContext to promptContent', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6d',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    promptContent: 'Refactor the auth module.',
                    planFilePath: '/workspace/plan.md',
                    additionalContext: 'Focus on tests.',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Refactor the auth module. /workspace/plan.md\n\nAdditional context: Focus on tests.',
            }));
        });
    });

    // ========================================================================
    // Code Review / Resolve Comments (no-op)
    // ========================================================================

    describe('no-op task types', () => {
        it('should complete code-review tasks as no-op', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-7',
                type: 'code-review',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { diffType: 'staged', rulesFolder: '.github/cr-rules' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).not.toHaveBeenCalled();
            expect(result.result).toEqual(expect.objectContaining({
                status: 'completed',
                message: expect.stringContaining('no-op'),
            }));
        });

        it('should complete resolve-comments tasks as no-op', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-8',
                type: 'resolve-comments',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { documentUri: 'file:///test.md', commentIds: ['c1'], promptTemplate: '' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Error Handling
    // ========================================================================

    describe('error handling', () => {
        it('should handle SDK unavailability', async () => {
            mockIsAvailable.mockResolvedValue({ available: false, error: 'Not installed' });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-err-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('not available');

            // Verify process was marked as failed
            expect(store.updateProcess).toHaveBeenCalledWith('queue-task-err-1', expect.objectContaining({
                status: 'failed',
                error: expect.stringContaining('not available'),
            }));
            expect(store.emitProcessComplete).toHaveBeenCalledWith(
                'queue-task-err-1',
                'failed',
                expect.stringMatching(/\d+ms/)
            );
        });

        it('should handle SDK execution failure', async () => {
            mockSendMessage.mockResolvedValue({
                success: false,
                error: 'Rate limited',
            });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-err-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('Rate limited');
        });

        it('should handle SDK throwing an exception', async () => {
            mockSendMessage.mockRejectedValue(new Error('Network error'));

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-err-3',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Network error');
        });
    });

    // ========================================================================
    // Cancellation
    // ========================================================================

    describe('cancellation', () => {
        it('should return failure for cancelled tasks', async () => {
            const executor = new CLITaskExecutor(store);
            executor.cancel('task-cancel-1');

            const task: QueuedTask = {
                id: 'task-cancel-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            expect(mockSendMessage).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Process Tracking
    // ========================================================================

    describe('process tracking', () => {
        it('should create process with correct metadata', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-1',
                type: 'ai-clarification',
                priority: 'high',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'Analyze this' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.metadata).toEqual({
                type: 'queue-ai-clarification',
                queueTaskId: 'task-meta-1',
                priority: 'high',
                model: undefined,
            });
        });

        it('should store model in process metadata when provided in config', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-model',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: { model: 'claude-sonnet-4-5' },
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.metadata?.model).toBe('claude-sonnet-4-5');
        });

        it('should store workingDirectory on process from ai-clarification payload', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-cwd',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test', workingDirectory: '/my/project' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/my/project');
        });

        it('should store workingDirectory on process from follow-prompt payload', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-cwd-fp',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { promptFilePath: '/path/to/prompt.md', workingDirectory: '/workspace/root' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/workspace/root');
        });

        it('should store default workingDirectory on process when no payload cwd', async () => {
            const executor = new CLITaskExecutor(store, { workingDirectory: '/default/cwd' });

            const task: QueuedTask = {
                id: 'task-meta-cwd-default',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/default/cwd');
        });

        it('should store both model and workingDirectory on process', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-both',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test', workingDirectory: '/project' },
                config: { model: 'gpt-4' },
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/project');
            expect(addedProcess.metadata?.model).toBe('gpt-4');
        });

        it('should truncate long prompts in promptPreview', async () => {
            const executor = new CLITaskExecutor(store);

            const longPrompt = 'A'.repeat(200);
            const task: QueuedTask = {
                id: 'task-meta-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: longPrompt },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.promptPreview.length).toBeLessThanOrEqual(80);
            expect(addedProcess.promptPreview).toContain('...');
            expect(addedProcess.fullPrompt).toBe(longPrompt);
        });

        it('should link processId to task', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-3',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            expect(task.processId).toBe('queue-task-meta-3');
        });
    });

    // ========================================================================
    // Permission Handling
    // ========================================================================

    describe('permission handling', () => {
        it('should approve permissions by default', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-perm-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                onPermissionRequest: expect.any(Function),
            }));
        });

        it('should not set permission handler when approvePermissions is false', async () => {
            const executor = new CLITaskExecutor(store, { approvePermissions: false });

            const task: QueuedTask = {
                id: 'task-perm-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                onPermissionRequest: undefined,
            }));
        });
    });
});

// ============================================================================
// Queue Executor Bridge Integration Tests
// ============================================================================

describe('createQueueExecutorBridge', () => {
    let store: ReturnType<typeof createMockStore>;
    let queueManager: TaskQueueManager;

    beforeEach(() => {
        store = createMockStore();
        queueManager = new TaskQueueManager({
            maxQueueSize: 0,
            keepHistory: true,
            maxHistorySize: 100,
        });
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'sess-1',
        });
    });

    it('should create a running executor', () => {
        const executor = createQueueExecutorBridge(queueManager, store);
        expect(executor).toBeInstanceOf(QueueExecutor);
        expect(executor.isRunning()).toBe(true);
        executor.dispose();
    });

    it('should execute enqueued tasks automatically', async () => {
        const executor = createQueueExecutorBridge(queueManager, store);

        const taskCompleted = new Promise<void>((resolve) => {
            executor.on('taskCompleted', () => resolve());
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'Hello AI' },
            config: { timeoutMs: 30000 },
            displayName: 'Test task',
        });

        await taskCompleted;

        // Task should be in history as completed
        const history = queueManager.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe('completed');

        // Process should be in store
        expect(store.addProcess).toHaveBeenCalled();
        expect(store.updateProcess).toHaveBeenCalledWith(
            expect.stringContaining('queue-'),
            expect.objectContaining({ status: 'completed' })
        );

        executor.dispose();
    });

    it('should handle task failure and populate history', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Model overloaded',
        });

        const executor = createQueueExecutorBridge(queueManager, store);

        const taskFailed = new Promise<void>((resolve) => {
            executor.on('taskFailed', () => resolve());
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'test' },
            config: {},
        });

        await taskFailed;

        const history = queueManager.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe('failed');
        expect(history[0].error).toContain('Model overloaded');

        executor.dispose();
    });

    it('should process multiple tasks in order', async () => {
        const executor = createQueueExecutorBridge(queueManager, store, {
            maxConcurrency: 1,
        });

        const completedTasks: string[] = [];

        executor.on('taskCompleted', (task: QueuedTask) => {
            completedTasks.push(task.displayName || task.id);
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'Task A' },
            config: {},
            displayName: 'A',
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'Task B' },
            config: {},
            displayName: 'B',
        });

        // Wait for both tasks to complete
        await delay(500);

        expect(completedTasks).toContain('A');
        expect(completedTasks).toContain('B');
        expect(queueManager.getHistory()).toHaveLength(2);

        executor.dispose();
    });

    it('should respect high priority ordering', async () => {
        // Pause first so we can enqueue in specific order
        queueManager.pause();

        const executor = createQueueExecutorBridge(queueManager, store, {
            maxConcurrency: 1,
        });

        const executionOrder: string[] = [];
        mockSendMessage.mockImplementation(async (opts: any) => {
            executionOrder.push(opts.prompt);
            return { success: true, response: 'ok' };
        });

        // Enqueue low priority first, then high
        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'low',
            payload: { prompt: 'low-task' },
            config: {},
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'high',
            payload: { prompt: 'high-task' },
            config: {},
        });

        // Resume and wait
        queueManager.resume();
        await delay(500);

        // High priority should execute first
        expect(executionOrder[0]).toBe('high-task');
        expect(executionOrder[1]).toBe('low-task');

        executor.dispose();
    });

    it('should not start when autoStart is false', () => {
        const executor = createQueueExecutorBridge(queueManager, store, {
            autoStart: false,
        });

        expect(executor.isRunning()).toBe(false);
        executor.dispose();
    });

    it('should stop processing when paused', async () => {
        const executor = createQueueExecutorBridge(queueManager, store);

        // Pause the queue
        queueManager.pause();

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'test' },
            config: {},
        });

        // Wait a bit — task should NOT execute
        await delay(300);

        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(queueManager.getQueued()).toHaveLength(1);

        // Resume — task should execute
        const taskCompleted = new Promise<void>((resolve) => {
            executor.on('taskCompleted', () => resolve());
        });

        queueManager.resume();
        await taskCompleted;

        expect(mockSendMessage).toHaveBeenCalledOnce();
        expect(queueManager.getHistory()).toHaveLength(1);

        executor.dispose();
    });

    it('should cancel a running task via executor', async () => {
        // Make the AI call take a while
        mockSendMessage.mockImplementation(() => new Promise(resolve => {
            setTimeout(() => resolve({ success: true, response: 'done' }), 5000);
        }));

        const executor = createQueueExecutorBridge(queueManager, store);

        const taskId = queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'long task' },
            config: {},
        });

        // Wait for task to start
        await delay(200);

        // Cancel it
        executor.cancelTask(taskId);

        // Wait for cancellation to process
        await delay(300);

        // Task should be cancelled
        const task = queueManager.getTask(taskId);
        expect(task?.status).toBe('cancelled');

        executor.dispose();
    });
});

// ============================================================================
// Server Integration Tests
// ============================================================================

describe('Queue execution via HTTP API', () => {
    // These tests verify the full flow: HTTP enqueue → executor picks up → task completes

    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
        });
    });

    it('should have CLITaskExecutor as a proper TaskExecutor', () => {
        const executor = new CLITaskExecutor(store);
        expect(typeof executor.execute).toBe('function');
        expect(typeof executor.cancel).toBe('function');
    });

    it('should handle store errors gracefully', async () => {
        // Make store.addProcess throw
        const failingStore = createMockStore();
        (failingStore.addProcess as any).mockRejectedValue(new Error('Store error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        // Should still succeed (store errors are non-fatal)
        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should handle store update errors gracefully on success', async () => {
        const failingStore = createMockStore();
        (failingStore.updateProcess as any).mockRejectedValue(new Error('Update error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err-2',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should handle store update errors gracefully on failure', async () => {
        mockSendMessage.mockResolvedValue({ success: false, error: 'AI error' });

        const failingStore = createMockStore();
        (failingStore.updateProcess as any).mockRejectedValue(new Error('Update error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err-3',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(false);
    });

    it('should pass onStreamingChunk to sendMessage for AI tasks', async () => {
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-1',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Stream me' },
            config: {},
        };

        await executor.execute(task);

        // Verify onStreamingChunk was passed to sendMessage
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            onStreamingChunk: expect.any(Function),
        }));
    });

    it('should emit streaming chunks to process store via onStreamingChunk', async () => {
        // Capture the onStreamingChunk callback and invoke it during execution
        mockSendMessage.mockImplementation(async (opts: any) => {
            // Simulate streaming chunks
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('Hello ');
                opts.onStreamingChunk('world!');
            }
            return { success: true, response: 'Hello world!', sessionId: 'sess-stream' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-2',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Stream test' },
            config: {},
        };

        await executor.execute(task);

        // Verify chunks were emitted to the store
        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue-task-stream-2', 'Hello ');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue-task-stream-2', 'world!');
        expect(store.outputs.get('queue-task-stream-2')).toEqual(['Hello ', 'world!']);
    });

    it('should handle store.emitProcessOutput errors gracefully during streaming', async () => {
        // Make emitProcessOutput throw
        const failingStore = createMockStore();
        (failingStore.emitProcessOutput as any).mockImplementation(() => {
            throw new Error('Store emit error');
        });

        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('chunk1');
            }
            return { success: true, response: 'done', sessionId: 'sess-err' };
        });

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-stream-err',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        // Should not throw — store errors in streaming are non-fatal
        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should emit streaming chunks for custom tasks', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('custom chunk');
            }
            return { success: true, response: 'custom response' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-custom',
            type: 'custom',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { data: { prompt: 'Custom task' } },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue-task-stream-custom', 'custom chunk');
    });

    it('should emit streaming chunks for follow-prompt tasks', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('follow chunk');
            }
            return { success: true, response: 'follow response' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-follow',
            type: 'follow-prompt',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { promptFilePath: '/nonexistent/file.md' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue-task-stream-follow', 'follow chunk');
    });

    it('should use default working directory from options', async () => {
        const executor = new CLITaskExecutor(store, { workingDirectory: '/default/dir' });

        const task: QueuedTask = {
            id: 'task-wd',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            workingDirectory: '/default/dir',
        }));
    });

    it('should prefer task working directory over default', async () => {
        const executor = new CLITaskExecutor(store, { workingDirectory: '/default/dir' });

        const task: QueuedTask = {
            id: 'task-wd-2',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test', workingDirectory: '/task/dir' },
            config: {},
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            workingDirectory: '/task/dir',
        }));
    });

    // ========================================================================
    // Output Persistence
    // ========================================================================

    describe('output persistence', () => {
        let tmpDir: string;

        beforeEach(async () => {
            const os = await import('os');
            const fsPromises = await import('fs/promises');
            const path = await import('path');
            tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'coc-bridge-test-'));
        });

        afterEach(async () => {
            const fsPromises = await import('fs/promises');
            await fsPromises.rm(tmpDir, { recursive: true, force: true });
        });

        it('should accumulate streaming chunks and save output file on success', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('chunk1');
                opts.onStreamingChunk?.('chunk2');
                opts.onStreamingChunk?.('chunk3');
                return { success: true, response: 'done', sessionId: 's1' };
            });

            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-output-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test output' },
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(true);

            // Verify output file was written with concatenated chunks
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue-task-output-1.md');
            const content = await fsPromises.readFile(outputPath, 'utf-8');
            expect(content).toBe('chunk1chunk2chunk3');
        });

        it('should set rawStdoutFilePath on the process after completion', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('output data');
                return { success: true, response: 'done', sessionId: 's2' };
            });

            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-output-path',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            // Check that updateProcess was called with rawStdoutFilePath
            const path = await import('path');
            const expectedPath = path.join(tmpDir, 'outputs', 'queue-task-output-path.md');
            expect(store.updateProcess).toHaveBeenCalledWith('queue-task-output-path', {
                rawStdoutFilePath: expectedPath,
            });
        });

        it('should save output file on task failure too', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('partial1');
                opts.onStreamingChunk?.('partial2');
                throw new Error('AI execution failed mid-stream');
            });

            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-output-fail',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(false);

            // Verify partial output was still saved
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue-task-output-fail.md');
            const content = await fsPromises.readFile(outputPath, 'utf-8');
            expect(content).toBe('partial1partial2');
        });

        it('should still emit streaming chunks to store alongside file persistence', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('chunk-a');
                opts.onStreamingChunk?.('chunk-b');
                return { success: true, response: 'done', sessionId: 's3' };
            });

            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-output-sse',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            // Verify streaming chunks were emitted to store (SSE/WS)
            expect(store.emitProcessOutput).toHaveBeenCalledWith('queue-task-output-sse', 'chunk-a');
            expect(store.emitProcessOutput).toHaveBeenCalledWith('queue-task-output-sse', 'chunk-b');

            // And also verify file was written
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue-task-output-sse.md');
            const content = await fsPromises.readFile(outputPath, 'utf-8');
            expect(content).toBe('chunk-achunk-b');
        });

        it('should not create output file when no dataDir is provided', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('chunk');
                return { success: true, response: 'done', sessionId: 's4' };
            });

            // No dataDir — should skip persistence
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-no-datadir',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(true);

            // updateProcess should not be called with rawStdoutFilePath
            const calls = (store.updateProcess as any).mock.calls;
            const pathCalls = calls.filter((c: any) => c[1]?.rawStdoutFilePath);
            expect(pathCalls).toHaveLength(0);
        });

        it('should not create output file for non-AI task types', async () => {
            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-noop',
                type: 'code-review',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {},
                config: {},
            };

            await executor.execute(task);

            // No output file should exist (no-op tasks produce no output)
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputsDir = path.join(tmpDir, 'outputs');
            await expect(fsPromises.access(outputsDir)).rejects.toThrow();
        });
    });
});
