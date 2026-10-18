import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, type QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner, type LifecycleRunnerOptions } from '../../../src/server/executors/process-lifecycle-runner';
import { defaultIsExclusive } from '../../../src/server/queue/queue-executor-bridge';
import { SentinelJobService, getJobTaskContext } from '../../../src/server/sentinel-jobs/job-service';
import { SentinelJobStore } from '../../../src/server/sentinel-jobs/job-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createTodoTestDatabase } from '../sentinel-todos/test-db';

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

const owner = { workspaceId: 'ws-jobs', processId: 'queue_sentinel' };
let fixture: ReturnType<typeof createTodoTestDatabase>;
let jobs: SentinelJobStore;
let service: SentinelJobService;
let queue: TaskQueueManager;
let store: ReturnType<typeof createMockProcessStore>;
let runner: ProcessLifecycleRunner;
let options: LifecycleRunnerOptions;
let enabled: boolean;

beforeEach(async () => {
    const directory = path.resolve('.sentinel-jobs-tests', randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    fixture = createTodoTestDatabase(directory);
    jobs = new SentinelJobStore(fixture.db);
    enabled = true;
    store = createMockProcessStore({ initialWorkspaces: [{ id: owner.workspaceId,
        rootPath: process.cwd(), name: 'Jobs' }] });
    await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
        promptPreview: 'Sentinel', conversationTurns: [],
        metadata: { type: 'chat', ...owner, mode: 'sentinel', provider: 'copilot' } });
    const todos = new SentinelTodoService({ todos: new SentinelTodoStore(fixture.db), store });
    queue = new TaskQueueManager({ keepHistory: true, isExclusive: defaultIsExclusive });
    service = new SentinelJobService({ dataDir: fixture.dataDir, jobs, todos, store, getEnabled: () => enabled,
        enqueue: async input => queue.enqueue(input), cancelTask: id => queue.cancelTask(id),
        getTask: id => queue.getTask(id) });
    const listeners = new Map<unknown, (...args: unknown[]) => void>();
    service.attach({
        on(event, listener) {
            const wrapped = (task: QueuedTask, detail?: unknown) => listener(process.cwd(), task, detail);
            listeners.set(listener, wrapped as never);
            queue.on(event, wrapped as never);
        },
        off(event, listener) { queue.off(event, listeners.get(listener) as never); listeners.delete(listener); },
    });
    runner = new ProcessLifecycleRunner(store, directory, vi.fn(), 'copilot', {
        getSentinelScheduledJobs: () => service,
    });
    options = {
        cancelledTasks: new Set(),
        executeByTypeFn: vi.fn(async () => { throw new Error('Jobs must never create a fresh process per run'); }),
        getWorkingDirectoryFn: () => process.cwd(),
        executeFollowUpFn: vi.fn(async (id, _prompt, _attachments, mode, ...rest) => {
            const executionOptions = rest[rest.length - 1] as { sentinelScheduledJob?: boolean };
            if (id !== owner.processId) {
                expect(['ask', 'autopilot']).toContain(mode);
                expect(executionOptions.sentinelScheduledJob).toBe(true);
            } else expect(executionOptions.sentinelScheduledJob).toBeUndefined();
            await store.appendConversationTurn(id, turnIndex => ({
                turnIndex, role: 'assistant', content: id === owner.processId ? 'Reviewed' : 'Job evidence',
                timestamp: new Date(), timeline: [],
            }));
        }),
    };
});
afterEach(async () => { await service.shutdown(); fixture.dispose(); });

async function execute(task: QueuedTask): Promise<void> {
    queue.markStarted(task.id);
    const result = await runner.run(task, options);
    if (result.success) queue.markCompleted(task.id, result.result);
    else queue.markFailed(task.id, result.error!);
}

