import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, CreateTaskInput, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { SentinelJobStore } from '../../../src/server/sentinel-jobs/job-store';
import { SentinelJobService, getJobTaskContext } from '../../../src/server/sentinel-jobs/job-service';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createTodoTestDatabase } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const input = { name: 'Review', instructions: 'Check evidence', provider: 'copilot' as const, model: 'gpt' };
const NOW = '2026-10-18T10:00:00.000Z';

let fixture: ReturnType<typeof createTodoTestDatabase>;
let jobStore: SentinelJobStore;
let todoStore: SentinelTodoStore;
let todoService: SentinelTodoService;
let service: SentinelJobService;
let processes: Map<string, AIProcess>;
let enabled: boolean;
let enqueue: ReturnType<typeof vi.fn>;
let cancelTask: ReturnType<typeof vi.fn>;
let tasks: Map<string, Pick<QueuedTask, 'status'>>;
let onChange: ReturnType<typeof vi.fn>;
let clock: number;

function process(id: string, overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id, type: 'chat', promptPreview: '', fullPrompt: '', status: 'running', startTime: new Date(),
        metadata: { mode: 'sentinel', workspaceId: owner.workspaceId, provider: 'copilot' },
        conversationTurns: [],
        ...overrides,
    } as unknown as AIProcess;
}

function addProcess(id: string, overrides: Partial<AIProcess> = {}) {
    const p = process(id, overrides);
    processes.set(id, p);
    return p;
}

function assistantTurn(turnIndex: number, content: string, overrides: Record<string, unknown> = {}) {
    return { role: 'assistant', content, turnIndex, timestamp: new Date(), timeline: [], ...overrides };
}

let stallWorkspaces: Promise<void> | null = null;

function makeService(overrides: { getEnabled?: () => boolean } = {}): SentinelJobService {
    return new SentinelJobService({
        dataDir: fixture.dataDir,
        jobs: jobStore,
        todos: todoService,
        store: {
            getWorkspaces: async () => {
                if (stallWorkspaces) await stallWorkspaces;
                return [{ id: owner.workspaceId, name: 'a', rootPath: '/a' }];
            },
            getProcess: async (id: string) => processes.get(id),
            addProcess: async (value: AIProcess) => { processes.set(value.id, value); },
            updateProcess: async (id: string, updates: Partial<AIProcess>) => {
                const current = processes.get(id);
                if (current) processes.set(id, { ...current, ...updates, metadata: { ...current.metadata, ...updates.metadata } });
            },
        } as unknown as ProcessStore,
        getEnabled: overrides.getEnabled ?? (() => enabled),
        enqueue,
        cancelTask,
        getTask: (id: string) => tasks.get(id),
        onChange,
        now: () => new Date(clock),
    });
}

/** Minimal stand-in for the task queue's EventEmitter-shaped terminal events. */
class FakeQueue {
    private listeners = new Map<string, Set<(repo: string, task: QueuedTask, detail?: unknown) => void>>();
    on(event: string, listener: (repo: string, task: QueuedTask, detail?: unknown) => void): this {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(listener);
        return this;
    }
    off(event: string, listener: (repo: string, task: QueuedTask, detail?: unknown) => void): this {
        this.listeners.get(event)?.delete(listener);
        return this;
    }
    emit(event: string, repo: string, task: QueuedTask, detail?: unknown): void {
        for (const listener of [...(this.listeners.get(event) ?? [])]) listener(repo, task, detail);
    }
}

/** Flush the microtask queue enough times for tracked async terminal handling to settle. */
async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

function guardTask(call: CreateTaskInput, overrides: Partial<QueuedTask> = {}): QueuedTask {
    return { id: call.id!, repoId: call.repoId, processId: call.processId, payload: call.payload, status: 'running', ...overrides } as QueuedTask;
}

