import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import { createSentinelJobsTool, type SentinelJobDefaults, type SentinelJobsArgs } from '../../../src/server/llm-tools/sentinel-jobs-tool';
import { SentinelJobCommands } from '../../../src/server/sentinel-jobs/job-commands';
import { SentinelJobService } from '../../../src/server/sentinel-jobs/job-service';
import { SentinelJobStore } from '../../../src/server/sentinel-jobs/job-store';
import { ScrubberCommands } from '../../../src/server/sentinel-scrubber/scrubber-commands';
import { ScrubberEngine } from '../../../src/server/sentinel-scrubber/scrubber-engine';
import { ScrubberRunService } from '../../../src/server/sentinel-scrubber/scrubber-runs';
import { ScrubberStore } from '../../../src/server/sentinel-scrubber/scrubber-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_s1' };
const sibling = { workspaceId: 'ws-a', processId: 'queue_s2' };
const otherWorkspace = { workspaceId: 'ws-b', processId: 'queue_s3' };

let jobStore: SentinelJobStore;
let todos: SentinelTodoStore;
let scrubberStore: ScrubberStore;
let processes: Map<string, AIProcess>;
let jobsEnabled: boolean;
let sentinelEnabled: boolean;
let scrubberEnabled: boolean;
let enqueue: ReturnType<typeof vi.fn>;
let scrubEnqueue: ReturnType<typeof vi.fn>;
let onConfigChange: ReturnType<typeof vi.fn>;
let jobCommands: SentinelJobCommands;
let scrubberCommands: ScrubberCommands;
let defaults: SentinelJobDefaults;

function sentinel(id: string, workspaceId: string): AIProcess {
    return { id, type: 'chat', status: 'running', startTime: new Date(), conversationTurns: [],
        metadata: { mode: 'sentinel', workspaceId } } as unknown as AIProcess;
}

beforeEach(() => {
    const fixture = createTodoTestDatabase(createTodoTestDirectory());
    processes = new Map([
        [owner.processId, sentinel(owner.processId, 'ws-a')],
        [sibling.processId, sentinel(sibling.processId, 'ws-a')],
        [otherWorkspace.processId, sentinel(otherWorkspace.processId, 'ws-b')],
    ]);
    const store = {
        getWorkspaces: async () => [{ id: 'ws-a', name: 'a', rootPath: '/a' }, { id: 'ws-b', name: 'b', rootPath: '/b' }],
        getProcess: async (id: string) => processes.get(id),
        addProcess: async (value: AIProcess) => { processes.set(value.id, value); },
        updateProcess: async (id: string, updates: Partial<AIProcess>) => {
            const current = processes.get(id);
            if (current) processes.set(id, { ...current, ...updates, metadata: { ...current.metadata, ...updates.metadata } });
        },
    } as unknown as ProcessStore;
    jobStore = new SentinelJobStore(fixture.db);
    todos = new SentinelTodoStore(fixture.db);
    scrubberStore = new ScrubberStore(fixture.db);
    const todoService = new SentinelTodoService({ todos, store });
    jobsEnabled = true;
    sentinelEnabled = true;
    scrubberEnabled = true;
    enqueue = vi.fn(async (input: CreateTaskInput) => input.id ?? 'task');
    scrubEnqueue = vi.fn(async (input: CreateTaskInput) => input.id!);
    onConfigChange = vi.fn();
    const service = new SentinelJobService({ dataDir: fixture.dataDir, jobs: jobStore, todos: todoService, store,
        getEnabled: () => sentinelEnabled && jobsEnabled, enqueue, cancelTask: vi.fn(() => true), getTask: () => undefined });
    jobCommands = new SentinelJobCommands({ jobs: jobStore, service, onConfigChange });
    const runs = new ScrubberRunService({ dataDir: fixture.dataDir, todos: todoService, scrubber: scrubberStore,
        engine: new ScrubberEngine({ todos, scrubber: scrubberStore }), enqueue: scrubEnqueue, cancelTask: vi.fn(() => true) });
    scrubberCommands = new ScrubberCommands({ todos: todoService, scrubber: scrubberStore, runs, getEnabled: () => scrubberEnabled });
    defaults = { provider: 'copilot', model: 'gpt-5', effort: 'high' };
});

