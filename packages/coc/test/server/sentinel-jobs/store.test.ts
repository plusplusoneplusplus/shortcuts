import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SentinelJobStore } from '../../../src/server/sentinel-jobs/job-store';
import { createTodoTestDatabase } from '../sentinel-todos/test-db';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createSentinelTodosDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const input = { name: 'Review', instructions: 'Check evidence', provider: 'copilot', model: 'model' };
let fixture: ReturnType<typeof createTodoTestDatabase>;
let store: SentinelJobStore;
beforeEach(() => {
    const directory = path.resolve('.sentinel-jobs-tests', randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    fixture = createTodoTestDatabase(directory);
    store = new SentinelJobStore(fixture.db);
});
afterEach(() => fixture.dispose());

describe('scheduled job definitions and durable runs', () => {
    it('keeps job state machine-local and wipes definitions and runs with the owning ledger', async () => {
        new SentinelTodoStore(fixture.db);
        const job = store.create(owner, input);
        store.createRun(owner, job.id, 'manual', 'queue_job', new Date().toISOString());
        fixture.close();
        const domain = createSentinelTodosDomain();
        const context = { dataDir: fixture.dataDir, store: undefined, includeWikis: false };
        expect(await domain.collect(context as never)).toMatchObject({ data: {}, metadata: {}, warnings: [] });
        const result = { errors: [] as string[] };
        await domain.executeWipe(context as never, (await domain.planWipe(context as never)).plan, result);
        expect(result.errors).toEqual([]);
        fixture = createTodoTestDatabase(fixture.dataDir);
        const restored = new SentinelJobStore(fixture.db);
        expect(restored.list(owner)).toEqual([]);
        expect(restored.runs(owner, job.id)).toEqual([]);
    });
    it('persists defaults, limits each owner independently and enforces scoped identity', () => {
        const job = store.create(owner, input);
        expect(job).toMatchObject({ mode: 'ask', enabled: true, autoCompactThreshold: 100_000, revision: 1 });
        expect(new SentinelJobStore(fixture.db).get(owner, job.id)).toEqual(job);
        for (let i = 1; i < 10; i++) store.create(owner, input);
        expect(() => store.create(owner, input)).toThrow(/at most 10/);
        for (const other of [{ ...owner, workspaceId: 'ws-b' }, { ...owner, processId: 'queue_other' }]) {
            expect(store.list(other)).toEqual([]);
            expect(() => store.get(other, job.id)).toThrow(/not found/);
            expect(store.create(other, input)).toBeDefined();
        }
    });

    it.each([
        { mode: 'sentinel' }, { mode: 'ralph' }, { provider: 'auto' }, { provider: '' },
        { model: '' }, { name: '' }, { instructions: '' }, { autoCompactThreshold: 0 },
        { autoCompactThreshold: 1.5 }, { cron: '* * * * *' }, { cron: 'bad' }, { unknown: true },
        { name: 'n'.repeat(121) }, { instructions: 'i'.repeat(32_001) },
        { effort: 'max' }, { effort: 'very-low' }, { effort: 'other' },
    ])('rejects invalid input %j', patch => {
        expect(() => store.create(owner, { ...input, ...patch } as never)).toThrow();
    });

    it('accepts the editor length boundaries and canonical reasoning efforts', () => {
        for (const effort of ['low', 'medium', 'high', 'xhigh', '']) {
            const job = store.create(owner, { ...input, name: 'n'.repeat(120),
                instructions: 'i'.repeat(32_000), effort });
            expect(job.effort).toBe(effort || undefined);
        }
    });

    it('checks revisions, clears a cron and safely rejects changes during runs or handbacks', () => {
        const job = store.create(owner, { ...input, cron: '0 */6 * * *' });
        expect(() => store.update(owner, job.id, { name: 'new' }, 0)).toThrow(/changed/);
        const updated = store.update(owner, job.id, { cron: '', enabled: false }, 1);
        expect(updated).toMatchObject({ revision: 2, enabled: false });
        expect(updated.cron).toBeUndefined();
        const run = store.createRun(owner, job.id, 'manual', 'queue_job', new Date().toISOString());
        expect(() => store.update(owner, job.id, { name: 'new' }, 2)).toThrow(/Cancel/);
        expect(() => store.delete(owner, job.id, 2)).toThrow(/Cancel/);
        store.patchRun(owner, job.id, run.id, { status: 'completed', handbackState: 'pending' });
        expect(() => store.delete(owner, job.id, 2)).toThrow(/handback/);
        store.patchRun(owner, job.id, run.id, { handbackState: 'delivered' });
        store.delete(owner, job.id, 2);
        expect(store.list(owner)).toEqual([]);
        expect(store.runs(owner, job.id)).toEqual([]);
    });

    it('serializes each job, records schedule overlaps, and keeps independent jobs parallel', () => {
        const a = store.create(owner, input);
        const b = store.create(owner, input);
        const at = new Date().toISOString();
        const run = store.createRun(owner, a.id, 'manual', 'queue_a', at);
        expect(() => store.createRun(owner, a.id, 'manual', 'queue_a', at)).toThrow(/active/);
        expect(store.createRun(owner, a.id, 'schedule', 'queue_a', at)).toMatchObject({ status: 'skipped', skipReason: 'overlap', runNumber: 2 });
        expect(store.createRun(owner, b.id, 'manual', 'queue_b', at).status).toBe('queued');
        store.patchRun(owner, a.id, run.id, { status: 'cancelled' }, ['queued']);
        expect(store.patchRun(owner, a.id, run.id, { status: 'completed' }, ['running'])).toBeUndefined();
        expect(store.run(owner, a.id, run.id).status).toBe('cancelled');
    });

    it('retains 20 recent history records and a monotonic counter without pruning active runs', () => {
        const job = store.create(owner, input);
        const at = new Date().toISOString();
        const first = store.createRun(owner, job.id, 'manual', 'queue_job', at);
        for (let i = 0; i < 25; i++) store.createRun(owner, job.id, 'schedule', 'queue_job', at);
        expect(store.run(owner, job.id, first.id).status).toBe('queued');
        expect(store.get(owner, job.id).runCount).toBe(26);
        expect(store.runs(owner, job.id)).toHaveLength(21);
        store.patchRun(owner, job.id, first.id, { status: 'completed' });
        store.createRun(owner, job.id, 'manual', 'queue_other', at);
        expect(store.runs(owner, job.id)).toHaveLength(20);
        expect(store.get(owner, job.id).processId).toBe('queue_job');
    });
});