beforeEach(() => {
    const directory = path.resolve('.sentinel-jobs-tests', randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    fixture = createTodoTestDatabase(directory);
    jobStore = new SentinelJobStore(fixture.db);
    todoStore = new SentinelTodoStore(fixture.db);
    processes = new Map();
    enabled = true;
    tasks = new Map();
    clock = Date.parse(NOW);
    onChange = vi.fn();
    enqueue = vi.fn(async (taskInput: CreateTaskInput) => taskInput.id!);
    cancelTask = vi.fn(() => true);
    addProcess(owner.processId);
    todoService = new SentinelTodoService({ todos: todoStore, store: { getProcess: async (id: string) => processes.get(id) } as unknown as ProcessStore });
    service = makeService();
});
afterEach(() => fixture.dispose());

describe('SentinelJobService', () => {
    it('allows an explicit manual run of a paused job while refusing scheduled admission', async () => {
        const job = jobStore.create(owner, { ...input, enabled: false });
        await expect(service.start(owner, job.id, 'schedule')).rejects.toMatchObject({ code: 'conflict' });
        const run = await service.start(owner, job.id);
        expect(run.status).toBe('queued');
        await expect(service.guard(guardTask(enqueue.mock.calls[0][0]))).resolves.toBeUndefined();
    });
    it('preserves the compaction failure/pause state across runs and resets only a changed threshold', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        const chat = processes.get(call.processId!)!;
        const state = { enabled: true, thresholdTokens: 100_000, consecutiveFailures: 3,
            paused: { reason: 'failures', at: NOW }, lastEvaluatedTurnIndex: 4 };
        processes.set(chat.id, { ...chat, metadata: { ...chat.metadata!, autoCompact: state } });
        await service.guard(guardTask(call));
        expect(processes.get(chat.id)?.metadata?.autoCompact).toEqual(state);
        expect(jobStore.run(owner, job.id, run.id).status).toBe('running');
        expect(processes.get(chat.id)?.metadata?.mode).toBe('ask');
    });

    it('does not admit a stale timer after an asynchronous owner check', async () => {
        const job = jobStore.create(owner, input);
        await expect(service.start(owner, job.id, 'schedule', () => false)).rejects.toMatchObject({ code: 'conflict' });
        expect(jobStore.runs(owner, job.id)).toEqual([]);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('keeps the persistent chat after a snapshot-read failure so the next run is usable', async () => {
        const job = jobStore.create(owner, input);
        const list = vi.spyOn(todoService, 'list').mockRejectedValueOnce(new Error('Snapshot unavailable'));
        const failed = await service.start(owner, job.id);
        expect(failed.status).toBe('failed');
        const processId = jobStore.get(owner, job.id).processId;
        expect(processes.has(processId!)).toBe(true);
        const next = await service.start(owner, job.id);
        expect(next.status).toBe('queued');
        expect(jobStore.get(owner, job.id).processId).toBe(processId);
        list.mockRestore();
    });

    it('does not replay a completed Sentinel handback after queue history is evicted', async () => {
        const job = jobStore.create(owner, input);
        const run = jobStore.createRun(owner, job.id, 'manual', 'queue_job', NOW);
        jobStore.patchRun(owner, job.id, run.id, { status: 'completed', handbackState: 'queued', handbackTaskId: 'old-handback' });
        addProcess(owner.processId, { conversationTurns: [
            { role: 'user', content: 'handback', turnIndex: 2, timestamp: new Date(),
                relayRequestId: `sentinel-job-handback:${run.id}` },
            assistantTurn(3, 'reviewed'),
        ] as never });
        await service.recover();
        expect(jobStore.run(owner, job.id, run.id)).toMatchObject({ handbackState: 'delivered',
            sentinelFollowUpHref: expect.stringContaining('?turn=2') });
        expect(enqueue).not.toHaveBeenCalled();
    });
    it('creates one persistent chat and relays every run through that same chat', async () => {
        const job = jobStore.create(owner, input);
        const first = await service.start(owner, job.id);
        expect(first.status).toBe('queued');
        expect(enqueue).toHaveBeenCalledTimes(1);
        const call1 = enqueue.mock.calls[0][0] as CreateTaskInput;
        expect(call1.priority).toBe('low');
        expect(call1.type).toBe('chat');
        expect(call1.processId).toBe(toQueueProcessId(call1.id!));
        expect((call1.payload as Record<string, unknown>).processId).toBe(call1.processId);
        expect((call1.payload as Record<string, unknown>).relayRequestId).toBe(`sentinel-job:${first.id}`);
        expect(call1.config).toMatchObject({ timeoutMs: 0, retryAttempts: 0, retryOnFailure: false });
        expect(processes.get(call1.processId!)?.metadata).toMatchObject({
            mode: 'ask', autoCompact: { enabled: true, thresholdTokens: 100_000 },
        });
        expect(getJobTaskContext({ payload: call1.payload })).toMatchObject({
            workspaceId: owner.workspaceId, processId: owner.processId, jobId: job.id, runId: first.id, kind: 'run',
        });
        const chatProcessId = call1.processId!;
        expect(jobStore.get(owner, job.id).processId).toBe(chatProcessId);
        addProcess(chatProcessId);
        await service.guard(guardTask(call1));

        const queue = new FakeQueue();
        service.attach(queue);
        queue.emit('taskCompleted', owner.workspaceId, guardTask(call1, { status: 'completed' }));
        await flush();
        expect(jobStore.run(owner, job.id, first.id).status).toBe('completed');
        expect(enqueue).toHaveBeenCalledTimes(2); // the Sentinel handback queued automatically

        const second = await service.start(owner, job.id);
        expect(enqueue).toHaveBeenCalledTimes(3);
        const call2 = enqueue.mock.calls[2][0] as CreateTaskInput;
        expect(call2.processId).toBe(chatProcessId); // same persistent chat, not a new one
        expect((call2.payload as Record<string, unknown>).processId).toBe(chatProcessId);
        expect((call2.payload as Record<string, unknown>).relayRequestId).toBe(`sentinel-job:${second.id}`);
    });

    it('writes a fresh read-only snapshot per run, referenced by path only — never inlined — and never the owning Sentinel\'s identity', async () => {
        todoStore.create(owner, { title: 'Ship the feature' }, { actor: 'sentinel' });
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        const prompt = (call.payload as Record<string, unknown>).prompt as string;
        const match = /Fresh read-only Sentinel to-do snapshot: (.+)$/m.exec(prompt);
        expect(match).toBeTruthy();
        const snapshotPath = match![1];
        expect(prompt).not.toContain('Ship the feature'); // ledger content is never inlined into the prompt
        expect(prompt).toContain('You are a job chat, not the owning Sentinel');
        expect((call.payload as Record<string, unknown>).context).not.toHaveProperty('actor');
        expect(JSON.stringify(call.payload)).not.toContain('"actor"'); // no Sentinel actor identity leaks into the run payload

        const content = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        expect(content).toMatchObject({ owner, jobId: job.id, runId: run.id, readOnly: true });
        expect(content.ledger.items[0].title).toBe('Ship the feature');
        if (process.platform !== 'win32') expect(fs.statSync(snapshotPath).mode & 0o777).toBe(0o400);

        // A second run gets its own fresh snapshot at a different path.
        addProcess(call.processId!);
        await service.guard(guardTask(call));
        const queue = new FakeQueue();
        service.attach(queue);
        queue.emit('taskCompleted', owner.workspaceId, guardTask(call, { status: 'completed' }));
        await flush();
        const second = await service.start(owner, job.id);
        const call2 = enqueue.mock.calls[1 + 1][0] as CreateTaskInput; // index 2: handback is index 1
        const match2 = /Fresh read-only Sentinel to-do snapshot: (.+)$/m.exec((call2.payload as Record<string, unknown>).prompt as string);
        expect(match2![1]).not.toBe(snapshotPath);
        expect(fs.existsSync(match2![1])).toBe(true);
        void second;
    });

    it('is single-flight per job but runs independent jobs in parallel', async () => {
        const a = jobStore.create(owner, input);
        const b = jobStore.create(owner, input);
        const [r1, r2] = await Promise.allSettled([service.start(owner, a.id), service.start(owner, a.id)]);
        // Exactly one of the two concurrent manual starts for the same job wins the single-flight claim;
        // the loser rejects with a conflict rather than silently no-op-ing.
        const outcomes = [r1, r2];
        expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1);
        const rejected = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({ code: 'conflict' });
        expect(enqueue).toHaveBeenCalledTimes(1); // the overlapping manual start never enqueues
        const rb = await service.start(owner, b.id);
        expect(rb.status).toBe('queued');
        expect(enqueue).toHaveBeenCalledTimes(2); // an independent job proceeds normally
    });

    it('throws immediately, without creating a run, when the owner or feature flag is already invalid', async () => {
        const job = jobStore.create(owner, input);
        enabled = false;
        await expect(service.start(owner, job.id)).rejects.toMatchObject({ code: 'not_found' });
        expect(jobStore.runs(owner, job.id)).toEqual([]);
        expect(enqueue).not.toHaveBeenCalled();
        enabled = true;
        await expect(service.start({ ...owner, processId: 'queue_missing' }, job.id)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('re-checks the owner/feature gate after the snapshot write and aborts to a failed run without enqueueing', async () => {
        let calls = 0;
        const gatedService = makeService({ getEnabled: () => { calls++; return calls <= 2; } });
        const job = jobStore.create(owner, input);
        const run = await gatedService.start(owner, job.id);
        expect(run.status).toBe('failed');
        expect(run.error).toMatch(/disabled/);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('aborts without enqueueing when the job was disabled or its run was cancelled between snapshot and admission', async () => {
        const job = jobStore.create(owner, input);
        const run = jobStore.createRun(owner, job.id, 'manual', 'queue_x', NOW);
        addProcess('queue_x'); // the persistent chat from that earlier run already exists
        // Simulate a concurrent cancel landing between the snapshot write and the enqueue call.
        jobStore.patchRun(owner, job.id, run.id, { status: 'cancelled' }, ['queued']);
        const resumed = await service.start(owner, job.id);
        // A fresh manual start claims a new run (the cancelled one is no longer active) — prove the stale one stays untouched.
        expect(jobStore.run(owner, job.id, run.id).status).toBe('cancelled');
        expect(resumed.status).toBe('queued');
    });

    it('guard rejects forged, stale, disabled and deleted run tasks', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id, 'schedule');
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        const valid = guardTask(call);
        await expect(service.guard({ ...valid, id: 'forged-task-id' })).rejects.toMatchObject({ code: 'conflict' });
        await expect(service.guard({ ...valid, processId: 'queue_other' })).rejects.toMatchObject({ code: 'conflict' });
        await expect(service.guard({ ...valid, payload: { ...valid.payload, mode: 'autopilot' } })).rejects.toMatchObject({ code: 'conflict' });
        await expect(service.guard({ ...valid, payload: { ...valid.payload, provider: 'codex' } })).rejects.toMatchObject({ code: 'conflict' });

        // A separate job whose run is cancelled: its old task id is now stale (no longer an active run).
        const other = jobStore.create(owner, input);
        const otherRun = await service.start(owner, other.id);
        const otherCall = enqueue.mock.calls[enqueue.mock.calls.length - 1][0] as CreateTaskInput;
        addProcess(otherCall.processId!);
        await service.guard(guardTask(otherCall));
        await service.cancel(owner, other.id, otherRun.id);
        await expect(service.guard(guardTask(otherCall))).rejects.toMatchObject({ code: 'conflict' });

        // A forged scheduled run cannot execute while its persisted job schedule is paused.
        const raw = jobStore.get(owner, job.id);
        fixture.db.prepare('UPDATE sentinel_scheduled_jobs SET record = ? WHERE workspace_id = ? AND parent_process_id = ? AND id = ?')
            .run(JSON.stringify({ ...raw, enabled: false }), owner.workspaceId, owner.processId, job.id);
        await expect(service.guard(valid)).rejects.toMatchObject({ code: 'conflict' });

        // Deleting the job row (cascades to its runs) makes any outstanding task reference a job that is gone.
        fixture.db.prepare('DELETE FROM sentinel_scheduled_jobs WHERE workspace_id = ? AND parent_process_id = ? AND id = ?')
            .run(owner.workspaceId, owner.processId, job.id);
        await expect(service.guard(valid)).rejects.toMatchObject({ code: 'not_found' });
        void run;
    });

    it('cancels an active run, and a late terminal event for the already-settled task id is a no-op', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        addProcess(call.processId!);
        await service.guard(guardTask(call));
        const cancelled = await service.cancel(owner, job.id, run.id);
        expect(cancelled.status).toBe('cancelled');
        expect(cancelTask).toHaveBeenCalledWith(call.id);

        onChange.mockClear();
        const queue = new FakeQueue();
        service.attach(queue);
        queue.emit('taskCompleted', owner.workspaceId, guardTask(call, { status: 'completed' }));
        await flush();
        expect(jobStore.run(owner, job.id, run.id).status).toBe('cancelled'); // unchanged
        expect(onChange).not.toHaveBeenCalled(); // the late completion never re-opens or re-processes the run
    });

    it('attaches terminal queue listeners once, and re-attaching detaches the previous listener set first', () => {
        const queue = new FakeQueue();
        const onSpy = vi.spyOn(queue, 'on');
        const offSpy = vi.spyOn(queue, 'off');
        service.attach(queue);
        expect(onSpy).toHaveBeenCalledTimes(3); // taskCompleted + taskFailed + taskCancelled
        expect(offSpy).not.toHaveBeenCalled();
        service.attach(queue);
        expect(offSpy).toHaveBeenCalledTimes(3);
        expect(onSpy).toHaveBeenCalledTimes(6);
    });

    it('hands back the last non-streaming assistant turn as the result, and the error text on failure', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        addProcess(call.processId!);
        await service.guard(guardTask(call));
        // Conversation turns accumulate as the job chat runs, after guard() recorded the run's starting turn index.
        addProcess(call.processId!, { conversationTurns: [
            assistantTurn(0, 'draft', { displayOnly: true }),
            assistantTurn(1, 'final answer'),
        ] });
        const queue = new FakeQueue();
        service.attach(queue);
        queue.emit('taskCompleted', owner.workspaceId, guardTask(call, { status: 'completed' }));
        await flush();
        expect(jobStore.run(owner, job.id, run.id)).toMatchObject({ status: 'completed', result: 'final answer' });
        const handbackCall = enqueue.mock.calls[1][0] as CreateTaskInput;
        expect((handbackCall.payload as Record<string, unknown>).prompt).toContain('final answer');
        expect(handbackCall.processId).toBe(owner.processId);
        expect((handbackCall.payload as Record<string, unknown>).processId).toBe(owner.processId);
        expect(handbackCall.priority).toBe('low');

        const job2 = jobStore.create(owner, input);
        const run2 = await service.start(owner, job2.id);
        const call2 = enqueue.mock.calls[2][0] as CreateTaskInput;
        addProcess(call2.processId!);
        await service.guard(guardTask(call2));
        queue.emit('taskFailed', owner.workspaceId, guardTask(call2, { status: 'failed' }), 'boom');
        await flush();
        expect(jobStore.run(owner, job2.id, run2.id)).toMatchObject({ status: 'failed', error: 'boom' });
        const handback2 = enqueue.mock.calls[3][0] as CreateTaskInput;
        expect((handback2.payload as Record<string, unknown>).prompt).toContain('failed: boom');
    });

    it('guard rejects a handback whose task id, delivery state, or target no longer matches the recorded handback', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        addProcess(call.processId!);
        await service.guard(guardTask(call));
        const queue = new FakeQueue();
        service.attach(queue);
        queue.emit('taskCompleted', owner.workspaceId, guardTask(call, { status: 'completed' }));
        await flush();
        const handbackCall = enqueue.mock.calls[1][0] as CreateTaskInput;
        const validHandback = guardTask(handbackCall);
        await expect(service.guard(validHandback)).resolves.toBeUndefined();
        await expect(service.guard({ ...validHandback, id: 'forged-handback' })).rejects.toMatchObject({ code: 'conflict' });
        await expect(service.guard({ ...validHandback, processId: 'queue_other' })).rejects.toMatchObject({ code: 'conflict' });
        jobStore.patchRun(owner, job.id, run.id, { handbackState: 'delivered' });
        await expect(service.guard(validHandback)).rejects.toMatchObject({ code: 'conflict' });
    });

    it('recover cancels orphaned active runs as interrupted, and resolves or re-queues pending handbacks by queue identity', async () => {
        const jobA = jobStore.create(owner, input);
        const runA = jobStore.createRun(owner, jobA.id, 'manual', 'queue_a', NOW);
        jobStore.patchRun(owner, jobA.id, runA.id, { taskId: 'task-a', status: 'running' });

        const jobB = jobStore.create(owner, input);
        const runB = jobStore.createRun(owner, jobB.id, 'manual', 'queue_b', NOW);
        jobStore.patchRun(owner, jobB.id, runB.id, { status: 'completed', handbackTaskId: 'handback-b', handbackState: 'queued' });
        tasks.set('handback-b', { status: 'completed' });

        const jobC = jobStore.create(owner, input);
        const runC = jobStore.createRun(owner, jobC.id, 'manual', 'queue_c', NOW);
        jobStore.patchRun(owner, jobC.id, runC.id, { status: 'failed', handbackTaskId: 'handback-c', handbackState: 'queued' });
        tasks.set('handback-c', { status: 'failed' });

        const jobD = jobStore.create(owner, input);
        const runD = jobStore.createRun(owner, jobD.id, 'manual', 'queue_d', NOW);
        jobStore.patchRun(owner, jobD.id, runD.id, { status: 'completed', handbackTaskId: 'handback-d', handbackState: 'queued' });
        tasks.set('handback-d', { status: 'running' });

        const jobE = jobStore.create(owner, input);
        const runE = jobStore.createRun(owner, jobE.id, 'manual', 'queue_e', NOW);
        jobStore.patchRun(owner, jobE.id, runE.id, { status: 'completed', handbackState: 'pending' });

        const count = await service.recover();
        expect(count).toBe(1); // only jobA's active run counted as an interrupted recovery
        expect(cancelTask).toHaveBeenCalledWith('task-a');
        expect(jobStore.run(owner, jobA.id, runA.id)).toMatchObject({ status: 'interrupted', error: 'Server restarted during this run' });
        expect(jobStore.run(owner, jobB.id, runB.id).handbackState).toBe('delivered');
        expect(jobStore.run(owner, jobC.id, runC.id).handbackState).toBe('failed');
        expect(jobStore.run(owner, jobD.id, runD.id).handbackState).toBe('queued'); // left alone — its task is still live
        expect(jobStore.run(owner, jobE.id, runE.id).handbackState).toBe('queued'); // re-queued since no task was ever recorded
        expect(enqueue).toHaveBeenCalled();
    });

    it('invalidate suppresses pending handbacks and cancels active runs the moment the owner becomes invalid', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        addProcess(call.processId!);
        await service.guard(guardTask(call));
        processes.delete(owner.processId); // the owning Sentinel chat disappears
        await service.invalidate();
        expect(jobStore.run(owner, job.id, run.id).status).toBe('cancelled');
        expect(cancelTask).toHaveBeenCalledWith(call.id);
        expect(onChange).toHaveBeenCalledWith(owner);
    });

    it('shutdown marks every active run interrupted with a pending handback, without itself queuing the handback', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        addProcess(call.processId!);
        await service.guard(guardTask(call));
        enqueue.mockClear();
        await service.shutdown();
        expect(jobStore.run(owner, job.id, run.id)).toMatchObject({
            status: 'interrupted', error: 'Server stopped during this run', handbackState: 'pending',
        });
        expect(cancelTask).toHaveBeenCalledWith(call.id);
        expect(enqueue).not.toHaveBeenCalled(); // the handback is left for recovery on next boot, not queued now
    });

    it('revokes queued handbacks on shutdown and recovers their durable delivery without rerunning the job', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        await service.guard(guardTask(call));
        const queue = new FakeQueue();
        service.attach(queue);
        queue.emit('taskCompleted', owner.workspaceId, guardTask(call));
        await flush();
        const handbackId = jobStore.run(owner, job.id, run.id).handbackTaskId!;
        await service.shutdown();
        expect(cancelTask).toHaveBeenCalledWith(handbackId);
        expect(jobStore.run(owner, job.id, run.id)).toMatchObject({ status: 'completed', handbackState: 'pending' });
        expect(jobStore.run(owner, job.id, run.id).handbackTaskId).toBeUndefined();
        enqueue.mockClear();
        await makeService().recover();
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(getJobTaskContext({ payload: enqueue.mock.calls[0][0].payload })?.kind).toBe('handback');
        expect(enqueue.mock.calls[0][0].id).not.toBe(handbackId);
    });

    it('shutdown awaits every in-flight start before returning, even one still blocked on async owner validation', async () => {
        const job = jobStore.create(owner, input);
        let release!: () => void;
        stallWorkspaces = new Promise(resolve => { release = resolve; });
        const startPromise = service.start(owner, job.id);
        await flush();
        let shutdownSettled = false;
        const shutdownPromise = service.shutdown().then(() => { shutdownSettled = true; });
        await flush();
        expect(shutdownSettled).toBe(false); // shutdown must not resolve while the admission it tracked is still in flight
        release();
        // Shutdown flips disposed synchronously, so the stalled start that resumes afterwards is rejected, not completed.
        await expect(startPromise).rejects.toMatchObject({ code: 'not_found' });
        await shutdownPromise;
        expect(shutdownSettled).toBe(true);
        stallWorkspaces = null;
    });
});