function call(args: SentinelJobsArgs | Record<string, unknown>, bound = owner, withScrubber = true): Promise<any> {
    const tool = createSentinelJobsTool({ owner: bound, jobs: jobCommands,
        ...(withScrubber ? { scrubber: scrubberCommands } : {}), defaults: () => defaults });
    return (tool as any).handler(args, {});
}

async function createJob(extra: Record<string, unknown> = {}) {
    const result = await call({ action: 'create', kind: 'custom', name: 'Nightly', instructions: 'Check the ledger', ...extra });
    expect(result.error).toBeUndefined();
    return result.job;
}

describe('sentinel_jobs tool schema', () => {
    it('exposes no delete action and no owner parameters', () => {
        const tool = createSentinelJobsTool({ owner, jobs: jobCommands, scrubber: scrubberCommands, defaults: () => defaults }) as any;
        const props = tool.parameters.properties;
        expect(props.action.enum).not.toContain('delete');
        for (const key of ['owner', 'workspaceId', 'processId', 'serverId']) expect(props).not.toHaveProperty(key);
        expect(tool.description).toMatch(/never permission/);
    });
});

describe('custom jobs', () => {
    it('creates with inherited settings, ask mode, no run and no schedule unless requested', async () => {
        const job = await createJob({ cron: '0 9 * * *' });
        expect(job).toMatchObject({ provider: 'copilot', model: 'gpt-5', effort: 'high', mode: 'ask', enabled: false, revision: 1 });
        expect(job.nextRunAt).toBeUndefined();
        expect(enqueue).not.toHaveBeenCalled();
        expect(jobStore.runs(owner, job.id)).toEqual([]);
        expect(onConfigChange).toHaveBeenCalled();

        const scheduled = await createJob({ name: 'Daily', cron: '0 9 * * *', enabled: true });
        expect(scheduled.enabled).toBe(true);
        expect(scheduled.nextRunAt).toBeDefined();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it.each([
        { settings: {}, provider: 'copilot', model: 'gpt-5', effort: 'high' },
        { settings: { provider: 'copilot' }, provider: 'copilot', model: 'gpt-5', effort: 'high' },
        { settings: { model: 'gpt-5' }, provider: 'copilot', model: 'gpt-5', effort: 'high' },
        { settings: { provider: 'copilot', model: 'gpt-5' }, provider: 'copilot', model: 'gpt-5', effort: 'high' },
        { settings: { model: 'gpt-5', effort: 'low' }, provider: 'copilot', model: 'gpt-5', effort: 'low' },
        { settings: { model: 'gpt-5', effort: '' }, provider: 'copilot', model: 'gpt-5', effort: undefined },
        { settings: { model: 'other-model' }, provider: 'copilot', model: 'other-model', effort: undefined },
        { settings: { provider: 'claude', model: 'gpt-5' }, provider: 'claude', model: 'gpt-5', effort: undefined },
        { settings: { provider: 'claude', model: 'opus', effort: 'low' }, provider: 'claude', model: 'opus', effort: 'low' },
    ])('resolves create settings $settings without crossing provider/model effort defaults', async ({ settings, provider, model, effort }) => {
        const job = await createJob(settings);
        expect(job).toMatchObject({ provider, model });
        expect(job.effort).toBe(effort);
        expect(jobStore.get(owner, job.id).effort).toBe(effort);
    });

    it('does not pair another provider with the Sentinel model and reports unresolved defaults', async () => {
        expect(await call({ action: 'create', kind: 'custom', name: 'X', instructions: 'Y', provider: 'claude' }))
            .toMatchObject({ code: 'invalid', error: expect.stringMatching(/provider and model/) });
        const job = await createJob({ provider: 'claude', model: 'opus' });
        expect(job).toMatchObject({ provider: 'claude', model: 'opus' });
        expect(job.effort).toBeUndefined();
        defaults = {};
        expect(await call({ action: 'create', kind: 'custom', name: 'X', instructions: 'Y' })).toMatchObject({ code: 'invalid' });
        expect(jobStore.list(owner)).toHaveLength(1);
    });

    it('updates only passed fields, pauses/resumes and rejects stale revisions', async () => {
        const job = await createJob({ cron: '0 9 * * *', mode: 'autopilot', autoCompactThreshold: 5000 });
        const updated = (await call({ action: 'update', kind: 'custom', jobId: job.id, expectedRevision: 1, instructions: 'New' })).job;
        expect(updated).toMatchObject({ name: 'Nightly', instructions: 'New', mode: 'autopilot', cron: '0 9 * * *',
            autoCompactThreshold: 5000, provider: 'copilot', model: 'gpt-5', effort: 'high', enabled: false, revision: 2 });
        const resumed = (await call({ action: 'resume', kind: 'custom', jobId: job.id, expectedRevision: 2 })).job;
        expect(resumed).toMatchObject({ enabled: true, revision: 3 });
        expect(resumed.nextRunAt).toBeDefined();
        const rescheduled = (await call({ action: 'update', kind: 'custom', jobId: job.id, expectedRevision: 3, cron: '30 8 * * 1' })).job;
        expect(rescheduled).toMatchObject({ cron: '30 8 * * 1', enabled: true });
        expect((await call({ action: 'pause', kind: 'custom', jobId: job.id, expectedRevision: 4 })).job.enabled).toBe(false);
        const stale = await call({ action: 'update', kind: 'custom', jobId: job.id, expectedRevision: 1, name: 'Old' });
        expect(stale).toMatchObject({ code: 'conflict', current: { id: job.id, revision: 5 } });
        expect(await call({ action: 'update', kind: 'custom', jobId: job.id, name: 'X' })).toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'update', kind: 'custom', jobId: job.id, expectedRevision: 5 })).toMatchObject({ code: 'invalid' });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('rejects invalid cron/settings and the ten-job limit', async () => {
        expect(await call({ action: 'create', kind: 'custom', name: 'X', instructions: 'Y', cron: 'nope' })).toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'create', kind: 'custom', name: '', instructions: 'Y' })).toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'create', kind: 'custom', name: 'X', instructions: 'Y', mode: 'yolo' })).toMatchObject({ code: 'invalid' });
        for (let i = 0; i < 10; i++) await createJob({ name: `Job ${i}` });
        expect(await call({ action: 'create', kind: 'custom', name: 'Eleventh', instructions: 'Y' })).toMatchObject({ code: 'limit' });
    });

    it('runs now, blocks overlap and edits during a run, allows pause, and cancels', async () => {
        const job = await createJob({ cron: '0 9 * * *', enabled: true });
        const { run } = await call({ action: 'run_now', kind: 'custom', jobId: job.id });
        expect(run).toMatchObject({ trigger: 'manual', status: 'queued' });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(await call({ action: 'run_now', kind: 'custom', jobId: job.id })).toMatchObject({ code: 'conflict' });
        expect(await call({ action: 'update', kind: 'custom', jobId: job.id, expectedRevision: 1, name: 'X' }))
            .toMatchObject({ code: 'conflict', error: expect.stringMatching(/handback/) });
        const paused = (await call({ action: 'pause', kind: 'custom', jobId: job.id, expectedRevision: 1 })).job;
        expect(paused).toMatchObject({ enabled: false });
        expect(paused.activeRun?.id).toBe(run.id);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(await call({ action: 'cancel', kind: 'custom', jobId: job.id })).toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'cancel', kind: 'custom', jobId: job.id, runId: 'missing' })).toMatchObject({ code: 'not_found' });
        expect((await call({ action: 'cancel', kind: 'custom', jobId: job.id, runId: run.id })).run).toMatchObject({ id: run.id, status: 'cancelled' });
    });

    it('returns a failed run when the queue rejects it', async () => {
        const job = await createJob();
        enqueue.mockRejectedValueOnce(new Error('queue offline'));
        const result = await call({ action: 'run_now', kind: 'custom', jobId: job.id });
        expect(result.run).toMatchObject({ status: 'failed', error: expect.stringMatching(/queue offline/) });
    });

    it('lists and reads with ids, revisions and history', async () => {
        const job = await createJob();
        const list = await call({ action: 'list' });
        expect(list.jobs).toEqual([expect.objectContaining({ id: job.id, revision: 1, runs: [] })]);
        expect(list.scrubber.config).toMatchObject({ enabled: false, revision: 0 });
        expect((await call({ action: 'get', kind: 'custom', jobId: job.id })).job.id).toBe(job.id);
        expect(await call({ action: 'get', kind: 'custom' })).toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'get' })).toMatchObject({ code: 'invalid' });
    });
});

