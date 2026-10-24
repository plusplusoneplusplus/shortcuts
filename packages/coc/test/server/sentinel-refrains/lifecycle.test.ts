import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, type QueuedTask } from '@plusplusoneplusplus/forge';
import { ProcessLifecycleRunner, type LifecycleRunnerOptions } from '../../../src/server/executors/process-lifecycle-runner';
import { defaultIsExclusive } from '../../../src/server/queue/queue-executor-bridge';
import { SentinelRefrainService, getRefrainTaskContext } from '../../../src/server/sentinel-refrains/refrain-service';
import { SentinelRefrainStore } from '../../../src/server/sentinel-refrains/refrain-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { registerSentinelRefrainRoutes } from '../../../src/server/sentinel-refrains/refrain-routes';
import { createRouter, type Route } from '../../../src/server/shared/router';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createTodoTestDatabase } from '../sentinel-todos/test-db';

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

const owner = { workspaceId: 'ws-jobs', processId: 'queue_sentinel' };
let fixture: ReturnType<typeof createTodoTestDatabase>;
let jobs: SentinelRefrainStore;
let service: SentinelRefrainService;
let queue: TaskQueueManager;
let store: ReturnType<typeof createMockProcessStore>;
let runner: ProcessLifecycleRunner;
let options: LifecycleRunnerOptions;
let enabled: boolean;

