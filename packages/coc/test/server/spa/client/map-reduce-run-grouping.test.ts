import { describe, expect, it } from 'vitest';
import type { MapReduceRunStatus, MapReduceRunSummary } from '@plusplusoneplusplus/coc-client';
import {
    groupByMapReduceRun,
    getMapReduceRunId,
    isMapReduceRunTask,
    type MapReduceRunGroup,
} from '../../../../src/server/spa/client/react/features/chat/map-reduce-run-grouping';

function makeRun(overrides: Partial<MapReduceRunSummary> = {}): MapReduceRunSummary {
    return {
        runId: 'map-reduce-run-1',
        workspaceId: 'ws-1',
        status: 'approved',
        originalRequest: 'Split then aggregate this work',
        childMode: 'ask',
        reduceInstructions: 'Aggregate all outputs.',
        maxParallel: 3,
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
        reduceStatus: 'pending',
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

function makePayloadChild(runId: string, phase: 'map' | 'reduce' = 'map', overrides: any = {}): any {
    return makeTask({
        payload: {
            context: {
                mapReduce: phase === 'map'
                    ? {
                        workspaceId: 'ws-1',
                        runId,
                        phase: 'map',
                        itemId: 'item-1',
                        childMode: 'ask',
                    }
                    : {
                        workspaceId: 'ws-1',
                        runId,
                        phase: 'reduce',
                        childMode: 'ask',
                    },
            },
        },
        ...overrides,
    });
}

function makeHistoryChild(runId: string, phase: 'map' | 'reduce' = 'map', overrides: any = {}): any {
    return makeTask({
        mapReduce: phase === 'map'
            ? {
                workspaceId: 'ws-1',
                runId,
                phase: 'map',
                itemId: 'item-1',
                childMode: 'ask',
            }
            : {
                workspaceId: 'ws-1',
                runId,
                phase: 'reduce',
                childMode: 'ask',
            },
        ...overrides,
    });
}

describe('map-reduce-run-grouping', () => {
    it('returns standalone tasks unchanged when there are no persisted runs', () => {
        const task = makeTask({ id: 'standalone' });
        expect(groupByMapReduceRun([task], [])).toEqual([task]);
    });

    it('creates first-class groups for every persisted run status, including zero-child runs', () => {
        const statuses: MapReduceRunStatus[] = ['draft', 'approved', 'running', 'reducing', 'failed', 'completed', 'cancelled'];
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

        const result = groupByMapReduceRun([], runs);
        const groups = result as MapReduceRunGroup[];

        expect(groups).toHaveLength(statuses.length);
        expect(groups.every(group => group.kind === 'map-reduce-run')).toBe(true);
        expect(groups.map(group => group.run.status).sort()).toEqual([...statuses].sort());
        expect(groups.every(group => group.children.length === 0)).toBe(true);
    });

    it('nests map and reduce children linked by live queue payload metadata and removes standalone duplicates', () => {
        const mapChild = makePayloadChild('map-reduce-run-1', 'map', { id: 'queue_map-child-1', createdAt: 2000 });
        const reduceChild = makePayloadChild('map-reduce-run-1', 'reduce', { id: 'queue_reduce-child-1', createdAt: 2500 });
        const standalone = makeTask({ id: 'standalone', createdAt: 3000 });

        const result = groupByMapReduceRun([mapChild, reduceChild, standalone], [makeRun()]);
        const group = result.find((entry: any) => entry.kind === 'map-reduce-run') as MapReduceRunGroup;

        expect(group.children).toEqual([mapChild, reduceChild]);
        expect(result).toContain(standalone);
        expect(result).not.toContain(mapChild);
        expect(result).not.toContain(reduceChild);
    });

    it('nests children linked by persisted process metadata', () => {
        const child = makeHistoryChild('map-reduce-run-1', 'reduce', { id: 'queue_reduce-child-2', createdAt: 2000 });

        const result = groupByMapReduceRun([child], [makeRun()]);
        const group = result[0] as MapReduceRunGroup;

        expect(group.kind).toBe('map-reduce-run');
        expect(group.children).toEqual([child]);
    });

    it('nests the generation chat when it matches persisted generationProcessId', () => {
        const generation = makeTask({ id: 'queue_generation', createdAt: 2000 });
        const run = makeRun({ generationProcessId: 'queue_generation' });

        const result = groupByMapReduceRun([generation], [run]);
        const group = result[0] as MapReduceRunGroup;

        expect(group.children).toEqual([generation]);
    });

    it('propagates unseen state from nested child chats', () => {
        const child = makeHistoryChild('map-reduce-run-1', 'map', { id: 'queue_map-child-1' });

        const result = groupByMapReduceRun([child], [makeRun()], new Set(['queue_map-child-1']));
        const group = result[0] as MapReduceRunGroup;

        expect(group.hasUnseen).toBe(true);
    });

    it('sorts mixed groups and standalone rows by latest activity timestamp', () => {
        const oldRun = makeRun({ runId: 'old-run', updatedAt: '2026-01-01T00:00:00.000Z' });
        const activeRun = makeRun({ runId: 'active-run', updatedAt: '2026-01-01T00:00:00.000Z' });
        const activeChild = makePayloadChild('active-run', 'map', {
            id: 'queue_active-child',
            lastActivityAt: +new Date('2026-01-01T00:02:00.000Z'),
        });
        const standalone = makeTask({
            id: 'standalone',
            lastActivityAt: +new Date('2026-01-01T00:01:00.000Z'),
        });

        const result = groupByMapReduceRun([standalone, activeChild], [oldRun, activeRun]);

        expect((result[0] as MapReduceRunGroup).runId).toBe('active-run');
        expect(result[1]).toBe(standalone);
        expect((result[2] as MapReduceRunGroup).runId).toBe('old-run');
    });

    it('leaves orphan Map Reduce children standalone when the persisted run is absent', () => {
        const child = makeHistoryChild('missing-run', 'map', { id: 'orphan-child' });
        const result = groupByMapReduceRun([child], [makeRun({ runId: 'other-run' })]);

        expect(result).toHaveLength(2);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'orphan-child' }),
            expect.objectContaining({ kind: 'map-reduce-run', runId: 'other-run' }),
        ]));
    });

    it('extracts run ids from both metadata shapes', () => {
        expect(getMapReduceRunId(makePayloadChild('payload-run'))).toBe('payload-run');
        expect(getMapReduceRunId(makeHistoryChild('history-run'))).toBe('history-run');
        expect(isMapReduceRunTask(makeHistoryChild('history-run'))).toBe(true);
        expect(isMapReduceRunTask(makeTask())).toBe(false);
    });
});
