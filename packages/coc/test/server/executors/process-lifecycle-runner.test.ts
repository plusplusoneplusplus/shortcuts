/**
 * ProcessLifecycleRunner — selected-skills directive tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
vi.mock('../../../src/server/processes/output-file-manager', () => ({
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
// Initial user turn mode/model stamping
// ============================================================================

describe('ProcessLifecycleRunner — initial user turn mode/model stamping', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('copies payload mode and configured model onto the initial user turn', async () => {
        const task = makeTask({
            config: { model: 'claude-sonnet-4.6' } as any,
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Hello world',
                workspaceId: 'ws-abc',
            } as any,
        });

        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        const initialTurn = proc?.conversationTurns?.[0];
        expect(initialTurn?.role).toBe('user');
        expect(initialTurn?.mode).toBe('ask');
        expect(initialTurn?.model).toBe('claude-sonnet-4.6');
    });

    it('copies mode without adding a model property when no model is configured', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'plan',
                prompt: 'Plan this',
                workspaceId: 'ws-abc',
            } as any,
        });

        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        const initialTurn = proc?.conversationTurns?.[0];
        expect(initialTurn?.mode).toBe('plan');
        expect(initialTurn).not.toHaveProperty('model');
    });

    it('copies model without adding a mode property when no mode is provided', async () => {
        const task = makeTask({
            config: { model: 'gpt-5.4' } as any,
        });

        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        const initialTurn = proc?.conversationTurns?.[0];
        expect(initialTurn?.model).toBe('gpt-5.4');
        expect(initialTurn).not.toHaveProperty('mode');
    });

    it('leaves both mode and model absent when neither is provided', async () => {
        const task = makeTask();

        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        const initialTurn = proc?.conversationTurns?.[0];
        expect(initialTurn).not.toHaveProperty('mode');
        expect(initialTurn).not.toHaveProperty('model');
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

    it('falls back to task.repoId for memory-promote payload', async () => {
        const task = makeTask({
            type: 'memory-promote',
            payload: {
                kind: 'memory-promote',
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

// ============================================================================
// metadata.notePath / noteTitle from payload.context.noteChat
// ============================================================================

describe('ProcessLifecycleRunner — metadata.notePath from context.noteChat', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('copies noteChat.notePath and noteTitle to metadata for note-chat tasks', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Update the note',
                workspaceId: 'ws-abc',
                context: {
                    noteChat: {
                        notePath: 'my-note.md',
                        noteTitle: 'My Note',
                    },
                },
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.notePath).toBe('my-note.md');
        expect(proc?.metadata?.noteTitle).toBe('My Note');
    });

    it('sets notePath without noteTitle when noteTitle is absent', async () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Edit note',
                workspaceId: 'ws-abc',
                context: {
                    noteChat: {
                        notePath: 'untitled.md',
                    },
                },
            } as any,
        });
        await runner.run(task, makeOpts());

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.metadata?.notePath).toBe('untitled.md');
        expect(proc?.metadata?.noteTitle).toBeUndefined();
    });

    it('sets notePath and noteTitle to undefined when context has no noteChat', async () => {
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
        expect(proc?.metadata?.notePath).toBeUndefined();
        expect(proc?.metadata?.noteTitle).toBeUndefined();
    });

    it('sets notePath and noteTitle to undefined for non-chat task types', async () => {
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
        expect(proc?.metadata?.notePath).toBeUndefined();
        expect(proc?.metadata?.noteTitle).toBeUndefined();
    });
});

// ============================================================================
// Title generation gating by task type
// ============================================================================

describe('ProcessLifecycleRunner — title generation gating', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let onGenerateTitle: ReturnType<typeof vi.fn>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        store = createMockProcessStore();
        onGenerateTitle = vi.fn();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', onGenerateTitle);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does NOT call onGenerateTitle for run-script tasks', async () => {
        const task = makeTask({
            type: 'run-script',
            displayName: undefined as any,
            payload: { kind: 'run-script', script: 'npm test' } as any,
        });
        await runner.run(task, makeOpts());
        vi.runAllTimers();
        expect(onGenerateTitle).not.toHaveBeenCalled();
    });

    it('calls onGenerateTitle for chat tasks', async () => {
        const task = makeTask();
        await runner.run(task, makeOpts());
        expect(onGenerateTitle).not.toHaveBeenCalled(); // not yet — still in setTimeout
        vi.runAllTimers();
        expect(onGenerateTitle).toHaveBeenCalledOnce();
    });

    it('sets deterministic title from first script line for run-script tasks', async () => {
        const task = makeTask({
            type: 'run-script',
            displayName: undefined as any,
            payload: { kind: 'run-script', script: '# comment\nnpm install\nnpm test' } as any,
        });
        await runner.run(task, makeOpts());
        vi.runAllTimers();
        // Flush async IIFE microtasks
        await Promise.resolve();
        await Promise.resolve();

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.title).toBe('npm install');
    });

    it('uses task.displayName as title when set for run-script tasks', async () => {
        const task = makeTask({
            type: 'run-script',
            displayName: 'Nightly build',
            payload: { kind: 'run-script', script: 'npm run build' } as any,
        });
        await runner.run(task, makeOpts());
        vi.runAllTimers();
        await Promise.resolve();
        await Promise.resolve();

        const processId = `queue_${task.id}`;
        const proc = await store.getProcess(processId);
        expect(proc?.title).toBe('Nightly build');
    });

    it('does not overwrite an existing title for run-script tasks', async () => {
        const task = makeTask({
            type: 'run-script',
            displayName: undefined as any,
            payload: { kind: 'run-script', script: 'echo hello' } as any,
        });
        const processId = `queue_${task.id}`;
        // Intercept addProcess to inject an existing title, simulating a re-run
        // after the title was already set by a previous execution.
        const origAddProcess = store.addProcess as ReturnType<typeof vi.fn>;
        store.addProcess = vi.fn(async (proc: any) => {
            await origAddProcess(proc);
            const created = store.processes.get(proc.id);
            if (created) {
                store.processes.set(proc.id, { ...created, title: 'existing title' });
            }
        }) as any;

        await runner.run(task, makeOpts());
        vi.runAllTimers();
        await Promise.resolve();
        await Promise.resolve();

        const proc = await store.getProcess(processId);
        expect(proc?.title).toBe('existing title');
    });
});

// ============================================================================
// Ralph auto-loop: onRalphNext callback
// ============================================================================

describe('ProcessLifecycleRunner — ralph onRalphNext callback', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    function makeRalphTask(ralphCtx?: Record<string, unknown>): QueuedTask {
        return makeTask({
            payload: {
                kind: 'chat',
                mode: 'ralph',
                prompt: 'Continue toward the goal',
                workspaceId: 'ws-ralph',
                context: ralphCtx ? { ralph: ralphCtx } : undefined,
            } as any,
        });
    }

    it('calls onRalphNext after a ralph task completes successfully', async () => {
        const onRalphNext = vi.fn();
        const task = makeRalphTask({ originalGoal: 'Build a REST API', currentIteration: 1 });

        await runner.run(task, makeOpts({
            executeByTypeFn: vi.fn().mockResolvedValue({ response: 'Done\nRALPH_PROGRESS:\nAuth done\nRALPH_NEXT' }),
            onRalphNext,
        }));

        expect(onRalphNext).toHaveBeenCalledOnce();
        const [calledProcessId, calledTask, calledResponse] = onRalphNext.mock.calls[0];
        expect(calledProcessId).toBe(`queue_${task.id}`);
        expect(calledTask).toBe(task);
        expect(calledResponse).toContain('RALPH_NEXT');
    });

    it('does not call onRalphNext for non-ralph tasks', async () => {
        const onRalphNext = vi.fn();
        const task = makeTask({
            payload: { kind: 'chat', mode: 'ask', prompt: 'Hello', workspaceId: 'ws' } as any,
        });

        await runner.run(task, makeOpts({
            executeByTypeFn: vi.fn().mockResolvedValue({ response: 'Some response RALPH_NEXT' }),
            onRalphNext,
        }));

        expect(onRalphNext).not.toHaveBeenCalled();
    });

    it('does not call onRalphNext when task fails', async () => {
        const onRalphNext = vi.fn();
        const task = makeRalphTask({ originalGoal: 'Build a REST API' });

        await runner.run(task, makeOpts({
            executeByTypeFn: vi.fn().mockRejectedValue(new Error('execution error')),
            onRalphNext,
        }));

        expect(onRalphNext).not.toHaveBeenCalled();
    });

    it('does not crash when onRalphNext callback throws', async () => {
        const onRalphNext = vi.fn().mockImplementation(() => { throw new Error('enqueue failed'); });
        const task = makeRalphTask({ originalGoal: 'Build a REST API' });

        const result = await runner.run(task, makeOpts({
            executeByTypeFn: vi.fn().mockResolvedValue({ response: 'RALPH_NEXT' }),
            onRalphNext,
        }));

        expect(result.success).toBe(true);
        expect(onRalphNext).toHaveBeenCalledOnce();
    });

    it('works without onRalphNext callback (backward compat)', async () => {
        const task = makeRalphTask({ originalGoal: 'Build a REST API' });

        const result = await runner.run(task, makeOpts({
            executeByTypeFn: vi.fn().mockResolvedValue({ response: 'RALPH_NEXT' }),
            // no onRalphNext
        }));

        expect(result.success).toBe(true);
    });
});

// ============================================================================
// Partial conversation turn persistence on error / timeout
// ============================================================================

/**
 * Subclass that exposes the protected `getOrCreateSession` so tests can seed
 * the session buffers used by the error-recovery path. Mirrors what the
 * real streaming pipeline does on every chunk.
 */