beforeEach(async () => {
    const directory = path.resolve('.sentinel-jobs-tests', randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    fixture = createTodoTestDatabase(directory);
    jobs = new SentinelRefrainStore(fixture.db);
    enabled = true;
    store = createMockProcessStore({ initialWorkspaces: [{ id: owner.workspaceId,
        rootPath: process.cwd(), name: 'Jobs' }] });
    await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
        promptPreview: 'Sentinel', conversationTurns: [],
        metadata: { type: 'chat', ...owner, mode: 'sentinel', provider: 'copilot' } });
    const todos = new SentinelTodoService({ todos: new SentinelTodoStore(fixture.db), store });
    queue = new TaskQueueManager({ keepHistory: true, isExclusive: defaultIsExclusive });
    service = new SentinelRefrainService({ dataDir: fixture.dataDir, jobs, todos, store, getEnabled: () => enabled,
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
        getSentinelRefrains: () => service,
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
    it.each(['cancelled', 'enqueue-failed'])('reuses the persisted chat with a fresh task ID after the first run is %s', async outcome => {
        const job = jobs.create(owner, { name: 'A', instructions: 'Read', provider: 'copilot', model: 'model' });
        if (outcome === 'enqueue-failed') {
            vi.spyOn(service.deps, 'enqueue').mockImplementationOnce(async input => {
                expect(await store.getProcess(input.processId!)).toBeDefined();
                throw new Error('Queue admission unavailable');
            });
        }
        const first = await service.start(owner, job.id);
        const firstRecord = jobs.run(owner, job.id, first.id);
        const processId = jobs.get(owner, job.id).processId!;
        expect(await store.getProcess(processId)).toBeDefined();
        if (outcome === 'cancelled') {
            expect(queue.getTask(firstRecord.taskId!)?.status).toBe('queued');
            await service.cancel(owner, job.id, first.id);
            expect(queue.getTask(firstRecord.taskId!)?.status).toBe('cancelled');
        } else expect(first.status).toBe('failed');
        const next = await service.start(owner, job.id);
        expect(next.status).toBe('queued');
        expect(next.taskId).not.toBe(firstRecord.taskId);
        const nextTask = queue.getTask(next.taskId!)!;
        expect(nextTask.processId).toBe(processId);
        expect(jobs.get(owner, job.id).processId).toBe(processId);
        await execute(nextTask);
        await vi.waitFor(() => expect(jobs.run(owner, job.id, next.id).status).toBe('completed'));
        expect((await store.getProcess(processId))?.conversationTurns?.map(turn => turn.role)).toEqual(['user', 'assistant']);
        expect(store.processes.size).toBe(2);
        expect(options.executeByTypeFn).not.toHaveBeenCalled();
    });

    it('executes HTTP-created runs through the queue and lifecycle, then gates both routes and queued provider dispatch live', async () => {
        const routes: Route[] = [];
        registerSentinelRefrainRoutes({ routes, jobs, service, onConfigChange: () => {} });
        const server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Missing server address');
            const base = `http://127.0.0.1:${address.port}/api/workspaces/${owner.workspaceId}/sentinel-todos/${owner.processId}/jobs`;
            const created = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'HTTP job', instructions: 'Read the snapshot', provider: 'copilot', model: 'model' }) });
            expect(created.status).toBe(201);
            const job = await created.json() as { id: string };
            const response = await fetch(`${base}/${job.id}/runs`, { method: 'POST' });
            expect(response.status).toBe(202);
            const run = await response.json() as { id: string };
            const task = queue.getTask(jobs.run(owner, job.id, run.id).taskId!)!;
            await execute(task);
            await vi.waitFor(() => expect(jobs.run(owner, job.id, run.id).status).toBe('completed'));
            expect(queue.peek()).toBeUndefined(); // completion queues no Sentinel turn
            const result = await (await fetch(base)).json() as { jobs: Array<{ processId: string; runs: unknown[] }> };
            expect(result.jobs[0].processId).toBe(task.processId);
            expect(result.jobs[0].runs).toEqual([expect.objectContaining({
                status: 'completed', turnIndex: 0,
                jobTurnHref: `#repos/${owner.workspaceId}/chats/${task.processId}?turn=0`,
            })]);
            expect(result.jobs[0].runs[0]).not.toHaveProperty('sentinelFollowUpHref');

            const nextResponse = await fetch(`${base}/${job.id}/runs`, { method: 'POST' });
            expect(nextResponse.status).toBe(202);
            const next = await nextResponse.json() as { id: string };
            const nextTask = queue.getTask(jobs.run(owner, job.id, next.id).taskId!)!;
            expect(nextTask.processId).toBe(task.processId);
            enabled = false;
            expect((await fetch(base)).status).toBe(404);
            expect((await fetch(`${base}/${job.id}/runs`, { method: 'POST' })).status).toBe(404);
            await execute(nextTask);
            await vi.waitFor(() => expect(jobs.run(owner, job.id, next.id).status).toBe('failed'));
            expect(options.executeFollowUpFn).toHaveBeenCalledTimes(1);
            expect(options.executeByTypeFn).not.toHaveBeenCalled();
            enabled = true;
            expect((await fetch(base)).status).toBe(200);
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    it('runs jobs in parallel beside an active Sentinel, never queues a Sentinel turn, and adds turns to a stable chat', async () => {
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
        await vi.waitFor(() => expect(jobs.run(owner, a.id, runA.id).status).toBe('completed'));
        expect(queue.peek()?.id).toBe(taskB.id);
        await execute(taskB);
        await vi.waitFor(() => expect(jobs.run(owner, b.id, runB.id).status).toBe('completed'));
        queue.markCompleted(sentinelTurn, 'done');
        expect(queue.peek()).toBeUndefined();
        expect((await store.getProcess(owner.processId))?.conversationTurns).toEqual([]);
        const next = await service.start(owner, a.id);
        await execute(queue.getTask(next.taskId!)!);
        await vi.waitFor(() => expect(jobs.run(owner, a.id, next.id).status).toBe('completed'));
        const persistentId = jobs.get(owner, a.id).processId!;
        expect(store.processes.size).toBe(3); // Sentinel plus exactly one process per job
        expect((await store.getProcess(persistentId))?.conversationTurns?.map(turn => turn.role))
            .toEqual(['user', 'assistant', 'user', 'assistant']);
        expect(jobs.run(owner, a.id, next.id).jobTurnHref).toContain('?turn=2');
        expect(options.executeFollowUpFn).toHaveBeenCalledTimes(3);
        expect(vi.mocked(options.executeFollowUpFn!).mock.calls.map(([id]) => id)).not.toContain(owner.processId);
        expect(options.executeByTypeFn).not.toHaveBeenCalled();
        expect(getRefrainTaskContext(taskA)?.kind).toBe('run');
    });

    it('fails a restored legacy handback task before the Sentinel provider runs', async () => {
        const job = jobs.create(owner, { name: 'A', instructions: 'Read', provider: 'copilot', model: 'model' });
        const run = jobs.createRun(owner, job.id, 'manual', 'queue_job', new Date().toISOString());
        jobs.patchRun(owner, job.id, run.id, { status: 'completed', handbackState: 'queued', handbackTaskId: 'legacy-handback' });
        queue.enqueue({ id: 'legacy-handback', processId: owner.processId, repoId: owner.workspaceId, type: 'chat', priority: 'low',
            payload: { kind: 'chat', mode: 'sentinel', processId: owner.processId, workspaceId: owner.workspaceId,
                prompt: '[Job: A] run #1 finished — old result',
                context: { sentinelScheduledJob: { ...owner, jobId: job.id, runId: run.id, kind: 'handback' } } }, config: {} });
        await execute(queue.getTask('legacy-handback')!);
        expect(queue.getTask('legacy-handback')?.status).toBe('failed');
        expect(options.executeFollowUpFn).not.toHaveBeenCalled();
        expect((await store.getProcess(owner.processId))?.conversationTurns).toEqual([]);
        expect(jobs.run(owner, job.id, run.id).status).toBe('completed');
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
        expect(queue.peek()).toBeUndefined();
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
