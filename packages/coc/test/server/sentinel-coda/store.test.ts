import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    MAX_SCRUB_RUNS, SCRUB_CRON_PRESETS, SCRUB_DEFAULT_CRON, evidenceFingerprint, codaFindingInputSchema, validateScrubCron,
} from '../../../src/server/sentinel-coda/coda-model';
import {
    CodaStore, CodaStoreError, type CodaFindingRecord, type CodaRunRecord,
} from '../../../src/server/sentinel-coda/coda-store';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createSentinelTodosDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const others = [{ ...owner, processId: 'queue_other' }, { workspaceId: 'ws-b', processId: owner.processId }];
const now = '2026-10-11T10:00:00.000Z';
const evidence = [{ kind: 'pr' as const, ref: 'https://github.com/o/r/pull/915', state: 'merged' as const, checkedAt: now }];

let fixture: ReturnType<typeof createTodoTestDatabase>;
let store: CodaStore;

function run(id: string, patch: Partial<CodaRunRecord> = {}): CodaRunRecord {
    return { id, trigger: 'manual', status: 'queued', createdAt: new Date(Date.parse(now) + Number(id.replace(/\D/g, '') || 0) * 1000).toISOString(),
        snapshot: [], deferredItemIds: [], awaitingReviewItemIds: [], ...patch };
}

function finding(runId: string, itemId: string, state: CodaFindingRecord['state'] = 'proposed'): CodaFindingRecord {
    return {
        runId, itemId, state, itemRevision: 1, fingerprint: evidenceFingerprint(evidence), audit: [],
        finding: codaFindingInputSchema.parse({ itemId, verdict: 'done', confidence: 'medium', summary: 'Merged', evidence }),
    };
}

beforeEach(() => {
    fixture = createTodoTestDatabase(createTodoTestDirectory());
    store = new CodaStore(fixture.db);
});
afterEach(() => fixture.dispose());

describe('scrubber model', () => {
    it('validates finding evidence and autoApply rules', () => {
        expect(codaFindingInputSchema.safeParse({ itemId: 'a', verdict: 'done', confidence: 'high', summary: 's' }).success).toBe(false);
        expect(codaFindingInputSchema.safeParse({ itemId: 'a', verdict: 'obsolete', confidence: 'high', summary: 's', evidence, autoApply: true }).success).toBe(false);
        expect(codaFindingInputSchema.safeParse({ itemId: 'a', verdict: 'unverified', confidence: 'low', summary: 's' }).success).toBe(false);
        expect(codaFindingInputSchema.parse({ itemId: 'a', verdict: 'unchanged', confidence: 'low', summary: 's' }))
            .toMatchObject({ autoApply: false, evidence: [], rationale: '' });
        expect(codaFindingInputSchema.safeParse({ itemId: 'a', verdict: 'done', confidence: 'high', summary: 's', evidence, extra: 1 }).success).toBe(false);
        expect(codaFindingInputSchema.safeParse({ itemId: 'a', verdict: 'done', confidence: 'high', summary: 'x'.repeat(301), evidence }).success).toBe(false);
    });

    it('fingerprints evidence by kind, ref and state regardless of order or check time', () => {
        const a = { kind: 'pr' as const, ref: 'pr-1', state: 'merged' as const };
        const b = { kind: 'commit' as const, ref: 'abc', state: 'on_default_branch' as const };
        expect(evidenceFingerprint([a, b])).toBe(evidenceFingerprint([b, { ...a, ref: ' pr-1 ' }]));
        expect(evidenceFingerprint([a])).not.toBe(evidenceFingerprint([{ ...a, state: 'open' }]));
        expect(evidenceFingerprint([a])).toMatch(/^[0-9a-f]{64}$/);
    });

    it('accepts hourly-or-slower crons and rejects invalid or faster ones', () => {
        const at = new Date('2026-10-11T00:00:00');
        for (const preset of SCRUB_CRON_PRESETS) expect(validateScrubCron(preset.cron, at)).toBeUndefined();
        expect(validateScrubCron('0 * * * *', at)).toBeUndefined();
        expect(validateScrubCron('30 9 * * 1', at)).toBeUndefined();
        expect(validateScrubCron('*/30 * * * *', at)).toMatch(/once an hour/);
        expect(validateScrubCron('0,30 9 * * *', at)).toMatch(/once an hour/);
        expect(validateScrubCron('0 9 * *', at)).toMatch(/5 fields/);
        expect(validateScrubCron('99 9 * * *', at)).toMatch(/out of range/);
        expect(validateScrubCron('a b c d e', at)).toBeDefined();
        // Zero steps otherwise loop forever while expanding wildcard/range fields.
        expect(validateScrubCron('*/0 * * * *', at)).toMatch(/step must be positive/);
        expect(validateScrubCron('0 0-23/00 * * *', at)).toMatch(/step must be positive/);
        expect(validateScrubCron('0-999999999 9 * * *', at)).toMatch(/out of range/);
    });

    it.each([
        '0,30 9 1 1 *', '*/30 9 1 1 *', '0-30/30 9 1 1 *',
        '15,45 9 1 2 *', '0,30 9 1 */3 *',
    ])('rejects sparse sub-hourly cron %s beyond the firing scan horizon', cron => {
        expect(validateScrubCron(cron, new Date(2026, 9, 11))).toMatch(/once an hour/);
    });

    it.each([
        '0 9 1 1 *', '30 9 1 1 *', '0,0 9 1 1 *',
        '0-0 9 1 1 *', '0-59/60 9 1 1 *', '0 9,10 1 1 *',
    ])('accepts sparse hourly-or-slower cron %s regardless of minute syntax', cron => {
        expect(validateScrubCron(cron, new Date(2026, 9, 11))).toBeUndefined();
    });
});

