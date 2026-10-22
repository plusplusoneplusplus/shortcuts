import { SENTINEL_COMPLETION_GUIDANCE } from '../../../src/server/delegation/sentinel-job-review-instructions';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { createSubmitScrubFindingsTool } from '../../../src/server/llm-tools/submit-scrub-findings-tool';
import { ScrubberEngine } from '../../../src/server/sentinel-scrubber/scrubber-engine';
import { MAX_SCRUB_ITEMS } from '../../../src/server/sentinel-scrubber/scrubber-model';
import { ScrubberRunService, getScrubChildContext, SUBMIT_SCRUB_FINDINGS_TOOL_NAME } from '../../../src/server/sentinel-scrubber/scrubber-runs';
import { ScrubberStore } from '../../../src/server/sentinel-scrubber/scrubber-store';
import type { SentinelTodoItemView, SentinelTodoLedgerView } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore, type SentinelTodoItem } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import type { Trigger } from '../../../src/server/triggers/trigger-types';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';
import * as config from '../../../src/config';
import { prepareTaskForEnqueue } from '../../../src/server/routes/queue-enqueue';
import { resolveChatTurnPolicy } from '../../../src/server/executors/chat-turn-policy-resolver';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const other = { workspaceId: 'ws-b', processId: 'queue_parent' };
const checkedAt = '2026-10-11T10:05:00.000Z';
const pr = { kind: 'pr', ref: 'https://github.com/o/r/pull/915', state: 'merged', checkedAt };

let fixture: ReturnType<typeof createTodoTestDatabase>;
let todos: SentinelTodoStore;
let scrubber: ScrubberStore;
let service: ScrubberRunService;
let enqueued: CreateTaskInput[];
let enqueue: ReturnType<typeof vi.fn<(input: CreateTaskInput) => Promise<string>>>;
let cancelTask: ReturnType<typeof vi.fn<(taskId: string) => boolean>>;
let onChange: ReturnType<typeof vi.fn>;
let triggers: Trigger[];
/** Items whose linked job result still awaits the Sentinel's review. */
let pendingReview: Set<string>;

function view(item: SentinelTodoItem): SentinelTodoItemView {
    return {
        ...item,
        jobs: pendingReview.has(item.id) ? [{
            processId: 'queue_job', workspaceId: owner.workspaceId, kind: 'chat', linkedAt: item.createdAt,
            execution: { state: 'completed', review: { state: 'delivered', assessment: 'pending', terminalEventId: 't-1' } },
        } as never] : [],
    };
}

function createService(timeoutMs?: number) {
    const engine = new ScrubberEngine({ todos, scrubber, now: () => new Date('2026-10-11T10:10:00.000Z') });
    service = new ScrubberRunService({
        now: () => new Date('2026-10-11T10:00:00.000Z'),
        dataDir: fixture.dataDir, scrubber, engine, enqueue, cancelTask, onChange,
        todos: { list: async ledgerOwner => {
            const ledger = todos.get(ledgerOwner);
            return { revision: ledger.revision, items: ledger.items.map(view) } satisfies SentinelTodoLedgerView;
        } },
        listTriggers: async () => triggers,
        ...(timeoutMs ? { timeoutMs } : {}),
    });
    return service;
}

function item(title: string, patch: { status?: 'in_progress' | 'deferred' | 'done'; statusReason?: string } = {}): SentinelTodoItem {
    return todos.create(owner, { title, ...patch }, { actor: 'sentinel' }).item;
}

function childTask(index = 0): QueuedTask {
    const input = enqueued[index];
    return { ...input, id: input.id!, status: 'running', createdAt: 0, retryCount: 0 } as unknown as QueuedTask;
}

function current(itemId: string): SentinelTodoItem {
    return todos.get(owner).items.find(entry => entry.id === itemId)!;
}

beforeEach(() => {
    fixture = createTodoTestDatabase(createTodoTestDirectory());
    todos = new SentinelTodoStore(fixture.db);
    scrubber = new ScrubberStore(fixture.db);
    enqueued = [];
    enqueue = vi.fn(async (input: CreateTaskInput) => { enqueued.push(input); return input.id!; });
    cancelTask = vi.fn(() => true);
    onChange = vi.fn();
    triggers = [];
    pendingReview = new Set();
    createService();
});
afterEach(() => {
    vi.restoreAllMocks();
    service.dispose();
    vi.useRealTimers();
    fixture.dispose();
});

