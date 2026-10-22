import * as http from 'node:http';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeCron } from '../../../src/server/schedule/cron-utils';
import { createRouter, type Route } from '../../../src/server/shared/router';
import { ScrubberEngine } from '../../../src/server/sentinel-scrubber/scrubber-engine';
import { registerScrubberRoutes } from '../../../src/server/sentinel-scrubber/scrubber-routes';
import { ScrubberRunService, getScrubChildContext } from '../../../src/server/sentinel-scrubber/scrubber-runs';
import { ScrubberStore } from '../../../src/server/sentinel-scrubber/scrubber-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore, type SentinelTodoItem } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';

/**
 * The spec's Definition of Done demo, end to end over isolated fixtures: the
 * real ledger, scrubber store, engine, run service, REST routes and shared
 * client. Only the queue is faked; the child chat's findings go through the
 * same markRunning/submit/terminal path the bound tool and queue events use.
 */
const owner = { workspaceId: 'ws-a', processId: 'queue_sentinel' };
const prA = 'https://github.com/o/r/pull/915';

let fixture: ReturnType<typeof createTodoTestDatabase>;
let todos: SentinelTodoStore;
let scrubber: ScrubberStore;
let runs: ScrubberRunService;
let server: http.Server;
let client: CocClient['sentinelTodos']['scrubber'];
let enqueued: CreateTaskInput[];
let cancelTask: ReturnType<typeof vi.fn>;
let retireItemRules: ReturnType<typeof vi.fn>;

const ws = owner.workspaceId;
const pid = owner.processId;
const current = (itemId: string): SentinelTodoItem => todos.get(owner).items.find(item => item.id === itemId)!;
const childTask = (input: CreateTaskInput): QueuedTask =>
    ({ ...input, id: input.id!, status: 'running', createdAt: 0, retryCount: 0 }) as unknown as QueuedTask;

/** Starts a run through REST and returns its child chat's queue input and bound context. */
async function scrubNow(itemIds?: string[]) {
    const started = await client.start(ws, pid, itemIds ? { itemIds } : {});
    const input = enqueued.at(-1)!;
    expect(started.processId).toBe(`queue_${input.id}`);
    const context = getScrubChildContext(input.payload)!;
    expect(runs.markRunning(context)?.status).toBe('running');
    return { runId: started.runId, input, context };
}

beforeEach(async () => {
    fixture = createTodoTestDatabase(createTodoTestDirectory());
    todos = new SentinelTodoStore(fixture.db);
    scrubber = new ScrubberStore(fixture.db);
    retireItemRules = vi.fn(() => () => undefined);
    const engine = new ScrubberEngine({ todos, scrubber, triggers: { retireItemRules } });
    const service = new SentinelTodoService({ todos, store: {
        getProcess: async id => id === pid ? { id, metadata: { workspaceId: ws, mode: 'sentinel' } } as never : undefined,
    } });
    enqueued = [];
    cancelTask = vi.fn(() => true);
    runs = new ScrubberRunService({
        dataDir: fixture.dataDir, todos: service, scrubber, engine, cancelTask,
        enqueue: async input => { enqueued.push(input); return input.id!; },
    });
    const routes: Route[] = [];
    registerScrubberRoutes({ routes, todos: service, scrubber, engine, runs, getEnabled: () => true });
    server = http.createServer(createRouter({ routes, spaHtml: '' }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') { throw new Error('Missing address'); }
    client = new CocClient({ baseUrl: `http://127.0.0.1:${address.port}` }).sentinelTodos.scrubber;
});
afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    runs.dispose();
    fixture.dispose();
});

