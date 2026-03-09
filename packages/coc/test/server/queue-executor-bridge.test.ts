/**
 * Queue Executor Bridge Tests
 *
 * Tests for CLITaskExecutor and createQueueExecutorBridge:
 * - Task execution by type (chat with ask/plan/autopilot modes, run-workflow, run-script)
 * - Process tracking in ProcessStore
 * - Cancellation handling
 * - Error handling and failure paths
 * - Queue executor integration (tasks move from queued → running → completed/failed)
 * - History population after execution
 * - Concurrent execution limits
 *
 * Uses mock CopilotSDKService to avoid real AI calls.
 */

import * as fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Partial mock of fs — allows overriding existsSync/readFileSync per test
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

import {
    TaskQueueManager,
    QueueExecutor,
    createQueueExecutor,
    QueuedTask,
    TaskExecutionResult,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor, createQueueExecutorBridge, defaultIsExclusive } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable, mockSendFollowUp, mockCanResumeSession } = sdkMocks;

const mockExecutePipeline = vi.fn();
const mockExecuteWorkflow = vi.fn();
const mockCompileToWorkflow = vi.fn();
const mockFlattenWorkflowResult = vi.fn();
const mockGatherFeatureContext = vi.fn();
const mockResolveSkillSync = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
        executePipeline: (...args: any[]) => mockExecutePipeline(...args),
        executeWorkflow: (...args: any[]) => mockExecuteWorkflow(...args),
        compileToWorkflow: (...args: any[]) => mockCompileToWorkflow(...args),
        flattenWorkflowResult: (...args: any[]) => mockFlattenWorkflowResult(...args),
        gatherFeatureContext: (...args: any[]) => mockGatherFeatureContext(...args),
        resolveSkillSync: (...args: any[]) => mockResolveSkillSync(...args),
    };
});

const mockCreateCLIAIInvoker = vi.fn().mockReturnValue(vi.fn());
vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: (...args: any[]) => mockCreateCLIAIInvoker(...args),
}));

const mockLoadImages = vi.fn().mockResolvedValue([]);
vi.mock('../../src/server/image-blob-store', () => ({
    ImageBlobStore: {
        loadImages: (...args: any[]) => mockLoadImages(...args),
        saveImages: vi.fn(),
        deleteImages: vi.fn(),
        getBlobsDir: vi.fn(),
    },
}));

// ============================================================================
// Mock child_process for run-script tests
// ============================================================================

import { EventEmitter } from 'events';

