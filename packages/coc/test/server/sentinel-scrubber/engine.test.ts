import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { ScrubberEngine } from '../../../src/server/sentinel-scrubber/scrubber-engine';
import { scrubFindingInputSchema, type ScrubFindingInput } from '../../../src/server/sentinel-scrubber/scrubber-model';
import { ScrubberStore, type ScrubRunRecord } from '../../../src/server/sentinel-scrubber/scrubber-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore, type SentinelTodoItem } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoTriggerService } from '../../../src/server/triggers/sentinel-todo-trigger-service';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const other = { workspaceId: 'ws-b', processId: 'queue_parent' };
const startedAt = '2026-10-11T10:00:00.000Z';
const checkedAt = '2026-10-11T10:05:00.000Z';
const now = new Date('2026-10-11T10:10:00.000Z');
const pr = { kind: 'pr' as const, ref: 'https://github.com/o/r/pull/915', state: 'merged' as const, checkedAt };

let fixture: ReturnType<typeof createTodoTestDatabase>;
let todos: SentinelTodoStore;
let scrubber: ScrubberStore;
let triggers: TriggerStore;
let engine: ScrubberEngine;
const disarm = vi.fn();
const emit = vi.fn();

function finding(itemId: string, patch: Partial<ScrubFindingInput> = {}): ScrubFindingInput {
    return scrubFindingInputSchema.parse({
        itemId, verdict: 'done', confidence: 'high', autoApply: true, summary: 'PR #915 merged', evidence: [pr], ...patch,
    });
}

function item(title: string, patch: { type?: 'manual'; status?: 'in_progress' } = {}): SentinelTodoItem {
    return todos.create(owner, { title, ...patch }, { actor: 'sentinel' }).item;
}

function startRun(items: SentinelTodoItem[], id = 'run-1'): ScrubRunRecord {
    scrubber.createRun(owner, {
        id, trigger: 'manual', status: 'running', createdAt: startedAt, startedAt,
        snapshot: items.map(entry => ({ itemId: entry.id, revision: entry.revision })),
        deferredItemIds: [], awaitingReviewItemIds: [],
    });
    return scrubber.getRun(owner, id)!;
}

function current(itemId: string): SentinelTodoItem {
    return todos.get(owner).items.find(entry => entry.id === itemId)!;
}

beforeEach(() => {
    vi.resetAllMocks();
    fixture = createTodoTestDatabase(createTodoTestDirectory());
    todos = new SentinelTodoStore(fixture.db);
    scrubber = new ScrubberStore(fixture.db);
    triggers = new TriggerStore(fixture.db);
    const getProcess = vi.fn<(id: string) => Promise<AIProcess>>();
    const ruleService = new SentinelTodoTriggerService({
        triggers, todos, owners: new SentinelTodoService({ todos, store: { getProcess } }),
        manager: { arm: vi.fn(), disarm }, firer: { fire: vi.fn() } as never, fetchPr: vi.fn(), enabled: true, emit,
        now: () => now.getTime(),
    });
    engine = new ScrubberEngine({ todos, scrubber, triggers: ruleService, now: () => now });
});
afterEach(() => fixture.dispose());

function armRule(itemId: string, id = 'rule-1') {
    triggers.insert({
        id, ...owner, status: 'active', revision: 1, inFlight: false, createdAt: startedAt, expiresAt: null,
        lastTickAt: null, nextTickAt: startedAt,
        event: { type: 'condition-monitor', monitor: 'pr-merged', pollIntervalMs: 60_000, consecutiveErrors: 0,
            pr: { provider: 'github', host: 'github.com', repoPath: 'o/r', number: 915 } },
        binding: { kind: 'sentinel-todo', itemId, armedBy: 'sentinel', armedAt: startedAt },
        action: { type: 'send-message', mode: 'inherit', processId: owner.processId, prompt: '' },
    } as never);
}

