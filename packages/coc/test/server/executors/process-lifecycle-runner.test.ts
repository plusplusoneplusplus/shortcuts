/**
 * ProcessLifecycleRunner — initial-prompt memory recording tests.
 *
 * Verifies that `recordUserMessage` is called for manual user chats
 * and skipped for scheduled, workflow, and script tasks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import type { LifecycleRunnerOptions } from '../../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

const mockRecordUserMessage = vi.fn();
vi.mock('../../../src/server/memory/conversation-recorder', () => ({
    recordUserMessage: (...args: any[]) => mockRecordUserMessage(...args),
}));

// Stub image-store to avoid temp-file side effects
vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

// Stub output-file-manager to avoid disk writes
vi.mock('../../../src/server/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id: 'task-1',
        type: 'chat',
        displayName: 'test',
        priority: 1,
        addedAt: new Date(),
        config: { model: undefined },
        payload: {
            kind: 'chat',
            prompt: 'Hello world',
            workspaceId: 'ws-abc',
        } as any,
        ...overrides,
    } as QueuedTask;
}

function makeOpts(overrides: Partial<LifecycleRunnerOptions> = {}): LifecycleRunnerOptions {
    return {
        cancelledTasks: new Set<string>(),
        executeFollowUpFn: vi.fn().mockResolvedValue(undefined),
        executeByTypeFn: vi.fn().mockResolvedValue({ response: 'done' }),
        getWorkingDirectoryFn: vi.fn().mockReturnValue('/tmp'),
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('ProcessLifecycleRunner — initial prompt memory recording', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('records the initial prompt for a manual chat task', async () => {
        const task = makeTask();
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).toHaveBeenCalledOnce();
        expect(mockRecordUserMessage).toHaveBeenCalledWith('/data-dir', 'ws-abc', 'Hello world');
    });

    it('skips recording when task.type is run-workflow', async () => {
        const task = makeTask({
            type: 'run-workflow',
            payload: {
                kind: 'run-workflow',
                workflowPath: '/wf.yaml',
                prompt: 'run this',
                workspaceId: 'ws-abc',
            } as any,
        });
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('skips recording when task.type is run-script', async () => {
        const task = makeTask({
            type: 'run-script',
            payload: {
                kind: 'run-script',
                scriptPath: '/script.sh',
                prompt: 'run this',
                workspaceId: 'ws-abc',
            } as any,
        });
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('skips recording for scheduled chat runs', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'scheduled prompt',
                workspaceId: 'ws-abc',
                context: { scheduleId: 'sched-1' },
            } as any,
        });
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('skips recording when dataDir is undefined', async () => {
        const noDataDirRunner = new ProcessLifecycleRunner(store as any, undefined, vi.fn());
        const task = makeTask();
        await noDataDirRunner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('skips recording when workspaceId is empty', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Hello',
                workspaceId: '',
            } as any,
        });
        await runner.run(task, makeOpts());

        expect(mockRecordUserMessage).not.toHaveBeenCalled();
    });

    it('does not block execution if recordUserMessage throws', async () => {
        mockRecordUserMessage.mockImplementation(() => { throw new Error('disk full'); });

        const task = makeTask();
        const result = await runner.run(task, makeOpts());

        expect(result.success).toBe(true);
    });
});

// ============================================================================
// Selected-skills directive in initial turn
// ============================================================================

describe('ProcessLifecycleRunner — selected_skills directive in stored turns', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('prepends selected_skills directive to the initial turn content when skills are selected', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Fix the bug',
                workspaceId: 'ws-abc',
                context: { skills: ['impl', 'review'] },
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        const userTurn = proc?.conversationTurns?.find(t => t.role === 'user');

        expect(userTurn?.content).toContain('<selected_skills>');
        expect(userTurn?.content).toContain('impl, review');
        expect(userTurn?.content).toContain('Fix the bug');
    });

    it('stores directive in promptPreview and fullPrompt', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Fix the bug',
                workspaceId: 'ws-abc',
                context: { skills: ['go-deep'] },
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);

        expect(proc?.fullPrompt).toContain('<selected_skills>');
        expect(proc?.fullPrompt).toContain('go-deep');
        expect(proc?.promptPreview).toContain('<selected_skills>');
    });

    it('does not alter turn content when no skills are selected', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Hello world',
                workspaceId: 'ws-abc',
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        const userTurn = proc?.conversationTurns?.find(t => t.role === 'user');

        expect(userTurn?.content).toBe('Hello world');
        expect(userTurn?.content).not.toContain('<selected_skills>');
    });

    it('passes original prompt (without directive) to executeByTypeFn', async () => {
        const executeByTypeFn = vi.fn().mockResolvedValue({ response: 'done' });
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Fix the bug',
                workspaceId: 'ws-abc',
                context: { skills: ['impl'] },
            } as any,
        });
        await runner.run(task, makeOpts({ executeByTypeFn }));

        const passedPrompt = executeByTypeFn.mock.calls[0][1];
        expect(passedPrompt).toBe('Fix the bug');
        expect(passedPrompt).not.toContain('<selected_skills>');
    });
});

// ============================================================================
// Cancellation detection tests
// ============================================================================

describe('ProcessLifecycleRunner — cancellation detection', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('sets cancelled (not failed) when cancelledTasks contains the task id', async () => {
        const cancelledTasks = new Set<string>();
        const task = makeTask();
        const opts = makeOpts({
            cancelledTasks,
            executeByTypeFn: vi.fn(async () => {
                // Simulate cancellation arriving mid-flight
                cancelledTasks.add(task.id);
                throw new Error('Session aborted');
            }),
        });

        await runner.run(task, opts);

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.status).toBe('cancelled');
        expect(proc?.error).toBeUndefined();
    });

    it('sets cancelled when process status is cancelling at error time', async () => {
        const task = makeTask();
        const processId = `queue_${task.id}`;

        const opts = makeOpts({
            executeByTypeFn: vi.fn(async () => {
                // Simulate the cancel endpoint setting 'cancelling' mid-flight
                await store.updateProcess(processId, { status: 'cancelling' as any });
                throw new Error('Session aborted');
            }),
        });

        await runner.run(task, opts);

        const proc = await store.getProcess(processId);
        expect(proc?.status).toBe('cancelled');
        expect(proc?.error).toBeUndefined();
    });

    it('sets failed (not cancelled) for normal errors', async () => {
        const task = makeTask();
        const opts = makeOpts({
            executeByTypeFn: vi.fn().mockRejectedValue(new Error('network timeout')),
        });

        await runner.run(task, opts);

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.status).toBe('failed');
        expect(proc?.error).toBe('network timeout');
    });

    it('emits process complete with cancelled status', async () => {
        const cancelledTasks = new Set<string>();
        const task = makeTask();
        const opts = makeOpts({
            cancelledTasks,
            executeByTypeFn: vi.fn(async () => {
                cancelledTasks.add(task.id);
                throw new Error('Session aborted');
            }),
        });

        await runner.run(task, opts);

        const processId = `queue_${task.id}`;
        expect(store.completions.has(processId)).toBe(true);
        expect(store.completions.get(processId)?.status).toBe('cancelled');
    });

    it('treats success path as cancelled when status is cancelling', async () => {
        const task = makeTask();
        const processId = `queue_${task.id}`;

        const opts = makeOpts({
            executeByTypeFn: vi.fn(async () => {
                // Simulate cancel endpoint setting 'cancelling' just before success
                await store.updateProcess(processId, { status: 'cancelling' as any });
                return { response: 'partial result' };
            }),
        });

        await runner.run(task, opts);

        const proc = await store.getProcess(processId);
        expect(proc?.status).toBe('cancelled');
    });
});
