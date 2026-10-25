import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, CreateTaskInput, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { SentinelRefrainStore } from '../../../src/server/sentinel-refrains/refrain-store';
import { GATE_FAILURE_LIMIT, SentinelRefrainService, getRefrainTaskContext, type RefrainServiceDeps } from '../../../src/server/sentinel-refrains/refrain-service';
import { SentinelRefrainCommands } from '../../../src/server/sentinel-refrains/refrain-commands';
import { SentinelJobScheduler } from '../../../src/server/sentinel-refrains/job-scheduler';
import { getRepoDataPath } from '../../../src/server/paths';
import { nextCronTime } from '../../../src/server/schedule/cron-utils';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createTodoTestDatabase } from '../sentinel-todos/test-db';
import { resolveEffortTierConfig } from '../../../src/server/routes/queue-enqueue';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const input = { name: 'Review', instructions: 'Check evidence', provider: 'copilot' as const, model: 'gpt' };
const NOW = '2026-10-18T10:00:00.000Z';

let fixture: ReturnType<typeof createTodoTestDatabase>;
let jobStore: SentinelRefrainStore;
let todoStore: SentinelTodoStore;
let todoService: SentinelTodoService;
let service: SentinelRefrainService;
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

function makeService(overrides: Pick<Partial<RefrainServiceDeps>, 'getEnabled' | 'getGateEnabled' | 'runGate'> = {}): SentinelRefrainService {
    return new SentinelRefrainService({
        ...overrides,
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
    jobStore = new SentinelRefrainStore(fixture.db);
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
afterEach(() => {
    // A failed test must not leave later tests stalled on owner validation.
    stallWorkspaces = null;
    fixture.dispose();
});

describe('SentinelRefrainService', () => {
    it('exposes an active run separately after more than twenty overlap skips fill the visible history', async () => {
        const job = jobStore.create(owner, input);
        const active = await service.start(owner, job.id);
        for (let index = 0; index < 25; index++) {
            expect(await service.tick(owner, job.id)).toMatchObject({ status: 'skipped', skipReason: 'overlap' });
        }
        const view = service.view(owner, jobStore.get(owner, job.id));
        expect(view.runs).toHaveLength(20);
        expect(view.runs.every(run => run.status === 'skipped')).toBe(true);
        expect(view.activeRun).toMatchObject({ id: active.id, status: 'queued' });
        expect(jobStore.run(owner, job.id, active.id).status).toBe('queued');
        await expect(service.start(owner, job.id)).rejects.toMatchObject({ code: 'conflict' });
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('links the canonical next turn using the workspace chat route', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        const chat = processes.get(call.processId!)!;
        processes.set(chat.id, { ...chat, conversationTurns: [assistantTurn(7, 'Earlier result')] } as AIProcess);
        await service.guard(guardTask(call));
        expect(jobStore.run(owner, job.id, run.id)).toMatchObject({
            turnIndex: 8, jobTurnHref: `#repos/${owner.workspaceId}/chats/${chat.id}?turn=8`,
        });
    });

    it.each(['manual', 'schedule'])('preserves custom job effort on %s launches', async trigger => {
        for (const effort of [undefined, 'low', 'medium', 'high', 'xhigh']) {
            const job = jobStore.create(owner, { ...input, effort });
            if (trigger === 'schedule') await service.tick(owner, job.id);
            else await service.start(owner, job.id);
            const call = enqueue.mock.calls.at(-1)![0] as CreateTaskInput;
            expect(call.config?.reasoningEffort).toBe(effort);
            expect(call.config?.model).toBe(input.model);
            expect(call.config).not.toHaveProperty('effortTier');
        }
    });
    it('enqueues a stored tier for owning-server resolution, never a stale model or effort', async () => {
        const job = jobStore.create(owner, { ...input, effort: 'xhigh', effortTier: 'high' });
        await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        expect(call.config).toMatchObject({ effortTier: 'high' });
        expect(call.config).not.toHaveProperty('model');
        expect(call.config).not.toHaveProperty('reasoningEffort');
        expect(call.payload).not.toHaveProperty('model');
        expect(processes.get(call.processId!)?.metadata).not.toHaveProperty('model');

        // The real enqueue preparation resolves the tier against the owner's provider settings.
        const getEffortTiersForProvider = vi.fn(() => ({ high: { model: 'owner-high', reasoningEffort: 'high' } }));
        resolveEffortTierConfig(call, { getEffortTiersForProvider });
        expect(getEffortTiersForProvider).toHaveBeenCalledWith('copilot');
        expect(call.config).toMatchObject({ model: 'owner-high', reasoningEffort: 'high', afterEffortTier: 'high' });
        await service.guard({ ...guardTask(call), config: call.config } as QueuedTask);
        expect(processes.get(call.processId!)?.metadata).toMatchObject({ model: 'owner-high', provider: 'copilot' });
    });
    it('allows an explicit manual run of a paused job while refusing scheduled admission', async () => {
        const job = jobStore.create(owner, { ...input, enabled: false });
        await expect(service.tick(owner, job.id)).rejects.toMatchObject({ code: 'conflict' });
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
        await expect(service.tick(owner, job.id, () => false)).rejects.toMatchObject({ code: 'conflict' });
        expect(jobStore.runs(owner, job.id)).toEqual([]);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('retains persistent history across repeated runs without reading the ledger', async () => {
        const job = jobStore.create(owner, input);
        const list = vi.spyOn(todoService, 'list').mockRejectedValue(new Error('Ledger unavailable'));
        const first = await service.start(owner, job.id);
        const chat = processes.get(jobStore.get(owner, job.id).processId!)!;
        chat.conversationTurns = [assistantTurn(1, 'Historical snapshot reference')] as AIProcess['conversationTurns'];
        jobStore.patchRun(owner, job.id, first.id, { status: 'completed' });
        const next = await service.start(owner, job.id);
        expect(next.status).toBe('queued');
        expect(jobStore.get(owner, job.id).processId).toBe(chat.id);
        expect(processes.get(chat.id)?.conversationTurns).toEqual(chat.conversationTurns);
        expect(list).not.toHaveBeenCalled();
        list.mockRestore();
    });

    it('drops legacy Sentinel handbacks on recovery without delivering them, unlocking edits and later runs', async () => {
        const commands = new SentinelRefrainCommands({ jobs: jobStore, service });
        const states = [
            ['queued', 'handback-queued', { status: 'queued' }],
            ['queued', 'handback-running', { status: 'running' }],
            ['pending', undefined, undefined],
            ['delivered', 'handback-done', { status: 'completed' }],
        ] as const;
        const legacy = states.map(([handbackState, handbackTaskId, task]) => {
            const job = jobStore.create(owner, input);
            const run = jobStore.createRun(owner, job.id, 'manual', `queue_${job.id}`, NOW);
            jobStore.patchRun(owner, job.id, run.id, { status: 'completed', handbackState, handbackTaskId,
                result: 'old result', sentinelFollowUpHref: '#repos/ws-a/chats/queue_parent?turn=2' });
            if (handbackTaskId && task) tasks.set(handbackTaskId, task);
            return { job, run };
        });
        expect(() => jobStore.update(owner, legacy[0].job.id, { name: 'Renamed' }, legacy[0].job.revision)).not.toThrow();

        expect(await service.recover()).toBe(0);
        expect(enqueue).not.toHaveBeenCalled();
        expect(cancelTask.mock.calls.map(([id]) => id).sort()).toEqual(['handback-done', 'handback-queued', 'handback-running']);
        for (const { job, run } of legacy) {
            const stored = jobStore.run(owner, job.id, run.id);
            expect(stored).toMatchObject({ status: 'completed' });
            for (const field of ['handbackState', 'handbackTaskId', 'result', 'sentinelFollowUpHref']) expect(stored).not.toHaveProperty(field);
            expect(service.view(owner, jobStore.get(owner, job.id)).runs[0]).not.toHaveProperty('sentinelFollowUpHref');
        }
        const { job } = legacy[2];
        await expect(commands.update(owner, job.id, { name: 'Edited' }, job.revision)).resolves.toMatchObject({ name: 'Edited' });
        await expect(service.start(owner, job.id)).resolves.toMatchObject({ status: 'queued' });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(getRefrainTaskContext({ payload: enqueue.mock.calls[0][0].payload })?.kind).toBe('run');
    });

    it('guard rejects a handback task persisted by an older server, so it never runs a Sentinel turn', async () => {
        const job = jobStore.create(owner, input);
        const run = jobStore.createRun(owner, job.id, 'manual', 'queue_job', NOW);
        jobStore.patchRun(owner, job.id, run.id, { status: 'completed', handbackState: 'queued', handbackTaskId: 'old-handback' });
        const handback = { id: 'old-handback', repoId: owner.workspaceId, processId: owner.processId, status: 'queued',
            payload: { kind: 'chat', mode: 'sentinel', workspaceId: owner.workspaceId, processId: owner.processId, prompt: 'old result',
                context: { sentinelScheduledJob: { ...owner, jobId: job.id, runId: run.id, kind: 'handback' } } } } as unknown as QueuedTask;
        await expect(service.guard(handback)).rejects.toMatchObject({ code: 'conflict' });

        const queue = new FakeQueue();
        service.attach(queue);
        onChange.mockClear();
        queue.emit('taskFailed', owner.workspaceId, { ...handback, status: 'failed' }, 'rejected');
        await flush();
        expect(onChange).not.toHaveBeenCalled();
        expect(jobStore.run(owner, job.id, run.id).status).toBe('completed');
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
        expect(getRefrainTaskContext({ payload: call1.payload })).toMatchObject({
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
        expect(enqueue).toHaveBeenCalledTimes(1); // completion queues no Sentinel turn

        const second = await service.start(owner, job.id);
        expect(enqueue).toHaveBeenCalledTimes(2);
        const call2 = enqueue.mock.calls[1][0] as CreateTaskInput;
        expect(call2.processId).toBe(chatProcessId); // same persistent chat, not a new one
        expect((call2.payload as Record<string, unknown>).processId).toBe(chatProcessId);
        expect((call2.payload as Record<string, unknown>).relayRequestId).toBe(`sentinel-job:${second.id}`);
    });

    it.each(['manual', 'schedule'] as const)('%s runs omit automatic To-do data and snapshot writes', async trigger => {
        todoStore.create(owner, { title: 'Ship the feature' }, { actor: 'sentinel' });
        const list = vi.spyOn(todoService, 'list');
        const job = jobStore.create(owner, input);
        await (trigger === 'manual' ? service.start(owner, job.id) : service.tick(owner, job.id));
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        expect(call.payload.prompt).toBe([
            input.instructions, '',
            'You are a job chat, not the owning Sentinel. You have no ledger-writing authority.',
            'Return the result in your final response. It stays in this job chat; nothing is sent to the Sentinel.',
        ].join('\n'));
        expect(call.payload.context).not.toHaveProperty('actor');
        expect(list).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(fixture.dataDir, 'repos', owner.workspaceId, 'sentinel-jobs'))).toBe(false);
        list.mockRestore();
    });
    it('retains historical snapshot files during runs and removes them only on explicit job deletion', async () => {
        const job = jobStore.create(owner, input);
        const directory = getRepoDataPath(fixture.dataDir, owner.workspaceId,
            path.join('sentinel-jobs', encodeURIComponent(owner.processId), job.id));
        fs.mkdirSync(directory, { recursive: true });
        const historical = path.join(directory, 'historical.json');
        fs.writeFileSync(historical, '{"historical":true}');
        const run = await service.start(owner, job.id);
        expect(fs.readdirSync(directory)).toEqual(['historical.json']);
        expect(fs.readFileSync(historical, 'utf8')).toBe('{"historical":true}');
        jobStore.patchRun(owner, job.id, run.id, { status: 'completed' });
        await new SentinelRefrainCommands({ jobs: jobStore, service }).delete(owner, job.id, job.revision);
        expect(fs.existsSync(directory)).toBe(false);
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

    it('re-checks the owner/feature gate during chat admission and aborts to a failed run without enqueueing', async () => {
        let calls = 0;
        const gatedService = makeService({ getEnabled: () => { calls++; return calls <= 4; } });
        const job = jobStore.create(owner, input);
        const run = await gatedService.start(owner, job.id);
        expect(run.status).toBe('failed');
        expect(run.error).toMatch(/disabled/);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('aborts without enqueueing when the job was disabled or its run was cancelled before admission', async () => {
        const job = jobStore.create(owner, input);
        const run = jobStore.createRun(owner, job.id, 'manual', 'queue_x', NOW);
        addProcess('queue_x'); // the persistent chat from that earlier run already exists
        // Simulate a concurrent cancel landing before the enqueue call.
        jobStore.patchRun(owner, job.id, run.id, { status: 'cancelled' }, ['queued']);
        const resumed = await service.start(owner, job.id);
        // A fresh manual start claims a new run (the cancelled one is no longer active) — prove the stale one stays untouched.
        expect(jobStore.run(owner, job.id, run.id).status).toBe('cancelled');
        expect(resumed.status).toBe('queued');
    });

    it('guard rejects forged, stale, disabled and deleted run tasks', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.tick(owner, job.id);
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

    it.each([
        ['taskCompleted', undefined, { status: 'completed' }],
        ['taskFailed', 'boom', { status: 'failed', error: 'boom' }],
        ['taskCancelled', undefined, { status: 'cancelled', error: 'Cancelled' }],
    ] as const)('settles a run on %s without a Sentinel turn and admits repeat runs', async (event, detail, expected) => {
        const job = jobStore.create(owner, input);
        const queue = new FakeQueue();
        service.attach(queue);
        for (let attempt = 0; attempt < 2; attempt++) {
            const run = await service.start(owner, job.id);
            const call = enqueue.mock.calls.at(-1)![0] as CreateTaskInput;
            addProcess(call.processId!, { conversationTurns: [assistantTurn(attempt, 'final answer')] as never });
            await service.guard(guardTask(call));
            queue.emit(event, owner.workspaceId, guardTask(call, { status: expected.status }), detail);
            await flush();
            const settled = jobStore.run(owner, job.id, run.id);
            expect(settled).toMatchObject(expected);
            expect(settled.finishedAt).toBeDefined();
            for (const field of ['handbackState', 'handbackTaskId', 'result']) expect(settled).not.toHaveProperty(field);
            expect(service.view(owner, jobStore.get(owner, job.id)).activeRun).toBeUndefined();
        }
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(enqueue.mock.calls.every(([call]) => call.processId !== owner.processId)).toBe(true);
        expect(processes.get(owner.processId)?.conversationTurns).toEqual([]);
        const current = jobStore.get(owner, job.id);
        await expect(new SentinelRefrainCommands({ jobs: jobStore, service }).update(owner, job.id, { name: 'Next' }, current.revision))
            .resolves.toMatchObject({ name: 'Next' });
    });

    it('settles a user cancellation without a Sentinel turn', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        addProcess(call.processId!);
        await service.guard(guardTask(call));
        await expect(service.cancel(owner, job.id, run.id)).resolves.toMatchObject({ status: 'cancelled', error: 'Cancelled by user' });
        expect(enqueue).toHaveBeenCalledTimes(1);
        await expect(service.start(owner, job.id)).resolves.toMatchObject({ status: 'queued' });
    });

    it('keeps run settlement isolated per Sentinel owner', async () => {
        const other = { workspaceId: owner.workspaceId, processId: 'queue_other_parent' };
        addProcess(other.processId);
        const mine = jobStore.create(owner, input);
        const theirs = jobStore.create(other, input);
        const myRun = await service.start(owner, mine.id);
        const theirRun = await service.start(other, theirs.id);
        const [myCall, theirCall] = enqueue.mock.calls.map(([call]) => call as CreateTaskInput);
        addProcess(myCall.processId!);
        addProcess(theirCall.processId!);
        await service.guard(guardTask(myCall));
        await service.guard(guardTask(theirCall));
        const queue = new FakeQueue();
        service.attach(queue);
        queue.emit('taskCompleted', owner.workspaceId, guardTask(theirCall, { status: 'completed' }));
        await flush();
        expect(jobStore.run(other, theirs.id, theirRun.id).status).toBe('completed');
        expect(jobStore.run(owner, mine.id, myRun.id).status).toBe('running');
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(processes.get(owner.processId)?.conversationTurns).toEqual([]);
        expect(processes.get(other.processId)?.conversationTurns).toEqual([]);
    });

    it('recover cancels orphaned active runs as interrupted without queuing anything', async () => {
        const jobA = jobStore.create(owner, input);
        const runA = jobStore.createRun(owner, jobA.id, 'manual', 'queue_a', NOW);
        jobStore.patchRun(owner, jobA.id, runA.id, { taskId: 'task-a', status: 'running' });
        const jobB = jobStore.create(owner, input);
        const runB = jobStore.createRun(owner, jobB.id, 'manual', 'queue_b', NOW);
        jobStore.patchRun(owner, jobB.id, runB.id, { status: 'completed' });

        const count = await service.recover();
        expect(count).toBe(1);
        expect(cancelTask).toHaveBeenCalledWith('task-a');
        expect(jobStore.run(owner, jobA.id, runA.id)).toMatchObject({ status: 'interrupted', error: 'Server restarted during this run' });
        expect(jobStore.run(owner, jobB.id, runB.id).status).toBe('completed');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('does not cancel active work when an owner read fails unexpectedly', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const failure = new Error('Database read unavailable');
        const assertOwner = vi.spyOn(todoService, 'assertOwner').mockRejectedValueOnce(failure);
        await expect(service.invalidate()).rejects.toBe(failure);
        expect(jobStore.run(owner, job.id, run.id).status).toBe('queued');
        expect(cancelTask).not.toHaveBeenCalled();
        assertOwner.mockRestore();
    });

    it('invalidate cancels active runs the moment the owner becomes invalid', async () => {
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

    it('shutdown marks every active run interrupted without queuing anything', async () => {
        const job = jobStore.create(owner, input);
        const run = await service.start(owner, job.id);
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        addProcess(call.processId!);
        await service.guard(guardTask(call));
        enqueue.mockClear();
        await service.shutdown();
        expect(jobStore.run(owner, job.id, run.id)).toMatchObject({
            status: 'interrupted', error: 'Server stopped during this run',
        });
        expect(jobStore.run(owner, job.id, run.id)).not.toHaveProperty('handbackState');
        expect(cancelTask).toHaveBeenCalledWith(call.id);
        enqueue.mockClear();
        await makeService().recover();
        expect(enqueue).not.toHaveBeenCalled(); // recovery on the next boot delivers nothing either
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

describe('SentinelRefrainService gated ticks', () => {
    const gated = { ...input, cron: '0 * * * *', gateScript: 'return state;' };
    let gateEnabled: boolean;
    let runGate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        gateEnabled = true;
        runGate = vi.fn(async () => ({ items: [1] }));
        service = makeService({ getGateEnabled: () => gateEnabled, runGate });
    });

    /** A gate that settles only when the test releases it, or rejects with the abort reason. */
    function pendingGate() {
        let resolve!: (value: unknown) => void;
        let reject!: (error: unknown) => void;
        runGate.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((ok, fail) => {
            resolve = ok; reject = fail;
            signal.addEventListener('abort', () => fail(signal.reason));
        }));
        return { resolve: (value: unknown) => resolve(value), reject: (error: unknown) => reject(error) };
    }

    it.each(['manual', 'schedule'] as const)('%s includes the current gate result after instructions', async trigger => {
        const job = jobStore.create(owner, gated);
        const list = vi.spyOn(todoService, 'list');
        const run = await (trigger === 'manual' ? service.start(owner, job.id) : service.tick(owner, job.id));
        expect(list).not.toHaveBeenCalled();
        list.mockRestore();
        expect(run).toMatchObject({ status: 'queued', trigger });
        expect(runGate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            workspaceId: owner.workspaceId, processId: owner.processId, code: 'return state;', state: null }));
        expect(enqueue).toHaveBeenCalledOnce();
        const call = enqueue.mock.calls[0][0] as CreateTaskInput;
        const stored = jobStore.get(owner, job.id);
        expect(call.processId).toBe(stored.processId);
        expect(processes.has(stored.processId!)).toBe(true);
        expect((call.payload as { prompt: string }).prompt).toMatch(
            /^Check evidence\n\nGate script result \(JSON\):\n```json\n\{"items":\[1\]\}\n```\n\nYou are a job chat/);
        expect(stored).toMatchObject({ gateLastResult: '{"items":[1]}', gateConsecutiveFailures: 0, gatePaused: false });
    });

    it.each(['manual', 'schedule'] as const)('%s fences embedded backticks and preserves selected To-do data', async trigger => {
        runGate.mockResolvedValueOnce({ note: 'a ``` b ```` c', todos: [{ title: 'Selected task' }] });
        const job = jobStore.create(owner, gated);
        await (trigger === 'manual' ? service.start(owner, job.id) : service.tick(owner, job.id));
        const prompt = (enqueue.mock.calls[0][0] as CreateTaskInput).payload as { prompt: string };
        expect(prompt.prompt).toContain('`````json\n{"note":"a ``` b ```` c","todos":[{"title":"Selected task"}]}\n`````');
    });

    it.each((['manual', 'schedule'] as const).flatMap(trigger => [null, false, '', [], {}].map(value => ({ trigger, value }))))('skips $trigger for $value', async ({ trigger, value }) => {
        runGate.mockResolvedValueOnce(value);
        const job = jobStore.create(owner, gated);
        expect(await (trigger === 'manual' ? service.start(owner, job.id) : service.tick(owner, job.id))).toMatchObject({ status: 'skipped', skipReason: 'gate-empty', trigger });
        expect(enqueue).not.toHaveBeenCalled();
        const stored = jobStore.get(owner, job.id);
        expect(stored.gateLastResult).toBe(JSON.stringify(value));
        // A skip never adopts a job chat id; only a claimed run does.
        expect(stored.processId).toBeUndefined();
        expect(service.view(owner, stored).runs).toEqual([expect.objectContaining({ skipReason: 'gate-empty' })]);
    });

    it('admits a scheduled zero result as current context', async () => {
        const job = jobStore.create(owner, gated);
        runGate.mockResolvedValueOnce(0);
        expect(await service.tick(owner, job.id)).toMatchObject({ status: 'queued', trigger: 'schedule' });
        expect(enqueue.mock.calls[0][0].payload.prompt).toContain('```json\n0\n```');
        expect(jobStore.get(owner, job.id).gateLastResult).toBe('0');
    });

    it('passes the previous result to the next tick as state', async () => {
        runGate.mockResolvedValueOnce({ seen: [1] }).mockResolvedValueOnce([]);
        const job = jobStore.create(owner, gated);
        const first = (await service.tick(owner, job.id))!;
        jobStore.patchRun(owner, job.id, first.id, { status: 'completed' }, ['queued']);
        await service.tick(owner, job.id);
        expect(runGate.mock.calls.map(([request]) => request.state)).toEqual([null, { seen: [1] }]);
        expect(jobStore.get(owner, job.id).gateLastResult).toBe('[]');
    });

    it('skips an overlapping tick before running the gate', async () => {
        const job = jobStore.create(owner, gated);
        const active = await service.start(owner, job.id);
        runGate.mockClear();
        expect(await service.tick(owner, job.id)).toMatchObject({ status: 'skipped', skipReason: 'overlap' });
        expect(runGate).not.toHaveBeenCalled();
        expect(jobStore.run(owner, job.id, active.id).status).toBe('queued');
    });

    it('records the overlap without claiming a run when the active run settles during admission', async () => {
        const job = jobStore.create(owner, gated);
        await service.start(owner, job.id);
        runGate.mockClear();
        const queue = new FakeQueue();
        service.attach(queue);
        // Stall owner validation from the moment the tick reads the still-active run.
        let release!: () => void;
        const runs = jobStore.runs.bind(jobStore);
        vi.spyOn(jobStore, 'runs').mockImplementationOnce((...args) => {
            stallWorkspaces = new Promise(resolve => { release = resolve; });
            return runs(...args);
        });
        const tick = service.tick(owner, job.id);
        await flush();
        queue.emit('taskCompleted', owner.workspaceId, guardTask(enqueue.mock.calls[0][0] as CreateTaskInput));
        await flush();
        release();
        stallWorkspaces = null;
        expect(await tick).toMatchObject({ status: 'skipped', skipReason: 'overlap', trigger: 'schedule' });
        await flush();
        expect(runGate).not.toHaveBeenCalled();
        expect(enqueue.mock.calls.filter(([task]) => getRefrainTaskContext(task)?.kind === 'run')).toHaveLength(1);
        expect(jobStore.runs(owner, job.id).map(run => run.status)).toEqual(['skipped', 'completed']);
    });

    it('starts no gate-less scheduled run for a job that gained a gate script during admission', async () => {
        const job = jobStore.create(owner, { ...input, cron: '0 * * * *' });
        let release!: () => void;
        const get = jobStore.get.bind(jobStore);
        vi.spyOn(jobStore, 'get').mockImplementationOnce((...args) => {
            stallWorkspaces = new Promise(resolve => { release = resolve; });
            return get(...args);
        });
        const tick = service.tick(owner, job.id);
        await flush();
        jobStore.update(owner, job.id, { gateScript: gated.gateScript }, job.revision);
        release();
        stallWorkspaces = null;
        await expect(tick).rejects.toMatchObject({ code: 'conflict' });
        expect(runGate).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        expect(jobStore.runs(owner, job.id)).toEqual([]);
    });

    it('counts failures, pauses after five in a row with exactly one Sentinel notice, and stops running the gate', async () => {
        const job = jobStore.create(owner, gated);
        runGate.mockRejectedValueOnce(new Error('boom 1'))
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce('x'.repeat(17 * 1024))
            .mockRejectedValueOnce(new Error('boom 4'));
        for (let failures = 1; failures < GATE_FAILURE_LIMIT; failures++) {
            clock += 60_000;
            expect(await service.tick(owner, job.id)).toBeUndefined();
            expect(jobStore.get(owner, job.id)).toMatchObject({ gateConsecutiveFailures: failures, gatePaused: false });
        }
        expect(jobStore.get(owner, job.id).gateLastError).toEqual({ message: 'boom 4', at: new Date(clock).toISOString() });
        runGate.mockRejectedValueOnce(new Error('Gate script exceeded its 60-second deadline'));
        await service.tick(owner, job.id);
        expect(jobStore.get(owner, job.id)).toMatchObject({ gateConsecutiveFailures: 5, gatePaused: true,
            gateLastError: { message: 'Gate script exceeded its 60-second deadline' } });
        expect(enqueue).toHaveBeenCalledOnce();
        const notice = enqueue.mock.calls[0][0] as CreateTaskInput;
        expect(notice).toMatchObject({ processId: owner.processId, repoId: owner.workspaceId,
            payload: { mode: 'sentinel', processId: owner.processId, provider: 'copilot',
                context: { sentinelScheduledJob: { ...owner, jobId: job.id, kind: 'notice' } } } });
        const prompt = (notice.payload as { prompt: string }).prompt;
        expect(prompt).toContain('Gate script exceeded its 60-second deadline');
        expect(prompt).toContain('until the user resumes the gate');
        expect(prompt).toContain('grants no authority');
        expect(jobStore.runs(owner, job.id)).toEqual([]);

        for (let i = 0; i < 3; i++) expect(await service.tick(owner, job.id)).toBeUndefined();
        expect(runGate).toHaveBeenCalledTimes(GATE_FAILURE_LIMIT);
        expect(enqueue).toHaveBeenCalledOnce();
        expect(jobStore.runs(owner, job.id)).toEqual([]);
    });

    it('a success resets the failure count and the last error', async () => {
        const job = jobStore.create(owner, gated);
        runGate.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(false);
        await service.tick(owner, job.id);
        expect(jobStore.get(owner, job.id)).toMatchObject({ gateConsecutiveFailures: 1, gateLastError: { message: 'boom' } });
        await service.tick(owner, job.id);
        const stored = jobStore.get(owner, job.id);
        expect(stored.gateConsecutiveFailures).toBe(0);
        expect(stored.gateLastError).toBeUndefined();
    });

    it('guards the gate notice: only the owning Sentinel, only while the gate stays paused, never a terminal settle', async () => {
        const job = jobStore.create(owner, gated);
        runGate.mockRejectedValue(new Error('boom'));
        for (let i = 0; i < GATE_FAILURE_LIMIT; i++) await service.tick(owner, job.id);
        const notice = guardTask(enqueue.mock.calls[0][0] as CreateTaskInput);
        expect(getRefrainTaskContext(notice)).toEqual({ ...owner, jobId: job.id, kind: 'notice' });
        await expect(service.guard(notice)).resolves.toBeUndefined();
        await expect(service.guard({ ...notice, processId: 'queue_other' })).rejects.toMatchObject({ code: 'conflict' });
        await expect(service.guard({ ...notice, payload: { ...notice.payload, mode: 'ask' } })).rejects.toMatchObject({ code: 'conflict' });
        const queue = new FakeQueue();
        service.attach(queue);
        queue.emit('taskCompleted', owner.workspaceId, notice);
        await flush();
        jobStore.updateGate(owner, job.id, gated.gateScript, () => ({ gatePaused: false, gateConsecutiveFailures: 0 }));
        await expect(service.guard(notice)).rejects.toMatchObject({ code: 'conflict' });
    });

    it('Run now evaluates a paused schedule and resets failures with the current result', async () => {
        const job = jobStore.create(owner, { ...gated, enabled: false });
        jobStore.updateGate(owner, job.id, gated.gateScript, () => ({ gateLastResult: '{"stale":1}', gateConsecutiveFailures: 2 }));
        runGate.mockResolvedValueOnce(0);
        expect(await service.start(owner, job.id)).toMatchObject({ status: 'queued', trigger: 'manual' });
        expect(runGate).toHaveBeenCalledOnce();
        expect(enqueue.mock.calls[0][0].payload.prompt).toContain('```json\n0\n```');
        expect(enqueue.mock.calls[0][0].payload.prompt).not.toContain('stale');
        expect(jobStore.get(owner, job.id)).toMatchObject({ gateLastResult: '0', gateConsecutiveFailures: 0 });
    });

    it.each(['boom', 'Gate script exceeded its 60-second deadline'])('manual errors preserve %s and never reuse saved results', async error => {
        const job = jobStore.create(owner, gated);
        jobStore.updateGate(owner, job.id, gated.gateScript, () => ({ gateLastResult: '{"stale":true}' }));
        runGate.mockRejectedValueOnce(new Error(error));
        await expect(service.start(owner, job.id)).rejects.toMatchObject({ code: 'conflict', message: error });
        expect(jobStore.get(owner, job.id)).toMatchObject({ gateLastResult: '{"stale":true}', gateConsecutiveFailures: 1 });
        expect(jobStore.runs(owner, job.id)).toEqual([]);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('manual failures pause the gate, and Run now requires an explicit resume', async () => {
        const job = jobStore.create(owner, gated);
        runGate.mockRejectedValue(new Error('boom'));
        for (let i = 0; i < GATE_FAILURE_LIMIT; i++) await expect(service.start(owner, job.id)).rejects.toThrow('boom');
        await expect(service.start(owner, job.id)).rejects.toThrow('gate is paused');
        expect(runGate).toHaveBeenCalledTimes(GATE_FAILURE_LIMIT);
        expect(enqueue).toHaveBeenCalledOnce(); // informational notice only
        expect(jobStore.get(owner, job.id).gatePaused).toBe(true);
        await service.resumeGate(owner, job.id);
        runGate.mockResolvedValueOnce(false);
        expect(await service.start(owner, job.id)).toMatchObject({ status: 'skipped', trigger: 'manual', skipReason: 'gate-empty' });
    });

    it('manual unavailable gates return a skip or an explicit runtime error', async () => {
        const job = jobStore.create(owner, gated);
        gateEnabled = false;
        expect(await service.start(owner, job.id)).toMatchObject({ status: 'skipped', trigger: 'manual', skipReason: 'gate-unavailable' });
        const bare = makeService({ getGateEnabled: () => true });
        await expect(bare.start(owner, job.id)).rejects.toThrow('Gate script runtime is unavailable');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it.each(['edit', 'delete', 'owner', 'jobs flag', 'scripting flag', 'shutdown'] as const)('revokes a late manual gate after %s', async reason => {
        const job = jobStore.create(owner, gated);
        let resolve!: (value: unknown) => void;
        runGate.mockImplementationOnce(() => new Promise(ok => { resolve = ok; })); // ignores abort
        const start = service.start(owner, job.id);
        const rejected = expect(start).rejects.toMatchObject({ code: expect.stringMatching(/conflict|not_found/) });
        await flush();
        if (reason === 'edit') jobStore.update(owner, job.id, { name: 'Changed' }, job.revision);
        if (reason === 'delete') jobStore.delete(owner, job.id, job.revision);
        if (reason === 'owner') processes.delete(owner.processId);
        if (reason === 'jobs flag') enabled = false;
        if (reason === 'scripting flag') gateEnabled = false;
        const shutdown = reason === 'shutdown' ? service.shutdown() : undefined;
        resolve({ late: true });
        await rejected;
        await shutdown;
        expect(enqueue).not.toHaveBeenCalled();
        if (reason !== 'delete') {
            expect(jobStore.runs(owner, job.id)).toEqual([]);
            expect(jobStore.get(owner, job.id).gateLastResult).toBeUndefined();
            expect(jobStore.get(owner, job.id).gateConsecutiveFailures).toBe(0);
        }
    });

    it('skips and records gated ticks while tool scripting is off; ungated jobs still run', async () => {
        gateEnabled = false;
        const job = jobStore.create(owner, gated);
        const plain = jobStore.create(owner, { ...input, cron: '0 * * * *' });
        expect(await service.tick(owner, job.id)).toMatchObject({ status: 'skipped', skipReason: 'gate-unavailable' });
        expect(runGate).not.toHaveBeenCalled();
        expect(await service.tick(owner, plain.id)).toMatchObject({ status: 'queued' });
        expect(enqueue).toHaveBeenCalledOnce();
        expect(jobStore.get(owner, job.id).gateConsecutiveFailures).toBe(0);
    });

    it('runs no gate when the job schedule is paused', async () => {
        const job = jobStore.create(owner, { ...gated, enabled: false });
        await expect(service.tick(owner, job.id)).rejects.toMatchObject({ code: 'conflict' });
        expect(runGate).not.toHaveBeenCalled();
    });

    it.each([
        ['a job edit', async (job: { id: string; revision: number }) => {
            jobStore.update(owner, job.id, { name: 'Renamed' }, job.revision);
            service.cancelGate(owner, job.id);
        }],
        ['server shutdown', async () => { await Promise.race([service.shutdown(), flush()]); }],
        ['owner revocation', async () => { processes.delete(owner.processId); await service.invalidate(); }],
        ['the tool-scripting flag turning off', async () => { gateEnabled = false; await service.invalidate(); }],
    ])('cancelling a gate for %s neither counts a failure nor saves a result', async (_label, cancel) => {
        const job = jobStore.create(owner, gated);
        const gate = pendingGate();
        const tick = service.tick(owner, job.id);
        await flush();
        expect(runGate).toHaveBeenCalledOnce();
        expect(runGate.mock.calls[0][0].signal.aborted).toBe(false);
        await cancel(job);
        expect(runGate.mock.calls[0][0].signal.aborted).toBe(true);
        gate.resolve({ late: true });
        expect(await tick).toBeUndefined();
        const stored = jobStore.get(owner, job.id);
        expect(stored).toMatchObject({ gateConsecutiveFailures: 0, gatePaused: false });
        expect(stored.gateLastResult).toBeUndefined();
        expect(stored.gateLastError).toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
        expect(jobStore.runs(owner, job.id)).toEqual([]);
    });

    it('does not count or save a gate outcome once the tick became stale', async () => {
        const job = jobStore.create(owner, gated);
        let current = true;
        const failing = pendingGate();
        const failed = service.tick(owner, job.id, () => current);
        await flush();
        current = false;
        failing.reject(new Error('boom'));
        expect(await failed).toBeUndefined();
        current = true;
        const succeeding = pendingGate();
        const succeeded = service.tick(owner, job.id, () => current);
        await flush();
        current = false;
        succeeding.resolve({ items: [1] });
        expect(await succeeded).toBeUndefined();
        expect(jobStore.get(owner, job.id)).toMatchObject({ gateConsecutiveFailures: 0 });
        expect(jobStore.get(owner, job.id).gateLastResult).toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('does not save a result for a script that changed while it ran', async () => {
        const job = jobStore.create(owner, gated);
        const gate = pendingGate();
        const tick = service.tick(owner, job.id);
        await flush();
        // A direct store edit (no cancelGate) still cannot land the old script's result.
        jobStore.update(owner, job.id, { gateScript: 'return null;' }, job.revision);
        gate.resolve({ items: [1] });
        expect(await tick).toBeUndefined();
        expect(jobStore.get(owner, job.id).gateLastResult).toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('keeps the gate cancellable until its outcome is recorded', async () => {
        const job = jobStore.create(owner, gated);
        const gate = pendingGate();
        const tick = service.tick(owner, job.id);
        await flush();
        // Stall the post-gate owner check, then edit the job while it is pending.
        let release!: () => void;
        stallWorkspaces = new Promise(resolve => { release = resolve; });
        gate.resolve({ items: [1] });
        await flush();
        jobStore.update(owner, job.id, { name: 'Renamed' }, job.revision);
        service.cancelGate(owner, job.id);
        release();
        stallWorkspaces = null;
        expect(await tick).toBeUndefined();
        expect(jobStore.get(owner, job.id).gateLastResult).toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
        expect(jobStore.runs(owner, job.id)).toEqual([]);
    });

    it.each(['manual', 'schedule'] as const)('rejects Run now during a %s gate without duplicate evaluation', async trigger => {
        const job = jobStore.create(owner, gated);
        const gate = pendingGate();
        const first = trigger === 'manual' ? service.start(owner, job.id) : service.tick(owner, job.id);
        await flush();
        await expect(service.start(owner, job.id)).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('in flight') });
        expect(await service.tick(owner, job.id)).toBeUndefined();
        expect(runGate).toHaveBeenCalledOnce();
        gate.resolve({ items: [1] });
        expect(await first).toMatchObject({ status: 'queued', trigger });
        expect(enqueue).toHaveBeenCalledOnce();
        expect(jobStore.runs(owner, job.id)).toHaveLength(1);
    });

    it('claims the run with the saved result, so a pause during admission leaves a failed run, never nothing', async () => {
        const job = jobStore.create(owner, gated);
        const queue = new FakeQueue();
        service.attach(queue);
        // Stall owner validation from the moment the result is saved.
        let release!: () => void;
        const updateGate = jobStore.updateGate.bind(jobStore);
        vi.spyOn(jobStore, 'updateGate').mockImplementationOnce((...args) => {
            const saved = updateGate(...args);
            stallWorkspaces = new Promise(resolve => { release = resolve; });
            return saved;
        });
        const tick = service.tick(owner, job.id);
        await flush();
        expect(jobStore.runs(owner, job.id).map(run => [run.status, run.trigger])).toEqual([['queued', 'schedule']]);
        jobStore.update(owner, job.id, { enabled: false }, job.revision);
        release();
        stallWorkspaces = null;
        expect(await tick).toMatchObject({ status: 'failed', trigger: 'schedule', error: 'Refrain schedule is paused' });
        expect(jobStore.get(owner, job.id).gateLastResult).toBe('{"items":[1]}');
        expect(enqueue.mock.calls.filter(([task]) => getRefrainTaskContext(task)?.kind === 'run')).toEqual([]);
        expect(service.view(owner, jobStore.get(owner, job.id)).runs).toEqual([
            expect.objectContaining({ status: 'failed', error: 'Refrain schedule is paused' })]);
    });

    describe('with the job scheduler', () => {
        let scheduler: SentinelJobScheduler;
        let commands: SentinelRefrainCommands;
        let ticks: Array<Promise<unknown>>;

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            ticks = [];
            scheduler = new SentinelJobScheduler({ jobs: jobStore, getEnabled: () => enabled, now: () => new Date(clock),
                service: {
                    assertOwner: value => service.assertOwner(value),
                    tick: (...args) => { const tick = service.tick(...args); ticks.push(tick); return tick; },
                } });
            commands = new SentinelRefrainCommands({ jobs: jobStore, service, onConfigChange: () => scheduler.refreshAll() });
        });
        afterEach(() => {
            scheduler.dispose();
            vi.useRealTimers();
        });

        /** Arms every job, then fires the next cron boundary for the gated jobs. */
        async function fireTick(): Promise<void> {
            scheduler.refreshAll();
            await flush();
            const due = nextCronTime(gated.cron, new Date(clock))!.getTime();
            const delay = due - clock;
            clock = due;
            await vi.advanceTimersByTimeAsync(delay);
        }

        it('a pending gate survives refreshAll() and other jobs\' changes, then starts its run with the gate JSON', async () => {
            const job = jobStore.create(owner, gated);
            const sibling = jobStore.create(owner, { ...input, name: 'Sibling' });
            const gate = pendingGate();
            await fireTick();
            expect(runGate).toHaveBeenCalledOnce();
            scheduler.refreshAll();
            await commands.update(owner, sibling.id, { name: 'Renamed' }, sibling.revision);
            await commands.create(owner, { ...input, name: 'New' });
            await flush();
            expect(runGate.mock.calls[0][0].signal.aborted).toBe(false);
            gate.resolve({ items: [1] });
            expect(await ticks[0]).toMatchObject({ status: 'queued', trigger: 'schedule' });
            expect(enqueue).toHaveBeenCalledOnce();
            expect((enqueue.mock.calls[0][0] as CreateTaskInput).payload).toMatchObject({
                prompt: expect.stringContaining('Gate script result (JSON):\n```json\n{"items":[1]}\n```') });
            expect(jobStore.get(owner, job.id).gateLastResult).toBe('{"items":[1]}');
        });

        it.each([
            ['its own edit', (job: { id: string; revision: number }) => { jobStore.update(owner, job.id, { name: 'Renamed' }, job.revision); }],
            ['its own schedule pause', (job: { id: string; revision: number }) => { jobStore.update(owner, job.id, { enabled: false }, job.revision); }],
            ['its own delete', (job: { id: string; revision: number }) => { jobStore.delete(owner, job.id, job.revision); }],
            ['the jobs flag turning off', () => { enabled = false; }],
        ])('discards a pending gate result after %s, even without a cancel', async (_label, change) => {
            const job = jobStore.create(owner, gated);
            const gate = pendingGate();
            await fireTick();
            expect(runGate).toHaveBeenCalledOnce();
            change(job);
            scheduler.refreshAll();
            gate.resolve({ items: [1] });
            expect(await ticks[0]).toBeUndefined();
            expect(enqueue).not.toHaveBeenCalled();
            expect(jobStore.all().flatMap(entry => jobStore.runs(owner, entry.job.id))).toEqual([]);
            expect(jobStore.all().map(entry => entry.job.gateLastResult)).not.toContain('{"items":[1]}');
        });
    });

    it('Test gate evaluates with the saved state while paused, starting no run and saving nothing', async () => {
        const job = jobStore.create(owner, gated);
        const error = { message: 'boom', at: NOW };
        jobStore.updateGate(owner, job.id, gated.gateScript, () => ({
            gateLastResult: '{"seen":1}', gateConsecutiveFailures: GATE_FAILURE_LIMIT, gateLastError: error, gatePaused: true }));
        const saved = jobStore.get(owner, job.id);
        runGate.mockResolvedValueOnce({ b: 2, a: [1] }).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('bad'))
            .mockResolvedValueOnce(undefined);
        expect(await service.testGate(owner, job.id)).toEqual({ ok: true, result: '{"a":[1],"b":2}', empty: false });
        expect(runGate).toHaveBeenCalledWith(expect.objectContaining({ code: gated.gateScript, state: { seen: 1 } }));
        expect(await service.testGate(owner, job.id)).toEqual({ ok: true, result: '{}', empty: true });
        expect(await service.testGate(owner, job.id)).toEqual({ ok: false, error: 'bad' });
        expect(await service.testGate(owner, job.id)).toMatchObject({ ok: false, error: expect.any(String) });
        expect(jobStore.get(owner, job.id)).toEqual(saved);
        expect(jobStore.runs(owner, job.id)).toEqual([]);
        expect(enqueue).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('rejects Test gate for an ungated job, an unknown job and while tool scripting is off', async () => {
        const plain = jobStore.create(owner, { ...input, cron: '0 * * * *' });
        const job = jobStore.create(owner, gated);
        await expect(service.testGate(owner, plain.id)).rejects.toMatchObject({ code: 'invalid' });
        await expect(service.resumeGate(owner, plain.id)).rejects.toMatchObject({ code: 'invalid' });
        await expect(service.testGate(owner, 'missing')).rejects.toMatchObject({ code: 'not_found' });
        gateEnabled = false;
        await expect(service.testGate(owner, job.id)).rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/toolScripting/) });
        enabled = false;
        await expect(service.testGate(owner, job.id)).rejects.toMatchObject({ code: 'not_found' });
        expect(runGate).not.toHaveBeenCalled();
    });

    it('cancels a Test gate when its caller aborts, the server stops or tool scripting turns off', async () => {
        const job = jobStore.create(owner, gated);
        const caller = new AbortController();
        pendingGate();
        const aborted = service.testGate(owner, job.id, caller.signal);
        await flush();
        caller.abort(new Error('Request closed'));
        expect(await aborted).toEqual({ ok: false, error: 'Request closed' });

        pendingGate();
        const flagged = service.testGate(owner, job.id);
        await flush();
        gateEnabled = false;
        await service.invalidate();
        expect(await flagged).toEqual({ ok: false, error: 'Tool scripting was turned off' });

        gateEnabled = true;
        pendingGate();
        const stopped = service.testGate(owner, job.id);
        await flush();
        await service.shutdown();
        expect(await stopped).toEqual({ ok: false, error: 'Server stopped' });
        expect(jobStore.get(owner, job.id)).toMatchObject({ gateConsecutiveFailures: 0, gatePaused: false });
    });

    it('Resume clears the pause and failure count without a revision bump, so ticks run the gate again', async () => {
        const job = jobStore.create(owner, gated);
        runGate.mockRejectedValue(new Error('boom'));
        for (let i = 0; i < GATE_FAILURE_LIMIT; i++) await service.tick(owner, job.id);
        expect(await service.tick(owner, job.id)).toBeUndefined();
        expect(runGate).toHaveBeenCalledTimes(GATE_FAILURE_LIMIT);
        onChange.mockClear();
        const resumed = await service.resumeGate(owner, job.id);
        expect(resumed).toMatchObject({ gatePaused: false, gateConsecutiveFailures: 0, revision: job.revision,
            gateLastError: { message: 'boom' } });
        expect(jobStore.get(owner, job.id)).toEqual(resumed);
        expect(onChange).toHaveBeenCalledWith(owner);
        runGate.mockReset().mockResolvedValueOnce({ items: [1] });
        expect(await service.tick(owner, job.id)).toMatchObject({ status: 'queued', trigger: 'schedule' });
        expect(runGate).toHaveBeenCalledOnce();
    });

    it('fails the tick without a runtime and never runs a second gate for the same job concurrently', async () => {
        const job = jobStore.create(owner, gated);
        const gate = pendingGate();
        const first = service.tick(owner, job.id);
        await flush();
        expect(await service.tick(owner, job.id)).toBeUndefined();
        expect(runGate).toHaveBeenCalledOnce();
        gate.resolve([]);
        await first;

        const bare = makeService({ getGateEnabled: () => true });
        await bare.tick(owner, job.id);
        expect(jobStore.get(owner, job.id).gateLastError?.message).toBe('Gate script runtime is unavailable');
    });
});