describe('ScrubberEngine.complete', () => {
    it('keeps Deferred despite newer completion evidence, then permits explicit user acceptance', () => {
        const deferred = todos.create(owner, { title: 'Postponed', status: 'deferred' }, { actor: 'user' }).item;
        startRun([deferred]);
        const completed = engine.complete(owner, 'run-1', [finding(deferred.id, { evidence: [{ ...pr, observedAt: '2099-01-01T00:00:00Z' }] })])!;
        expect(completed.findings[0]).toMatchObject({ state: 'proposed', demotedBecause: 'user_verdict' });
        expect(current(deferred.id).status).toBe('deferred');
        expect(engine.accept(owner, 'run-1', deferred.id, deferred.revision).item.status).toBe('done');
    });
    it('accepts a Deferred proposal only through the user action', () => {
        const row = item('Postpone');
        startRun([row]);
        expect(engine.complete(owner, 'run-1', [finding(row.id, { verdict: 'deferred', autoApply: false })])!.findings[0].state).toBe('proposed');
        expect(current(row.id).status).toBe('todo');
        expect(engine.accept(owner, 'run-1', row.id, row.revision).item.status).toBe('deferred');
    });
    it('auto-applies a strong Done as system without a user verdict and retires its PR rule', () => {
        const a = item('Chat pagination', { status: 'in_progress' });
        armRule(a.id);
        startRun([a]);
        const result = engine.complete(owner, 'run-1', [finding(a.id)])!;
        expect(result.run.status).toBe('completed');
        expect(result.findings[0]).toMatchObject({ state: 'applied', audit: [{ action: 'applied', actor: 'scrubber',
            before: { status: 'in_progress', archived: false, revision: a.revision }, after: { status: 'done' } }] });
        const done = current(a.id);
        expect(done).toMatchObject({ status: 'done', updatedBy: 'system', outcome: { recordedBy: 'system' } });
        expect(done.outcome!.summary).toContain(pr.ref);
        expect(done.userVerdictRevision).toBeUndefined();
        expect(done.userEditedAt).toBeUndefined();
        expect(triggers.getById('rule-1')).toBeNull();
        expect(disarm).toHaveBeenCalledWith('rule-1');
        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'trigger-disarmed' }));
    });

    it.each([
        ['manual', () => item('Manual', { type: 'manual' }), {}],
        ['evidence_gate', () => item('Medium'), { confidence: 'medium' as const }],
        ['evidence_gate', () => item('Stale check'), { evidence: [{ ...pr, checkedAt: '2026-10-11T09:00:00.000Z' }] }],
    ])('demotes auto-Done to a proposal: %s', (reason, make, patch) => {
        const target = make();
        startRun([target]);
        const [record] = engine.complete(owner, 'run-1', [finding(target.id, patch)])!.findings;
        expect(record).toMatchObject({ state: 'proposed', demotedBecause: reason });
        expect(current(target.id).status).toBe(target.status);
    });

    it('marks an item edited during the run as superseded and never overwrites it', () => {
        const b = item('Edited mid-run');
        startRun([b]);
        todos.update(owner, b.id, b.revision, { notes: 'user note' }, 'user');
        const [record] = engine.complete(owner, 'run-1', [finding(b.id)])!.findings;
        expect(record).toMatchObject({ state: 'proposed', demotedBecause: 'superseded', itemRevision: b.revision });
        expect(current(b.id)).toMatchObject({ status: 'todo', notes: 'user note' });
        expect(() => engine.accept(owner, 'run-1', b.id, b.revision + 1)).toThrow('Item changed since this proposal');
    });

    it('keeps a newer user verdict unless cited evidence is newer', () => {
        const edited = item('User reopened');
        const reopened = todos.update(owner, edited.id, edited.revision, { status: 'in_progress' }, 'user').item;
        const fresh = item('Newer evidence');
        const freshEdited = todos.update(owner, fresh.id, fresh.revision, { status: 'in_progress' }, 'user').item;
        startRun([reopened, freshEdited]);
        const observedAt = new Date(Date.parse(freshEdited.userEditedAt!) + 60_000).toISOString();
        const [kept, applied] = engine.complete(owner, 'run-1', [
            finding(reopened.id, { evidence: [{ ...pr, observedAt: '2020-01-01T00:00:00.000Z' }] }),
            finding(freshEdited.id, { evidence: [{ ...pr, observedAt }] }),
        ])!.findings;
        expect(kept).toMatchObject({ state: 'proposed', demotedBecause: 'user_verdict' });
        expect(applied.state).toBe('applied');
    });

    it('records non-Done verdicts as proposals and settles unchanged, unverified and matching verdicts', () => {
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(title => item(title));
        const e = item('e', { status: 'in_progress' });
        startRun([a, b, c, d, e]);
        const records = engine.complete(owner, 'run-1', [
            finding(a.id, { verdict: 'obsolete', autoApply: false, summary: 'superseded by #902' }),
            finding(b.id, { verdict: 'unchanged', autoApply: false, evidence: [] }),
            finding(c.id, { verdict: 'unverified', autoApply: false, evidence: [], unverifiedReason: 'remote offline' }),
            finding(d.id, { verdict: 'needs_attention', autoApply: false }),
            finding(e.id, { verdict: 'in_progress', autoApply: false }),
            finding('not-in-snapshot'),
            finding(a.id),
        ])!.findings;
        expect(records.map(record => [record.itemId, record.state])).toEqual([
            [a.id, 'proposed'], [b.id, 'unchanged'], [c.id, 'unverified'], [d.id, 'proposed'], [e.id, 'unchanged'],
        ]);
        expect(todos.get(owner).items.map(entry => entry.revision)).toEqual([1, 1, 1, 1, 1]);
    });

    it('applies nothing once the run is no longer running', () => {
        const a = item('Cancelled');
        startRun([a]);
        scrubber.transitionRun(owner, 'run-1', ['running'], { status: 'cancelled' });
        expect(engine.complete(owner, 'run-1', [finding(a.id)])).toBeUndefined();
        expect(current(a.id).status).toBe('todo');
        expect(scrubber.listFindings(owner, 'run-1')).toEqual([]);
    });

    it('rolls back every write when one fails', () => {
        const a = item('First');
        const b = item('Second');
        startRun([a, b]);
        fixture.db.exec(`CREATE TEMP TRIGGER fail_findings BEFORE INSERT ON scrubber_findings
            BEGIN SELECT RAISE(ABORT, 'findings write failure'); END;`);
        expect(() => engine.complete(owner, 'run-1', [finding(a.id), finding(b.id)])).toThrow('findings write failure');
        expect(todos.get(owner).items.map(entry => entry.status)).toEqual(['todo', 'todo']);
        expect(scrubber.getRun(owner, 'run-1')!.status).toBe('running');
    });

    it('cannot settle another owner\'s run', () => {
        const a = item('Mine');
        startRun([a]);
        expect(engine.complete(other, 'run-1', [finding(a.id)])).toBeUndefined();
        expect(current(a.id).status).toBe('todo');
    });
});