describe('To-do Scrubber Definition of Done demo', () => {
    it('walks the A–E ledger through scrub, guards, Accept/Undo, cancel and failure pause', async () => {
        const create = (title: string, extra: Record<string, unknown> = {}) =>
            todos.create(owner, { title, status: 'in_progress', ...extra } as never, { actor: 'sentinel' }).item;
        const a = create('Chat pagination');
        const b = create('WhatsApp safe diagnostics');
        const c = create('Old flaky-shard investigation', { status: 'todo' });
        const d = create('Teams reaction parity', { type: 'manual' });
        const e = create('Review export job');
        todos.linkJob(owner, e.id, { processId: 'queue_job', workspaceId: ws, kind: 'local', openLink: '/chat/queue_job' });
        todos.recordJobResult(owner, 'queue_job', { terminalEventId: 'evt-1', outcome: 'completed' }, () => 'Job finished');
        const eBefore = current(e.id);

        // 1.1 Manual only: the schedule is off by default.
        const initial = await client.get(ws, pid);
        expect(initial.config).toMatchObject({ enabled: false, paused: false, revision: 0 });
        expect(initial.config.nextRunAt).toBeUndefined();
        expect(initial.activeRun).toBeUndefined();

        // 1.2 Run now queues one visible low-priority ask chat; a second start conflicts.
        const first = await scrubNow();
        expect(first.input).toMatchObject({ type: 'chat', priority: 'low', repoId: ws, payload: { mode: 'ask', workspaceId: ws } });
        expect((await client.get(ws, pid)).activeRun).toMatchObject({ id: first.runId, status: 'running' });
        await expect(client.start(ws, pid, {})).rejects.toMatchObject({ status: 409 });
        expect(enqueued).toHaveLength(1);

        // 1.3 Completion applies only evidence-backed Done; everything else is a proposal. E waits for review.
        const firstDetail = await client.getRun(ws, pid, first.runId);
        expect(firstDetail.snapshot.map(entry => entry.itemId).sort()).toEqual([a.id, b.id, c.id, d.id].sort());
        expect(firstDetail.awaitingReviewItemIds).toEqual([e.id]);
        const checkedAt = new Date().toISOString();
        const merged = { kind: 'pr', ref: prA, state: 'merged', checkedAt } as const;
        const commit = { kind: 'commit', ref: 'a1b2c3d', state: 'on_default_branch', checkedAt } as const;
        runs.submit(first.context, [
            { itemId: a.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'PR #915 merged', evidence: [merged] },
            { itemId: b.id, verdict: 'done', confidence: 'medium', summary: 'commit a1b2c3d on main', evidence: [commit] },
            { itemId: c.id, verdict: 'obsolete', confidence: 'medium', summary: 'superseded by #902',
                evidence: [{ kind: 'reference', ref: 'https://github.com/o/r/issues/902', state: 'other', checkedAt }] },
            { itemId: d.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'Reaction parity shipped', evidence: [merged] },
        ]);
        // Nothing applies until the chat completes.
        expect(current(a.id).status).toBe('in_progress');
        await runs.handleTaskTerminal(childTask(first.input), 'completed');

        expect(current(a.id)).toMatchObject({ status: 'done', updatedBy: 'system', outcome: { summary: expect.stringContaining('PR #915 merged') } });
        expect(current(a.id).userVerdictRevision).toBeUndefined();
        expect(retireItemRules).toHaveBeenCalledWith(owner, a.id);
        expect(current(b.id).status).toBe('in_progress');
        expect(current(c.id).status).toBe('todo');
        expect(current(d.id).status).toBe('in_progress');
        expect(current(e.id)).toEqual(eBefore);
        const settled = await client.getRun(ws, pid, first.runId);
        const state = (itemId: string) => settled.findings.find(f => f.itemId === itemId);
        expect(state(a.id)).toMatchObject({ state: 'applied', audit: [{ actor: 'scrubber', action: 'applied' }] });
        expect(state(b.id)).toMatchObject({ state: 'proposed' });
        expect(state(c.id)).toMatchObject({ state: 'proposed', finding: { verdict: 'obsolete' } });
        expect(state(d.id)).toMatchObject({ state: 'proposed', demotedBecause: 'manual' });
        expect(state(e.id)).toBeUndefined();
        expect((await client.get(ws, pid)).runs[0]).toMatchObject({
            id: first.runId, status: 'completed', counts: { done: 1, proposals: 3 }, awaitingReviewCount: 1,
        });

        // 1.4 A user edit to B during a second run supersedes that run's B result.
        const second = await scrubNow([b.id]);
        const edited = todos.update(owner, b.id, current(b.id).revision, { title: 'WhatsApp diagnostics (user)' }, 'user').item;
        runs.submit(second.context, [
            { itemId: b.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'commit a1b2c3d on main',
                evidence: [{ ...commit, checkedAt: new Date().toISOString() }] },
        ]);
        await runs.handleTaskTerminal(childTask(second.input), 'completed');
        expect(current(b.id)).toEqual(edited);
        expect((await client.getRun(ws, pid, second.runId)).findings[0]).toMatchObject({ state: 'proposed', demotedBecause: 'superseded' });

        // 1.5 Accepting Obsolete C closes it as the user with an Obsolete outcome and archives it.
        const acceptedC = await client.accept(ws, pid, first.runId, c.id, { expectedItemRevision: c.revision });
        expect(acceptedC.item).toMatchObject({ status: 'done', archived: true, updatedBy: 'user',
            outcome: { summary: expect.stringContaining('Obsolete:') } });
        expect(retireItemRules).toHaveBeenCalledWith(owner, c.id);

        // Undo A restores In progress, and a fresh scrub with the same evidence does not re-close it.
        const appliedA = current(a.id);
        const undone = await client.undo(ws, pid, first.runId, a.id, { expectedItemRevision: appliedA.revision });
        expect(undone.item).toMatchObject({ status: 'in_progress', updatedBy: 'user' });
        const third = await scrubNow([a.id]);
        runs.submit(third.context, [
            { itemId: a.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'PR #915 merged', evidence: [merged] },
        ]);
        await runs.handleTaskTerminal(childTask(third.input), 'completed');
        expect(current(a.id).status).toBe('in_progress');
        expect((await client.getRun(ws, pid, third.runId)).findings[0].state).toBe('suppressed');

        // 1.6 Enabling a schedule shows its description and next run; cancelling a run applies nothing.
        const scheduled = await client.updateConfig(ws, pid, { enabled: true, cron: '0 9 * * *', expectedRevision: 0 });
        expect(scheduled).toMatchObject({ enabled: true, cron: '0 9 * * *', paused: false });
        const withSchedule = await client.get(ws, pid);
        expect(Date.parse(withSchedule.config.nextRunAt!)).toBeGreaterThan(Date.now());
        expect(describeCron(withSchedule.config.cron)).toMatch(/9/);
        const cancelled = await scrubNow([a.id]);
        runs.submit(cancelled.context, [
            { itemId: a.id, verdict: 'done', confidence: 'high', autoApply: true, summary: 'PR #915 merged',
                evidence: [{ ...merged, ref: `${prA}#new`, checkedAt: new Date().toISOString() }] },
        ]);
        const before = todos.get(owner);
        expect(await client.cancel(ws, pid, cancelled.runId)).toMatchObject({ status: 'cancelled' });
        expect(cancelTask).toHaveBeenCalledWith(cancelled.input.id);
        await runs.handleTaskTerminal(childTask(cancelled.input), 'completed');
        expect(todos.get(owner)).toEqual(before);
        // Submitted findings stay pending forever on a cancelled run; none is applied or offered.
        expect((await client.getRun(ws, pid, cancelled.runId)).findings.map(f => f.state)).toEqual(['pending']);

        // 1.7 Three failures pause the schedule; Resume clears the pause.
        for (let failure = 0; failure < 3; failure++) {
            const failing = await scrubNow([a.id]);
            await runs.handleTaskTerminal(childTask(failing.input), 'failed', new Error('invalid model'));
            expect((await client.getRun(ws, pid, failing.runId))).toMatchObject({ status: 'failed', error: expect.stringContaining('invalid model') });
        }
        const paused = await client.get(ws, pid);
        expect(paused.config).toMatchObject({ enabled: true, paused: true, consecutiveFailures: 3 });
        expect(paused.config.nextRunAt).toBeUndefined();
        const resumed = await client.updateConfig(ws, pid, { enabled: true, cron: '0 9 * * *', expectedRevision: paused.config.revision });
        expect(resumed).toMatchObject({ paused: false, consecutiveFailures: 0 });
        expect(todos.get(owner)).toEqual(before);
    });
});
