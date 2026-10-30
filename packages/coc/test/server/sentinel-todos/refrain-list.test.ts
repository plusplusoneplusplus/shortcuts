import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import { SentinelRefrainCommands } from '../../../src/server/sentinel-refrains/refrain-commands';
import { SentinelRefrainService } from '../../../src/server/sentinel-refrains/refrain-service';
import { SentinelRefrainStore } from '../../../src/server/sentinel-refrains/refrain-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore, type SentinelTodoOwner } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createSentinelTodosTool, SENTINEL_REFRAIN_LIST_GUIDANCE } from '../../../src/server/llm-tools/sentinel-todos-tool';
import { SENTINEL_TODO_LEDGER_GUIDANCE } from '../../../src/server/executors/prompt-builder';
import { createTodoTestDatabase, createTodoTestDirectory } from './test-db';

const owner = { workspaceId: 'repo-a', processId: 'queue_sentinel' };
const sibling = { ...owner, processId: 'queue_sibling' };
const group = { workspaceId: 'group-team', processId: 'queue_group' };
const now = '2026-10-28T10:00:00.000Z';
const started = '2026-10-28T10:01:00.000Z';
const finished = '2026-10-28T10:02:00.000Z';
let fixture: ReturnType<typeof createTodoTestDatabase>;
let todos: SentinelTodoStore;
let service: SentinelTodoService;
let jobs: SentinelRefrainStore;
let commands: SentinelRefrainCommands;
let enabled: boolean;
let available: boolean;
let enqueue: ReturnType<typeof vi.fn>;
let changed: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fixture = createTodoTestDatabase(createTodoTestDirectory());
    const processes = [owner, sibling, group].map(bound => ({ id: bound.processId,
        metadata: { workspaceId: bound.workspaceId, mode: 'sentinel' } } as AIProcess));
    const store = {
        getProcess: async (id: string) => processes.find(process => process.id === id),
        getWorkspaces: async () => [owner.workspaceId, group.workspaceId].map(id => ({ id })),
    } as unknown as ProcessStore;
    todos = new SentinelTodoStore(fixture.db);
    jobs = new SentinelRefrainStore(fixture.db);
    service = new SentinelTodoService({ todos, store });
    enabled = true;
    available = true;
    enqueue = vi.fn();
    changed = vi.fn();
    commands = new SentinelRefrainCommands({ jobs, service: new SentinelRefrainService({
        dataDir: fixture.dataDir, jobs, todos: service, store, getEnabled: () => enabled,
        enqueue, cancelTask: vi.fn(), getTask: () => undefined, onChange: changed,
    }), onConfigChange: changed });
});
afterEach(() => fixture.dispose());

function tool(bound = owner, withCapability = true) {
    return createSentinelTodosTool({ service, owner: bound,
        ...(withCapability ? { getRefrains: () => available ? commands : undefined } : {}),
    }).tool;
}
async function list(bound = owner, args = {}, withCapability = true): Promise<any> {
    return tool(bound, withCapability).handler({ action: 'list', ...args }, {});
}
function job(bound: SentinelTodoOwner = owner, name = 'Check changes') {
    return jobs.create(bound, { name, instructions: 'Check only', provider: 'copilot', model: 'model', enabled: false });
}
function run(id: string, status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted', bound = owner) {
    const record = jobs.createRun(bound, id, 'manual', 'queue_job', now);
    return jobs.patchRun(bound, id, record.id, { status,
        ...(status !== 'queued' ? { startedAt: started } : {}),
        ...(!['queued', 'running'].includes(status) ? { finishedAt: finished } : {}),
        ...(status !== 'queued' ? { jobTurnHref: `#repos/${bound.workspaceId}/chats/queue_job?turn=${record.runNumber}` } : {}),
    })!;
}

