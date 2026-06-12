import { describe, expect, it } from 'vitest';
import {
    groupItemsByRun,
    runBackedEntryTimestamp,
    type RunBackedGroup,
} from '../../../../src/server/spa/client/react/features/chat/run-group';

interface FakeRun {
    runId: string;
    updatedAt?: string;
    generationProcessId?: string;
}

const config = {
    entryKind: 'for-each-run' as const,
    taskGroupKind: 'for-each' as const,
    getRunId: (run: FakeRun) => run.runId,
    getRunTimestamp: (run: FakeRun) => (run.updatedAt ? +new Date(run.updatedAt) : 0),
    getGenerationProcessId: (run: FakeRun) => run.generationProcessId,
};

function isGroup(entry: unknown): entry is RunBackedGroup<FakeRun, 'for-each-run'> {
    return !!entry && typeof entry === 'object' && (entry as { kind?: unknown }).kind === 'for-each-run';
}

describe('groupItemsByRun', () => {
    it('returns the original list unchanged when there are no runs', () => {
        const items = [{ id: 'a' }, { id: 'b' }];
        expect(groupItemsByRun(items, [], config)).toBe(items);
    });

    it('groups children matched by legacy per-feature context', () => {
        const run: FakeRun = { runId: 'run-1', updatedAt: '2026-01-01T00:00:00.000Z' };
        const child = { id: 'c1', payload: { context: { forEach: { runId: 'run-1', kind: 'child' } } }, startTime: 10 };
        const [entry] = groupItemsByRun([child], [run], config);
        expect(isGroup(entry)).toBe(true);
        expect((entry as RunBackedGroup<FakeRun, 'for-each-run'>).children).toEqual([child]);
    });

    it('groups children matched by the explicit unified group ref (new contract)', () => {
        const run: FakeRun = { runId: 'run-1', updatedAt: '2026-01-01T00:00:00.000Z' };
        const child = { id: 'c1', payload: { context: { group: { kind: 'for-each', groupId: 'run-1', role: 'child' } } }, startTime: 10 };
        const [entry] = groupItemsByRun([child], [run], config);
        expect(isGroup(entry)).toBe(true);
        expect((entry as RunBackedGroup<FakeRun, 'for-each-run'>).children).toEqual([child]);
    });

    it('does not match a child whose ref kind belongs to a different feature', () => {
        const run: FakeRun = { runId: 'run-1' };
        const child = { id: 'c1', payload: { context: { group: { kind: 'map-reduce', groupId: 'run-1', role: 'child' } } } };
        const entries = groupItemsByRun([child], [run], config);
        // The for-each group has no children; the child stays standalone.
        const group = entries.find(isGroup) as RunBackedGroup<FakeRun, 'for-each-run'>;
        expect(group.children).toEqual([]);
        expect(entries).toContain(child);
    });

    it('matches the run generation chat by process id', () => {
        const run: FakeRun = { runId: 'run-1', generationProcessId: 'gen-1' };
        const generation = { id: 'gen-1', startTime: 5 };
        const [entry] = groupItemsByRun([generation], [run], config);
        expect((entry as RunBackedGroup<FakeRun, 'for-each-run'>).children).toEqual([generation]);
    });

    it('keeps unrelated items standalone', () => {
        const run: FakeRun = { runId: 'run-1', updatedAt: '2026-01-01T00:00:00.000Z' };
        const plain = { id: 'plain', startTime: 999 };
        const entries = groupItemsByRun([plain], [run], config);
        expect(entries).toContain(plain);
    });

    it('sorts children ascending and orders entries by latest activity descending', () => {
        // No run timestamps, so latestTimestamp derives purely from children.
        const runA: FakeRun = { runId: 'A' };
        const runB: FakeRun = { runId: 'B' };
        const older = { id: 'a-old', payload: { context: { forEach: { runId: 'A', kind: 'child' } } }, lastActivityAt: 100 };
        const newer = { id: 'a-new', payload: { context: { forEach: { runId: 'A', kind: 'child' } } }, lastActivityAt: 300 };
        const bChild = { id: 'b1', payload: { context: { forEach: { runId: 'B', kind: 'child' } } }, lastActivityAt: 200 };

        const entries = groupItemsByRun([newer, older, bChild], [runA, runB], config);
        const groups = entries.filter(isGroup) as Array<RunBackedGroup<FakeRun, 'for-each-run'>>;
        // Group A (latest 300) before group B (latest 200).
        expect(groups.map(g => g.runId)).toEqual(['A', 'B']);
        // Children within A sorted ascending by timestamp.
        expect(groups[0].children.map(c => c.id)).toEqual(['a-old', 'a-new']);
        expect(groups[0].latestTimestamp).toBe(300);
    });

    it('flags hasUnseen when a child id is in the unseen set', () => {
        const run: FakeRun = { runId: 'run-1' };
        const child = { id: 'c1', payload: { context: { forEach: { runId: 'run-1', kind: 'child' } } } };
        const [seen] = groupItemsByRun([child], [run], config, new Set());
        expect((seen as RunBackedGroup<FakeRun, 'for-each-run'>).hasUnseen).toBe(false);
        const [unseen] = groupItemsByRun([child], [run], config, new Set(['c1']));
        expect((unseen as RunBackedGroup<FakeRun, 'for-each-run'>).hasUnseen).toBe(true);
    });
});

describe('runBackedEntryTimestamp', () => {
    it('uses latestTimestamp for a group entry', () => {
        const group = { kind: 'for-each-run', runId: 'r', run: {}, children: [], latestTimestamp: 42, hasUnseen: false };
        expect(runBackedEntryTimestamp(group)).toBe(42);
    });

    it('falls back to the activity chain for a standalone item', () => {
        expect(runBackedEntryTimestamp({ lastActivityAt: 77 })).toBe(77);
        expect(runBackedEntryTimestamp({ startTime: 5 })).toBe(5);
    });
});