describe('CodaStore', () => {
    it('defaults to a disabled, unsaved daily schedule and saves revision-checked config', () => {
        expect(store.getConfig(owner)).toEqual({ enabled: false, cron: SCRUB_DEFAULT_CRON, paused: false, consecutiveFailures: 0, revision: 0 });
        const saved = store.putConfig(owner, { enabled: true, cron: ' 0 */6 * * * ' }, 0);
        expect(saved).toMatchObject({ enabled: true, cron: '0 */6 * * *', revision: 1 });
        expect(() => store.putConfig(owner, { enabled: false, cron: '0 */6 * * *' }, 0)).toThrow(CodaStoreError);
        expect(store.listEnabledOwners()).toEqual([owner]);
        for (const other of others) expect(store.getConfig(other).revision).toBe(0);
    });

    it('allows one active run per owner while other owners run independently', () => {
        store.createRun(owner, run('r1'));
        expect(() => store.createRun(owner, run('r2'))).toThrow(/already running/);
        for (const other of others) expect(store.createRun(other, run('r1')).id).toBe('r1');
        // A skipped record is not active, so it never blocks.
        store.createRun(owner, run('r3', { status: 'skipped', skipReason: 'overlap' }));
        expect(store.activeRun(owner)?.id).toBe('r1');
        store.transitionRun(owner, 'r1', ['queued', 'running'], { status: 'completed' });
        expect(store.activeRun(owner)).toBeUndefined();
        expect(store.createRun(owner, run('r4')).id).toBe('r4');
        expect(store.listActiveRuns().map(entry => [entry.owner, entry.run.id])).toEqual(expect.arrayContaining([
            [owner, 'r4'], [others[0], 'r1'], [others[1], 'r1'],
        ]));
    });

    it('only transitions runs from the expected states', () => {
        store.createRun(owner, run('r1'));
        expect(store.transitionRun(owner, 'r1', ['queued', 'running'], { status: 'cancelled' })?.status).toBe('cancelled');
        expect(store.transitionRun(owner, 'r1', ['queued', 'running'], { status: 'completed' })).toBeUndefined();
        expect(store.getRun(owner, 'r1')?.status).toBe('cancelled');
        expect(store.transitionRun(others[0], 'r1', ['cancelled'], { status: 'completed' })).toBeUndefined();
    });

    it('pauses the schedule after three consecutive failures and resets on completion', () => {
        store.putConfig(owner, { enabled: true, cron: SCRUB_DEFAULT_CRON }, 0);
        const fail = (id: string, status: 'failed' | 'timed_out' | 'cancelled' | 'skipped' | 'completed') => {
            store.createRun(owner, run(id));
            store.transitionRun(owner, id, ['queued'], { status, inputFingerprint: `fp-${id}` });
        };
        fail('r1', 'failed');
        fail('r2', 'timed_out');
        fail('r3', 'cancelled');
        expect(store.getConfig(owner)).toMatchObject({ consecutiveFailures: 2, paused: false });
        fail('r4', 'completed');
        expect(store.getConfig(owner)).toMatchObject({ consecutiveFailures: 0, lastInputFingerprint: 'fp-r4' });
        fail('r5', 'failed');
        fail('r6', 'failed');
        fail('r7', 'timed_out');
        expect(store.getConfig(owner)).toMatchObject({ consecutiveFailures: 3, paused: true, revision: 1 });
        // Saving (Resume) clears the pause and the counter.
        expect(store.putConfig(owner, { enabled: true, cron: SCRUB_DEFAULT_CRON }, 1)).toMatchObject({ paused: false, consecutiveFailures: 0 });
    });

    it('keeps the newest runs and their findings, never pruning the active run', () => {
        for (let i = 1; i <= MAX_SCRUB_RUNS + 2; i += 1) {
            store.createRun(owner, run(`r${i}`, { status: 'completed' }));
            store.saveFindings(owner, `r${i}`, [finding(`r${i}`, 'item')]);
        }
        store.createRun(owner, run('r99'));
        expect(store.pruneRuns(owner).sort()).toEqual(['r1', 'r2']);
        expect(store.listRuns(owner)).toHaveLength(MAX_SCRUB_RUNS + 1);
        expect(store.listRuns(owner)[0].id).toBe('r99');
        expect(store.listFindings(owner, 'r1')).toEqual([]);
        expect(store.listFindings(owner, 'r3')).toHaveLength(1);
    });

    it('updates findings only from the expected state and scopes them to the owner', () => {
        store.createRun(owner, run('r1'));
        store.saveFindings(owner, 'r1', [finding('r1', 'a'), finding('r1', 'b', 'unchanged')]);
        expect(store.listFindings(owner, 'r1').map(f => f.itemId)).toEqual(['a', 'b']);
        expect(store.listFindings(others[0], 'r1')).toEqual([]);
        const accepted = { ...finding('r1', 'a'), state: 'accepted' as const };
        expect(store.updateFinding(owner, 'proposed', accepted)).toBe(true);
        expect(store.updateFinding(owner, 'proposed', { ...accepted, state: 'dismissed' })).toBe(false);
        expect(store.getFinding(owner, 'r1', 'a')?.state).toBe('accepted');
        expect(() => store.saveFindings(owner, 'r1', [finding('r2', 'a')])).toThrow(CodaStoreError);
    });

    it('suppresses a dismissed verdict only for the same evidence and owner', () => {
        const fp = evidenceFingerprint(evidence);
        store.suppress(owner, 'a', 'obsolete', fp);
        store.suppress(owner, 'a', 'obsolete', fp);
        expect(store.isSuppressed(owner, 'a', 'obsolete', fp)).toBe(true);
        expect(store.isSuppressed(owner, 'a', 'done', fp)).toBe(false);
        expect(store.isSuppressed(owner, 'a', 'obsolete', 'other')).toBe(false);
        for (const other of others) expect(store.isSuppressed(other, 'a', 'obsolete', fp)).toBe(false);
    });

    it('persists across reopen with an idempotent schema', () => {
        store.putConfig(owner, { enabled: true, cron: SCRUB_DEFAULT_CRON }, 0);
        store.createRun(owner, run('r1'));
        const reopened = new CodaStore(fixture.db);
        expect(reopened.getConfig(owner).enabled).toBe(true);
        expect(reopened.activeRun(owner)?.id).toBe('r1');
    });

    it('is wiped with the Sentinel to-do ledger', async () => {
        new SentinelTodoStore(fixture.db);
        store.putConfig(owner, { enabled: true, cron: SCRUB_DEFAULT_CRON }, 0);
        store.createRun(owner, run('r1'));
        store.saveFindings(owner, 'r1', [finding('r1', 'a')]);
        store.suppress(owner, 'a', 'done', 'fp');
        fixture.close();
        const domain = createSentinelTodosDomain();
        const ctx = { dataDir: fixture.dataDir, store: undefined, includeWikis: false };
        const result = { errors: [] as string[] };
        await domain.executeWipe(ctx as never, (await domain.planWipe(ctx as never)).plan, result);
        expect(result.errors).toEqual([]);
        fixture = createTodoTestDatabase(fixture.dataDir);
        const wiped = new CodaStore(fixture.db);
        expect(wiped.getConfig(owner).revision).toBe(0);
        expect(wiped.listRuns(owner)).toEqual([]);
        expect(wiped.isSuppressed(owner, 'a', 'done', 'fp')).toBe(false);
    });
});