interface FakeChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
        // Simulate process being killed: emit close with null exit code
        setImmediate(() => child.emit('close', null));
    });
    return child;
}

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));

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
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockResolveSkillSync.mockReset();
        mockLoadImages.mockReset();
        mockLoadImages.mockResolvedValue([]);
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    // ========================================================================
    // Ask-Mode Chat Tasks
    // ========================================================================

    describe('ask-mode chat tasks', () => {
        it('should execute an ask-mode chat task successfully', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Explain this code' },
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
            expect(addedProcess.id).toBe('queue_task-1');
            expect(addedProcess.type).toBe('chat');
            expect(addedProcess.status).toBe('running');
            expect(addedProcess.fullPrompt).toContain('Explain this code');

            // Verify process was marked completed
            expect(store.updateProcess).toHaveBeenCalledWith('queue_task-1', expect.objectContaining({
                status: 'completed',
            }));
            expect(store.emitProcessComplete).toHaveBeenCalledWith(
                'queue_task-1',
                'completed',
                expect.stringMatching(/\d+ms/)
            );
        });

        it('should use displayName as prompt fallback for ask-mode chat', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: '' },
                config: {},
                displayName: 'My clarification task',
            };

            await executor.execute(task);

            // Prompt should fall back to displayName (with READONLY prefix for ask mode)
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('My clarification task'),
            }));
        });

        it('should pass model and timeout from task config', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test', workingDirectory: '/my/dir' },
                config: { model: 'gpt-4', timeoutMs: 60000 },
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                model: 'gpt-4',
                timeoutMs: 60000,
                workingDirectory: '/my/dir',
            }));
        });
    });

    // ========================================================================
    // Chat Tasks
    // ========================================================================

    describe('chat tasks', () => {
        it('should execute a chat task successfully', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'What does this repo do?' },
                config: { timeoutMs: 30000 },
                displayName: 'Chat message',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(result.result).toEqual({
                response: 'AI response text',
                sessionId: 'session-123',
            });

            // Verify process was created in store
            expect(store.addProcess).toHaveBeenCalled();
            const addedProcess = (store.addProcess as any).mock.calls.at(-1)[0];
            expect(addedProcess.id).toBe('queue_chat-1');
            expect(addedProcess.type).toBe('chat');
            expect(addedProcess.status).toBe('running');
            expect(addedProcess.fullPrompt).toContain('What does this repo do?');

            // Verify process was marked completed
            expect(store.updateProcess).toHaveBeenCalledWith('queue_chat-1', expect.objectContaining({
                status: 'completed',
            }));
        });

        it('should use displayName as prompt fallback for chat', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: '' },
                config: {},
                displayName: 'My chat message',
            };

            await executor.execute(task);

            // Prompt should fall back to displayName (with follow-up count suffix)
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('My chat message'),
            }));
        });

        it('should fall back to default prompt when both prompt and displayName are empty', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: '' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Chat message'),
            }));
        });

        it('should use payload.workingDirectory as CWD for chat tasks', async () => {
            const executor = new CLITaskExecutor(store, { workingDirectory: '/default/cwd' });

            const task: QueuedTask = {
                id: 'chat-wd',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Hello', workingDirectory: '/project/root' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                workingDirectory: '/project/root',
            }));
        });

        it('should fall back to folderPath when workingDirectory is absent', async () => {
            const executor = new CLITaskExecutor(store, { workingDirectory: '/default/cwd' });

            const task: QueuedTask = {
                id: 'chat-fp',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Hello', folderPath: '/folder/path' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                workingDirectory: '/folder/path',
            }));
        });

        it('should fall back to defaultWorkingDirectory when neither workingDirectory nor folderPath are set', async () => {
            const executor = new CLITaskExecutor(store, { workingDirectory: '/default/cwd' });

            const task: QueuedTask = {
                id: 'chat-def',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Hello' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                workingDirectory: '/default/cwd',
            }));
        });
    });

    // ========================================================================
    // Read-Only Chat Tasks
    // ========================================================================

    describe('chat tasks with readonly flag', () => {
        it('should pass mode=interactive to sendMessage for ask-mode chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'readonly-chat-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Explain the architecture' },
                config: {},
                displayName: 'Read-Only Chat',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Explain the architecture'),
                mode: 'interactive',
            }));
        });

        it('should pass mode=autopilot to sendMessage for autopilot chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-noprefix',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Explain the architecture' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                mode: 'autopilot',
            }));
        });

        it('should pass mode=plan to sendMessage for plan-mode chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'plan-chat-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'plan', prompt: 'Plan the refactoring' },
                config: {},
                displayName: 'Plan Chat',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Plan the refactoring'),
                mode: 'plan',
            }));
            // Prompt should NOT contain the old plan prefix
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.not.stringContaining('IMPORTANT: You are in plan mode'),
            }));
        });

        it('should include suggest_follow_ups tool for chat tasks with readonly=true', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'readonly-chat-tools',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'What is this?' },
                config: {},
                displayName: 'Read-Only Chat',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                tools: expect.arrayContaining([
                    expect.objectContaining({ name: 'suggest_follow_ups' }),
                ]),
            }));
        });
    });

    // ========================================================================
    // Chat Follow-up Tasks
    // ========================================================================

    describe('chat follow-up tasks', () => {
        it('should dispatch chat follow-up to executeFollowUp on an existing session', async () => {
            const executor = new CLITaskExecutor(store);

            // Pre-create a process with an SDK session
            const proc = createCompletedProcessWithSession('proc-fu', 'sess-fu');
            await store.addProcess(proc);

            const task: QueuedTask = {
                id: 'followup-task-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat',
                    processId: 'proc-fu',
                    prompt: 'What is the best approach?',
                } as any,
                config: {},
                displayName: 'What is the best approach?',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            // executeFollowUp calls sendFollowUp on the AI service
            expect(mockSendFollowUp).toHaveBeenCalledWith(
                'sess-fu',
                expect.stringContaining('What is the best approach?'),
                expect.any(Object)
            );
        });

        it('should fail gracefully when the parent process does not exist', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'followup-task-notfound',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat',
                    processId: 'proc-does-not-exist',
                    prompt: 'Hello?',
                } as any,
                config: {},
            };

            const result = await executor.execute(task);

            // Should fail without crashing
            expect(result.success).toBe(false);
        });

        it('should pass mode to sendFollowUp based on process metadata', async () => {
            const executor = new CLITaskExecutor(store);

            // Pre-create a process with an SDK session and mode='ask' in metadata
            const proc = createCompletedProcessWithSession('proc-fu-mode', 'sess-fu-mode');
            (proc as any).metadata = { mode: 'ask' };
            await store.addProcess(proc);

            const task: QueuedTask = {
                id: 'followup-mode-test',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat',
                    processId: 'proc-fu-mode',
                    prompt: 'Follow up question',
                } as any,
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendFollowUp).toHaveBeenCalledWith(
                'sess-fu-mode',
                expect.any(String),
                expect.objectContaining({ mode: 'interactive' }),
            );
        });

        it('should requeue a completed chat task for follow-up execution', async () => {
            const queueManager = new TaskQueueManager();
            const executor = new CLITaskExecutor(store);
            executor.setQueueManager(queueManager);

            // Pre-create a process with an SDK session and conversation turns
            const proc = createCompletedProcessWithSession('proc-reactivate', 'sess-reactivate');
            (proc as any).conversationTurns = [
                { role: 'user', content: 'Hello', turnIndex: 0 },
                { role: 'assistant', content: 'Hi!', turnIndex: 1 },
            ];
            await store.addProcess(proc);

            // Simulate a parent chat task that completed
            const parentId = queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', prompt: 'Hello' },
                config: {},
                processId: 'proc-reactivate',
                displayName: 'Chat',
            });
            queueManager.markStarted(parentId);
            queueManager.markCompleted(parentId);
            expect(queueManager.getHistory()).toHaveLength(1);

            await executor.requeueForFollowUp(parentId, 'Follow-up question');

            expect(queueManager.getQueued()).toHaveLength(1);
            expect(queueManager.getHistory()).toHaveLength(0);
            const parentTask = queueManager.getTask(parentId);
            expect(parentTask?.status).toBe('queued');
            expect((parentTask?.payload as any).processId).toBe('proc-reactivate');
            expect((parentTask?.payload as any).prompt).toBe('Follow-up question');
        });

        it('should clear follow-up payload metadata after successful execution', async () => {
            const queueManager = new TaskQueueManager();
            const executor = new CLITaskExecutor(store);
            executor.setQueueManager(queueManager);

            const proc = createCompletedProcessWithSession('proc-fail-reactivate', 'sess-fail-reactivate');
            (proc as any).conversationTurns = [
                { role: 'user', content: 'Hello', turnIndex: 0 },
                { role: 'assistant', content: 'Hi!', turnIndex: 1 },
            ];
            await store.addProcess(proc);

            const task: QueuedTask = {
                id: 'followup-fail-reactivate',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat',
                    processId: 'proc-fail-reactivate',
                    prompt: 'This will succeed',
                } as any,
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(true);
            expect((task.payload as any).processId).toBeUndefined();
            expect((task.payload as any).attachments).toBeUndefined();
            expect((task.payload as any).imageTempDir).toBeUndefined();
            expect(task.displayName).toMatch(/Chat \(\d+ turns?\)/);
        });

        it('should clear follow-up payload metadata after failed execution', async () => {
            const executor = new CLITaskExecutor(store);

            const proc = createCompletedProcessWithSession('proc-fail-followup', '');
            (proc as any).sdkSessionId = undefined;
            await store.addProcess(proc);

            const task: QueuedTask = {
                id: 'followup-fail-reactivate',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat',
                    processId: 'proc-fail-followup',
                    prompt: 'This will fail',
                } as any,
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(false);
            expect((task.payload as any).processId).toBeUndefined();
            expect((task.payload as any).attachments).toBeUndefined();
            expect((task.payload as any).imageTempDir).toBeUndefined();
        });

        it('should work without parent task metadata', async () => {
            const executor = new CLITaskExecutor(store);

            const proc = createCompletedProcessWithSession('proc-noparent', 'sess-noparent');
            await store.addProcess(proc);

            const task: QueuedTask = {
                id: 'followup-noparent',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat',
                    processId: 'proc-noparent',
                    prompt: 'No parent task id',
                } as any,
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(true);
        });
    });

    // ========================================================================
    // Autopilot Chat Tasks
    // ========================================================================

    describe('autopilot chat tasks', () => {
        it('should execute an autopilot chat task with prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-4',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Analyze performance' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Analyze performance'),
            }));
        });

        it('should include planFilePath in prompt for autopilot chat task', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-4b',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Update the document\n\nFile: /project/data/repos/abc/tasks/coc/add-retry-logic.plan.md',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Update the document\n\nFile: /project/data/repos/abc/tasks/coc/add-retry-logic.plan.md'),
            }));
        });

        it('should NOT append planFilePath when it is empty', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-4c',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Analyze performance' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Analyze performance'),
            }));
        });

        it('should use displayName for autopilot chat task without prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-5',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: '' },
                config: {},
                displayName: 'Custom task name',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Custom task name'),
            }));
        });
    });

    // ========================================================================
    // Chat Tasks (promoted prompt from top-level)
    // ========================================================================

    describe('chat tasks with promoted prompt', () => {
        it('should use promoted prompt from payload for chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'What does this repo do?' },
                config: {},
                displayName: 'Chat',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('What does this repo do?'),
            }));

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.fullPrompt).toContain('What does this repo do?');
        });

        it('should use promoted prompt with workingDirectory for chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Explain the architecture', workingDirectory: '/my/repo' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Explain the architecture'),
                workingDirectory: '/my/repo',
            }));
        });

        it('should store correct user turn content for chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'How do I build this project?' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns).toHaveLength(1);
            expect(addedProcess.conversationTurns[0].role).toBe('user');
            expect(addedProcess.conversationTurns[0].content).toContain('How do I build this project?');
        });

        it('should fall back to displayName when chat payload has no prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-4',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: '' },
                config: {},
                displayName: 'Chat',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.fullPrompt).toContain('Chat');
        });

        it('should persist images in the initial user conversation turn', async () => {
            const executor = new CLITaskExecutor(store);
            const images = ['data:image/png;base64,aaaa', 'data:image/jpeg;base64,bbbb'];

            const task: QueuedTask = {
                id: 'chat-img-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'What is in this image?', images },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns).toHaveLength(1);
            expect(addedProcess.conversationTurns[0].role).toBe('user');
            expect(addedProcess.conversationTurns[0].images).toEqual(images);
        });

        it('should not set images on user turn when payload has no images', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-img-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Hello' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns[0].images).toBeUndefined();
        });

        it('should filter out non-string values from payload images', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-img-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Check these', images: ['data:image/png;base64,ok', 42, null, 'data:image/jpeg;base64,fine'] },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns[0].images).toEqual([
                'data:image/png;base64,ok',
                'data:image/jpeg;base64,fine',
            ]);
        });
    });

    // ========================================================================
    // Image Rehydration from Blob Store
    // ========================================================================

    describe('image rehydration from blob store', () => {
        it('should rehydrate images from imagesFilePath when payload.images is empty', async () => {
            const executor = new CLITaskExecutor(store);
            const rehydratedImages = ['data:image/png;base64,rehydrated1', 'data:image/jpeg;base64,rehydrated2'];
            mockLoadImages.mockResolvedValue(rehydratedImages);

            const task: QueuedTask = {
                id: 'chat-rehydrate-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Describe the image', images: [], imagesFilePath: '/blobs/chat-rehydrate-1.images.json' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            expect(mockLoadImages).toHaveBeenCalledWith('/blobs/chat-rehydrate-1.images.json');
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns).toHaveLength(1);
            expect(addedProcess.conversationTurns[0].images).toEqual(rehydratedImages);
        });

        it('should rehydrate images when payload.images is not set', async () => {
            const executor = new CLITaskExecutor(store);
            const rehydratedImages = ['data:image/png;base64,abc'];
            mockLoadImages.mockResolvedValue(rehydratedImages);

            const task: QueuedTask = {
                id: 'chat-rehydrate-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Check image', imagesFilePath: '/blobs/chat-rehydrate-2.images.json' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            expect(mockLoadImages).toHaveBeenCalledWith('/blobs/chat-rehydrate-2.images.json');
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns[0].images).toEqual(rehydratedImages);
        });

        it('should not rehydrate when payload already has images', async () => {
            const executor = new CLITaskExecutor(store);
            const existingImages = ['data:image/png;base64,existing'];

            const task: QueuedTask = {
                id: 'chat-rehydrate-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Already has images', images: existingImages, imagesFilePath: '/blobs/chat-rehydrate-3.images.json' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            expect(mockLoadImages).not.toHaveBeenCalled();
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns[0].images).toEqual(existingImages);
        });

        it('should not call loadImages when no imagesFilePath is set', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-rehydrate-4',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'No images at all' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            expect(mockLoadImages).not.toHaveBeenCalled();
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns[0].images).toBeUndefined();
        });

        it('should handle empty result from loadImages gracefully', async () => {
            const executor = new CLITaskExecutor(store);
            mockLoadImages.mockResolvedValue([]);

            const task: QueuedTask = {
                id: 'chat-rehydrate-5',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Blob file missing', images: [], imagesFilePath: '/blobs/chat-rehydrate-5.images.json' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            expect(mockLoadImages).toHaveBeenCalled();
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            // Empty array from loadImages → no images on the turn
            expect(addedProcess.conversationTurns[0].images).toBeUndefined();
        });
    });

    // ========================================================================
    // Autopilot Chat Tasks with Context Files
    // ========================================================================

    describe('autopilot chat tasks with context files', () => {
        it('should execute an autopilot chat task with context file path', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: '',
                    context: { files: ['/nonexistent/prompt.md'] },
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

        it('should execute an autopilot chat task with prompt directly', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6b',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Analyze codebase for vulnerabilities.',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Analyze codebase for vulnerabilities.'),
                workingDirectory: '/my/workspace',
            }));
        });

        it('should prefer promptContent over promptFilePath', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6c',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Direct prompt text.',
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

        it('should prepend planFilePath and additionalContext as structured context block', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6d',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Refactor the auth module.',
                    context: { files: ['', '/workspace/plan.md'], blocks: [{ label: 'context', content: 'Focus on tests.' }] },
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            // Uses shared buildFollowPromptText with promptContent style (empty promptFile)
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Refactor the auth module. /workspace/plan.md\n\nAdditional context: Focus on tests.'),
            }));
        });

        // ====================================================================
        // Follow-prompt context support
        // ====================================================================

        describe('chat context files support', () => {
            it('should prepend additionalContext as structured context block', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-1',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: 'Implement the feature described above.',
                        context: { files: [''], blocks: [{ label: 'context', content: '# Task: Add login page\n\nCreate a login page with email and password fields.' }] },
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Implement the feature described above.\n\nAdditional context: # Task: Add login page\n\nCreate a login page with email and password fields.'),
                }));
            });

            it('should use path reference style with planFilePath content when no additionalContext', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-2',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: 'Execute this plan. /workspace/plan.md',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // New style: promptContent + planFilePath reference (no context block)
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Execute this plan. /workspace/plan.md'),
                }));
            });

            it('should use promptContent style with planFilePath and additionalContext', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-3',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: 'Execute plan with focus.',
                        context: { files: ['', '/workspace/plan.md'], blocks: [{ label: 'context', content: 'Focus on error handling.' }] },
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // Uses shared buildFollowPromptText: promptContent style + planFilePath + additionalContext
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Execute plan with focus. /workspace/plan.md\n\nAdditional context: Focus on error handling.'),
                }));
            });

            it('should not alter prompt when no context fields are provided', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-4',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: 'Analyze codebase for vulnerabilities.',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Analyze codebase for vulnerabilities.'),
                }));
            });

            it('should append planFilePath even when file does not exist', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-5',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: 'Do something. /nonexistent/plan.md',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // New style: planFilePath is appended as path reference regardless of existence
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Do something. /nonexistent/plan.md'),
                }));
            });

            it('should prepend context when using promptFilePath fallback', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-6',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: '',
                        context: { files: ['/nonexistent/prompt.md'], blocks: [{ label: 'context', content: 'Task context here.' }] },
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // Uses shared buildFollowPromptText: promptFilePath style + additionalContext
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Follow the instruction /nonexistent/prompt.md.\n\nAdditional context: Task context here.'),
                }));
            });

            it('should use VS Code extension style prompt with planFilePath and no additionalContext', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);

                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    if (String(p) === '/workspace/.github/skills/impl/SKILL.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-new-style-1',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: '',
                        context: { files: ['/workspace/.github/skills/impl/SKILL.md', '/workspace/data/repos/abc/tasks/my-task.plan.md'] },
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Follow the instruction /workspace/.github/skills/impl/SKILL.md. /workspace/data/repos/abc/tasks/my-task.plan.md'),
                    workingDirectory: '/workspace',
                }));

                existsSyncMock.mockReset();
            });

            it('should use skill promptContent + planFilePath when no additionalContext', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-new-style-2',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: 'Use the impl skill. /workspace/data/repos/abc/tasks/my-task.plan.md',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Use the impl skill. /workspace/data/repos/abc/tasks/my-task.plan.md'),
                    workingDirectory: '/workspace',
                }));
            });

            it('should include planFilePath in prompt when promptFilePath exists and no additionalContext (SPA flow)', async () => {
                // This test verifies the end-to-end flow when the SPA correctly constructs
                // promptFilePath as rootPath + relativePath (e.g., /workspace/.github/prompts/impl.prompt.md)
                const existsSyncMock = vi.mocked(fs.existsSync);

                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    if (String(p) === '/workspace/.github/prompts/impl.prompt.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-spa-prompt',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: '',
                        context: { files: ['/workspace/.github/prompts/impl.prompt.md', '/workspace/data/repos/abc/tasks/coc/e2e-repo-tests/013-document-groups.md'] },
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // Should use the new-style format: "Follow the instruction {promptFilePath}. {planFilePath}"
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Follow the instruction /workspace/.github/prompts/impl.prompt.md. /workspace/data/repos/abc/tasks/coc/e2e-repo-tests/013-document-groups.md'),
                    workingDirectory: '/workspace',
                }));

                existsSyncMock.mockReset();
            });

            it('should include planFilePath even when promptFilePath has wrong path', async () => {
                // Previously this was a regression test documenting a bug where wrong paths
                // dropped the plan file. Now buildFollowPromptText always includes both paths.
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-wrong-path',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: '',
                        context: { files: ['/workspace/.vscode/workflows/.github/prompts/impl.prompt.md', '/workspace/data/repos/abc/tasks/my-task.md'] },
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // Uses shared buildFollowPromptText: always references both files
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Follow the instruction /workspace/.vscode/workflows/.github/prompts/impl.prompt.md. /workspace/data/repos/abc/tasks/my-task.md'),
                }));
            });

            it('should use VS Code extension style even with additionalContext and planFilePath', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-new-style-3',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: '',
                        context: { files: ['/workspace/.github/skills/impl/SKILL.md', '/workspace/plan.md'], blocks: [{ label: 'context', content: 'Legacy context from old client.' }] },
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // Uses shared buildFollowPromptText: file-path style + additional context
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Follow the instruction /workspace/.github/skills/impl/SKILL.md. /workspace/plan.md'),
                }));
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Additional context: Legacy context from old client.'),
                }));
            });
        });

        // ====================================================================
        // CONTEXT.md auto-attachment
        // ====================================================================

        describe('CONTEXT.md auto-attachment', () => {
            it('should append CONTEXT.md reference for new-style prompt (promptFilePath + planFilePath)', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    const s = String(p).replace(/\\/g, '/');
                    if (s === '/workspace/.github/prompts/impl.prompt.md') return true;
                    if (s === '/workspace/data/repos/abc/tasks/feature/CONTEXT.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);
                const task: QueuedTask = {
                    id: 'task-ctx-md-1',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: '',
                        context: { files: ['/workspace/.github/prompts/impl.prompt.md', '/workspace/data/repos/abc/tasks/feature/plan.md'] },
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);
                expect(result.success).toBe(true);
                const prompt = mockSendMessage.mock.calls[0][0].prompt;
                expect(prompt).toContain('See context details in /workspace/data/repos/abc/tasks/feature/CONTEXT.md');
                existsSyncMock.mockReset();
            });

            it('should append CONTEXT.md reference for skill-type prompt (promptContent + planFilePath)', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    const s = String(p).replace(/\\/g, '/');
                    if (s === '/workspace/data/repos/abc/tasks/coc/CONTEXT.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);
                const task: QueuedTask = {
                    id: 'task-ctx-md-2',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: 'Use the impl skill.',
                        context: { files: ['', '/workspace/data/repos/abc/tasks/coc/task.md'] },
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);
                expect(result.success).toBe(true);
                const prompt = mockSendMessage.mock.calls[0][0].prompt;
                expect(prompt).toContain('Use the impl skill.');
                expect(prompt).toContain('See context details in /workspace/data/repos/abc/tasks/coc/CONTEXT.md');
                existsSyncMock.mockReset();
            });

            it('should not append CONTEXT.md reference when file does not exist', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    const s = String(p).replace(/\\/g, '/');
                    if (s === '/workspace/.github/prompts/review.prompt.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);
                const task: QueuedTask = {
                    id: 'task-ctx-md-3',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: '',
                        context: { files: ['/workspace/.github/prompts/review.prompt.md', '/workspace/data/repos/abc/tasks/feature/plan.md'] },
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);
                expect(result.success).toBe(true);
                const prompt = mockSendMessage.mock.calls[0][0].prompt;
                expect(prompt).not.toContain('CONTEXT.md');
                existsSyncMock.mockReset();
            });

            it('should not duplicate CONTEXT.md if additionalContext is already present', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                const readFileSyncMock = vi.mocked(fs.readFileSync);
                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    const s = String(p).replace(/\\/g, '/');
                    if (s === '/workspace/.github/skills/impl/SKILL.md') return true;
                    if (s === '/workspace/plan.md') return true;
                    if (s === '/workspace/CONTEXT.md') return true;
                    return false;
                });
                readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                    if (String(p).replace(/\\/g, '/') === '/workspace/plan.md') return '# Plan content';
                    throw new Error('not found');
                });

                const executor = new CLITaskExecutor(store);
                const task: QueuedTask = {
                    id: 'task-ctx-md-4',
                    type: 'chat',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'chat' as const,
                        mode: 'autopilot',
                        prompt: '',
                        context: { files: ['/workspace/.github/skills/impl/SKILL.md', '/workspace/plan.md'], blocks: [{ label: 'context', content: 'Already provided context.' }] },
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);
                expect(result.success).toBe(true);
                const prompt = mockSendMessage.mock.calls[0][0].prompt;
                expect(prompt).toContain('Already provided context.');
                expect(prompt).toContain('See context details in /workspace/CONTEXT.md');
                existsSyncMock.mockReset();
                readFileSyncMock.mockReset();
            });
        });
    });

    // ========================================================================
    // Skill content injection
    // ========================================================================

    describe('skill content injection', () => {
        it('should emit skill reference for autopilot chat with skills context', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-skill-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Use the impl skill.',
                    context: { skills: ['impl'] },
                    workingDirectory: '/my/workspace',
                },
                config: {},
                displayName: 'Skill: impl',
            };

            await executor.execute(task);

            expect(mockResolveSkillSync).not.toHaveBeenCalled();
            const sentPrompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(sentPrompt).toContain('Use impl skill when available');
            expect(sentPrompt).toContain('[Task]\nUse the impl skill.');
        });

        it('should emit skill reference for ask-mode chat with skills context', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-skill-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'ask',
                    prompt: 'Clarify this code',
                    context: { skills: ['review'] },
                    workingDirectory: '/my/workspace',
                },
                config: {},
                displayName: 'Skill: review',
            };

            await executor.execute(task);

            expect(mockResolveSkillSync).not.toHaveBeenCalled();
            const sentPrompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(sentPrompt).toContain('Use review skill when available');
            expect(sentPrompt).toContain('[Task]');
            expect(sentPrompt).toContain('Clarify this code');
        });

        it('should not apply skill wrapping when skillName is not set', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-skill-4',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Normal prompt without skill.',
                    workingDirectory: '/my/workspace',
                },
                config: {},
                displayName: 'Normal task',
            };

            await executor.execute(task);

            expect(mockResolveSkillSync).not.toHaveBeenCalled();
            const sentPrompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(sentPrompt).toContain('Normal prompt without skill.');
        });

        it('should store skill reference as fullPrompt in process', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-skill-5',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Do the thing.',
                    context: { skills: ['impl'] },
                    workingDirectory: '/my/workspace',
                },
                config: {},
                displayName: 'Skill: impl',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.fullPrompt).toContain('Use impl skill when available');
            expect(addedProcess.fullPrompt).toContain('[Task]\nDo the thing.');
        });

        it('should support multiple skillNames array', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-skill-multi',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'analyze the auth module',
                    context: { skills: ['go-deep', 'impl'] },
                },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const sentPrompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(sentPrompt).toContain('Use go-deep skill when available');
            expect(sentPrompt).toContain('Use impl skill when available');
            expect(sentPrompt).toContain('[Task]\nanalyze the auth module');
        });

        it('should prefer skillNames over skillName when both present', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-skill-precedence',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Do something.',
                    context: { skills: ['new-skill-a', 'new-skill-b'] },
                    workingDirectory: '/my/workspace',
                },
                config: {},
                displayName: 'Skill test',
            };

            await executor.execute(task);

            const sentPrompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(sentPrompt).toContain('Use new-skill-a skill when available');
            expect(sentPrompt).toContain('Use new-skill-b skill when available');
            expect(sentPrompt).not.toContain('Use old-skill skill when available');
        });

        it('should fall back to skillName when skillNames is empty', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-skill-fallback',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Do something.',
                    context: { skills: ['fallback-skill'] },
                    workingDirectory: '/my/workspace',
                },
                config: {},
                displayName: 'Skill test',
            };

            await executor.execute(task);

            const sentPrompt = mockSendMessage.mock.calls[0][0].prompt;
            expect(sentPrompt).toContain('Use fallback-skill skill when available');
        });
    });

    // ========================================================================
    // Task Generation — enriched prompt written to store
    // ========================================================================

    describe('task-generation prompt store update', () => {
        beforeEach(() => {
            mockGatherFeatureContext.mockResolvedValue({
                description: 'Feature description',
                planContent: 'Plan content',
                specContent: 'Spec content',
                relatedFiles: [],
            });
        });

        afterEach(() => {
            mockGatherFeatureContext.mockReset();
        });

        it('should update process store with enriched prompt for deep mode', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-deep',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Add retry logic',
                    workingDirectory: '/workspace',
                    context: { taskGeneration: { mode: 'from-feature', depth: 'deep' } },
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-deep';
            const process = await store.getProcess(processId);
            // The enriched prompt should contain go-deep prefix
            expect(process?.fullPrompt).toContain('Use go-deep skill when available');
            // The enriched prompt should contain the user ask
            expect(process?.fullPrompt).toContain('Add retry logic');
            // The initial conversation turn should also be updated
            expect(process?.conversationTurns?.[0]?.content).toContain('Use go-deep skill when available');
            // The prompt preview should be updated (not the raw prompt)
            expect(process?.promptPreview).not.toBe('Add retry logic');
        });

        it('should update process store with enriched prompt for normal mode', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-normal',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Add retry logic',
                    workingDirectory: '/workspace',
                    context: { taskGeneration: { mode: 'from-feature', depth: 'normal' } },
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-normal';
            const process = await store.getProcess(processId);
            // Normal mode should NOT contain go-deep prefix
            expect(process?.fullPrompt).not.toContain('Use go-deep skill when available');
            // But should contain the enriched content (feature context)
            expect(process?.fullPrompt).toContain('Add retry logic');
            expect(process?.fullPrompt).toContain('Output Location Requirement');
            // The initial conversation turn should also be updated
            expect(process?.conversationTurns?.[0]?.content).toContain('Output Location Requirement');
        });

        it('should update process store for simple task generation (no from-feature)', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-simple',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Create a new test file',
                    workingDirectory: '/workspace',
                    workspaceId: 'ws-test-gen',
                    context: { taskGeneration: {} },
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-simple';
            const process = await store.getProcess(processId);
            // Enriched prompt should differ from the raw user text
            expect(process?.fullPrompt).toContain('Create a new test file');
            // Should have output location directive (uses resolver-determined path)
            expect(process?.fullPrompt).toMatch(/repos[/\\]/);
            // Conversation turn updated
            expect(process?.conversationTurns?.[0]?.content).toBe(process?.fullPrompt);
        });

        it('should apply go-deep prefix for non-from-feature task with depth=deep', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-create-deep',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Add retry logic to API calls',
                    workingDirectory: '/workspace',
                    context: { taskGeneration: { name: 'retry-logic', depth: 'deep' } },
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-create-deep';
            const process = await store.getProcess(processId);
            // Should contain go-deep prefix even without from-feature mode
            expect(process?.fullPrompt).toContain('Use go-deep skill when available');
            // Should still contain the user prompt
            expect(process?.fullPrompt).toContain('Add retry logic to API calls');
            // Conversation turn should also be updated
            expect(process?.conversationTurns?.[0]?.content).toContain('Use go-deep skill when available');
        });

        it('should NOT apply go-deep prefix for non-from-feature task without depth=deep', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-create-normal',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Add retry logic to API calls',
                    workingDirectory: '/workspace',
                    context: { taskGeneration: { name: 'retry-logic' } },
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-create-normal';
            const process = await store.getProcess(processId);
            // Should NOT contain go-deep prefix
            expect(process?.fullPrompt).not.toContain('Use go-deep skill when available');
            // Should still contain the user prompt
            expect(process?.fullPrompt).toContain('Add retry logic to API calls');
        });

        it('should not double-prefix go-deep when from-feature + deep', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-from-feature-deep-no-dupe',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Add retry logic',
                    workingDirectory: '/workspace',
                    context: { taskGeneration: { mode: 'from-feature', depth: 'deep' } },
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-from-feature-deep-no-dupe';
            const process = await store.getProcess(processId);
            // Should contain go-deep prefix exactly once
            const matches = process?.fullPrompt?.match(/Use go-deep skill when available/g);
            expect(matches).toHaveLength(1);
        });
    });

    // ========================================================================
    // No-op / Plan-Mode Chat Tasks
    // ========================================================================

    describe('no-op task types', () => {
        it('should execute plan-mode code-review chat task via AI', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-7',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'plan', prompt: 'Code review' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalled();
        });

        it('should execute resolve-comments tasks via AI (no longer no-op)', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-8',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'resolve prompt',
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'file:///test.md', commentIds: ['c1'], documentContent: 'doc content', filePath: 'test.md' } },
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalled();
            expect(result.result).toMatchObject({
                commentIds: ['c1'],
            });
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('not available');

            // Verify process was marked as failed
            expect(store.updateProcess).toHaveBeenCalledWith('queue_task-err-1', expect.objectContaining({
                status: 'failed',
                error: expect.stringContaining('not available'),
            }));
            expect(store.emitProcessComplete).toHaveBeenCalledWith(
                'queue_task-err-1',
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            expect(mockSendMessage).not.toHaveBeenCalled();
        });

        it('cancelProcess should abort SDK session and mark task cancelled', async () => {
            const mockAbortSession = vi.fn().mockResolvedValue(true);
            const aiService = { ...sdkMocks.service, abortSession: mockAbortSession };
            const executor = new CLITaskExecutor(store, { aiService: aiService as any });

            // Seed the store with a process that has an sdkSessionId
            store.getProcess.mockResolvedValue({
                id: 'queue_task-cp-1',
                type: 'chat',
                status: 'running',
                sdkSessionId: 'sdk-session-abc',
                startTime: new Date(),
                promptPreview: 'test',
            } as any);

            await executor.cancelProcess('queue_task-cp-1');

            // Should add task-cp-1 to cancelledTasks (via replace('queue_', ''))
            // and should call abortSession with the sdkSessionId
            expect(mockAbortSession).toHaveBeenCalledWith('sdk-session-abc');
        });

        it('cancelProcess should be a no-op when process has no sdkSessionId', async () => {
            const mockAbortSession = vi.fn().mockResolvedValue(true);
            const aiService = { ...sdkMocks.service, abortSession: mockAbortSession };
            const executor = new CLITaskExecutor(store, { aiService: aiService as any });

            store.getProcess.mockResolvedValue({
                id: 'queue_task-cp-2',
                type: 'chat',
                status: 'running',
                startTime: new Date(),
                promptPreview: 'test',
            } as any);

            await executor.cancelProcess('queue_task-cp-2');

            expect(mockAbortSession).not.toHaveBeenCalled();
        });

        it('should not overwrite cancelled status with completed after execution', async () => {
            // Simulate: process is cancelled while AI is running
            // Store reports 'cancelled' by the time execution finishes
            let callCount = 0;
            store.getProcess.mockImplementation(async () => {
                callCount++;
                return {
                    id: 'queue_task-guard-1',
                    type: 'chat',
                    status: 'cancelled',
                    startTime: new Date(),
                    promptPreview: 'test',
                    conversationTurns: [],
                } as any;
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-guard-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            // updateProcess should NOT have been called with status 'completed'
            const completedCall = (store.updateProcess as any).mock.calls.find(
                (c: any[]) => c[1]?.status === 'completed'
            );
            expect(completedCall).toBeUndefined();
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
                type: 'chat',
                priority: 'high',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Analyze this' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.metadata).toEqual({
                type: 'chat',
                queueTaskId: 'task-meta-1',
                priority: 'high',
                model: undefined,
                mode: 'ask',
                workflowName: undefined,
            });
        });

        it('should store model in process metadata when provided in config', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-model',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: { model: 'claude-sonnet-4-5' },
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.metadata?.model).toBe('claude-sonnet-4-5');
        });

        it('should store workingDirectory on process from ask-mode chat payload', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-cwd',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test', workingDirectory: '/my/project' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/my/project');
        });

        it('should store workingDirectory on process from autopilot chat with context files payload', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-cwd-fp',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'autopilot', prompt: '', context: { files: ['/path/to/prompt.md'] }, workingDirectory: '/workspace/root' },
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test', workingDirectory: '/project' },
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: longPrompt },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.promptPreview.length).toBeLessThanOrEqual(80);
            expect(addedProcess.promptPreview).toContain('...');
            expect(addedProcess.fullPrompt).toContain(longPrompt);
        });

        it('should link processId to task', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            expect(task.processId).toBe('queue_task-meta-3');
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                onPermissionRequest: undefined,
            }));
        });
    });

    // ========================================================================
    // Resolve Comments Chat Tasks
    // ========================================================================

    describe('resolve-comments chat tasks', () => {
        it('should execute a resolve-comments task and return revisedContent with commentIds', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: '# Revised Document\n\nFixed content.',
                sessionId: 'session-resolve-1',
            });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: '# Document Revision Request\n\nRevise this document.',
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'feature/task.md', commentIds: ['comment-a', 'comment-b'], documentContent: '# Original Document\n\nOld content.', filePath: 'feature/task.md' } },
                    workingDirectory: '/workspace',
                },
                config: { timeoutMs: 60000 },
                displayName: 'Resolve comments: feature/task.md',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(result.result).toEqual({
                revisedContent: '# Revised Document\n\nFixed content.',
                commentIds: ['comment-a', 'comment-b'],
            });
        });

        it('should pass promptTemplate as the AI prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'Custom resolve prompt for testing',
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'task.md', commentIds: ['c1'], documentContent: 'doc content', filePath: 'task.md' } },
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Custom resolve prompt for testing',
            }));
        });

        it('should use workingDirectory from payload', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'test prompt',
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'task.md', commentIds: ['c1'], documentContent: 'doc', filePath: 'task.md' } },
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                workingDirectory: '/my/workspace',
            }));
        });

        it('should fail gracefully when AI service is unavailable', async () => {
            mockIsAvailable.mockResolvedValue({ available: false, error: 'not running' });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-4',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'test prompt',
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'task.md', commentIds: ['c1'], documentContent: 'doc', filePath: 'task.md' } },
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message || String(result.error)).toContain('not running');
        });

        it('should update process store with the prompt preview', async () => {
            const executor = new CLITaskExecutor(store);

            const longPrompt = 'A'.repeat(100);
            const task: QueuedTask = {
                id: 'resolve-5',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: longPrompt,
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'task.md', commentIds: ['c1'], documentContent: 'doc', filePath: 'task.md' } },
                },
                config: {},
            };

            await executor.execute(task);

            // Verify process store was updated with truncated preview
            expect(store.updateProcess).toHaveBeenCalledWith(
                'queue_resolve-5',
                expect.objectContaining({
                    fullPrompt: longPrompt,
                    promptPreview: 'Resolve 1 comment(s) in task.md',
                })
            );
        });

        it('should pass resolve_comment tool to sendMessage', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-tool-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'resolve prompt',
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'task.md', commentIds: ['c1', 'c2'], documentContent: 'doc', filePath: 'task.md' } },
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    tools: expect.arrayContaining([
                        expect.objectContaining({ name: 'resolve_comment' }),
                    ]),
                })
            );
        });

        it('should return only tool-resolved comment IDs when tool is called', async () => {
            // Mock sendMessage to invoke the resolve_comment tool handler
            mockSendMessage.mockImplementation(async (opts: any) => {
                // Simulate AI calling the resolve_comment tool for only one comment
                if (opts.tools?.length) {
                    const resolveTool = opts.tools.find((t: any) => t.name === 'resolve_comment');
                    if (resolveTool) {
                        resolveTool.handler(
                            { commentId: 'c1', summary: 'fixed typo' },
                            { sessionId: 's1', toolCallId: 'tc1', toolName: 'resolve_comment', arguments: {} }
                        );
                    }
                }
                return { success: true, response: 'revised doc', sessionId: 'sess-1' };
            });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-tool-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'resolve prompt',
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'task.md', commentIds: ['c1', 'c2'], documentContent: 'doc', filePath: 'task.md' } },
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            // Only c1 was resolved via tool, c2 was not
            expect(result.result).toEqual({ revisedContent: 'revised doc', commentIds: ['c1'] });
        });

        it('should fall back to all comment IDs when tool is not called', async () => {
            // Standard mock: AI responds without calling tools
            mockSendMessage.mockResolvedValue({
                success: true,
                response: 'revised doc',
                sessionId: 'sess-2',
            });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-tool-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'resolve prompt',
                    tools: ['resolve-comments'],
                    context: { resolveComments: { documentUri: 'task.md', commentIds: ['c1', 'c2', 'c3'], documentContent: 'doc', filePath: 'task.md' } },
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            // Fallback: all IDs returned
            expect(result.result).toEqual({ revisedContent: 'revised doc', commentIds: ['c1', 'c2', 'c3'] });
        });
    });
});