class TestableRunner extends ProcessLifecycleRunner {
    public seedSession(
        processId: string,
        outputBuffer: string,
        timeline: import('@plusplusoneplusplus/forge').TimelineItem[] = [],
    ): void {
        const session = (this as any).getOrCreateSession(processId);
        session.outputBuffer = outputBuffer;
        session.timelineBuffer = timeline;
    }
}

describe('ProcessLifecycleRunner — partial conversation turn on error', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: TestableRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new TestableRunner(store as any, '/data-dir', vi.fn());
    });

    it('persists accumulated outputBuffer as an assistant turn when executeByType throws', async () => {
        const task = makeTask();
        const processId = `queue_${task.id}`;
        const opts = makeOpts({
            executeByTypeFn: vi.fn(async () => {
                runner.seedSession(processId, 'Partial assistant response before timeout');
                throw new Error('Session timed out after 3600 seconds');
            }),
        });

        await runner.run(task, opts);

        const proc = await store.getProcess(processId);
        expect(proc?.status).toBe('failed');
        expect(proc?.error).toBe('Session timed out after 3600 seconds');

        const turns = proc?.conversationTurns ?? [];
        const assistantTurn = turns.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn?.content).toBe('Partial assistant response before timeout');
        expect(assistantTurn?.streaming).toBeFalsy();
    });

    it('persists accumulated timeline as part of the assistant turn', async () => {
        const task = makeTask();
        const processId = `queue_${task.id}`;
        const timeline = [
            { type: 'tool-complete' as const, timestamp: new Date(), toolCall: { id: 't1', name: 'view', status: 'completed' as const, startTime: new Date(), endTime: new Date(), args: { path: 'x' } } },
        ];
        const opts = makeOpts({
            executeByTypeFn: vi.fn(async () => {
                runner.seedSession(processId, '', timeline);
                throw new Error('timeout');
            }),
        });

        await runner.run(task, opts);

        const proc = await store.getProcess(processId);
        const assistantTurn = proc?.conversationTurns?.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn?.timeline).toHaveLength(1);
        expect(assistantTurn?.timeline?.[0].type).toBe('tool-complete');
    });

    it('falls back to status-only update when nothing was accumulated', async () => {
        const task = makeTask();
        const opts = makeOpts({
            executeByTypeFn: vi.fn().mockRejectedValue(new Error('immediate failure')),
        });

        await runner.run(task, opts);

        const proc = await store.getProcess(`queue_${task.id}`);
        expect(proc?.status).toBe('failed');
        expect(proc?.error).toBe('immediate failure');
        const turns = proc?.conversationTurns ?? [];
        expect(turns.find(t => t.role === 'assistant')).toBeUndefined();
    });

    it('marks status as cancelled (no error message) when cancellation triggered the error', async () => {
        const cancelledTasks = new Set<string>();
        const task = makeTask();
        const processId = `queue_${task.id}`;
        const opts = makeOpts({
            cancelledTasks,
            executeByTypeFn: vi.fn(async () => {
                runner.seedSession(processId, 'Some partial response');
                cancelledTasks.add(task.id);
                throw new Error('Aborted');
            }),
        });

        await runner.run(task, opts);

        const proc = await store.getProcess(processId);
        expect(proc?.status).toBe('cancelled');
        expect(proc?.error).toBeUndefined();
        const assistantTurn = proc?.conversationTurns?.find(t => t.role === 'assistant');
        expect(assistantTurn?.content).toBe('Some partial response');
    });

    it('replaces orphaned streaming turn (does not duplicate) via filterStreaming', async () => {
        const task = makeTask();
        const processId = `queue_${task.id}`;
        const opts = makeOpts({
            executeByTypeFn: vi.fn(async () => {
                await store.upsertStreamingTurn(processId, 'old streaming content', true, []);
                runner.seedSession(processId, 'final partial content');
                throw new Error('timeout');
            }),
        });

        await runner.run(task, opts);

        const proc = await store.getProcess(processId);
        const assistantTurns = (proc?.conversationTurns ?? []).filter(t => t.role === 'assistant');
        expect(assistantTurns).toHaveLength(1);
        expect(assistantTurns[0].content).toBe('final partial content');
        expect(assistantTurns[0].streaming).toBeFalsy();
    });

    it('emits process-complete event even on error path', async () => {
        const task = makeTask();
        const processId = `queue_${task.id}`;
        const opts = makeOpts({
            executeByTypeFn: vi.fn(async () => {
                runner.seedSession(processId, 'partial');
                throw new Error('timeout');
            }),
        });

        await runner.run(task, opts);

        expect(store.completions.has(processId)).toBe(true);
        expect(store.completions.get(processId)?.status).toBe('failed');
    });

    it('does not write a duplicate assistant turn on the happy path', async () => {
        const task = makeTask();
        const processId = `queue_${task.id}`;
        await runner.run(task, makeOpts({
            executeByTypeFn: vi.fn().mockResolvedValue({ response: 'final answer' }),
        }));

        const proc = await store.getProcess(processId);
        const assistantTurns = (proc?.conversationTurns ?? []).filter(t => t.role === 'assistant');
        expect(assistantTurns).toHaveLength(1);
        expect(assistantTurns[0].content).toBe('final answer');
    });

    it('still finalizes process status when appendConversationTurn itself throws', async () => {
        const task = makeTask();
        const processId = `queue_${task.id}`;

        const originalAppend = store.appendConversationTurn as any;
        (store.appendConversationTurn as any) = vi.fn()
            .mockRejectedValueOnce(new Error('store unavailable'))
            .mockImplementation(originalAppend);

        const opts = makeOpts({
            executeByTypeFn: vi.fn(async () => {
                runner.seedSession(processId, 'partial content');
                throw new Error('timeout');
            }),
        });

        await runner.run(task, opts);

        const proc = await store.getProcess(processId);
        expect(proc?.status).toBe('failed');
        expect(proc?.error).toBe('timeout');
    });
});