describe('ScrubberRunService.start', () => {
    it.each(['manual', 'schedule'] as const)('resolves %s runs to medium without changing owner or model routing', async trigger => {
        for (const [ledgerOwner, provider, preferredEffort] of [
            [owner, 'copilot', 'high'], [other, 'codex', 'low'],
        ] as const) {
            const settings = { models: { providers: { [provider]: { reasoningEfforts: { 'gpt-5': preferredEffort } } } } };
            vi.spyOn(config, 'loadConfigFile').mockReturnValue(settings);
            const scheduleBefore = scrubber.getConfig(ledgerOwner);
            const run = await service.start(ledgerOwner, { trigger });
            const task = enqueued.at(-1)!;
            expect(task.config).toEqual({ reasoningEffort: 'medium' });
            expect(task.payload).not.toHaveProperty('provider');
            expect(task.payload).not.toHaveProperty('model');
            await prepareTaskForEnqueue(task, {});
            const policyInput = {
                provider, requestedModel: 'gpt-5', defaultModelMode: 'ask' as const,
                getModelMetadata: async () => ({ id: 'gpt-5', name: 'GPT-5',
                    capabilities: { supports: { reasoning_effort: ['low', 'medium', 'high'] } } }),
            };
            expect((await resolveChatTurnPolicy({ ...policyInput, requestedEffort: undefined })).reasoningEffort)
                .toBe(preferredEffort);
            const policy = await resolveChatTurnPolicy({ ...policyInput, requestedEffort: task.config!.reasoningEffort });
            expect(policy).toMatchObject({ modelId: 'gpt-5', reasoningEffort: 'medium' });
            expect(task.repoId).toBe(ledgerOwner.workspaceId);
            expect(task.payload.workspaceId).toBe(ledgerOwner.workspaceId);
            expect(getScrubChildContext(task.payload)).toEqual({ ...ledgerOwner, runId: run.id });
            expect(scrubber.getConfig(ledgerOwner)).toEqual(scheduleBefore);
            expect(settings.models.providers[provider]?.reasoningEfforts['gpt-5']).toBe(preferredEffort);
        }
    });

    it('cancels a scheduled admission disarmed during snapshot I/O without counting a failure', async () => {
        item('Work');
        service.dispose();
        service = new ScrubberRunService({ dataDir: fixture.dataDir, scrubber,
            engine: new ScrubberEngine({ todos, scrubber }), enqueue, cancelTask,
            todos: { list: async () => ({ ...todos.get(owner), items: todos.get(owner).items.map(view) }) },
            canStartScheduled: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) });
        expect((await service.start(owner, { trigger: 'schedule' })).status).toBe('cancelled');
        expect(enqueue).not.toHaveBeenCalled();
        expect(scrubber.getConfig(owner).consecutiveFailures).toBe(0);
    });

    it('rechecks live schedule admission after awaited snapshot reads', async () => {
        item('Work');
        let armed = true;
        let release!: () => void;
        service.dispose();
        service = new ScrubberRunService({ dataDir: fixture.dataDir, scrubber,
            engine: new ScrubberEngine({ todos, scrubber }), enqueue, cancelTask,
            todos: { list: async () => ({ ...todos.get(owner), items: todos.get(owner).items.map(view) }) },
            listTriggers: () => new Promise(resolve => { release = () => resolve([]); }),
            canStartScheduled: () => armed });
        const pending = service.start(owner, { trigger: 'schedule' });
        await Promise.resolve();
        armed = false;
        release();
        await expect(pending).rejects.toThrow('disarmed');
        expect(enqueue).not.toHaveBeenCalled();
        expect(scrubber.listRuns(owner)).toEqual([]);
        const manual = service.start(owner, { trigger: 'manual' });
        await Promise.resolve();
        release();
        expect((await manual).status).toBe('queued');
    });

    it('keeps Deferred open without counting it as execution-deferred', async () => {
        const postponed = item('Later', { status: 'deferred' });
        const run = await service.start(owner, { trigger: 'manual' });
        expect(run.snapshot).toEqual([{ itemId: postponed.id, revision: postponed.revision }]);
        expect(run.deferredItemIds).toEqual([]);
        expect(enqueued[0].payload.prompt).toContain('Preserve Deferred items as postponed');
    });
    it('queues one low-priority ask child chat with the snapshot passed as a repo-scoped file path', async () => {
        const a = item('Chat pagination', { status: 'in_progress' });
        item('Shipped', { status: 'done', statusReason: 'Merged' });

        const run = await service.start(owner, { trigger: 'manual' });

        expect(run).toMatchObject({ status: 'queued', trigger: 'manual', childProcessId: `queue_${enqueued[0].id}`,
            snapshot: [{ itemId: a.id, revision: a.revision }] });
        expect(enqueue).toHaveBeenCalledTimes(1);
        const task = enqueued[0];
        expect(task).toMatchObject({ type: 'chat', priority: 'low', repoId: owner.workspaceId,
            payload: { kind: 'chat', mode: 'ask', workspaceId: owner.workspaceId } });
        expect(getScrubChildContext(task.payload)).toEqual({ ...owner, runId: run.id });
        // Never a Sentinel delegation: the child must not register as a delegated job.
        expect((task.payload.context as Record<string, unknown>).spawnedFromProcessId).toBeUndefined();

        const snapshotPath = service.snapshotPath(owner, run.id);
        expect(snapshotPath).toBe(path.join(fixture.dataDir, 'repos', owner.workspaceId, 'sentinel-scrubber',
            encodeURIComponent(owner.processId), run.id, 'snapshot.json'));
        expect(task.payload.prompt).toContain(snapshotPath);
        expect(task.payload.prompt).toContain(SUBMIT_SCRUB_FINDINGS_TOOL_NAME);
        expect(task.payload.prompt).toContain(SENTINEL_COMPLETION_GUIDANCE);
        expect(task.payload.prompt).toContain('If closure is uncertain, report `unchanged` with the gap for the parent to ask the user; never auto-apply.');
        expect(task.payload.prompt).toContain('and its completion condition met');
        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
        expect(snapshot.items.map((entry: { id: string }) => entry.id)).toEqual([a.id]);
        expect(onChange).toHaveBeenCalledWith(owner, { runId: run.id });
    });

    it('leaves items awaiting Sentinel review out of the snapshot and defers the newest beyond the cap', async () => {
        const awaiting = item('Pending job');
        pendingReview.add(awaiting.id);
        const items = Array.from({ length: MAX_SCRUB_ITEMS + 2 }, (_, i) => item(`Item ${i}`));
        // Make the first two items the most recently updated.
        for (const recent of items.slice(0, 2)) todos.update(owner, recent.id, recent.revision, { notes: 'touched' }, 'sentinel');

        const run = await service.start(owner, { trigger: 'manual' });

        expect(run.awaitingReviewItemIds).toEqual([awaiting.id]);
        expect(run.snapshot).toHaveLength(MAX_SCRUB_ITEMS);
        expect(run.snapshot.map(entry => entry.itemId)).not.toContain(awaiting.id);
        expect(run.deferredItemIds.sort()).toEqual(items.slice(0, 2).map(entry => entry.id).sort());
        const snapshot = JSON.parse(fs.readFileSync(service.snapshotPath(owner, run.id), 'utf-8'));
        expect(snapshot.awaitingSentinelReview).toEqual([{ id: awaiting.id, title: 'Pending job' }]);
    });

    it('runs over only the selected open items and rejects a selection with none open', async () => {
        const a = item('A');
        item('B');
        const done = item('Done', { status: 'done', statusReason: 'Merged' });

        const run = await service.start(owner, { trigger: 'manual', itemIds: [a.id, done.id] });
        expect(run.snapshot.map(entry => entry.itemId)).toEqual([a.id]);
        expect(run.selectedItemIds).toEqual([a.id]);
        await service.cancel(owner, run.id);

        await expect(service.start(owner, { trigger: 'manual', itemIds: [done.id] }))
            .rejects.toMatchObject({ code: 'invalid' });
    });

    it('is single-flight per ledger: a second manual run conflicts and a scheduled tick is skipped as overlap', async () => {
        item('A');
        const run = await service.start(owner, { trigger: 'manual' });

        await expect(service.start(owner, { trigger: 'manual' })).rejects.toMatchObject({ code: 'conflict' });
        const tick = await service.start(owner, { trigger: 'schedule' });

        expect(tick).toMatchObject({ status: 'skipped', skipReason: 'overlap', trigger: 'schedule' });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(scrubber.activeRun(owner)?.id).toBe(run.id);
        // Another ledger is unaffected.
        await expect(service.start(other, { trigger: 'manual' })).resolves.toMatchObject({ status: 'queued' });
        expect(enqueued[1].repoId).toBe(other.workspaceId);
    });

    it('keeps one visible child even when every open item is awaiting Sentinel review', async () => {
        const a = item('Awaiting review');
        pendingReview.add(a.id);
        const run = await service.start(owner, { trigger: 'manual' });
        expect(run).toMatchObject({ status: 'queued', snapshot: [], awaitingReviewItemIds: [a.id],
            childProcessId: `queue_${enqueued[0].id}` });
        expect(enqueue).toHaveBeenCalledOnce();
        const context = { ...owner, runId: run.id };
        service.markRunning(context);
        expect(service.submit(context, []).accepted).toBe(0);
        await service.handleTaskTerminal(childTask(), 'completed');
        expect(scrubber.getRun(owner, run.id)?.status).toBe('completed');
        expect(current(a.id).status).toBe('todo');
    });

    it('rejects a second manual run even when user edits leave no eligible open items', async () => {
        const a = item('Active run');
        await service.start(owner, { trigger: 'manual' });
        todos.update(owner, a.id, a.revision, { status: 'done', statusReason: 'User closed' }, 'user');
        await expect(service.start(owner, { trigger: 'manual' })).rejects.toMatchObject({ code: 'conflict' });
        expect(enqueue).toHaveBeenCalledOnce();
        expect(scrubber.listRuns(owner)).toHaveLength(1);
    });

    it('skips a scheduled tick when nothing changed since the last completed run, but manual runs always run', async () => {
        const a = item('A', { status: 'in_progress' });
        scrubber.putConfig(owner, { enabled: true, cron: '0 9 * * *' }, 0);
        const first = await service.start(owner, { trigger: 'schedule' });
        service.markRunning({ ...owner, runId: first.id });
        service.submit({ ...owner, runId: first.id }, [{ itemId: a.id, verdict: 'unchanged', confidence: 'medium', summary: 'Still open' }]);
        await service.handleTaskTerminal(childTask(0), 'completed');

        await expect(service.start(owner, { trigger: 'schedule' })).resolves.toMatchObject({ status: 'skipped', skipReason: 'unchanged' });
        triggers = [{ id: 'rule-1', status: 'active', binding: { itemId: a.id } } as Trigger];
        await expect(service.start(owner, { trigger: 'schedule' })).resolves.toMatchObject({ status: 'queued' });
        await service.cancel(owner, scrubber.activeRun(owner)!.id);
        triggers = [];
        await expect(service.start(owner, { trigger: 'manual' })).resolves.toMatchObject({ status: 'queued' });
    });

    it('assesses deferred items on the next bounded run instead of treating the whole ledger as unchanged', async () => {
        const entries = Array.from({ length: MAX_SCRUB_ITEMS + 2 }, (_, i) => item(`Deferred ${i}`));
        scrubber.putConfig(owner, { enabled: true, cron: '0 9 * * *' }, 0);
        const first = await service.start(owner, { trigger: 'schedule' });
        service.markRunning({ ...owner, runId: first.id });
        service.submit({ ...owner, runId: first.id }, first.snapshot.map(entry => ({
            itemId: entry.itemId, verdict: 'unchanged', confidence: 'high', summary: 'Still open',
        })));
        await service.handleTaskTerminal(childTask(), 'completed');
        const next = await service.start(owner, { trigger: 'schedule' });
        expect(next.status).toBe('queued');
        expect(next.snapshot).toHaveLength(MAX_SCRUB_ITEMS);
        expect(next.snapshot.slice(0, 2).map(entry => entry.itemId)).toEqual(first.deferredItemIds);
        expect(new Set([...first.snapshot, ...next.snapshot].map(entry => entry.itemId)).size).toBe(entries.length);
    });

    it('fails the run without applying anything when the child chat cannot be queued', async () => {
        item('A');
        enqueue.mockRejectedValueOnce(new Error('queue full'));

        const run = await service.start(owner, { trigger: 'manual' });

        expect(run).toMatchObject({ status: 'failed', error: 'Could not start the scrub: queue full' });
        expect(scrubber.activeRun(owner)).toBeUndefined();
    });

    it('tracks a child that starts and completes before enqueue resolves', async () => {
        const a = item('Fast child', { status: 'in_progress' });
        enqueue.mockImplementation(async input => {
            enqueued.push(input);
            const context = getScrubChildContext(input.payload)!;
            expect(scrubber.getRun(owner, context.runId)?.childProcessId).toBe(`queue_${input.id}`);
            service.markRunning(context);
            service.submit(context, [{ itemId: a.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'Merged', evidence: [pr] }]);
            await service.handleTaskTerminal(childTask(), 'completed');
            return input.id!;
        });
        const run = await service.start(owner, { trigger: 'manual' });
        expect(run.status).toBe('completed');
        expect(current(a.id).status).toBe('done');
        expect(scrubber.activeRun(owner)).toBeUndefined();
    });

    it('does not enqueue when cancellation wins during snapshot writes', async () => {
        const a = item('Cancelled before admission');
        const createRun = scrubber.createRun.bind(scrubber);
        vi.spyOn(scrubber, 'createRun').mockImplementationOnce((ledgerOwner, record) => {
            const run = createRun(ledgerOwner, record);
            void service.cancel(owner, run.id);
            return run;
        });
        const run = await service.start(owner, { trigger: 'manual' });
        expect(run.status).toBe('cancelled');
        expect(enqueue).not.toHaveBeenCalled();
        expect(current(a.id).status).toBe('todo');
    });

    it('cancels the late-admitted child when cancellation wins while enqueue is pending', async () => {
        const a = item('Cancelled during admission');
        enqueue.mockImplementation(async input => {
            enqueued.push(input);
            const context = getScrubChildContext(input.payload)!;
            await service.cancel(owner, context.runId);
            expect(service.markRunning(context)?.status).toBe('cancelled');
            expect(() => service.submit(context, [])).toThrow('no longer active');
            return input.id!;
        });
        const run = await service.start(owner, { trigger: 'manual' });
        expect(run.status).toBe('cancelled');
        expect(cancelTask).toHaveBeenLastCalledWith(enqueued[0].id);
        expect(cancelTask).toHaveBeenCalledTimes(2);
        expect(current(a.id).status).toBe('todo');
    });

    it('fails and cancels an early-running child if queue admission rejects', async () => {
        const a = item('Rejected admission');
        enqueue.mockImplementation(async input => {
            enqueued.push(input);
            service.markRunning(getScrubChildContext(input.payload)!);
            throw new Error('Admission failed');
        });
        expect((await service.start(owner, { trigger: 'manual' })).status).toBe('failed');
        expect(cancelTask).toHaveBeenLastCalledWith(enqueued[0].id);
        expect(scrubber.activeRun(owner)).toBeUndefined();
        expect(current(a.id).status).toBe('todo');
    });
});