describe('ownership and feature gates', () => {
    it('isolates jobs across Sentinels and workspaces', async () => {
        const job = await createJob();
        expect((await call({ action: 'list' }, sibling)).jobs).toEqual([]);
        expect((await call({ action: 'list' }, otherWorkspace)).jobs).toEqual([]);
        expect(await call({ action: 'get', kind: 'custom', jobId: job.id }, sibling)).toMatchObject({ code: 'not_found' });
        expect(await call({ action: 'run_now', kind: 'custom', jobId: job.id }, otherWorkspace)).toMatchObject({ code: 'not_found' });
        expect(await call({ action: 'pause', kind: 'custom', jobId: job.id, expectedRevision: 1 }, sibling)).toMatchObject({ code: 'not_found' });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it.each(['sentinel', 'jobs', 'owner', 'workspace'] as const)(
        'revokes every action on an issued tool after %s becomes unavailable', async gate => {
            const job = await createJob();
            const tool = createSentinelJobsTool({ owner, jobs: jobCommands, scrubber: scrubberCommands,
                defaults: () => defaults }) as any;
            expect((await tool.handler({ action: 'get', kind: 'scrubber' }, {})).scrubber).toBeDefined();
            const config = scrubberStore.getConfig(owner);
            const scrubberCalls = ['view', 'putConfig', 'start', 'cancel'] as const;
            const spies = scrubberCalls.map(method => vi.spyOn(scrubberCommands, method));
            if (gate === 'sentinel') sentinelEnabled = false;
            if (gate === 'jobs') jobsEnabled = false;
            if (gate === 'owner') processes.delete(owner.processId);
            if (gate === 'workspace') processes.set(owner.processId, sentinel(owner.processId, 'ws-b'));

            for (const kind of ['custom', 'scrubber'] as const) {
                for (const action of ['list', 'get', 'create', 'update', 'pause', 'resume', 'run_now', 'cancel'] as const) {
                    expect(await tool.handler({ action, kind, jobId: job.id, runId: 'run', expectedRevision: 0,
                        name: 'Changed', instructions: 'Check', enabled: true }, {})).toMatchObject({ code: 'not_found' });
                }
            }
            for (const spy of spies) expect(spy).not.toHaveBeenCalled();
            expect(jobStore.list(owner)).toEqual([expect.objectContaining({ id: job.id, revision: 1, name: 'Nightly' })]);
            expect(scrubberStore.getConfig(owner)).toEqual(config);
            expect(enqueue).not.toHaveBeenCalled();
            expect(scrubEnqueue).not.toHaveBeenCalled();
            // Scrubber REST commands remain independent of the jobs feature.
            if (gate === 'sentinel' || gate === 'jobs') expect((await scrubberCommands.view(owner)).config).toEqual(config);
        });

    it('rejects non-Sentinel owners and calls after the feature is disabled', async () => {
        processes.set('queue_ask', { ...sentinel('queue_ask', 'ws-a'), metadata: { mode: 'ask', workspaceId: 'ws-a' } } as AIProcess);
        expect(await call({ action: 'list' }, { workspaceId: 'ws-a', processId: 'queue_ask' })).toMatchObject({ code: 'not_found' });
        const job = await createJob();
        jobsEnabled = false;
        expect(await call({ action: 'list' })).toMatchObject({ code: 'not_found' });
        expect(await call({ action: 'run_now', kind: 'custom', jobId: job.id })).toMatchObject({ code: 'not_found' });
        expect(enqueue).not.toHaveBeenCalled();
    });
});

describe('built-in scrubber', () => {
    it('changes schedule, pauses and resumes, and rejects unsupported settings or creation', async () => {
        const saved = (await call({ action: 'update', kind: 'scrubber', expectedRevision: 0, cron: '0 7 * * *', enabled: true })).scrubber;
        expect(saved).toMatchObject({ enabled: true, cron: '0 7 * * *', revision: 1 });
        expect(saved.nextRunAt).toBeDefined();
        expect((await call({ action: 'pause', kind: 'scrubber', expectedRevision: 1 })).scrubber)
            .toMatchObject({ enabled: false, cron: '0 7 * * *', revision: 2 });
        expect(await call({ action: 'update', kind: 'scrubber', expectedRevision: 2, model: 'x' }))
            .toMatchObject({ code: 'invalid', error: expect.stringMatching(/model/) });
        expect(await call({ action: 'update', kind: 'scrubber', expectedRevision: 2, cron: 'bad' })).toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'pause', kind: 'scrubber', expectedRevision: 0 })).toMatchObject({ code: 'conflict', current: { revision: 2 } });
        expect(await call({ action: 'create', kind: 'scrubber' })).toMatchObject({ code: 'invalid' });
        expect(scrubEnqueue).not.toHaveBeenCalled();
    });

    it('resuming clears an auto-pause', async () => {
        await call({ action: 'update', kind: 'scrubber', expectedRevision: 0, enabled: true });
        (scrubberStore as any).saveConfig(owner, { ...scrubberStore.getConfig(owner), paused: true, consecutiveFailures: 3 });
        const resumed = (await call({ action: 'resume', kind: 'scrubber', expectedRevision: 1 })).scrubber;
        expect(resumed).toMatchObject({ enabled: true, paused: false, consecutiveFailures: 0, revision: 2 });
    });

    it('runs now with optional item selection, blocks overlap and cancels', async () => {
        const item = todos.create(owner, { title: 'Ship', completionCondition: 'Shipped' }, { actor: 'sentinel' }).item;
        expect(await call({ action: 'run_now', kind: 'scrubber', itemIds: ['missing'] })).toMatchObject({ code: 'invalid' });
        const { run } = await call({ action: 'run_now', kind: 'scrubber', itemIds: [item.id] });
        expect(run).toMatchObject({ trigger: 'manual', status: 'queued' });
        expect(await call({ action: 'run_now', kind: 'scrubber' })).toMatchObject({ code: 'conflict' });
        expect((await call({ action: 'get', kind: 'scrubber' })).scrubber.activeRun.id).toBe(run.id);
        expect((await call({ action: 'cancel', kind: 'scrubber', runId: run.id })).run).toMatchObject({ status: 'cancelled' });
        expect(await call({ action: 'cancel', kind: 'scrubber', runId: run.id }, sibling)).toMatchObject({ code: 'not_found' });
    });

    it('revokes scrubber actions on an issued tool when only the scrubber flag is disabled', async () => {
        const tool = createSentinelJobsTool({ owner, jobs: jobCommands, scrubber: scrubberCommands,
            defaults: () => defaults }) as any;
        expect((await tool.handler({ action: 'get', kind: 'scrubber' }, {})).scrubber).toBeDefined();
        const config = scrubberStore.getConfig(owner);
        scrubberEnabled = false;
        for (const action of ['get', 'update', 'pause', 'resume', 'run_now', 'cancel'] as const) {
            expect(await tool.handler({ action, kind: 'scrubber', expectedRevision: 0, enabled: true, runId: 'run' }, {}))
                .toMatchObject({ code: 'not_found' });
        }
        expect(await tool.handler({ action: 'list' }, {}))
            .toMatchObject({ jobs: [], scrubber: { unavailable: expect.any(String) } });
        expect(scrubberStore.getConfig(owner)).toEqual(config);
        expect(scrubEnqueue).not.toHaveBeenCalled();
    });

    it('is unavailable when the scrubber flag is off or not wired', async () => {
        scrubberEnabled = false;
        expect(await call({ action: 'get', kind: 'scrubber' })).toMatchObject({ code: 'not_found' });
        expect((await call({ action: 'list' })).scrubber).toEqual({ unavailable: expect.any(String) });
        expect(await call({ action: 'get', kind: 'scrubber' }, owner, false)).toMatchObject({ code: 'not_found' });
        expect((await call({ action: 'list' }, owner, false)).scrubber).toBeUndefined();
    });
});