// ============================================================================
// executeFollowUp Tests
// ============================================================================

describe('CLITaskExecutor.executeFollowUp', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'Follow-up response',
            sessionId: 'sess-follow',
        });
    });

    it('should throw for missing process', async () => {
        const executor = new CLITaskExecutor(store);
        await expect(executor.executeFollowUp('nonexistent', 'msg')).rejects.toThrow('Process not found: nonexistent');
    });

    it('should throw for process without sdkSessionId', async () => {
        const process: AIProcess = {
            id: 'proc-1',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await expect(executor.executeFollowUp('proc-1', 'msg')).rejects.toThrow('Process proc-1 has no SDK session');
    });

    it('should append assistant turn and set status to completed on success', async () => {
        const process: AIProcess = {
            id: 'proc-2',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-123',
            workingDirectory: '/workspace/shortcuts',
            conversationTurns: [
                { role: 'user', content: 'initial question', timestamp: new Date(), turnIndex: 0 , timeline: [] },
            ],
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-2', 'follow up');

        expect(mockSendFollowUp).toHaveBeenCalledWith('sess-123', expect.stringContaining('follow up'), expect.objectContaining({
            workingDirectory: '/workspace/shortcuts',
            onPermissionRequest: expect.any(Function),
            onStreamingChunk: expect.any(Function),
        }));

        // Verify the process was updated with assistant turn
        const updated = await store.getProcess('proc-2');
        expect(updated?.status).toBe('completed');
        expect(updated?.conversationTurns).toHaveLength(2);
        expect(updated?.conversationTurns![1].role).toBe('assistant');
        expect(updated?.conversationTurns![1].content).toBe('Follow-up response');
        expect(store.emitProcessComplete).toHaveBeenCalledWith('proc-2', 'completed', expect.stringMatching(/\d+ms/));
    });

    it('should append error turn and set status to failed on failure', async () => {
        mockSendFollowUp.mockResolvedValue({
            success: false,
            error: 'Session expired',
        });

        const process: AIProcess = {
            id: 'proc-3',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-456',
            conversationTurns: [],
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-3', 'follow up');

        const updated = await store.getProcess('proc-3');
        expect(updated?.status).toBe('failed');
        expect(updated?.conversationTurns).toHaveLength(1);
        expect(updated?.conversationTurns![0].role).toBe('assistant');
        expect(updated?.conversationTurns![0].content).toContain('Error:');
        expect(store.emitProcessComplete).toHaveBeenCalledWith('proc-3', 'failed', expect.stringMatching(/\d+ms/));
    });

    it('should stream chunks via store.emitProcessOutput', async () => {
        mockSendFollowUp.mockImplementation(async (_sessionId: string, _prompt: string, options?: any) => {
            // Simulate streaming chunks
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('chunk1');
                options.onStreamingChunk('chunk2');
            }
            return { success: true, response: 'chunk1chunk2', sessionId: 'sess-stream' };
        });

        const process: AIProcess = {
            id: 'proc-4',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-789',
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-4', 'stream test');

        // Verify streaming chunks were emitted
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-4', 'chunk1');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-4', 'chunk2');
    });
});

// ============================================================================
// Follow-Up Chat Conversation Scenario Tests
// ============================================================================

describe('executeFollowUp - chat conversation scenarios', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should accumulate turns across 3 sequential follow-ups', async () => {
        const process = createCompletedProcessWithSession('proc-multi', 'sess-multi', [
            { role: 'user', content: 'Question 1', timestamp: new Date(), turnIndex: 0 , timeline: [] },
            { role: 'assistant', content: 'Reply 1', timestamp: new Date(), turnIndex: 1 , timeline: [] },
        ]);
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'Reply 2' });
        const executor = new CLITaskExecutor(store);

        // Follow-up 1
        await executor.executeFollowUp('proc-multi', 'Question 2');

        // Simulate api-handler adding user turn before 2nd follow-up
        const after1 = await store.getProcess('proc-multi');
        await store.updateProcess('proc-multi', {
            conversationTurns: [
                ...after1!.conversationTurns!,
                { role: 'user', content: 'Question 3', timestamp: new Date(), turnIndex: after1!.conversationTurns!.length , timeline: [] },
            ],
        });

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'Reply 3' });
        // Follow-up 2
        await executor.executeFollowUp('proc-multi', 'Question 3');

        // Simulate api-handler adding user turn before 3rd follow-up
        const after2 = await store.getProcess('proc-multi');
        await store.updateProcess('proc-multi', {
            conversationTurns: [
                ...after2!.conversationTurns!,
                { role: 'user', content: 'Question 4', timestamp: new Date(), turnIndex: after2!.conversationTurns!.length , timeline: [] },
            ],
        });

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'Reply 4' });
        // Follow-up 3
        await executor.executeFollowUp('proc-multi', 'Question 4');

        const final = await store.getProcess('proc-multi');
        // 2 initial + 3 assistant + 2 manually-added user = 7
        expect(final!.conversationTurns!.length).toBeGreaterThanOrEqual(5);

        // Last 3 assistant turns have role 'assistant'
        const assistantTurns = final!.conversationTurns!.filter(t => t.role === 'assistant');
        expect(assistantTurns.length).toBeGreaterThanOrEqual(4); // original Reply 1 + 3 follow-up replies

        // Each assistant turn's turnIndex equals its position
        for (let i = 0; i < final!.conversationTurns!.length; i++) {
            expect(final!.conversationTurns![i].turnIndex).toBe(i);
        }

        expect(mockSendFollowUp).toHaveBeenCalledTimes(3);
        expect(mockSendFollowUp).toHaveBeenCalledWith('sess-multi', expect.any(String), expect.any(Object));
    });

    it('should use "(No text response)" fallback when SDK returns empty response', async () => {
        const process = createCompletedProcessWithSession('proc-empty', 'sess-empty');
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: '' });
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-empty', 'What happened?');

        const updated = await store.getProcess('proc-empty');
        expect(updated!.conversationTurns).toHaveLength(3); // 2 initial + 1 assistant
        expect(updated!.conversationTurns![2].content).toBe('(No text response)');
        expect(updated!.status).toBe('completed');
        // Empty string is falsy → result: undefined
        expect(store.updateProcess).toHaveBeenCalledWith('proc-empty', expect.objectContaining({
            result: undefined,
        }));
    });

    it('should append error turn when sendFollowUp throws (session expired)', async () => {
        const process = createCompletedProcessWithSession('proc-dying', 'sess-dying');
        await store.addProcess(process);

        mockSendFollowUp.mockRejectedValue(new Error('Session expired: connection reset'));
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-dying', 'Are you still there?');

        const updated = await store.getProcess('proc-dying');
        expect(updated!.status).toBe('failed');
        expect(updated!.error).toBe('Session expired: connection reset');
        expect(updated!.conversationTurns![2].role).toBe('assistant');
        expect(updated!.conversationTurns![2].content).toContain('Error: Session expired: connection reset');
        expect(store.emitProcessComplete).toHaveBeenCalledWith('proc-dying', 'failed', expect.stringMatching(/\d+ms/));
    });

    it('should concatenate streaming chunks in output buffer', async () => {
        const process = createCompletedProcessWithSession('proc-chunks', 'sess-chunks');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('Hello');
                options.onStreamingChunk(' ');
                options.onStreamingChunk('world');
                options.onStreamingChunk('!');
            }
            return { success: true, response: 'Hello world!' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-chunks', 'stream it');

        expect(store.emitProcessOutput).toHaveBeenCalledTimes(4);
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-chunks', 'Hello');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-chunks', ' ');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-chunks', 'world');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-chunks', '!');

        // Verify output chunks recorded in store
        const outputChunks = store.outputs.get('proc-chunks');
        expect(outputChunks).toEqual(['Hello', ' ', 'world', '!']);
    });

    it('should handle concurrent follow-ups on the same process without data corruption', async () => {
        const process = createCompletedProcessWithSession('proc-concurrent', 'sess-concurrent');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string) => {
            await new Promise(r => setTimeout(r, 10));
            return { success: true, response: 'concurrent reply' };
        });

        const executor = new CLITaskExecutor(store);
        const [resultA, resultB] = await Promise.allSettled([
            executor.executeFollowUp('proc-concurrent', 'msg A'),
            executor.executeFollowUp('proc-concurrent', 'msg B'),
        ]);

        expect(resultA.status).toBe('fulfilled');
        expect(resultB.status).toBe('fulfilled');
        expect(mockSendFollowUp).toHaveBeenCalledTimes(2);

        const final = await store.getProcess('proc-concurrent');
        expect(final!.status).toBe('completed');
        // At least 3: 2 initial + at least 1 assistant turn
        expect(final!.conversationTurns!.length).toBeGreaterThanOrEqual(3);
        expect(store.emitProcessComplete).toHaveBeenCalledTimes(2);
    });

    it('should handle a very long follow-up message without truncation', async () => {
        const process = createCompletedProcessWithSession('proc-large', 'sess-large');
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'ack' });
        const executor = new CLITaskExecutor(store);
        const longMsg = 'x'.repeat(100_000);
        await executor.executeFollowUp('proc-large', longMsg);

        expect(mockSendFollowUp).toHaveBeenCalledWith('sess-large', expect.stringContaining(longMsg), expect.any(Object));
        const updated = await store.getProcess('proc-large');
        expect(updated!.status).toBe('completed');
    });

    it('should transition process status to completed on successful follow-up', async () => {
        const process = createCompletedProcessWithSession('proc-status-ok', 'sess-status-ok');
        process.status = 'running';
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'done' });
        const executor = new CLITaskExecutor(store);

        const before = await store.getProcess('proc-status-ok');
        expect(before!.status).toBe('running');

        await executor.executeFollowUp('proc-status-ok', 'finish up');

        const after = await store.getProcess('proc-status-ok');
        expect(after!.status).toBe('completed');
        expect(after!.endTime).toBeDefined();
        expect(after!.result).toBe('done');
    });

    it('should transition process status to failed on follow-up error', async () => {
        const process = createCompletedProcessWithSession('proc-status-fail', 'sess-status-fail');
        process.status = 'running';
        await store.addProcess(process);

        mockSendFollowUp.mockRejectedValue(new Error('SDK crash'));
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-status-fail', 'bad request');

        const after = await store.getProcess('proc-status-fail');
        expect(after!.status).toBe('failed');
        expect(after!.endTime).toBeDefined();
        expect(after!.error).toBe('SDK crash');
        expect(after!.conversationTurns!.at(-1)!.content).toContain('Error: SDK crash');
    });

    it('should clean up outputBuffers map after follow-up (success and failure)', async () => {
        const proc1 = createCompletedProcessWithSession('proc-cleanup-ok', 'sess-cleanup-ok');
        const proc2 = createCompletedProcessWithSession('proc-cleanup-fail', 'sess-cleanup-fail');
        await store.addProcess(proc1);
        await store.addProcess(proc2);

        // First follow-up succeeds with streaming
        mockSendFollowUp.mockImplementationOnce(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('old-data');
            }
            return { success: true, response: 'ok' };
        });
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-cleanup-ok', 'first call');

        // Second follow-up fails
        mockSendFollowUp.mockRejectedValueOnce(new Error('boom'));
        await executor.executeFollowUp('proc-cleanup-fail', 'fail call');

        // Verify buffer cleanup: a subsequent follow-up starts fresh
        mockSendFollowUp.mockImplementationOnce(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('new-chunk');
            }
            return { success: true, response: 'fresh' };
        });
        // Reset output tracking to isolate the 3rd call
        store.outputs.clear();
        await executor.executeFollowUp('proc-cleanup-ok', 'second call');

        // Only 'new-chunk' should be present — no leftover 'old-data'
        const chunks = store.outputs.get('proc-cleanup-ok');
        expect(chunks).toEqual(['new-chunk']);
    });

    it('should handle follow-up when conversationTurns is empty array', async () => {
        const process = createCompletedProcessWithSession('proc-empty-turns', 'sess-empty-turns', []);
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'first reply' });
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-empty-turns', 'hello');

        const updated = await store.getProcess('proc-empty-turns');
        expect(updated!.conversationTurns).toHaveLength(1);
        expect(updated!.conversationTurns![0]).toMatchObject({
            role: 'assistant',
            content: 'first reply',
            turnIndex: 0,
            timeline: [],
        });
    });

    it('should handle follow-up when conversationTurns is undefined', async () => {
        const process: AIProcess = {
            id: 'proc-undef-turns',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-undef-turns',
        };
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'reply' });
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-undef-turns', 'hi');

        const updated = await store.getProcess('proc-undef-turns');
        expect(updated!.conversationTurns).toHaveLength(1);
        expect(updated!.conversationTurns![0].turnIndex).toBe(0);
    });
});