describe('ScrubberRunService findings lifecycle', () => {
    it('accepts one findings batch and applies it only when the chat completes', async () => {
        const a = item('Chat pagination', { status: 'in_progress' });
        const run = await service.start(owner, { trigger: 'manual' });
        const context = { ...owner, runId: run.id };
        expect(service.markRunning(context)?.status).toBe('running');

        const finding = { itemId: a.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'PR #915 merged', evidence: [pr] };
        expect(service.submit(context, [finding, { ...finding, itemId: 'unknown' }])).toEqual({ accepted: 1, ignoredItemIds: ['unknown'] });
        expect(() => service.submit(context, [finding])).toThrow('already submitted');
        expect(current(a.id).status).toBe('in_progress');

        await service.handleTaskTerminal(childTask(), 'completed');

        expect(current(a.id)).toMatchObject({ status: 'done', updatedBy: 'system' });
        expect(scrubber.getRun(owner, run.id)?.status).toBe('completed');
        expect(scrubber.getFinding(owner, run.id, a.id)?.state).toBe('applied');
        expect(onChange).toHaveBeenLastCalledWith(owner, { runId: run.id, ledgerChanged: true });
    });

    it('rejects invalid findings with the schema reason', async () => {
        const a = item('A');
        const run = await service.start(owner, { trigger: 'manual' });
        const context = { ...owner, runId: run.id };
        service.markRunning(context);

        expect(() => service.submit(context, [{ itemId: a.id, verdict: 'obsolete', confidence: 'low', summary: 'Gone' }]))
            .toThrow(/evidence/);
        expect(() => service.submit({ ...context, runId: 'other' }, [])).toThrow('no longer active');
    });

    it('rejects incomplete findings without consuming the one accepted batch or saving partial results', async () => {
        const a = item('Assessed');
        const b = item('Unchecked');
        const run = await service.start(owner, { trigger: 'manual' });
        const context = { ...owner, runId: run.id };
        service.markRunning(context);
        const finding = { itemId: a.id, verdict: 'unchanged', confidence: 'high', summary: 'Still open' };
        expect(() => service.submit(context, [finding])).toThrow('Findings missing for 1 snapshot item');
        expect(scrubber.getRun(owner, run.id)?.findingsSubmittedAt).toBeUndefined();
        expect(scrubber.listFindings(owner, run.id)).toEqual([]);
        expect(service.submit(context, [finding, { itemId: b.id, verdict: 'unverified', confidence: 'low',
            summary: 'Could not check', unverifiedReason: 'Remote unavailable' }]).accepted).toBe(2);
        await service.handleTaskTerminal(childTask(), 'completed');
        expect(scrubber.getFinding(owner, run.id, b.id)?.state).toBe('unverified');
        expect(current(b.id).status).toBe('todo');
    });

    it('applies nothing when the run is cancelled after findings were submitted, and cancels the child chat', async () => {
        const a = item('A', { status: 'in_progress' });
        const run = await service.start(owner, { trigger: 'manual' });
        const context = { ...owner, runId: run.id };
        service.markRunning(context);
        service.submit(context, [{ itemId: a.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'Merged', evidence: [pr] }]);

        await expect(service.cancel(owner, run.id)).resolves.toMatchObject({ status: 'cancelled' });
        await service.handleTaskTerminal(childTask(), 'completed');

        expect(cancelTask).toHaveBeenCalledWith(enqueued[0].id);
        expect(current(a.id).status).toBe('in_progress');
        expect(scrubber.getRun(owner, run.id)?.status).toBe('cancelled');
        await expect(service.cancel(owner, 'missing')).rejects.toMatchObject({ code: 'not_found' });
    });

    it('treats cancelling the child chat as cancelling the run', async () => {
        item('A');
        const run = await service.start(owner, { trigger: 'manual' });
        await service.handleTaskTerminal(childTask(), 'cancelled');
        expect(scrubber.getRun(owner, run.id)).toMatchObject({ status: 'cancelled' });
        expect(scrubber.getRun(owner, run.id)?.error).toBeUndefined();
    });

    it('fails a run whose chat ends without findings or fails, counting toward the schedule pause', async () => {
        item('A');
        scrubber.putConfig(owner, { enabled: true, cron: '0 9 * * *' }, 0);
        const first = await service.start(owner, { trigger: 'manual' });
        service.markRunning({ ...owner, runId: first.id });
        await service.handleTaskTerminal(childTask(0), 'completed');
        expect(scrubber.getRun(owner, first.id)).toMatchObject({ status: 'failed', error: 'The scrub chat ended without submitting findings' });

        const second = await service.start(owner, { trigger: 'manual' });
        await service.handleTaskTerminal(childTask(1), 'failed', new Error('invalid model'));
        expect(scrubber.getRun(owner, second.id)).toMatchObject({ status: 'failed', error: 'The scrub chat failed: invalid model' });
        expect(scrubber.getConfig(owner).consecutiveFailures).toBe(2);
    });

    it('ignores terminal events of unrelated tasks or of a different child process', async () => {
        item('A');
        const run = await service.start(owner, { trigger: 'manual' });
        await service.handleTaskTerminal({ ...childTask(), payload: { kind: 'chat', prompt: 'x' } } as QueuedTask, 'failed');
        await service.handleTaskTerminal({ ...childTask(), id: 'task-other' } as QueuedTask, 'failed');
        expect(scrubber.getRun(owner, run.id)?.status).toBe('queued');
    });

    it('times out a running run, cancels its chat and applies nothing', async () => {
        vi.useFakeTimers();
        createService(1_000);
        const a = item('A', { status: 'in_progress' });
        const run = await service.start(owner, { trigger: 'manual' });
        const context = { ...owner, runId: run.id };
        service.markRunning(context);
        service.submit(context, [{ itemId: a.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'Merged', evidence: [pr] }]);

        await vi.advanceTimersByTimeAsync(1_000);

        expect(scrubber.getRun(owner, run.id)).toMatchObject({ status: 'timed_out', error: expect.stringContaining('did not finish') });
        expect(cancelTask).toHaveBeenCalledWith(enqueued[0].id);
        await service.handleTaskTerminal(childTask(), 'completed');
        expect(current(a.id).status).toBe('in_progress');
    });

    it('marks runs left active by a previous server process as interrupted', async () => {
        item('A');
        const run = await service.start(owner, { trigger: 'manual' });

        await expect(createService().interruptActive()).resolves.toBe(1);

        expect(scrubber.getRun(owner, run.id)).toMatchObject({ status: 'interrupted' });
        expect(cancelTask).toHaveBeenCalledWith(enqueued[0].id);
        expect(scrubber.activeRun(owner)).toBeUndefined();
    });
});

