/**
 * ProcessLifecycleRunner — selected-skills directive tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import type { LifecycleRunnerOptions } from '../../../src/server/executors/process-lifecycle-runner';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

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

// ============================================================================
// Pending messages drain on task completion
// ============================================================================

describe('ProcessLifecycleRunner — pending messages drain', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('calls onDrainPendingMessages after successful new task completion', async () => {
        const drainFn = vi.fn().mockResolvedValue(undefined);
        const task = makeTask();
        const opts = makeOpts({ onDrainPendingMessages: drainFn });

        await runner.run(task, opts);

        const processId = `queue_${task.id}`;
        expect(drainFn).toHaveBeenCalledOnce();
        expect(drainFn).toHaveBeenCalledWith(processId, task.id);
    });

    it('calls onDrainPendingMessages after successful follow-up completion', async () => {
        const drainFn = vi.fn().mockResolvedValue(undefined);
        const processId = 'existing-process';
        // Set up a process in the store for the follow-up
        store.processes.set(processId, {
            id: processId,
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            conversationTurns: [
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        } as any);

        const followUpTask = makeTask({
            id: 'followup-task-1',
            payload: {
                kind: 'chat',
                prompt: 'Follow-up question',
                processId,
                workspaceId: 'ws-abc',
            } as any,
        });

        const opts = makeOpts({ onDrainPendingMessages: drainFn });
        await runner.run(followUpTask, opts);

        expect(drainFn).toHaveBeenCalledOnce();
        expect(drainFn).toHaveBeenCalledWith(processId, followUpTask.id);
    });

    it('does not call onDrainPendingMessages when task fails', async () => {
        const drainFn = vi.fn().mockResolvedValue(undefined);
        const task = makeTask();
        const opts = makeOpts({
            onDrainPendingMessages: drainFn,
            executeByTypeFn: vi.fn().mockRejectedValue(new Error('execution error')),
        });

        await runner.run(task, opts);

        expect(drainFn).not.toHaveBeenCalled();
    });

    it('does not call onDrainPendingMessages when task is cancelled', async () => {
        const drainFn = vi.fn().mockResolvedValue(undefined);
        const cancelledTasks = new Set<string>();
        const task = makeTask();
        cancelledTasks.add(task.id);

        const opts = makeOpts({
            onDrainPendingMessages: drainFn,
            cancelledTasks,
        });

        await runner.run(task, opts);

        expect(drainFn).not.toHaveBeenCalled();
    });

    it('does not crash when onDrainPendingMessages throws', async () => {
        const drainFn = vi.fn().mockRejectedValue(new Error('drain failed'));
        const task = makeTask();
        const opts = makeOpts({ onDrainPendingMessages: drainFn });

        const result = await runner.run(task, opts);

        // Task should still succeed despite drain error
        expect(result.success).toBe(true);
        expect(drainFn).toHaveBeenCalledOnce();
    });

    it('works without onDrainPendingMessages callback (backward compat)', async () => {
        const task = makeTask();
        const opts = makeOpts(); // no onDrainPendingMessages

        const result = await runner.run(task, opts);

        expect(result.success).toBe(true);
    });
});

// ============================================================================
// metadata.workspaceId fallback to task.repoId
// ============================================================================

describe('ProcessLifecycleRunner — metadata.workspaceId from task.repoId', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('uses payload.workspaceId when present (chat task)', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Hello',
                workspaceId: 'ws-from-payload',
            } as any,
            repoId: 'ws-from-repo',
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.workspaceId).toBe('ws-from-payload');
    });

    it('falls back to task.repoId for run-script payload (no workspaceId)', async () => {
        const task = makeTask({
            type: 'run-script',
            payload: {
                kind: 'run-script',
                script: 'echo hello',
            } as any,
            repoId: 'ws-scripts',
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.workspaceId).toBe('ws-scripts');
    });

    it('falls back to task.repoId for run-workflow payload without workspaceId', async () => {
        const task = makeTask({
            type: 'run-workflow',
            payload: {
                kind: 'run-workflow',
                workflowPath: '/wf.yaml',
                workingDirectory: '/tmp',
            } as any,
            repoId: 'ws-workflows',
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.workspaceId).toBe('ws-workflows');
    });

    it('falls back to task.repoId for memory-aggregate payload', async () => {
        const task = makeTask({
            type: 'memory-aggregate',
            payload: {
                kind: 'memory-aggregate',
                repoId: 'ws-mem',
                sources: ['notes'],
            } as any,
            repoId: 'ws-mem',
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.workspaceId).toBe('ws-mem');
    });

    it('stores undefined when both payload.workspaceId and task.repoId are absent', async () => {
        const task = makeTask({
            type: 'run-script',
            payload: {
                kind: 'run-script',
                script: 'echo hello',
            } as any,
        });
        delete (task as any).repoId;
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.workspaceId).toBeUndefined();
    });
});

// ============================================================================
// metadata.planFilePath from payload.context.files
// ============================================================================

describe('ProcessLifecycleRunner — metadata.planFilePath from context.files', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('copies context.files[0] to metadata.planFilePath for chat tasks', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Implement this feature',
                workspaceId: 'ws-abc',
                context: { files: ['/home/user/project/feature.plan.md'] },
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.planFilePath).toBe('/home/user/project/feature.plan.md');
    });

    it('copies Windows-style paths from context.files[0]', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Fix the bug',
                workspaceId: 'ws-abc',
                context: { files: ['C:\\Users\\dev\\project\\fix.plan.md'] },
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.planFilePath).toBe('C:\\Users\\dev\\project\\fix.plan.md');
    });

    it('sets planFilePath to undefined when context.files is empty', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Hello',
                workspaceId: 'ws-abc',
                context: { files: [] },
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.planFilePath).toBeUndefined();
    });

    it('sets planFilePath to undefined when context is absent', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Hello',
                workspaceId: 'ws-abc',
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.planFilePath).toBeUndefined();
    });

    it('sets planFilePath to undefined for non-chat task types', async () => {
        const task = makeTask({
            type: 'run-workflow',
            payload: {
                kind: 'run-workflow',
                workflowPath: '/wf.yaml',
                workingDirectory: '/tmp',
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.planFilePath).toBeUndefined();
    });

    it('uses only the first file from context.files', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Multi-file context',
                workspaceId: 'ws-abc',
                context: { files: ['/first/plan.md', '/second/extra.md', '/third/notes.md'] },
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.planFilePath).toBe('/first/plan.md');
    });
});