describe('SentinelTodoStore.recordScrubberDone', () => {
    it('refuses manual items and stale revisions', () => {
        const manual = item('Manual', { type: 'manual' });
        const normal = item('Normal');
        expect(() => todos.recordScrubberDone(owner, manual.id, manual.revision, 'done')).toThrow('Manual items accept proposals only');
        expect(() => todos.recordScrubberDone(owner, normal.id, normal.revision + 1, 'done')).toThrow('changed since it was loaded');
        expect(() => todos.recordScrubberDone(owner, normal.id, normal.revision, '')).toThrow();
        expect(todos.get(owner).items.map(entry => entry.status)).toEqual(['todo', 'todo']);
    });
});

describe('ScrubberEngine proposals', () => {
    it('accepts Obsolete as the user: done, outcome, archived, rule retired', () => {
        const c = item('Old investigation');
        armRule(c.id);
        startRun([c]);
        engine.complete(owner, 'run-1', [finding(c.id, { verdict: 'obsolete', autoApply: false, summary: 'superseded by #902' })]);
        const { item: accepted, finding: record } = engine.accept(owner, 'run-1', c.id, c.revision);
        expect(accepted).toMatchObject({ status: 'done', archived: true, updatedBy: 'user',
            outcome: { summary: 'Obsolete: superseded by #902', recordedBy: 'user' } });
        expect(accepted.userVerdictRevision).toBe(accepted.revision);
        expect(record).toMatchObject({ state: 'accepted', audit: [{ action: 'accepted', actor: 'user',
            before: { status: 'todo' }, after: { status: 'done', archived: true } }] });
        expect(triggers.getById('rule-1')).toBeNull();
        expect(() => engine.accept(owner, 'run-1', c.id, accepted.revision)).toThrow('accepted');
    });

    it('accepts a status proposal without retiring rules', () => {
        const d = item('Stuck');
        armRule(d.id);
        startRun([d]);
        engine.complete(owner, 'run-1', [finding(d.id, { verdict: 'needs_attention', autoApply: false, summary: 'CI red' })]);
        expect(engine.accept(owner, 'run-1', d.id, d.revision).item).toMatchObject({ status: 'needs_attention', statusReason: 'CI red' });
        expect(triggers.getById('rule-1')).not.toBeNull();
    });

    it('rejects Accept when the item changed since the proposal', () => {
        const c = item('Changed');
        startRun([c]);
        engine.complete(owner, 'run-1', [finding(c.id, { verdict: 'obsolete', autoApply: false })]);
        const edited = todos.update(owner, c.id, c.revision, { notes: 'edit' }, 'user').item;
        expect(() => engine.accept(owner, 'run-1', c.id, edited.revision)).toThrow('Item changed since this proposal');
        expect(scrubber.getFinding(owner, 'run-1', c.id)!.state).toBe('proposed');
    });

    it('keeps a dismissal until the evidence fingerprint changes', () => {
        const c = item('Dismiss me');
        startRun([c]);
        const proposal = finding(c.id, { verdict: 'obsolete', autoApply: false });
        engine.complete(owner, 'run-1', [proposal]);
        expect(engine.dismiss(owner, 'run-1', c.id)).toMatchObject({ state: 'dismissed', audit: [{ action: 'dismissed', actor: 'user' }] });
        expect(current(c.id).revision).toBe(c.revision);
        startRun([c], 'run-2');
        const rechecked = { ...proposal, evidence: [{ ...pr, checkedAt: '2026-10-11T10:06:00.000Z' }] };
        expect(engine.complete(owner, 'run-2', [rechecked])!.findings[0].state).toBe('suppressed');
        startRun([c], 'run-3');
        const newEvidence = { ...proposal, evidence: [{ ...pr, ref: 'https://github.com/o/r/pull/902' }] };
        expect(engine.complete(owner, 'run-3', [newEvidence])!.findings[0].state).toBe('proposed');
    });

    it('undoes an auto-Done as a user verdict and never re-applies the same finding', () => {
        const a = item('Undo me', { status: 'in_progress' });
        startRun([a]);
        engine.complete(owner, 'run-1', [finding(a.id)]);
        const done = current(a.id);
        const { item: restored, finding: record } = engine.undo(owner, 'run-1', a.id, done.revision);
        expect(restored).toMatchObject({ status: 'in_progress', archived: false, updatedBy: 'user' });
        expect(restored.outcome).toBeUndefined();
        expect(restored.userVerdictRevision).toBe(restored.revision);
        expect(record.audit.map(entry => entry.action)).toEqual(['applied', 'undone']);
        startRun([restored], 'run-2');
        expect(engine.complete(owner, 'run-2', [finding(a.id)])!.findings[0].state).toBe('suppressed');
        expect(current(a.id).status).toBe('in_progress');
    });

    it('refuses Undo after the item changed again', () => {
        const a = item('Changed after apply');
        startRun([a]);
        engine.complete(owner, 'run-1', [finding(a.id)]);
        const edited = todos.update(owner, a.id, current(a.id).revision, { notes: 'later' }, 'user').item;
        expect(() => engine.undo(owner, 'run-1', a.id, edited.revision)).toThrow('Item changed since this proposal');
        expect(current(a.id).status).toBe('done');
    });

    it('scopes findings to their owner', () => {
        const c = item('Scoped');
        startRun([c]);
        engine.complete(owner, 'run-1', [finding(c.id, { verdict: 'obsolete', autoApply: false })]);
        expect(() => engine.dismiss(other, 'run-1', c.id)).toThrow('Finding not found');
        expect(() => engine.accept(other, 'run-1', c.id, c.revision)).toThrow('Finding not found');
    });
});