describe('To-do list Refrain summaries', () => {
    it('keeps names separate and shows never-run accurately, including skipped-only schedules', async () => {
        const never = job();
        const skipped = job(owner, 'Gated');
        jobs.createRun(owner, skipped.id, 'schedule', undefined, now, 'gate-empty');
        const result = await list();
        expect(result.items).toEqual([]);
        expect(result.refrains).toEqual({ availability: 'available', items: [
            { id: never.id, name: never.name, latestRun: null },
            { id: skipped.id, name: skipped.name, latestRun: null },
        ] });
    });

    it.each(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'] as const)(
        'uses the newest actual %s run and its timestamp/link, ignoring later skips', async status => {
            const refrain = job();
            run(refrain.id, 'completed');
            const latest = run(refrain.id, status);
            jobs.createRun(owner, refrain.id, 'schedule', undefined, finished, 'gate-empty');
            expect((await list()).refrains.items[0].latestRun).toEqual({ status,
                timestamp: latest.finishedAt ?? latest.startedAt ?? latest.createdAt,
                ...(latest.jobTurnHref ? { jobTurnHref: latest.jobTurnHref } : {}),
            });
            expect(enqueue).not.toHaveBeenCalled();
            expect(changed).not.toHaveBeenCalled();
        });

    it('retains an active run outside the 20-row history window without reviving a completed result', async () => {
        const refrain = job();
        run(refrain.id, 'completed');
        const active = run(refrain.id, 'running');
        for (let i = 0; i < 25; i++) jobs.createRun(owner, refrain.id, 'schedule', undefined, now);
        const native = (await commands.list(owner))[0];
        expect(native.runs).toHaveLength(20);
        expect(native.latestRun?.id).toBe(active.id);
        expect((await list()).refrains.items[0].latestRun).toMatchObject({ status: 'running', timestamp: started });
    });

    it('reports expired actual-run history as unavailable, not never-run', async () => {
        const refrain = job();
        run(refrain.id, 'completed');
        for (let i = 0; i < 25; i++) jobs.createRun(owner, refrain.id, 'schedule', undefined, now, 'gate-empty');
        expect((await list()).refrains.items[0]).toMatchObject({ latestRun: null, latestRunUnavailable: true });
    });

    it('isolates Sentinel, workspace and group ownership and rejects a mismatched workspace', async () => {
        job();
        job(sibling, 'Sibling private');
        const grouped = job(group, 'Group check');
        const groupRun = run(grouped.id, 'completed', group);
        expect((await list()).refrains.items.map((item: any) => item.name)).toEqual(['Check changes']);
        expect((await list(group)).refrains.items).toEqual([{
            id: grouped.id, name: grouped.name, latestRun: {
                status: 'completed', timestamp: finished, jobTurnHref: groupRun.jobTurnHref,
            },
        }]);
        expect(await list({ ...owner, workspaceId: group.workspaceId })).toMatchObject({ code: 'not_found' });
        await expect(commands.list({ ...owner, workspaceId: group.workspaceId })).rejects.toThrow();
    });

    it('uses only the supplied server capability, and preserves To-do pages when unavailable', async () => {
        // A second database is another server, even when raw owner IDs match.
        const remote = createTodoTestDatabase(createTodoTestDirectory());
        try {
            new SentinelRefrainStore(remote.db).create(owner, {
                name: 'Other server private', instructions: 'Private', provider: 'copilot', model: 'model',
            });
            expect((await list()).refrains).toEqual({ availability: 'available', items: [] });
            job();
            const first = todos.create(owner, { title: 'Pending', completionCondition: 'Done' }, { actor: 'user' }).item;
            todos.create(owner, { title: 'Other', completionCondition: 'Done' }, { actor: 'user' });
            const before = todos.get(owner);
            const issued = tool();
            for (const args of [{}, { limit: 1 }, { limit: 1, offset: 1 }, { itemId: first.id }, { includeArchived: true }]) {
                const base = await list(owner, args, false);
                const { refrains, ...actual } = await list(owner, args);
                const { refrains: _, ...expected } = base;
                expect(actual).toEqual(expected);
                expect(refrains.availability).toBe('available');
            }
            enabled = false;
            expect((await issued.handler({ action: 'list' }, {}) as any).refrains)
                .toEqual({ availability: 'unavailable', items: [] });
            available = false;
            expect((await list()).refrains.availability).toBe('unavailable');
            expect(todos.get(owner)).toEqual(before);
            expect(enqueue).not.toHaveBeenCalled();
            expect(changed).not.toHaveBeenCalled();
        } finally { remote.dispose(); }
    });

    it('keeps listing useful on native read failure and carries separate read-only response guidance', async () => {
        vi.spyOn(commands, 'list').mockRejectedValue(new Error('Server read failed'));
        expect(await list()).toMatchObject({ items: [], refrains: { availability: 'unavailable', items: [] } });
        expect(SENTINEL_TODO_LEDGER_GUIDANCE).toContain(SENTINEL_REFRAIN_LIST_GUIDANCE);
        expect(tool().description).toContain(SENTINEL_REFRAIN_LIST_GUIDANCE);
        expect(SENTINEL_REFRAIN_LIST_GUIDANCE).toContain('compact separate latest-run section');
        expect(SENTINEL_REFRAIN_LIST_GUIDANCE).toContain('Listing never authorizes');
    });
});