describe('scheduled job queue and lifecycle integration', () => {
    it('runs jobs in parallel, serializes handbacks behind the Sentinel, and adds turns to a stable chat', async () => {
        const sentinelTurn = queue.enqueue({ id: 'sentinel-active', processId: owner.processId, repoId: owner.workspaceId,
            type: 'chat', priority: 'normal', payload: { kind: 'chat', mode: 'sentinel',
                processId: owner.processId, workspaceId: owner.workspaceId, prompt: 'Busy' }, config: {} });
        queue.markStarted(sentinelTurn);
        const a = jobs.create(owner, { name: 'A', instructions: 'Read', provider: 'copilot', model: 'model' });
        const b = jobs.create(owner, { name: 'B', instructions: 'Read', provider: 'copilot', model: 'model', mode: 'autopilot' });
        const runA = await service.start(owner, a.id);
        const runB = await service.start(owner, b.id);
        const taskA = queue.getTask(runA.taskId!)!;
        const taskB = queue.getTask(runB.taskId!)!;
        expect(defaultIsExclusive(taskA)).toBe(false);
        expect(defaultIsExclusive(taskB)).toBe(false);
        queue.markStarted(taskA.id);
        expect(queue.peek()?.id).toBe(taskB.id);
        const result = await runner.run(taskA, options);
        expect(result.success).toBe(true);
        queue.markCompleted(taskA.id, result.result);
        await vi.waitFor(() => expect(jobs.run(owner, a.id, runA.id).handbackState).toBe('queued'));
        expect(queue.peek()?.id).toBe(taskB.id); // handback cannot run alongside the active Sentinel
        await execute(taskB);
        await vi.waitFor(() => expect(jobs.run(owner, b.id, runB.id).handbackState).toBe('queued'));
        expect(queue.peek()).toBeUndefined();
        queue.markCompleted(sentinelTurn, 'done');
        const handbackA = queue.getTask(jobs.run(owner, a.id, runA.id).handbackTaskId!)!;
        expect(queue.peek()?.id).toBe(handbackA.id);
        await execute(handbackA);
        await vi.waitFor(() => expect(jobs.run(owner, a.id, runA.id).handbackState).toBe('delivered'));
        expect(jobs.run(owner, a.id, runA.id).sentinelFollowUpHref).toContain('?turn=0');
        const next = await service.start(owner, a.id);
        await execute(queue.getTask(next.taskId!)!);
        await vi.waitFor(() => expect(jobs.run(owner, a.id, next.id).status).toBe('completed'));
        const persistentId = jobs.get(owner, a.id).processId!;
        expect(store.processes.size).toBe(3); // Sentinel plus exactly one process per job
        expect((await store.getProcess(persistentId))?.conversationTurns?.map(turn => turn.role))
            .toEqual(['user', 'assistant', 'user', 'assistant']);
        expect(jobs.run(owner, a.id, next.id).jobTurnHref).toContain('?turn=2');
        expect(options.executeByTypeFn).not.toHaveBeenCalled();
        expect(getJobTaskContext(taskA)?.kind).toBe('run');
    });

    it('checks live gates in the real lifecycle before invoking the provider', async () => {
        const job = jobs.create(owner, { name: 'A', instructions: 'Read', provider: 'copilot', model: 'model' });
        const run = await service.start(owner, job.id);
        const task = queue.getTask(run.taskId!)!;
        enabled = false;
        await execute(task);
        expect(options.executeFollowUpFn).not.toHaveBeenCalled();
        expect(queue.getTask(task.id)?.status).toBe('failed');
        await vi.waitFor(() => expect(jobs.run(owner, job.id, run.id).status).toBe('failed'));
        expect(jobs.run(owner, job.id, run.id).handbackState).toBe('suppressed');
    });

    it('keeps restart interruption authoritative even when cancelling a restored task emits a terminal event', async () => {
        const job = jobs.create(owner, { name: 'A', instructions: 'Read', provider: 'copilot', model: 'model' });
        const run = await service.start(owner, job.id);
        await service.recover();
        expect(queue.getTask(run.taskId!)?.status).toBe('cancelled');
        await vi.waitFor(() => expect(jobs.run(owner, job.id, run.id).status).toBe('interrupted'));
        expect(jobs.run(owner, job.id, run.id).error).toContain('restarted');
    });
});