// ============================================================================
// Session Tracking and Conversation Turns Tests
// ============================================================================

describe('session tracking and conversation turns', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'sdk-session-abc',
        });
    });

    it('should store sdkSessionId on the process after successful execution', async () => {
        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-session-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test prompt' },
            config: { timeoutMs: 30000 },
        };
        await executor.execute(task);

        const processId = `queue_${task.id}`;
        const process = store.processes.get(processId);
        expect(process?.sdkSessionId).toBe('sdk-session-abc');
    });

    it('should populate initial conversationTurns with user + assistant pair', async () => {
        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-session-2',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'What is X?' },
            config: { timeoutMs: 30000 },
        };
        await executor.execute(task);

        const processId = `queue_${task.id}`;
        const process = store.processes.get(processId);
        expect(process?.conversationTurns).toHaveLength(2);

        const [userTurn, assistantTurn] = process!.conversationTurns!;
        expect(userTurn.role).toBe('user');
        expect(userTurn.content).toContain('What is X?');
        expect(userTurn.turnIndex).toBe(0);

        expect(assistantTurn.role).toBe('assistant');
        expect(assistantTurn.content).toBe('AI response');
        expect(assistantTurn.turnIndex).toBe(1);
    });

    it('should pass keepAlive: true to sendMessage', async () => {
        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-session-3',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: { timeoutMs: 30000 },
        };
        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ keepAlive: true })
        );
    });

    it('should append turns at correct indices on follow-up', async () => {
        // Setup: process with 2 existing turns
        const processId = 'proc-followup-turns';
        const process: AIProcess = {
            id: processId,
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-existing',
            conversationTurns: [
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0 , timeline: [] },
                { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1 , timeline: [] },
            ],
        };
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'follow-up reply',
            sessionId: 'sess-existing',
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp(processId, 'What about Y?');

        const updated = store.processes.get(processId);
        // Existing 2 turns + 1 assistant turn appended (user turn is added by api-handler)
        expect(updated?.conversationTurns).toHaveLength(3);
        expect(updated?.conversationTurns![2].role).toBe('assistant');
        expect(updated?.conversationTurns![2].content).toBe('follow-up reply');
        expect(updated?.conversationTurns![2].turnIndex).toBe(2);
    });

    it('should throw if process has no sdkSessionId', async () => {
        const process: AIProcess = {
            id: 'proc-no-session',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await expect(executor.executeFollowUp('proc-no-session', 'hi'))
            .rejects.toThrow('no SDK session');
    });

    it('should report session expired when SDK cannot resume the persisted session', async () => {
        const process: AIProcess = {
            id: 'proc-expired-session',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-missing-after-restart',
            workingDirectory: '/workspace/repo',
        };
        await store.addProcess(process);

        mockCanResumeSession.mockResolvedValueOnce(false);

        const executor = new CLITaskExecutor(store);
        await expect(executor.isSessionAlive('proc-expired-session')).resolves.toBe(false);
        expect(mockCanResumeSession).toHaveBeenCalledWith('sess-missing-after-restart', expect.objectContaining({
            workingDirectory: '/workspace/repo',
            onPermissionRequest: expect.any(Function),
        }));
    });

    it('should treat persisted session as alive when SDK can resume it', async () => {
        const process: AIProcess = {
            id: 'proc-resumable-session',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-resumable',
            workingDirectory: '/workspace/repo',
        };
        await store.addProcess(process);

        mockCanResumeSession.mockResolvedValueOnce(true);

        const executor = new CLITaskExecutor(store);
        await expect(executor.isSessionAlive('proc-resumable-session')).resolves.toBe(true);
    });
});

// ============================================================================
// Conversation History Persistence (Page Refresh Resilience)
// ============================================================================

describe('conversation history persistence during streaming', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should store initial user turn when task starts executing (before AI call)', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'sess-1',
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-persist-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Explain this code' },
            config: {},
        };

        await executor.execute(task);

        // Verify addProcess was called with conversationTurns containing the user turn
        const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
        expect(addedProcess.conversationTurns).toBeDefined();
        expect(addedProcess.conversationTurns).toHaveLength(1);
        expect(addedProcess.conversationTurns![0].role).toBe('user');
        expect(addedProcess.conversationTurns![0].content).toContain('Explain this code');
        expect(addedProcess.conversationTurns![0].turnIndex).toBe(0);
    });

    it('should have user turn available in store during streaming (before completion)', async () => {
        let storedDuringStreaming: AIProcess | undefined;

        mockSendMessage.mockImplementation(async (opts: any) => {
            // During streaming, check what's in the store
            storedDuringStreaming = await store.getProcess('queue_task-during-stream');
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('streaming...');
            }
            return { success: true, response: 'done', sessionId: 'sess-2' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-during-stream',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'What is X?' },
            config: {},
        };

        await executor.execute(task);

        // The user turn should have been in the store during streaming
        expect(storedDuringStreaming).toBeDefined();
        expect(storedDuringStreaming!.conversationTurns).toBeDefined();
        expect(storedDuringStreaming!.conversationTurns).toHaveLength(1);
        expect(storedDuringStreaming!.conversationTurns![0].role).toBe('user');
        expect(storedDuringStreaming!.conversationTurns![0].content).toContain('What is X?');
    });

    it('should have both user and assistant turns after completion', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'The answer is Y',
            sessionId: 'sess-3',
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-complete-turns',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'What is X?' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-complete-turns');
        expect(process).toBeDefined();
        expect(process!.conversationTurns).toHaveLength(2);
        expect(process!.conversationTurns![0].role).toBe('user');
        expect(process!.conversationTurns![0].content).toContain('What is X?');
        expect(process!.conversationTurns![1].role).toBe('assistant');
        expect(process!.conversationTurns![1].content).toBe('The answer is Y');
    });

    it('should preserve conversation turns on task failure', async () => {
        mockSendMessage.mockRejectedValue(new Error('AI crashed'));

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-fail-turns',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Analyze this' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-fail-turns');
        expect(process).toBeDefined();
        expect(process!.status).toBe('failed');
        // Should still have the user turn
        expect(process!.conversationTurns).toBeDefined();
        expect(process!.conversationTurns!.length).toBeGreaterThanOrEqual(1);
        expect(process!.conversationTurns![0].role).toBe('user');
        expect(process!.conversationTurns![0].content).toContain('Analyze this');
    });

    it('should create assistant turn with streaming=true on first chunk', async () => {
        const process = createCompletedProcessWithSession('proc-first-chunk', 'sess-first-chunk');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('first chunk');
            }
            return { success: true, response: 'first chunk' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-first-chunk', 'test');

        // Verify updateProcess was called with a streaming assistant turn
        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(1);
        const firstFlush = streamingFlushCalls[0][1];
        const assistantTurn = firstFlush.conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming === true
        );
        expect(assistantTurn.content).toBe('first chunk');
    });

    it('should flush every 50 chunks', async () => {
        const process = createCompletedProcessWithSession('proc-50chunks', 'sess-50chunks');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 150; i++) {
                    options.onStreamingChunk(`c${i} `);
                }
            }
            return { success: true, response: 'all chunks' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-50chunks', 'test');

        // Count streaming flushes (updateProcess calls with streaming: true turns)
        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // 3 streaming flushes: first chunk (time-based), chunk 51 (count), chunk 101 (count)
        expect(streamingFlushCalls.length).toBe(3);

        // Final completion call should have streaming=undefined
        const completionCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.status === 'completed';
        });
        expect(completionCalls.length).toBeGreaterThanOrEqual(1);
        const finalTurns = completionCalls[completionCalls.length - 1][1].conversationTurns;
        const finalAssistant = finalTurns?.find((t: any) => t.role === 'assistant');
        expect(finalAssistant?.streaming).toBeUndefined();
    });

    it('should flush every 5 seconds', async () => {
        vi.useFakeTimers();

        const process = createCompletedProcessWithSession('proc-5sec', 'sess-5sec');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 10; i++) {
                    options.onStreamingChunk(`c${i} `);
                    await vi.advanceTimersByTimeAsync(1000);
                }
            }
            return { success: true, response: 'all 10' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-5sec', 'test');

        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // First chunk triggers time-based flush (lastFlushTime=0),
        // then ~5 seconds later another time-based flush
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(2);

        // Verify content grows between flushes
        const firstContent = streamingFlushCalls[0][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        ).content;
        const lastContent = streamingFlushCalls[streamingFlushCalls.length - 1][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        ).content;
        expect(lastContent.length).toBeGreaterThan(firstContent.length);

        vi.useRealTimers();
    });

    it('should update existing streaming turn on subsequent flushes', async () => {
        const process = createCompletedProcessWithSession('proc-update-turn', 'sess-update-turn');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 100; i++) {
                    options.onStreamingChunk(`c${i} `);
                }
            }
            return { success: true, response: 'done' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-update-turn', 'test');

        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // At least 2 streaming flushes (first chunk + count-based at 51)
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(2);

        // Verify later flushes have more content than earlier ones
        const firstContent = streamingFlushCalls[0][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        ).content;
        const lastContent = streamingFlushCalls[streamingFlushCalls.length - 1][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        ).content;
        expect(lastContent.length).toBeGreaterThan(firstContent.length);
    });

    it('should set streaming=false on completion', async () => {
        const process = createCompletedProcessWithSession('proc-complete-flag', 'sess-complete-flag');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 30; i++) {
                    options.onStreamingChunk(`c${i} `);
                }
            }
            return { success: true, response: 'final response' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-complete-flag', 'test');

        const updated = await store.getProcess('proc-complete-flag');
        const lastTurn = updated!.conversationTurns![updated!.conversationTurns!.length - 1];
        expect(lastTurn.role).toBe('assistant');
        expect(lastTurn.streaming).toBeUndefined();
        expect(lastTurn.content).toBe('final response');
    });

    it('should handle store.updateProcess errors gracefully during flush', async () => {
        const process = createCompletedProcessWithSession('proc-flush-error', 'sess-flush-error');
        await store.addProcess(process);

        (store.updateProcess as any).mockImplementation(async (id: string, updates: any) => {
            // Fail streaming flushes, succeed for completion updates
            if (updates.conversationTurns?.some((t: any) => t.streaming === true)) {
                throw new Error('Store write failed');
            }
            const existing = store.processes.get(id);
            if (existing) {
                store.processes.set(id, { ...existing, ...updates });
            }
        });

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 150; i++) {
                    options.onStreamingChunk(`c${i} `);
                }
            }
            return { success: true, response: 'completed despite errors' };
        });

        const executor = new CLITaskExecutor(store);
        // Should not throw despite flush errors
        await executor.executeFollowUp('proc-flush-error', 'test');

        const updated = await store.getProcess('proc-flush-error');
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('completed');
    });

    it('should clean up throttle state after completion', async () => {
        const process = createCompletedProcessWithSession('proc-cleanup', 'sess-cleanup');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('chunk');
            }
            return { success: true, response: 'done' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-cleanup', 'first');

        // Execute a second follow-up — should work cleanly with no stale throttle state
        await executor.executeFollowUp('proc-cleanup', 'second');

        const updated = await store.getProcess('proc-cleanup');
        expect(updated!.status).toBe('completed');
    });

    it('should clean up throttle state after error', async () => {
        const process = createCompletedProcessWithSession('proc-cleanup-err', 'sess-cleanup-err');
        await store.addProcess(process);

        let callCount = 0;
        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            callCount++;
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('chunk');
            }
            if (callCount === 1) {
                return { success: false, error: 'AI failed' };
            }
            return { success: true, response: 'recovered' };
        });

        const executor = new CLITaskExecutor(store);
        // First call fails
        await executor.executeFollowUp('proc-cleanup-err', 'fail');

        // Second call should work (throttle state cleaned up after error)
        await executor.executeFollowUp('proc-cleanup-err', 'succeed');

        const updated = await store.getProcess('proc-cleanup-err');
        expect(updated!.status).toBe('completed');
    });
});

// ============================================================================
// Queue Executor Bridge Integration Tests
// ============================================================================