// ============================================================================
// Follow-up lifecycle status ordering
// ============================================================================

describe('ProcessLifecycleRunner — follow-up lifecycle status ordering', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let runner: ProcessLifecycleRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
        runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
    });

    it('marks the target process as running BEFORE invoking executeFollowUpFn', async () => {
        const processId = 'existing-process';
        store.processes.set(processId, {
            id: processId,
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            conversationTurns: [
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        } as any);

        const callOrder: string[] = [];
        (store.updateProcess as any).mockImplementation(async (id: string, updates: any) => {
            if (updates?.status === 'running' && id === processId) {
                callOrder.push('updateProcess:running');
            }
            const existing = store.processes.get(id);
            if (existing) { store.processes.set(id, { ...existing, ...updates }); }
        });
        const executeFollowUpFn = vi.fn(async () => {
            callOrder.push('executeFollowUpFn');
        });

        const followUpTask = makeTask({
            id: 'followup-task-1',
            payload: {
                kind: 'chat',
                prompt: 'Follow-up question',
                processId,
                workspaceId: 'ws-abc',
            } as any,
        });

        const result = await runner.run(followUpTask, makeOpts({ executeFollowUpFn }));

        expect(result.success).toBe(true);
        expect(executeFollowUpFn).toHaveBeenCalledOnce();
        expect(callOrder.indexOf('updateProcess:running')).toBeGreaterThanOrEqual(0);
        expect(callOrder.indexOf('updateProcess:running'))
            .toBeLessThan(callOrder.indexOf('executeFollowUpFn'));
    });

    it('fails the task fail-loud if the pre-execution status update throws', async () => {
        const processId = 'existing-process';
        store.processes.set(processId, {
            id: processId,
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            conversationTurns: [],
        } as any);

        (store.updateProcess as any).mockRejectedValueOnce(new Error('db down'));
        const executeFollowUpFn = vi.fn().mockResolvedValue(undefined);

        const followUpTask = makeTask({
            id: 'followup-task-2',
            payload: {
                kind: 'chat',
                prompt: 'Follow-up',
                processId,
                workspaceId: 'ws-abc',
            } as any,
        });

        const result = await runner.run(followUpTask, makeOpts({ executeFollowUpFn }));

        expect(result.success).toBe(false);
        expect(result.error?.message).toBe('db down');
        expect(executeFollowUpFn).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Provider attribution (AC-09)
// ============================================================================

describe('ProcessLifecycleRunner — provider attribution', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        vi.clearAllMocks();
        store = createMockProcessStore();
    });

    it('defaults metadata.provider to "copilot" when no provider is specified', async () => {
        const runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn());
        const task = makeTask();
        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        expect(proc?.metadata?.provider).toBe('copilot');
    });

    it('sets metadata.provider to "copilot" when explicitly constructed with copilot', async () => {
        const runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn(), 'copilot');
        const task = makeTask();
        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        expect(proc?.metadata?.provider).toBe('copilot');
    });

    it('sets metadata.provider to "codex" when constructed with codex provider', async () => {
        const runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn(), 'codex');
        const task = makeTask();
        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        expect(proc?.metadata?.provider).toBe('codex');
    });

    it('records codex provider for run-script tasks too', async () => {
        const runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn(), 'codex');
        const task = makeTask({
            type: 'run-script',
            displayName: 'npm test',
            payload: { kind: 'run-script', script: 'npm test' } as any,
        });
        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        expect(proc?.metadata?.provider).toBe('codex');
    });

    it('uses payload.provider over runner-level provider when payload.provider is set', async () => {
        // Runner is constructed with copilot but payload explicitly requests codex.
        const runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn(), 'copilot');
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Hello from codex',
                workspaceId: 'ws-abc',
                provider: 'codex',
            } as any,
        });
        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        expect(proc?.metadata?.provider).toBe('codex');
    });

    it('falls back to runner-level provider when payload.provider is absent', async () => {
        // Runner is codex; payload omits provider — should use codex.
        const runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn(), 'codex');
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'No explicit provider',
                workspaceId: 'ws-abc',
                // provider omitted
            } as any,
        });
        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        expect(proc?.metadata?.provider).toBe('codex');
    });

    it('payload.provider copilot wins over runner-level codex', async () => {
        const runner = new ProcessLifecycleRunner(store as any, '/data-dir', vi.fn(), 'codex');
        const task = makeTask({
            payload: {
                kind: 'chat',
                prompt: 'Use copilot explicitly',
                workspaceId: 'ws-abc',
                provider: 'copilot',
            } as any,
        });
        await runner.run(task, makeOpts());

        const proc = await store.getProcess(`queue_${task.id}`);
        expect(proc?.metadata?.provider).toBe('copilot');
    });
});
