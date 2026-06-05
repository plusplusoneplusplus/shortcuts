import { describe, expect, it } from 'vitest';
import type { ForEachRunStatus, ForEachRunSummary } from '@plusplusoneplusplus/coc-client';
import {
    groupByForEachRun,
    getForEachRunId,
    isForEachRunTask,
    type ForEachRunGroup,
} from '../../../../src/server/spa/client/react/features/chat/for-each-run-grouping';

function makeRun(overrides: Partial<ForEachRunSummary> = {}): ForEachRunSummary {
    return {
        runId: 'run-1',
        workspaceId: 'ws-1',
        status: 'approved',
        originalRequest: 'Split this work',
        childMode: 'ask',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        itemCount: 2,
        itemStatusCounts: {
            pending: 2,
            running: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
        },
        ...overrides,
    };
}

function makeTask(overrides: any = {}): any {
    return {
        id: `task-${Math.random().toString(36).slice(2)}`,
        type: 'chat',
        status: 'completed',
        createdAt: 1000,
        ...overrides,
    };
}

function makePayloadChild(runId: string, itemId = 'item-1', overrides: any = {}): any {
    return makeTask({
        payload: {
            context: {
                forEach: {
                    kind: 'child',
                    workspaceId: 'ws-1',
                    runId,
                    itemId,
                },
            },
        },
        ...overrides,
    });
}

function makeHistoryChild(runId: string, itemId = 'item-1', overrides: any = {}): any {
    return makeTask({
        forEach: {
            kind: 'child',
            workspaceId: 'ws-1',
            runId,
            itemId,
        },
        ...overrides,
    });
}

describe('for-each-run-grouping', () => {
    it('returns standalone tasks unchanged when there are no persisted runs', () => {
        const task = makeTask({ id: 'standalone' });
        expect(groupByForEachRun([task], [])).toEqual([task]);
    });

    it('creates first-class groups for every persisted run status, including zero-child runs', () => {
        const statuses: ForEachRunStatus[] = ['draft', 'approved', 'running', 'failed', 'completed', 'cancelled'];
        const runs = statuses.map((status, index) => makeRun({
            runId: `run-${status}`,
            status,
            updatedAt: `2026-01-01T00:0${index}:00.000Z`,
            itemCount: 0,
            itemStatusCounts: {
                pending: 0,
                running: 0,
                completed: 0,
                failed: 0,
                skipped: 0,
            },
        }));

        const result = groupByForEachRun([], runs);
        const groups = result as ForEachRunGroup[];

        expect(groups).toHaveLength(statuses.length);
        expect(groups.every(group => group.kind === 'for-each-run')).toBe(true);
        expect(groups.map(group => group.run.status).sort()).toEqual([...statuses].sort());
        expect(groups.every(group => group.children.length === 0)).toBe(true);
    });

    it('nests children linked by live queue payload metadata and removes standalone duplicates', () => {
        const child = makePayloadChild('run-1', 'item-1', { id: 'queue_child-1', createdAt: 2000 });
        const standalone = makeTask({ id: 'standalone', createdAt: 3000 });

        const result = groupByForEachRun([child, standalone], [makeRun()]);
        const group = result.find((entry: any) => entry.kind === 'for-each-run') as ForEachRunGroup;

        expect(group.children).toEqual([child]);
        expect(result).toContain(standalone);
        expect(result).not.toContain(child);
    });

    it('nests children linked by persisted process metadata', () => {
        const child = makeHistoryChild('run-1', 'item-2', { id: 'queue_child-2', createdAt: 2000 });

        const result = groupByForEachRun([child], [makeRun()]);
        const group = result[0] as ForEachRunGroup;

        expect(group.kind).toBe('for-each-run');
        expect(group.children).toEqual([child]);
    });

    it('nests the generation chat when it matches persisted generationProcessId', () => {
        const generation = makeTask({ id: 'queue_generation', createdAt: 2000 });
        const run = makeRun({ generationProcessId: 'queue_generation' });

        const result = groupByForEachRun([generation], [run]);
        const group = result[0] as ForEachRunGroup;

        expect(group.children).toEqual([generation]);
    });

    it('propagates unseen state from nested child chats', () => {
        const child = makeHistoryChild('run-1', 'item-1', { id: 'queue_child-1' });

        const result = groupByForEachRun([child], [makeRun()], new Set(['queue_child-1']));
        const group = result[0] as ForEachRunGroup;

        expect(group.hasUnseen).toBe(true);
    });

    it('sorts mixed groups and standalone rows by latest activity timestamp', () => {
        const oldRun = makeRun({ runId: 'old-run', updatedAt: '2026-01-01T00:00:00.000Z' });
        const activeRun = makeRun({ runId: 'active-run', updatedAt: '2026-01-01T00:00:00.000Z' });
        const activeChild = makePayloadChild('active-run', 'item-1', {
            id: 'queue_active-child',
            lastActivityAt: +new Date('2026-01-01T00:02:00.000Z'),
        });
        const standalone = makeTask({
            id: 'standalone',
            lastActivityAt: +new Date('2026-01-01T00:01:00.000Z'),
        });

        const result = groupByForEachRun([standalone, activeChild], [oldRun, activeRun]);

        expect((result[0] as ForEachRunGroup).runId).toBe('active-run');
        expect(result[1]).toBe(standalone);
        expect((result[2] as ForEachRunGroup).runId).toBe('old-run');
    });

    it('leaves orphan For Each children standalone when the persisted run is absent', () => {
        const child = makeHistoryChild('missing-run', 'item-1', { id: 'orphan-child' });
        const result = groupByForEachRun([child], [makeRun({ runId: 'other-run' })]);

        expect(result).toHaveLength(2);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'orphan-child' }),
            expect.objectContaining({ kind: 'for-each-run', runId: 'other-run' }),
        ]));
    });

    it('extracts run ids from both metadata shapes', () => {
        expect(getForEachRunId(makePayloadChild('payload-run'))).toBe('payload-run');
        expect(getForEachRunId(makeHistoryChild('history-run'))).toBe('history-run');
        expect(isForEachRunTask(makeHistoryChild('history-run'))).toBe(true);
        expect(isForEachRunTask(makeTask())).toBe(false);
    });
});