describe('createQueueExecutorBridge', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let queueManager: TaskQueueManager;

    beforeEach(() => {
        store = createMockProcessStore();
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
        const { executor } = createQueueExecutorBridge(queueManager, store);
        expect(executor).toBeInstanceOf(QueueExecutor);
        expect(executor.isRunning()).toBe(true);
        executor.dispose();
    });

    it('should execute enqueued tasks automatically', async () => {
        const { executor } = createQueueExecutorBridge(queueManager, store);

        const taskCompleted = new Promise<void>((resolve) => {
            executor.on('taskCompleted', () => resolve());
        });

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Hello AI' },
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
            expect.stringContaining('queue_'),
            expect.objectContaining({ status: 'completed' })
        );

        executor.dispose();
    });

    it('should handle task failure and populate history', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Model overloaded',
        });

        const { executor } = createQueueExecutorBridge(queueManager, store);

        const taskFailed = new Promise<void>((resolve) => {
            executor.on('taskFailed', () => resolve());
        });

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
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
        const { executor } = createQueueExecutorBridge(queueManager, store, {
            maxConcurrency: 1,
        });

        const completedTasks: string[] = [];

        executor.on('taskCompleted', (task: QueuedTask) => {
            completedTasks.push(task.displayName || task.id);
        });

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Task A' },
            config: {},
            displayName: 'A',
        });

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Task B' },
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

        const { executor } = createQueueExecutorBridge(queueManager, store, {
            maxConcurrency: 1,
        });

        const executionOrder: string[] = [];
        mockSendMessage.mockImplementation(async (opts: any) => {
            executionOrder.push(opts.prompt);
            return { success: true, response: 'ok' };
        });

        // Enqueue low priority first, then high
        queueManager.enqueue({
            type: 'chat',
            priority: 'low',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'low-task' },
            config: {},
        });

        queueManager.enqueue({
            type: 'chat',
            priority: 'high',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'high-task' },
            config: {},
        });

        // Resume and wait
        queueManager.resume();
        await delay(500);

        // High priority should execute first
        expect(executionOrder[0]).toContain('high-task');
        expect(executionOrder[1]).toContain('low-task');

        executor.dispose();
    });

    it('should not start when autoStart is false', () => {
        const { executor } = createQueueExecutorBridge(queueManager, store, {
            autoStart: false,
        });

        expect(executor.isRunning()).toBe(false);
        executor.dispose();
    });

    it('should stop processing when paused', async () => {
        const { executor } = createQueueExecutorBridge(queueManager, store);

        // Pause the queue
        queueManager.pause();

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
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

        const { executor } = createQueueExecutorBridge(queueManager, store);

        const taskId = queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'long task' },
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

    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
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
        const failingStore = createMockProcessStore();
        (failingStore.addProcess as any).mockRejectedValue(new Error('Store error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        // Should still succeed (store errors are non-fatal)
        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should handle store update errors gracefully on success', async () => {
        const failingStore = createMockProcessStore();
        (failingStore.updateProcess as any).mockRejectedValue(new Error('Update error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err-2',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should handle store update errors gracefully on failure', async () => {
        mockSendMessage.mockResolvedValue({ success: false, error: 'AI error' });

        const failingStore = createMockProcessStore();
        (failingStore.updateProcess as any).mockRejectedValue(new Error('Update error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err-3',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(false);
    });

    it('should pass onStreamingChunk to sendMessage for AI tasks', async () => {
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Stream me' },
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
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Stream test' },
            config: {},
        };

        await executor.execute(task);

        // Verify chunks were emitted to the store
        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-stream-2', 'Hello ');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-stream-2', 'world!');
        expect(store.outputs.get('queue_task-stream-2')).toEqual(['Hello ', 'world!']);
    });

    it('should handle store.emitProcessOutput errors gracefully during streaming', async () => {
        // Make emitProcessOutput throw
        const failingStore = createMockProcessStore();
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
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        // Should not throw — store errors in streaming are non-fatal
        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should emit streaming chunks for autopilot chat tasks', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('autopilot chunk');
            }
            return { success: true, response: 'autopilot response' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-custom',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Custom task' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-stream-custom', 'autopilot chunk');
    });

    it('should emit streaming chunks for autopilot chat tasks with context files', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('follow chunk');
            }
            return { success: true, response: 'follow response' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-follow',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: '', context: { files: ['/nonexistent/file.md'] } },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-stream-follow', 'follow chunk');
    });

    it('should use default working directory from options', async () => {
        const executor = new CLITaskExecutor(store, { workingDirectory: '/default/dir' });

        const task: QueuedTask = {
            id: 'task-wd',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
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
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test', workingDirectory: '/task/dir' },
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test output' },
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(true);

            // Verify output file was written with concatenated chunks
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue_task-output-1.md');
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            // Check that updateProcess was called with rawStdoutFilePath
            const path = await import('path');
            const expectedPath = path.join(tmpDir, 'outputs', 'queue_task-output-path.md');
            expect(store.updateProcess).toHaveBeenCalledWith('queue_task-output-path', {
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(false);

            // Verify partial output was still saved
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue_task-output-fail.md');
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            // Verify streaming chunks were emitted to store (SSE/WS)
            expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-output-sse', 'chunk-a');
            expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-output-sse', 'chunk-b');

            // And also verify file was written
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue_task-output-sse.md');
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
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
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, mode: 'plan', prompt: 'Code review' },
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

// ============================================================================
// Tool Event Emission Tests
// ============================================================================

describe('tool event emission via onToolEvent', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should pass onToolEvent callback to sendMessage', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            // Verify onToolEvent is provided
            expect(typeof opts.onToolEvent).toBe('function');
            return { success: true, response: 'done', sessionId: 'sess-1' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-event',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            onToolEvent: expect.any(Function),
        }));
    });

    it('should emit tool-start events to store.emitProcessEvent', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-1',
                    toolName: 'view',
                    parameters: { path: '/test.ts' },
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-2' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-start',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-tool-start', {
            type: 'tool-start',
            toolCallId: 'tc-1',
            toolName: 'view',
            parameters: { path: '/test.ts' },
            result: undefined,
            error: undefined,
        });
    });

    it('should emit tool-complete events to store.emitProcessEvent', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-2',
                    toolName: 'bash',
                    result: 'command output',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-3' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-complete',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-tool-complete', {
            type: 'tool-complete',
            toolCallId: 'tc-2',
            toolName: 'bash',
            parameters: undefined,
            result: 'command output',
            error: undefined,
        });
    });

    it('should preserve parentToolCallId for nested subagent events', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-parent',
                    toolName: 'task',
                    parameters: { agent_type: 'explore' },
                });
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-child',
                    toolName: 'glob',
                    parentToolCallId: 'tc-parent',
                    parameters: { glob_pattern: '**/*.ts' },
                });
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-child',
                    toolName: 'glob',
                    parentToolCallId: 'tc-parent',
                    result: 'a.ts\nb.ts',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-parent' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-parent-tool',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-parent-tool', expect.objectContaining({
            type: 'tool-start',
            toolCallId: 'tc-child',
            parentToolCallId: 'tc-parent',
        }));
        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-parent-tool', expect.objectContaining({
            type: 'tool-complete',
            toolCallId: 'tc-child',
            parentToolCallId: 'tc-parent',
        }));
    });

    it('should emit tool-failed events to store.emitProcessEvent', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-failed',
                    toolCallId: 'tc-3',
                    toolName: 'edit',
                    error: 'Permission denied',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-4' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-failed',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-tool-failed', {
            type: 'tool-failed',
            toolCallId: 'tc-3',
            toolName: 'edit',
            parameters: undefined,
            result: undefined,
            error: 'Permission denied',
        });
    });

    it('should handle store.emitProcessEvent errors gracefully', async () => {
        const failingStore = createMockProcessStore();
        (failingStore.emitProcessEvent as any).mockImplementation(() => {
            throw new Error('Event emit error');
        });

        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-err',
                    toolName: 'grep',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-5' };
        });

        const executor = new CLITaskExecutor(failingStore);
        const task: QueuedTask = {
            id: 'task-tool-err',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        // Should not throw despite emitProcessEvent failing
        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should emit tool events for follow-up messages', async () => {
        store = createMockProcessStore({
            initialProcesses: [createCompletedProcessWithSession('proc-tool-follow', 'sess-follow')],
        });

        mockSendFollowUp.mockImplementation(async (_sessionId: string, _prompt: string, options?: any) => {
            if (options?.onToolEvent) {
                options.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-follow-1',
                    toolName: 'view',
                    parameters: { path: '/file.ts' },
                });
                options.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-follow-1',
                    toolName: 'view',
                    result: 'file contents',
                });
            }
            return { success: true, response: 'follow-up done', sessionId: 'sess-follow' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-tool-follow', 'follow-up message');

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(2);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-tool-follow', expect.objectContaining({
            type: 'tool-start',
            toolCallId: 'tc-follow-1',
            toolName: 'view',
        }));
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-tool-follow', expect.objectContaining({
            type: 'tool-complete',
            toolCallId: 'tc-follow-1',
            result: 'file contents',
        }));
    });

    it('should emit multiple tool events in sequence', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-a', toolName: 'view' });
                opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-a', result: 'ok' });
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-b', toolName: 'bash' });
                opts.onToolEvent({ type: 'tool-failed', toolCallId: 'tc-b', error: 'timeout' });
            }
            return { success: true, response: 'done', sessionId: 'sess-multi' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-multi-tool',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(4);
    });

    it('should persist assistant turn with timeline during tool-only execution (no text chunks)', async () => {
        // Simulate a task that only emits tool events (no onStreamingChunk calls)
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                // Emit enough tool events to trigger a throttled flush (first call triggers due to lastFlushTime=0)
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-read-1', toolName: 'view', parameters: { path: '/a.ts' } });
                opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-read-1', toolName: 'view', result: 'file contents' });
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-edit-1', toolName: 'edit', parameters: { path: '/a.ts' } });
                opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-edit-1', toolName: 'edit', result: 'ok' });
            }
            // No onStreamingChunk called — pure tool execution
            return { success: true, response: '', sessionId: 'sess-tool-only' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-only-flush',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'refactor this file' },
            config: {},
        };

        await executor.execute(task);

        // The intermediate flush should have persisted an assistant turn with timeline
        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // At least one streaming flush should have occurred from tool events
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(1);

        // The flushed assistant turn should have timeline items even with empty content
        const firstFlush = streamingFlushCalls[0][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        );
        expect(firstFlush).toBeDefined();
        expect(firstFlush.content).toBe('');
        expect(firstFlush.timeline.length).toBeGreaterThan(0);
        expect(firstFlush.timeline.some((item: any) => item.type === 'tool-start' || item.type === 'tool-complete')).toBe(true);

        // Final completion should also have timeline
        const finalProcess = await store.getProcess('queue_task-tool-only-flush');
        expect(finalProcess).toBeDefined();
        const assistantTurn = finalProcess!.conversationTurns?.find((t: any) => t.role === 'assistant' && !t.streaming);
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn!.timeline!.length).toBeGreaterThan(0);
    });

    it('should flush conversation turn when buffer is empty string but timeline has items', async () => {
        // Test follow-up path: only tool events, no streaming chunks
        const process = createCompletedProcessWithSession('proc-tool-flush', 'sess-tool-flush');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onToolEvent) {
                options.onToolEvent({ type: 'tool-start', toolCallId: 'tc-f1', toolName: 'bash', parameters: { cmd: 'npm test' } });
                options.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-f1', toolName: 'bash', result: 'all passed' });
            }
            // No onStreamingChunk — pure tool execution
            return { success: true, response: '' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-tool-flush', 'run tests');

        // Verify intermediate streaming flush happened with timeline
        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(1);

        // The flushed turn should have timeline items
        const flushedTurn = streamingFlushCalls[0][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        );
        expect(flushedTurn).toBeDefined();
        expect(flushedTurn.timeline.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// Conversation Persistence Mid-Stream (Integration-style)
// ============================================================================

describe('conversation persistence mid-stream', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should persist conversation state mid-stream and restore on server restart', async () => {
        vi.useFakeTimers();

        const process = createCompletedProcessWithSession('proc-restart', 'sess-restart');
        await store.addProcess(process);

        let chunksSent = 0;
        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                // Emit 6 chunks with 500ms gaps (3 seconds total)
                for (let i = 0; i < 6; i++) {
                    options.onStreamingChunk(`chunk${i} `);
                    chunksSent++;
                    await vi.advanceTimersByTimeAsync(500);
                }
            }
            return { success: true, response: 'chunk0 chunk1 chunk2 chunk3 chunk4 chunk5 ' };
        });

        const executor1 = new CLITaskExecutor(store);
        await executor1.executeFollowUp('proc-restart', 'start streaming');

        // Verify that streaming content was flushed to the store during streaming
        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // At least one streaming flush should have occurred during the 3 seconds
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(1);

        // The flushed content should include chunk data
        const flushedTurns = streamingFlushCalls[0][1].conversationTurns;
        const streamingTurn = flushedTurns.find((t: any) => t.role === 'assistant' && t.streaming);
        expect(streamingTurn.content).toContain('chunk0');

        // Simulate "server restart": read persisted state from same store with new executor
        const executor2 = new CLITaskExecutor(store);
        const persisted = await store.getProcess('proc-restart');
        expect(persisted).toBeDefined();
        expect(persisted!.conversationTurns).toBeDefined();

        // Final state should have the complete response (first executor completed)
        const finalAssistant = persisted!.conversationTurns!.find(t => t.role === 'assistant');
        expect(finalAssistant).toBeDefined();
        expect(finalAssistant!.streaming).toBeUndefined();

        // New executor should be functional
        expect(await executor2.isSessionAlive('proc-restart')).toBeDefined();

        vi.useRealTimers();
    });
});

// ============================================================================
// Timeline Population Tests
// ============================================================================