describe('submit_scrub_findings tool', () => {
    it('is bound to its run and is the only tool a scrub chat gets', async () => {
        const a = item('A');
        const run = await service.start(owner, { trigger: 'manual' });
        const context = { ...owner, runId: run.id };
        service.markRunning(context);
        const tool = createSubmitScrubFindingsTool({ service, context });
        const invoke = (args: unknown) => (tool.handler as (args: unknown, inv: unknown) => Promise<unknown>)(args, {});

        await expect(invoke({ runId: 'other', findings: [] })).resolves.toEqual({ error: `runId must be "${run.id}"` });
        await expect(invoke({ runId: run.id, findings: [{ itemId: a.id, verdict: 'unchanged', confidence: 'high', summary: 'Open' }] }))
            .resolves.toEqual({ status: 'submitted', accepted: 1, ignoredItemIds: [] });
        await expect(invoke({ runId: run.id, findings: [] })).resolves.toMatchObject({ error: expect.stringContaining('already submitted') });

        const bundle = buildChatToolBundle({ store: {} as never, workspaceId: owner.workspaceId, processId: 'queue_task-1',
            scrubFindings: tool, enqueueChat: vi.fn() as never, includeCanvasTools: true });
        expect(bundle.tools.map(entry => entry.name)).toEqual([SUBMIT_SCRUB_FINDINGS_TOOL_NAME]);
        expect(bundle.toolGuidance).toBe('');
    });
});

it('replaces queue subscriptions on reattach and removes them on disposal', async () => {
    const queue = new EventEmitter();
    const nextQueue = new EventEmitter();
    const settle = vi.spyOn(service, 'handleTaskTerminal').mockResolvedValue(undefined);
    service.attach(queue);
    service.attach(nextQueue);
    expect(queue.listenerCount('taskCompleted')).toBe(0);
    expect(nextQueue.listenerCount('taskCompleted')).toBe(1);
    nextQueue.emit('taskCompleted', '/repo', {});
    expect(settle).toHaveBeenCalledOnce();
    service.dispose();
    for (const event of ['taskCompleted', 'taskFailed', 'taskCancelled']) expect(nextQueue.listenerCount(event)).toBe(0);
    nextQueue.emit('taskCompleted', '/repo', {});
    expect(settle).toHaveBeenCalledOnce();
});