describe('timeline population during execution', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should initialize timeline as empty array on new process', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'done',
            sessionId: 'sess-tl-init',
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-init',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test prompt' },
            config: {},
        };

        await executor.execute(task);

        // User turn should have empty timeline
        const process = await store.getProcess('queue_task-tl-init');
        expect(process).toBeDefined();
        const userTurn = process!.conversationTurns!.find(t => t.role === 'user');
        expect(userTurn).toBeDefined();
        expect(userTurn!.timeline).toEqual([]);
    });

    it('should append content chunks to assistant turn timeline', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('Hello ');
                opts.onStreamingChunk('world');
            }
            return { success: true, response: 'Hello world', sessionId: 'sess-tl-content' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-content',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-content');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        // Consecutive content chunks are merged during flush
        expect(assistantTurn!.timeline.length).toBe(1);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('Hello world');
    });

    it('should merge consecutive content chunks into single timeline item', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('Hello ');
                opts.onStreamingChunk('beautiful ');
                opts.onStreamingChunk('world');
            }
            return { success: true, response: 'Hello beautiful world', sessionId: 'sess-tl-merge' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-merge',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-merge');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn!.timeline.length).toBe(1);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('Hello beautiful world');
    });

    it('should not merge content across tool event boundaries', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) opts.onStreamingChunk('before ');
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-bnd-1', toolName: 'grep' });
            }
            if (opts.onStreamingChunk) opts.onStreamingChunk('after');
            return { success: true, response: 'before after', sessionId: 'sess-tl-bnd' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-bnd',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-bnd');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        // content → tool-start → content = 3 items (tool breaks merge)
        expect(assistantTurn!.timeline.length).toBe(3);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('before ');
        expect(assistantTurn!.timeline[1].type).toBe('tool-start');
        expect(assistantTurn!.timeline[2].type).toBe('content');
        expect(assistantTurn!.timeline[2].content).toBe('after');
    });

    it('should preserve first timestamp when merging content items', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('first ');
                opts.onStreamingChunk('second');
            }
            return { success: true, response: 'first second', sessionId: 'sess-tl-tstamp' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-tstamp',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-tstamp');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn!.timeline.length).toBe(1);
        // Timestamp should be a valid Date (the first chunk's timestamp)
        expect(assistantTurn!.timeline[0].timestamp).toBeInstanceOf(Date);
    });

    it('should handle complex merge boundaries with multiple tool types', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            // content → content → tool-start → tool-complete → content → content
            if (opts.onStreamingChunk) opts.onStreamingChunk('a');
            if (opts.onStreamingChunk) opts.onStreamingChunk('b');
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-cx-1', toolName: 'view' });
                opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-cx-1', toolName: 'view', result: 'ok' });
            }
            if (opts.onStreamingChunk) opts.onStreamingChunk('c');
            if (opts.onStreamingChunk) opts.onStreamingChunk('d');
            return { success: true, response: 'abcd', sessionId: 'sess-tl-cx' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-cx',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-cx');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        // merged-content('ab') → tool-start → tool-complete → merged-content('cd')
        expect(assistantTurn!.timeline.length).toBe(4);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('ab');
        expect(assistantTurn!.timeline[1].type).toBe('tool-start');
        expect(assistantTurn!.timeline[2].type).toBe('tool-complete');
        expect(assistantTurn!.timeline[3].type).toBe('content');
        expect(assistantTurn!.timeline[3].content).toBe('cd');
    });

    it('should append tool events to assistant turn timeline', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-tl-1',
                    toolName: 'view',
                    parameters: { path: '/test.ts' },
                });
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-tl-1',
                    toolName: 'view',
                    result: 'file contents',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-tl-tool' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-tool',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-tool');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.timeline.length).toBe(2);
        expect(assistantTurn!.timeline[0].type).toBe('tool-start');
        expect(assistantTurn!.timeline[0].toolCall).toBeDefined();
        expect(assistantTurn!.timeline[0].toolCall!.name).toBe('view');
        expect(assistantTurn!.timeline[0].toolCall!.id).toBe('tc-tl-1');
        expect(assistantTurn!.timeline[1].type).toBe('tool-complete');
        expect(assistantTurn!.timeline[1].toolCall!.result).toBe('file contents');
    });

    it('should preserve parentToolCallId in timeline tool calls', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-parent',
                    toolName: 'task',
                    parameters: { agent_type: 'explore' },
                });
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-child',
                    toolName: 'glob',
                    parentToolCallId: 'tc-parent',
                    parameters: { glob_pattern: '**/*.ts' },
                });
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-child',
                    toolName: 'glob',
                    parentToolCallId: 'tc-parent',
                    result: 'match',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-tl-parent' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-parent',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-parent');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();

        const childStart = assistantTurn!.timeline.find(
            (item) => item.type === 'tool-start' && item.toolCall?.id === 'tc-child'
        );
        expect(childStart).toBeDefined();
        expect(childStart!.toolCall!.parentToolCallId).toBe('tc-parent');
    });

    it('should append tool-failed events to timeline', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-tl-fail',
                    toolName: 'edit',
                });
                opts.onToolEvent({
                    type: 'tool-failed',
                    toolCallId: 'tc-tl-fail',
                    toolName: 'edit',
                    error: 'Permission denied',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-tl-fail' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-fail',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-fail');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.timeline[1].type).toBe('tool-failed');
        expect(assistantTurn!.timeline[1].toolCall!.error).toBe('Permission denied');
        expect(assistantTurn!.timeline[1].toolCall!.status).toBe('failed');
    });

    it('should have accurate timestamps in chronological order', async () => {
        const timestamps: Date[] = [];
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('chunk1');
            }
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-ts', toolName: 'bash' });
                opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-ts', toolName: 'bash', result: 'ok' });
            }
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('chunk2');
            }
            return { success: true, response: 'chunk1chunk2', sessionId: 'sess-tl-ts' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-ts',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-ts');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.timeline.length).toBe(4);

        // Verify all items have timestamps
        for (const item of assistantTurn!.timeline) {
            expect(item.timestamp).toBeInstanceOf(Date);
        }

        // Verify chronological order (each timestamp >= previous)
        for (let i = 1; i < assistantTurn!.timeline.length; i++) {
            expect(assistantTurn!.timeline[i].timestamp.getTime())
                .toBeGreaterThanOrEqual(assistantTurn!.timeline[i - 1].timestamp.getTime());
        }

        // Verify order: content, tool-start, tool-complete, content
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[1].type).toBe('tool-start');
        expect(assistantTurn!.timeline[2].type).toBe('tool-complete');
        expect(assistantTurn!.timeline[3].type).toBe('content');
    });

    it('should persist timeline via store.updateProcess', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('data');
            }
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-p', toolName: 'grep' });
            }
            return { success: true, response: 'data', sessionId: 'sess-tl-persist' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-persist',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        // Verify updateProcess was called with conversation turns containing timeline
        expect(store.updateProcess).toHaveBeenCalledWith(
            'queue_task-tl-persist',
            expect.objectContaining({
                conversationTurns: expect.arrayContaining([
                    expect.objectContaining({
                        role: 'assistant',
                        timeline: expect.arrayContaining([
                            expect.objectContaining({ type: 'content', content: 'data' }),
                            expect.objectContaining({ type: 'tool-start' }),
                        ]),
                    }),
                ]),
            })
        );
    });

    it('should populate timeline for follow-up messages', async () => {
        const process = createCompletedProcessWithSession('proc-tl-follow', 'sess-tl-follow');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('follow-up text');
            }
            if (options?.onToolEvent) {
                options.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-fu-1',
                    toolName: 'view',
                    parameters: { path: '/src/index.ts' },
                });
                options.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-fu-1',
                    toolName: 'view',
                    result: 'file content',
                });
            }
            return { success: true, response: 'follow-up text', sessionId: 'sess-tl-follow' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-tl-follow', 'follow up question');

        const updated = await store.getProcess('proc-tl-follow');
        const allTurns = updated!.conversationTurns!;
        // The follow-up assistant turn is the last non-streaming assistant turn
        const assistantTurns = allTurns.filter(t => t.role === 'assistant' && !t.streaming);
        const assistantTurn = assistantTurns[assistantTurns.length - 1];
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn!.timeline.length).toBe(3);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('follow-up text');
        expect(assistantTurn!.timeline[1].type).toBe('tool-start');
        expect(assistantTurn!.timeline[1].toolCall!.name).toBe('view');
        expect(assistantTurn!.timeline[2].type).toBe('tool-complete');
    });

    it('should interleave content and tool events in chronological order', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            // Simulate realistic interleaving: content → tool → content → tool → content
            if (opts.onStreamingChunk) opts.onStreamingChunk('Analyzing...');
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-il-1', toolName: 'grep' });
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-il-1', toolName: 'grep', result: 'found' });
            if (opts.onStreamingChunk) opts.onStreamingChunk('Found results. ');
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-il-2', toolName: 'view' });
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-il-2', toolName: 'view', result: 'code' });
            if (opts.onStreamingChunk) opts.onStreamingChunk('Done.');
            return { success: true, response: 'Analyzing...Found results. Done.', sessionId: 'sess-il' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-interleave',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'analyze code' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-interleave');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.timeline.length).toBe(7);

        // Verify interleaved order
        const types = assistantTurn!.timeline.map(t => t.type);
        expect(types).toEqual([
            'content', 'tool-start', 'tool-complete',
            'content', 'tool-start', 'tool-complete',
            'content',
        ]);
    });

    it('should merge consecutive content items but preserve tool boundaries during flush', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            // Simulate: 3 content chunks → tool → 2 content chunks
            if (opts.onStreamingChunk) opts.onStreamingChunk('word1 ');
            if (opts.onStreamingChunk) opts.onStreamingChunk('word2 ');
            if (opts.onStreamingChunk) opts.onStreamingChunk('word3 ');
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-merge', toolName: 'grep' });
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-merge', toolName: 'grep', result: 'ok' });
            if (opts.onStreamingChunk) opts.onStreamingChunk('word4 ');
            if (opts.onStreamingChunk) opts.onStreamingChunk('word5');
            return { success: true, response: 'word1 word2 word3 word4 word5', sessionId: 'sess-merge' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-merge-flush',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test merge' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-merge-flush');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();

        // 3 content chunks merged into 1, tool-start, tool-complete, 2 content chunks merged into 1
        expect(assistantTurn!.timeline.length).toBe(4);
        expect(assistantTurn!.timeline[0]).toMatchObject({ type: 'content', content: 'word1 word2 word3 ' });
        expect(assistantTurn!.timeline[1]).toMatchObject({ type: 'tool-start' });
        expect(assistantTurn!.timeline[2]).toMatchObject({ type: 'tool-complete' });
        expect(assistantTurn!.timeline[3]).toMatchObject({ type: 'content', content: 'word4 word5' });
    });
});

// ============================================================================
// AI Service Injection Tests
// ============================================================================

describe('AI service injection', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        // Reset global mocks
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    it('should use injected aiService when provided', async () => {
        const injectedMock = createMockSDKService({
            sendMessageResponse: {
                success: true,
                response: 'Injected mock response',
                sessionId: 'injected-session-456',
            },
        });

        const executor = new CLITaskExecutor(store, {
            aiService: injectedMock.service as any,
        });

        const task: QueuedTask = {
            id: 'task-injection-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Test injection' },
            config: { timeoutMs: 30000 },
            displayName: 'Test injection',
        };

        const result = await executor.execute(task);

        // Verify the injected mock was called (not the global mock)
        expect(injectedMock.mockIsAvailable).toHaveBeenCalledTimes(1);
        expect(injectedMock.mockSendMessage).toHaveBeenCalledTimes(1);
        expect(injectedMock.mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining('Test injection'),
            })
        );

        // Verify global mock was NOT called
        expect(mockIsAvailable).not.toHaveBeenCalled();
        expect(mockSendMessage).not.toHaveBeenCalled();

        // Verify result contains injected mock's response
        expect(result.success).toBe(true);
        expect((result.result as any).response).toBe('Injected mock response');
        expect((result.result as any).sessionId).toBe('injected-session-456');
    });

    it('should fallback to getCopilotSDKService() when no aiService provided', async () => {
        mockIsAvailable.mockReset().mockResolvedValue({ available: true });
        mockSendMessage.mockReset().mockResolvedValue({
            success: true,
            response: 'Global mock response',
            sessionId: 'global-session-789',
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-fallback-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Test fallback' },
            config: { timeoutMs: 30000 },
            displayName: 'Test fallback',
        };

        const result = await executor.execute(task);

        // Verify the global mock from getCopilotSDKService() was called
        expect(mockIsAvailable).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining('Test fallback'),
            })
        );

        // Verify result contains global mock's response
        expect(result.success).toBe(true);
        expect((result.result as any).response).toBe('Global mock response');
        expect((result.result as any).sessionId).toBe('global-session-789');
    });
});

describe('createQueueExecutorBridge', () => {
    describe('AI service injection', () => {
        it('should pass aiService through createQueueExecutorBridge factory', async () => {
            const queueManager = new TaskQueueManager();
            const store = createMockProcessStore();

            const bridgeMock = createMockSDKService({
                sendMessageResponse: {
                    success: true,
                    response: 'Bridge integration response',
                    sessionId: 'bridge-session-999',
                },
            });

            const { executor, bridge } = createQueueExecutorBridge(queueManager, store, {
                maxConcurrency: 1,
                autoStart: false,
                aiService: bridgeMock.service as any,
            });

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Bridge integration test' },
                config: {},
                displayName: 'Bridge test',
            });

            executor.start();
            await delay(100);

            // Verify the injected service was used
            expect(bridgeMock.mockIsAvailable).toHaveBeenCalledTimes(1);
            expect(bridgeMock.mockSendMessage).toHaveBeenCalledTimes(1);
            expect(bridgeMock.mockSendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: expect.stringContaining('Bridge integration test'),
                })
            );

            // Verify task completed successfully
            await delay(100);
            const history = queueManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0].status).toBe('completed');

            executor.dispose();
        });
    });

    // ========================================================================
    // Run Workflow Tasks
    // ========================================================================

    describe('run-workflow tasks', () => {
        let store: ReturnType<typeof createMockProcessStore>;
        const existsSyncMock = vi.mocked(fs.existsSync);
        const readFileSyncMock = vi.mocked(fs.readFileSync);

        const SIMPLE_JOB_YAML = `name: "Test Job"
job:
  prompt: "Say hello"
`;

        beforeEach(() => {
            store = createMockProcessStore();
            mockSendMessage.mockReset();
            mockIsAvailable.mockReset();
            mockIsAvailable.mockResolvedValue({ available: true });
            mockExecutePipeline.mockReset();
            mockExecuteWorkflow.mockReset();
            mockCompileToWorkflow.mockReset();
            mockFlattenWorkflowResult.mockReset();
            mockCreateCLIAIInvoker.mockReset();
            mockCreateCLIAIInvoker.mockReturnValue(vi.fn());
            // Default: compileToWorkflow returns a minimal config
            mockCompileToWorkflow.mockReturnValue({ name: 'Test Job', nodes: {} });
        });

        it('should execute a run-workflow task successfully', async () => {
            // Mock fs to return pipeline YAML
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) {
                    return SIMPLE_JOB_YAML;
                }
                return '';
            });

            mockExecuteWorkflow.mockResolvedValue({ success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 100 });
            mockFlattenWorkflowResult.mockReturnValue({
                success: true,
                stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 100 },
                items: [],
                leafOutput: [],
                formattedOutput: 'Pipeline result output',
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-run-workflow',
                type: 'run-workflow',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-workflow' as const,
                    workflowPath: '/workspace/.vscode/workflows/my-pipeline',
                    workingDirectory: '/workspace',
                },
                config: {},
                displayName: 'Run Workflow: my-pipeline',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockExecuteWorkflow).toHaveBeenCalledOnce();
            expect(mockCreateCLIAIInvoker).toHaveBeenCalledOnce();
            // Verify the pipeline result is returned
            expect(result.result).toEqual(expect.objectContaining({
                pipelineName: 'Test Job',
                response: 'Pipeline result output',
            }));
        });

        it('should apply model override from payload', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) {
                    return SIMPLE_JOB_YAML;
                }
                return '';
            });

            mockExecuteWorkflow.mockResolvedValue({ success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 });
            mockFlattenWorkflowResult.mockReturnValue({
                success: true,
                stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                items: [],
                leafOutput: [],
                formattedOutput: 'result',
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-model-override',
                type: 'run-workflow',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-workflow' as const,
                    workflowPath: '/workspace/.vscode/workflows/test',
                    workingDirectory: '/workspace',
                    model: 'gpt-4',
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockCreateCLIAIInvoker).toHaveBeenCalledWith(expect.objectContaining({
                model: 'gpt-4',
            }));
        });

        it('should handle workflow execution failure', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) {
                    return SIMPLE_JOB_YAML;
                }
                return '';
            });

            mockExecuteWorkflow.mockRejectedValue(new Error('Workflow execution failed'));

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-workflow-fail',
                type: 'run-workflow',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-workflow' as const,
                    workflowPath: '/workspace/.vscode/workflows/failing',
                    workingDirectory: '/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('Workflow execution failed');
        });

        it('should extract prompt as workflow basename', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) {
                    return SIMPLE_JOB_YAML;
                }
                return '';
            });

            mockExecuteWorkflow.mockResolvedValue({ success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 });
            mockFlattenWorkflowResult.mockReturnValue({
                success: true,
                stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                items: [],
                leafOutput: [],
                formattedOutput: 'done',
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-prompt-extract',
                type: 'run-workflow',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-workflow' as const,
                    workflowPath: '/workspace/.vscode/workflows/my-named-pipeline',
                    workingDirectory: '/workspace',
                },
                config: {},
            };

            await executor.execute(task);

            // Verify the process was added with the correct prompt
            expect(store.addProcess).toHaveBeenCalledWith(expect.objectContaining({
                fullPrompt: 'Run workflow: my-named-pipeline',
                promptPreview: 'Run workflow: my-named-pipeline',
            }));
        });

        it('should forward mcpServers from payload to createCLIAIInvoker', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) { return SIMPLE_JOB_YAML; }
                return '';
            });
            mockExecuteWorkflow.mockResolvedValue({ success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 });
            mockFlattenWorkflowResult.mockReturnValue({
                success: true,
                stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                items: [],
                leafOutput: [],
                formattedOutput: 'done',
            });

            const mcpServers = {
                serverA: { command: 'npx', args: ['-y', 'serverA'] },
            };

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-mcp-forward',
                type: 'run-workflow',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-workflow' as const,
                    workflowPath: '/workspace/.vscode/workflows/mcp-pipe',
                    workingDirectory: '/workspace',
                    mcpServers,
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockCreateCLIAIInvoker).toHaveBeenCalledWith(expect.objectContaining({
                mcpServers,
            }));
        });

        it('should not set mcpServers on createCLIAIInvoker when payload.mcpServers is undefined', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) { return SIMPLE_JOB_YAML; }
                return '';
            });
            mockExecuteWorkflow.mockResolvedValue({ success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 });
            mockFlattenWorkflowResult.mockReturnValue({
                success: true,
                stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                items: [],
                leafOutput: [],
                formattedOutput: 'done',
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-mcp-undefined',
                type: 'run-workflow',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-workflow' as const,
                    workflowPath: '/workspace/.vscode/workflows/no-mcp',
                    workingDirectory: '/workspace',
                    // mcpServers intentionally omitted
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockCreateCLIAIInvoker).toHaveBeenCalledWith(expect.objectContaining({
                mcpServers: undefined,
            }));
        });

        it('persists executionStats to process metadata after workflow execution', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) { return SIMPLE_JOB_YAML; }
                return '';
            });

            const executionStats = {
                totalItems: 3,
                successfulMaps: 3,
                failedMaps: 0,
                mapPhaseTimeMs: 5000,
                reducePhaseTimeMs: 0,
                maxConcurrency: 1,
            };
            mockExecuteWorkflow.mockResolvedValue({ success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 5000 });
            mockFlattenWorkflowResult.mockReturnValue({
                success: true,
                stats: executionStats,
                items: [],
                leafOutput: [],
                formattedOutput: 'done',
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-meta-stats',
                type: 'run-workflow',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-workflow' as const,
                    workflowPath: '/workspace/.vscode/workflows/stats-pipe',
                    workingDirectory: '/workspace',
                },
                config: {},
            };

            await executor.execute(task);

            // Allow the fire-and-forget metadata update to settle
            await new Promise(r => setTimeout(r, 10));

            const processId = `queue_${task.id}`;
            const proc = await store.getProcess(processId);
            expect(proc?.metadata).toEqual(expect.objectContaining({
                executionStats: expect.objectContaining({ totalItems: 3 }),
            }));
        });

        describe('child process wiring via onItemProcessCreated', () => {
            function createWorkflowTask(id: string): QueuedTask {
                return {
                    id,
                    type: 'run-workflow',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        kind: 'run-workflow' as const,
                        workflowPath: '/workspace/.vscode/workflows/child-test',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };
            }

            function setupFsMock() {
                readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                    if (String(p).includes('pipeline.yaml')) { return SIMPLE_JOB_YAML; }
                    return '';
                });
            }

            it('should create child AIProcess records for each map item', async () => {
                setupFsMock();
                const itemProcessIds = ['queue_cp-3items-m0', 'queue_cp-3items-m1', 'queue_cp-3items-m2'];
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    // Simulate 3 map items firing the callback
                    for (let i = 0; i < 3; i++) {
                        opts.onItemProcess?.({
                            itemIndex: i,
                            processId: itemProcessIds[i],
                            itemLabel: `input item ${i}`,
                            nodeId: 'map',
                            status: 'completed',
                        });
                    }
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 100 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 3, successfulItems: 3, failedItems: 0, durationMs: 100 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'done',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-3items'));

                // 3 child processes should be added (plus the parent process from execute())
                const addCalls = store.addProcess.mock.calls.filter(
                    (call: any[]) => call[0].type === 'pipeline-item'
                );
                expect(addCalls).toHaveLength(3);

                for (let i = 0; i < 3; i++) {
                    expect(addCalls[i][0]).toMatchObject({
                        id: itemProcessIds[i],
                        type: 'pipeline-item',
                        parentProcessId: 'queue_cp-3items',
                        status: 'completed',
                    });
                }
            });

            it('should set correct parentProcessId on child processes', async () => {
                setupFsMock();
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    opts.onItemProcess?.({
                        itemIndex: 0,
                        processId: 'queue_cp-parent-m0',
                        itemLabel: 'test input',
                        nodeId: 'map',
                        status: 'completed',
                    });
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'done',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-parent'));

                const childCalls = store.addProcess.mock.calls.filter(
                    (call: any[]) => call[0].type === 'pipeline-item'
                );
                expect(childCalls[0][0].parentProcessId).toBe('queue_cp-parent');
            });

            it('should set type pipeline-item and metadata on child processes', async () => {
                setupFsMock();
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    opts.onItemProcess?.({
                        itemIndex: 2,
                        processId: 'queue_cp-meta-m2',
                        itemLabel: 'some input',
                        nodeId: 'map',
                        status: 'completed',
                    });
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 3, successfulItems: 3, failedItems: 0, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'done',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-meta'));

                const childCalls = store.addProcess.mock.calls.filter(
                    (call: any[]) => call[0].type === 'pipeline-item'
                );
                expect(childCalls[0][0]).toMatchObject({
                    type: 'pipeline-item',
                    metadata: {
                        type: 'pipeline-item',
                        itemIndex: 2,
                        nodeId: 'map',
                        parentPipelineId: 'queue_cp-meta',
                    },
                });
            });

            it('should update parent process with groupMetadata.childProcessIds on completion', async () => {
                setupFsMock();
                const childIds = ['queue_cp-group-m0', 'queue_cp-group-m1'];
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    for (let i = 0; i < 2; i++) {
                        opts.onItemProcess?.({
                            itemIndex: i,
                            processId: childIds[i],
                            itemLabel: `item ${i}`,
                            nodeId: 'map',
                            status: 'completed',
                        });
                    }
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 2, successfulItems: 2, failedItems: 0, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'done',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-group'));

                // Wait for fire-and-forget promises
                await new Promise(r => setTimeout(r, 10));

                const updateCalls = store.updateProcess.mock.calls.filter(
                    (call: any[]) => call[0] === 'queue_cp-group' && call[1].groupMetadata
                );
                expect(updateCalls).toHaveLength(1);
                expect(updateCalls[0][1]).toMatchObject({
                    groupMetadata: {
                        type: 'pipeline-execution',
                        childProcessIds: childIds,
                    },
                });
            });

            it('should emit SSE event per child process creation', async () => {
                setupFsMock();
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    for (let i = 0; i < 2; i++) {
                        opts.onItemProcess?.({
                            itemIndex: i,
                            processId: `queue_cp-sse-m${i}`,
                            itemLabel: `item ${i}`,
                            nodeId: 'map',
                            status: 'completed',
                        });
                    }
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 2, successfulItems: 2, failedItems: 0, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'done',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-sse'));

                const sseCalls = store.emitProcessEvent.mock.calls.filter(
                    (call: any[]) => call[0] === 'queue_cp-sse'
                        && call[1].type === 'pipeline-progress'
                        && call[1].pipelineProgress?.message?.startsWith('Item process created:')
                );
                expect(sseCalls).toHaveLength(2);
                expect(sseCalls[0][1].pipelineProgress.message).toContain('queue_cp-sse-m0');
                expect(sseCalls[1][1].pipelineProgress.message).toContain('queue_cp-sse-m1');
            });

            it('should not crash the pipeline if store.addProcess fails', async () => {
                setupFsMock();
                const originalAddProcess = store.addProcess;
                let callCount = 0;
                store.addProcess = vi.fn(async (process: any) => {
                    callCount++;
                    // Fail on child process adds (pipeline-item type)
                    if (process.type === 'pipeline-item') {
                        throw new Error('Store write failed');
                    }
                    return originalAddProcess(process);
                });

                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    opts.onItemProcess?.({
                        itemIndex: 0,
                        processId: 'queue_cp-fail-m0',
                        itemLabel: 'test',
                        nodeId: 'map',
                        status: 'completed',
                    });
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'pipeline completed',
                });

                const executor = new CLITaskExecutor(store);
                const result = await executor.execute(createWorkflowTask('cp-fail'));

                // Pipeline should succeed despite store failure
                expect(result.success).toBe(true);
                expect((result.result as any).response).toBe('pipeline completed');
            });

            it('should not update parent groupMetadata when no itemProcessIds returned', async () => {
                setupFsMock();
                mockExecuteWorkflow.mockResolvedValue({ success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'done',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-noids'));

                await new Promise(r => setTimeout(r, 10));

                const groupMetadataCalls = store.updateProcess.mock.calls.filter(
                    (call: any[]) => call[1].groupMetadata
                );
                expect(groupMetadataCalls).toHaveLength(0);
            });

            it('should handle object items by JSON-stringifying them', async () => {
                setupFsMock();
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    opts.onItemProcess?.({
                        itemIndex: 0,
                        processId: 'queue_cp-obj-m0',
                        itemLabel: '{"name":"test","value":42}',
                        nodeId: 'map',
                        status: 'completed',
                    });
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'done',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-obj'));

                const childCalls = store.addProcess.mock.calls.filter(
                    (call: any[]) => call[0].type === 'pipeline-item'
                );
                expect(childCalls[0][0].fullPrompt).toBe('{"name":"test","value":42}');
                expect(childCalls[0][0].promptPreview).toBe('{"name":"test","value":42}');
            });

            it('should set failed status and error on failed items', async () => {
                setupFsMock();
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    opts.onItemProcess?.({
                        itemIndex: 0,
                        processId: 'queue_cp-err-m0',
                        itemLabel: 'bad input',
                        nodeId: 'map',
                        status: 'failed',
                        error: 'AI model timeout',
                    });
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 1, successfulItems: 0, failedItems: 1, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'done',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-err'));

                const childCalls = store.addProcess.mock.calls.filter(
                    (call: any[]) => call[0].type === 'pipeline-item'
                );
                expect(childCalls[0][0]).toMatchObject({
                    status: 'failed',
                    error: 'AI model timeout',
                });
            });

            it('should populate fullPrompt and status from onItemProcess event', async () => {
                setupFsMock();
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    opts.onItemProcess?.({
                        itemIndex: 0,
                        processId: 'queue_cp-conv-m0',
                        itemLabel: 'Summarize this document',
                        nodeId: 'map',
                        status: 'completed',
                    });
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: 'Here is the summary.',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-conv'));

                const childCalls = store.addProcess.mock.calls.filter(
                    (call: any[]) => call[0].type === 'pipeline-item'
                );
                const child = childCalls[0][0];
                expect(child.fullPrompt).toBe('Summarize this document');
                expect(child.status).toBe('completed');
            });

            it('should use itemLabel fallback for fullPrompt when itemLabel is provided', async () => {
                setupFsMock();
                mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
                    opts.onItemProcess?.({
                        itemIndex: 0,
                        processId: 'queue_cp-noai-m0',
                        itemLabel: 'bad input',
                        nodeId: 'map',
                        status: 'failed',
                        error: 'timeout',
                    });
                    return { success: true, results: new Map(), leaves: new Map(), tiers: [], totalDurationMs: 50 };
                });
                mockFlattenWorkflowResult.mockReturnValue({
                    success: true,
                    stats: { totalItems: 1, successfulItems: 0, failedItems: 1, durationMs: 50 },
                    items: [],
                    leafOutput: [],
                    formattedOutput: '',
                });

                const executor = new CLITaskExecutor(store);
                await executor.execute(createWorkflowTask('cp-noai'));

                const childCalls = store.addProcess.mock.calls.filter(
                    (call: any[]) => call[0].type === 'pipeline-item'
                );
                const child = childCalls[0][0];
                expect(child.fullPrompt).toBe('bad input');
                expect(child.status).toBe('failed');
                expect(child.error).toBe('timeout');
            });
        });
    });
});

// ============================================================================
// Shared/Exclusive Concurrency Policy
// ============================================================================

describe('defaultIsExclusive', () => {
    it.each([
        { type: 'run-workflow', payload: { kind: 'run-workflow', workflowPath: 'test.yaml', workingDirectory: '/' }, expected: true },
        { type: 'run-script', payload: { kind: 'run-script', script: 'echo test' }, expected: true },
        { type: 'chat', payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' }, expected: true },
        { type: 'chat', payload: { kind: 'chat', mode: 'ask', prompt: 'test' }, expected: false },
        { type: 'chat', payload: { kind: 'chat', mode: 'plan', prompt: 'test' }, expected: false },
    ])('should classify $type (mode=$payload.mode) as exclusive=$expected', ({ type, payload, expected }) => {
        const task = { type, payload } as QueuedTask;
        expect(defaultIsExclusive(task)).toBe(expected);
    });

    it('should classify chat as exclusive when mode is autopilot', () => {
        const task = { type: 'chat', payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' } } as QueuedTask;
        expect(defaultIsExclusive(task)).toBe(true);
    });

    it('should classify chat as non-exclusive when mode is ask', () => {
        const task = { type: 'chat', payload: { kind: 'chat', mode: 'ask', prompt: 'test' } } as QueuedTask;
        expect(defaultIsExclusive(task)).toBe(false);
    });

    it('should classify unknown task types as exclusive', () => {
        const task = { type: 'unknown-future-type', payload: {} } as QueuedTask;
        expect(defaultIsExclusive(task)).toBe(true);
    });
});

describe('createQueueExecutorBridge dual-limiter options', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'sess-dual',
        });
    });

    it('should use defaults (sharedConcurrency=5, exclusiveConcurrency=1) when no options given', () => {
        const queueManager = new TaskQueueManager();
        const { executor } = createQueueExecutorBridge(queueManager, store, {});
        expect(executor.getSharedConcurrency()).toBe(5);
        expect(executor.getExclusiveConcurrency()).toBe(1);
        executor.dispose();
    });

    it('should pass explicit sharedConcurrency and exclusiveConcurrency', () => {
        const queueManager = new TaskQueueManager();
        const { executor } = createQueueExecutorBridge(queueManager, store, {
            sharedConcurrency: 3,
            exclusiveConcurrency: 2,
        });
        expect(executor.getSharedConcurrency()).toBe(3);
        expect(executor.getExclusiveConcurrency()).toBe(2);
        executor.dispose();
    });

    it('should accept a custom isExclusive callback', async () => {
        const queueManager = new TaskQueueManager();
        const customIsExclusive = vi.fn().mockReturnValue(false);
        const { executor } = createQueueExecutorBridge(queueManager, store, {
            isExclusive: customIsExclusive,
            autoStart: false,
        });

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'test' },
            config: {},
            displayName: 'Custom test',
        });

        executor.start();
        await delay(200);

        expect(customIsExclusive).toHaveBeenCalled();
        executor.dispose();
    });

    it('should allow a shared task to start while an exclusive task is running', async () => {
        const queueManager = new TaskQueueManager();

        // Make the exclusive task take 300ms, the shared task finishes quickly
        let exclusiveResolve: () => void;
        const exclusivePromise = new Promise<void>(resolve => { exclusiveResolve = resolve; });
        let callCount = 0;
        mockSendMessage.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                // Exclusive task — slow
                await exclusivePromise;
            }
            return { success: true, response: 'done', sessionId: `sess-${callCount}` };
        });

        const { executor } = createQueueExecutorBridge(queueManager, store, {
            sharedConcurrency: 5,
            exclusiveConcurrency: 1,
        });

        // Enqueue exclusive task first
        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'exclusive task' },
            config: {},
            displayName: 'Exclusive',
        });

        // Wait for it to start processing
        await delay(50);

        // Enqueue shared task
        const sharedCompleted = new Promise<void>(resolve => {
            executor.on('taskCompleted', (task: QueuedTask) => {
                if (task.payload?.mode === 'ask') { resolve(); }
            });
        });
        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'shared task' },
            config: {},
            displayName: 'Shared',
        });

        // The shared task should complete even though exclusive is still running
        await sharedCompleted;

        // Exclusive is still running
        expect(queueManager.getRunning().some(t => t.type === 'chat' && t.payload?.mode === 'autopilot')).toBe(true);

        // Now let the exclusive task finish
        exclusiveResolve!();
        await delay(200);

        executor.dispose();
    });

    it('should allow an ask-mode chat task to start while an exclusive autopilot task is running', async () => {
        const queueManager = new TaskQueueManager();

        // Block the first sendMessage (exclusive task) while allowing shared task to proceed
        let exclusiveResolve: () => void;
        const exclusivePromise = new Promise<void>(resolve => { exclusiveResolve = resolve; });
        let callCount = 0;
        mockSendMessage.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                await exclusivePromise;
            }
            return { success: true, response: 'done', sessionId: `sess-${callCount}` };
        });

        const { executor } = createQueueExecutorBridge(queueManager, store, {
            sharedConcurrency: 5,
            exclusiveConcurrency: 1,
        });

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'exclusive task' },
            config: {},
            displayName: 'Exclusive',
        });

        await delay(50);

        const sharedCompleted = new Promise<void>(resolve => {
            executor.on('taskCompleted', (task: QueuedTask) => {
                if ((task.payload as any)?.mode === 'ask') { resolve(); }
            });
        });
        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'ask-mode shared task' },
            config: {},
            displayName: 'Shared Ask',
        });

        await sharedCompleted;

        expect(queueManager.getRunning().some(t => t.type === 'chat' && (t.payload as any)?.mode === 'autopilot')).toBe(true);

        exclusiveResolve!();
        await delay(200);

        executor.dispose();
    });

    it('should serialise two exclusive tasks', async () => {
        const queueManager = new TaskQueueManager();
        const startTimes: number[] = [];
        const endTimes: number[] = [];

        mockSendMessage.mockImplementation(async () => {
            startTimes.push(Date.now());
            await delay(100);
            endTimes.push(Date.now());
            return { success: true, response: 'done', sessionId: 'sess-ex' };
        });

        const { executor } = createQueueExecutorBridge(queueManager, store, {
            sharedConcurrency: 5,
            exclusiveConcurrency: 1,
        });

        let completedCount = 0;
        const bothCompleted = new Promise<void>(resolve => {
            executor.on('taskCompleted', () => {
                completedCount++;
                if (completedCount >= 2) { resolve(); }
            });
        });

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'exclusive 1' },
            config: {},
            displayName: 'Exclusive 1',
        });
        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'exclusive 2' },
            config: {},
            displayName: 'Exclusive 2',
        });

        await bothCompleted;

        // Second task must have started after first task ended
        expect(startTimes).toHaveLength(2);
        expect(startTimes[1]).toBeGreaterThanOrEqual(endTimes[0]);

        executor.dispose();
    });
});

// ============================================================================
// Follow-up Suggestions Tool Wiring
// ============================================================================

describe('suggest_follow_ups tool wiring', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    it('should include suggest_follow_ups tool for chat tasks', async () => {
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-chat-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Explain this repo' },
            config: { timeoutMs: 30000 },
            displayName: 'Chat message',
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const callOpts = mockSendMessage.mock.calls[0][0];
        expect(callOpts.tools).toBeDefined();
        expect(callOpts.tools).toHaveLength(1);
    });

    it('should include suggest_follow_ups tool for ask-mode chat tasks', async () => {
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-ai-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Explain this code' },
            config: { timeoutMs: 30000 },
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const callOpts = mockSendMessage.mock.calls[0][0];
        expect(callOpts.tools).toBeDefined();
        expect(callOpts.tools).toHaveLength(1);
    });

    it('should include suggest_follow_ups tool for autopilot chat tasks', async () => {
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-fp-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'prompt content', workingDirectory: '/tmp' },
            config: { timeoutMs: 30000 },
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const callOpts = mockSendMessage.mock.calls[0][0];
        expect(callOpts.tools).toBeDefined();
        expect(callOpts.tools).toHaveLength(1);
    });

    it('should include suggest_follow_ups tool for autopilot chat tasks (formerly custom)', async () => {
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-custom-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Do something' },
            config: { timeoutMs: 30000 },
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const callOpts = mockSendMessage.mock.calls[0][0];
        expect(callOpts.tools).toBeDefined();
        expect(callOpts.tools).toHaveLength(1);
    });

    it('should NOT include suggest_follow_ups tool for follow-up messages (only first turn gets it)', async () => {
        const process = createCompletedProcessWithSession('queue_suggest-fu-1', 'sess-fu-1');
        store.processes.set(process.id, process);
        mockCanResumeSession.mockResolvedValue(true);
        mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'Follow-up response',
            sessionId: 'sess-fu-1',
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('queue_suggest-fu-1', 'follow-up question');

        expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
        const callOpts = mockSendFollowUp.mock.calls[0][2];
        expect(callOpts.tools).toBeUndefined();
    });

    it('should NOT append follow-up suggestion instruction to follow-up messages', async () => {
        const process = createCompletedProcessWithSession('queue_suggest-fu-noinstr', 'sess-fu-noinstr');
        store.processes.set(process.id, process);
        mockCanResumeSession.mockResolvedValue(true);
        mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'Follow-up response',
            sessionId: 'sess-fu-noinstr',
        });

        const executor = new CLITaskExecutor(store, { followUpSuggestions: { enabled: true, count: 3 } });
        await executor.executeFollowUp('queue_suggest-fu-noinstr', 'follow-up question');

        expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
        const sentMessage = mockSendFollowUp.mock.calls[0][1];
        expect(sentMessage).not.toContain('When suggesting follow-ups');
    });

    it('should include suggest_follow_ups tool on first turn with no prior assistant turns', async () => {
        // Process with only a user turn (no assistant response yet — simulates first turn)
        const process = createCompletedProcessWithSession('queue_suggest-fu-first', 'sess-fu-first', [
            { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
        ]);
        store.processes.set(process.id, process);
        mockCanResumeSession.mockResolvedValue(true);
        mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'First response',
            sessionId: 'sess-fu-first',
        });

        const executor = new CLITaskExecutor(store, { followUpSuggestions: { enabled: true, count: 3 } });
        await executor.executeFollowUp('queue_suggest-fu-first', 'first message');

        expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
        const callOpts = mockSendFollowUp.mock.calls[0][2];
        expect(callOpts.tools).toBeDefined();
        expect(callOpts.tools).toHaveLength(1);
    });

    it('should intercept suggest_follow_ups tool-complete and emit suggestions event', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-suggest-1',
                    toolName: 'suggest_follow_ups',
                    result: JSON.stringify({ suggestions: ['Question 1?', 'Question 2?'] }),
                });
            }
            return { success: true, response: 'AI response', sessionId: 'session-123' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-intercept-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Test' },
            config: { timeoutMs: 30000 },
        };

        await executor.execute(task);

        // Verify suggestions event was emitted
        expect(store.emitProcessEvent).toHaveBeenCalledWith(
            'queue_suggest-intercept-1',
            expect.objectContaining({
                type: 'suggestions',
                suggestions: ['Question 1?', 'Question 2?'],
                turnIndex: 1,
            }),
        );

        // Verify it was NOT emitted as a regular tool-complete event
        const toolCompleteEvents = (store.emitProcessEvent as any).mock.calls.filter(
            (call: any[]) => call[1].type === 'tool-complete' && call[1].toolName === 'suggest_follow_ups',
        );
        expect(toolCompleteEvents).toHaveLength(0);
    });

    it('should store suggestions on the final ConversationTurn', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-suggest-2',
                    toolName: 'suggest_follow_ups',
                    result: JSON.stringify({ suggestions: ['Follow up A', 'Follow up B', 'Follow up C'] }),
                });
            }
            return { success: true, response: 'AI response with suggestions', sessionId: 'session-123' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-persist-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Test persist' },
            config: { timeoutMs: 30000 },
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_suggest-persist-1');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.suggestions).toEqual(['Follow up A', 'Follow up B', 'Follow up C']);
    });

    it('should store suggestions on follow-up ConversationTurn', async () => {
        const process = createCompletedProcessWithSession('queue_suggest-fu-persist', 'sess-persist');
        store.processes.set(process.id, process);
        mockCanResumeSession.mockResolvedValue(true);
        mockSendFollowUp.mockImplementation(async (_sid: string, _msg: string, opts: any) => {
            if (opts?.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-suggest-fu',
                    toolName: 'suggest_follow_ups',
                    result: JSON.stringify({ suggestions: ['Next Q1?', 'Next Q2?'] }),
                });
            }
            return { success: true, response: 'Follow-up with suggestions', sessionId: 'sess-persist' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('queue_suggest-fu-persist', 'tell me more');

        const updated = await store.getProcess('queue_suggest-fu-persist');
        const lastTurn = updated!.conversationTurns![updated!.conversationTurns!.length - 1];
        expect(lastTurn.role).toBe('assistant');
        expect(lastTurn.suggestions).toEqual(['Next Q1?', 'Next Q2?']);
    });

    it('should silently ignore malformed suggestion results', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-suggest-bad',
                    toolName: 'suggest_follow_ups',
                    result: 'not valid json',
                });
            }
            return { success: true, response: 'AI response', sessionId: 'session-123' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-malformed-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Test malformed' },
            config: { timeoutMs: 30000 },
        };

        // Should not throw
        const result = await executor.execute(task);
        expect(result.success).toBe(true);

        // No suggestions event should have been emitted
        const suggestionsEvents = (store.emitProcessEvent as any).mock.calls.filter(
            (call: any[]) => call[1].type === 'suggestions',
        );
        expect(suggestionsEvents).toHaveLength(0);
    });

    it('should silently ignore empty suggestions array', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-suggest-empty',
                    toolName: 'suggest_follow_ups',
                    result: JSON.stringify({ suggestions: [] }),
                });
            }
            return { success: true, response: 'AI response', sessionId: 'session-123' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-empty-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Test empty' },
            config: { timeoutMs: 30000 },
        };

        await executor.execute(task);

        // No suggestions event should have been emitted for empty array
        const suggestionsEvents = (store.emitProcessEvent as any).mock.calls.filter(
            (call: any[]) => call[1].type === 'suggestions',
        );
        expect(suggestionsEvents).toHaveLength(0);
    });

    it('should not intercept tool-start events for suggest_follow_ups', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-suggest-start',
                    toolName: 'suggest_follow_ups',
                    parameters: { suggestions: ['Q1'] },
                });
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-suggest-start',
                    toolName: 'suggest_follow_ups',
                    result: JSON.stringify({ suggestions: ['Q1'] }),
                });
            }
            return { success: true, response: 'AI response', sessionId: 'session-123' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'suggest-start-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Test start event' },
            config: { timeoutMs: 30000 },
        };

        await executor.execute(task);

        // tool-start for suggest_follow_ups should still be emitted as a regular event
        const toolStartEvents = (store.emitProcessEvent as any).mock.calls.filter(
            (call: any[]) => call[1].type === 'tool-start' && call[1].toolName === 'suggest_follow_ups',
        );
        expect(toolStartEvents).toHaveLength(1);
    });

    it('should exclude suggestion tool from sendMessage when followUpSuggestions.enabled is false', async () => {
        const executor = new CLITaskExecutor(store, { followUpSuggestions: { enabled: false, count: 3 } });

        const task: QueuedTask = {
            id: 'suggest-disabled-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Hello' },
            config: { timeoutMs: 30000 },
            displayName: 'Chat',
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const callOpts = mockSendMessage.mock.calls[0][0];
        expect(callOpts.tools).toBeUndefined();
    });

    it('should not append count instruction to prompt when suggestions are disabled', async () => {
        const executor = new CLITaskExecutor(store, { followUpSuggestions: { enabled: false, count: 3 } });

        const task: QueuedTask = {
            id: 'suggest-disabled-2',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Tell me about this' },
            config: { timeoutMs: 30000 },
            displayName: 'Chat',
        };

        await executor.execute(task);

        const callOpts = mockSendMessage.mock.calls[0][0];
        expect(callOpts.prompt).not.toContain('When suggesting follow-ups');
    });

    it('should append count instruction to prompt when suggestions are enabled', async () => {
        const executor = new CLITaskExecutor(store, { followUpSuggestions: { enabled: true, count: 2 } });

        const task: QueuedTask = {
            id: 'suggest-count-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'autopilot', prompt: 'Hello' },
            config: { timeoutMs: 30000 },
            displayName: 'Chat',
        };

        await executor.execute(task);

        const callOpts = mockSendMessage.mock.calls[0][0];
        expect(callOpts.prompt).toContain('provide exactly 2 suggestions');
    });

    it('should exclude suggestion tool from sendFollowUp when disabled', async () => {
        const process = createCompletedProcessWithSession('queue_suggest-fu-disabled', 'sess-fu-disabled');
        store.processes.set(process.id, process);
        mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'Follow-up response',
            sessionId: 'sess-fu-disabled',
        });

        const executor = new CLITaskExecutor(store, { followUpSuggestions: { enabled: false, count: 3 } });
        await executor.executeFollowUp('queue_suggest-fu-disabled', 'follow-up question');

        expect(mockSendFollowUp).toHaveBeenCalledTimes(1);
        const callOpts = mockSendFollowUp.mock.calls[0][2];
        expect(callOpts.tools).toBeUndefined();
        // Should NOT append count instruction when disabled
        const sentMessage = mockSendFollowUp.mock.calls[0][1];
        expect(sentMessage).not.toContain('When suggesting follow-ups');
    });
});

// ============================================================================
// sdkSessionId Early Persistence Tests
// ============================================================================

describe('CLITaskExecutor - sdkSessionId stored via onSessionCreated', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should write sdkSessionId to the store when onSessionCreated is invoked during sendMessage', async () => {
        // Simulate the SDK calling onSessionCreated before resolving sendMessage
        mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onSessionCreated?.('early-session-id');
            return { success: true, response: 'done', sessionId: 'early-session-id' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-early-session',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Test early session' },
            config: { timeoutMs: 30000 },
            displayName: 'Test early session',
        };

        await executor.execute(task);

        // updateProcess should have been called with sdkSessionId from onSessionCreated
        expect(store.updateProcess).toHaveBeenCalledWith(
            'queue_task-early-session',
            expect.objectContaining({ sdkSessionId: 'early-session-id' }),
        );
    });

    it('should pass onSessionCreated callback via sendMessage options', async () => {
        mockSendMessage.mockResolvedValue({ success: true, response: 'done', sessionId: 'sess-cb' });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-cb-check',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'callback check' },
            config: { timeoutMs: 30000 },
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ onSessionCreated: expect.any(Function) }),
        );
    });
});

// ============================================================================
// run-script Tasks
// ============================================================================

describe('CLITaskExecutor — run-script tasks', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSpawn.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    function makeRunScriptTask(overrides?: Partial<QueuedTask>): QueuedTask {
        return {
            id: 'rs-task-1',
            type: 'run-script',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'run-script', script: 'echo hello' },
            config: {},
            ...overrides,
        };
    }

    it('happy path — exit code 0, captures stdout', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new CLITaskExecutor(store);
        const task = makeRunScriptTask();

        const resultPromise = executor.execute(task);

        setImmediate(() => {
            child.stdout.emit('data', Buffer.from('hello\n'));
            child.emit('close', 0);
        });

        const result = await resultPromise;
        const inner = result.result as any;

        expect(result.success).toBe(true);
        expect(inner.success).toBe(true);
        expect(inner.result.stdout).toBe('hello\n');
        expect(inner.result.stderr).toBe('');
        expect(inner.result.exitCode).toBe(0);
        expect(inner.timedOut).toBe(false);
        // Response should surface stdout for UI display
        expect(inner.response).toContain('hello');
        expect(inner.response).toContain('✅ Success');
    });

    it('non-zero exit — success false, correct exitCode', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new CLITaskExecutor(store);
        const task = makeRunScriptTask({ id: 'rs-task-2' });

        const resultPromise = executor.execute(task);

        setImmediate(() => {
            child.stderr.emit('data', Buffer.from('error output'));
            child.emit('close', 1);
        });

        const result = await resultPromise;
        const inner = result.result as any;

        expect(inner.success).toBe(false);
        expect(inner.result.exitCode).toBe(1);
        expect(inner.result.stderr).toBe('error output');
        // Response should surface stderr and failure status
        expect(inner.response).toContain('error output');
        expect(inner.response).toContain('❌ Failed');
    });

    it('timeout — kills process, timedOut true, exitCode null', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new CLITaskExecutor(store);
        const task = makeRunScriptTask({
            id: 'rs-task-3',
            config: { timeoutMs: 50 },
        });

        const result = await executor.execute(task);
        const inner = result.result as any;

        expect(child.kill).toHaveBeenCalled();
        expect(inner.timedOut).toBe(true);
        expect(inner.success).toBe(false);
        expect(inner.result.exitCode).toBeNull();
        // Response should indicate timeout
        expect(inner.response).toContain('Timed out');
    }, 2000);

    it('uses resolved working directory (fallback to defaultWorkingDirectory)', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new CLITaskExecutor(store, { workingDirectory: '/repo/root' });
        const task = makeRunScriptTask({
            id: 'rs-cwd-1',
            payload: { kind: 'run-script', script: 'ls', workingDirectory: '' },
        });

        const resultPromise = executor.execute(task);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        // Should fall back to defaultWorkingDirectory, not pass empty string
        expect(mockSpawn).toHaveBeenCalledWith('ls', [], expect.objectContaining({
            shell: true,
            cwd: '/repo/root',
        }));
    });

    it('uses explicit working directory when provided', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new CLITaskExecutor(store, { workingDirectory: '/repo/root' });
        const task = makeRunScriptTask({
            id: 'rs-cwd-2',
            payload: { kind: 'run-script', script: 'ls', workingDirectory: '/custom/dir' },
        });

        const resultPromise = executor.execute(task);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        expect(mockSpawn).toHaveBeenCalledWith('ls', [], expect.objectContaining({
            cwd: '/custom/dir',
        }));
    });

    it('response is stored as assistant turn content', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new CLITaskExecutor(store);
        const task = makeRunScriptTask({ id: 'rs-turn-1' });

        const resultPromise = executor.execute(task);
        setImmediate(() => {
            child.stdout.emit('data', Buffer.from('output line\n'));
            child.emit('close', 0);
        });

        await resultPromise;

        // Verify the assistant turn has the script response, not empty string
        const process = await store.getProcess(`queue_rs-turn-1`);
        const assistantTurn = process?.conversationTurns?.find(t => t.role === 'assistant');
        expect(assistantTurn?.content).toContain('output line');
        expect(assistantTurn?.content).toContain('✅ Success');
    });

    it('extractPrompt shows the actual script command', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new CLITaskExecutor(store);
        const task = makeRunScriptTask({
            id: 'rs-prompt-1',
            payload: { kind: 'run-script', script: 'git pull --rebase' },
        });

        const resultPromise = executor.execute(task);
        setImmediate(() => child.emit('close', 0));
        await resultPromise;

        // Verify the user turn shows the script command
        const process = await store.getProcess(`queue_rs-prompt-1`);
        const userTurn = process?.conversationTurns?.find(t => t.role === 'user');
        expect(userTurn?.content).toContain('git pull --rebase');
    });

    it('spawn error — executor returns failed result', async () => {
        const child = makeFakeChild();
        mockSpawn.mockReturnValue(child);

        const executor = new CLITaskExecutor(store);
        const task = makeRunScriptTask({ id: 'rs-task-4' });

        const resultPromise = executor.execute(task);

        setImmediate(() => {
            child.emit('error', new Error('spawn ENOENT'));
        });

        const result = await resultPromise;
        expect(result.success).toBe(false);
    });

    it('non-run-script task still reaches AI path (regression guard)', async () => {
        mockSendMessage.mockResolvedValue({ success: true, response: 'AI response', sessionId: 'sess-1' });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'ai-task-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Do something' },
            config: { timeoutMs: 30000 },
        };

        const result = await executor.execute(task);

        expect(result.success).toBe(true);
        expect(mockSpawn).not.toHaveBeenCalled();
    });
});

describe('ToolCallCapture integration', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    it('should call ToolCallCapture.createToolEventHandler with tool events during executeWithAI', async () => {
        const { FileToolCallCacheStore: Store } = await import('@plusplusoneplusplus/pipeline-core');
        const mockWriteRaw = vi.fn().mockResolvedValue('123-view.json');
        vi.spyOn(Store.prototype, 'writeRaw').mockImplementation(mockWriteRaw);

        const toolStartEvent = { type: 'tool-start', toolCallId: 'tc1', toolName: 'task', parameters: { prompt: 'Explain /foo.ts' } };
        const toolCompleteEvent = { type: 'tool-complete', toolCallId: 'tc1', toolName: 'task', result: 'file content' };

        mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent?.(toolStartEvent);
            opts.onToolEvent?.(toolCompleteEvent);
            return { success: true, response: 'ok', sessionId: 'sess-1' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-cap-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'Explain this code' },
            config: { timeoutMs: 5000 },
            displayName: 'Capture test',
        };

        await executor.execute(task);

        expect(mockWriteRaw).toHaveBeenCalledOnce();
        const entry = mockWriteRaw.mock.calls[0][0];
        expect(entry.toolName).toBe('task');
        expect(entry.question).toContain('/foo.ts');
        expect(entry.answer).toBe('file content');
    });

    it('should not capture suggest_follow_ups events (not in TASK_FILTER)', async () => {
        const { FileToolCallCacheStore: Store } = await import('@plusplusoneplusplus/pipeline-core');
        const mockWriteRaw = vi.fn().mockResolvedValue('ts.json');
        vi.spyOn(Store.prototype, 'writeRaw').mockImplementation(mockWriteRaw);

        mockSendMessage.mockImplementation(async (opts: any) => {
            opts.onToolEvent?.({ type: 'tool-start', toolCallId: 'sfup1', toolName: 'suggest_follow_ups', parameters: {} });
            opts.onToolEvent?.({ type: 'tool-complete', toolCallId: 'sfup1', toolName: 'suggest_follow_ups', result: '{"suggestions":[]}' });
            return { success: true, response: 'ok', sessionId: 'sess-2' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.execute({
            id: 'task-noc-1', type: 'chat', priority: 'normal',
            status: 'running', createdAt: Date.now(),
            payload: { kind: 'chat' as const, mode: 'ask', prompt: 'test' }, config: {}, displayName: 'no capture',
        });

        expect(mockWriteRaw).not.toHaveBeenCalled();
    });
});
