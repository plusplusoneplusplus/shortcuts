import { describe, it, expect } from 'vitest';
import {
    getTaskGroupRef,
    getTaskGroupIdForType,
    getTaskTimestamp,
    getTaskEndTimestamp,
    groupBySeededTaskGroups,
} from '../../../../src/server/spa/client/react/features/chat/task-group-grouping';
import { groupByForEachRun } from '../../../../src/server/spa/client/react/features/chat/for-each-run-grouping';
import { groupByMapReduceRun } from '../../../../src/server/spa/client/react/features/chat/map-reduce-run-grouping';
import { getRalphSessionId } from '../../../../src/server/spa/client/react/features/chat/ralph-session-grouping';
import { TASK_GROUP_DESCRIPTORS, getTaskGroupDescriptor } from '../../../../src/server/spa/client/react/features/chat/task-group-descriptors';

function forEachRunSummary(overrides: Record<string, unknown> = {}): any {
    return {
        runId: 'run-1',
        workspaceId: 'ws-1',
        status: 'running',
        originalRequest: 'do things',
        childMode: 'ask',
        createdAt: '2026-06-11T10:00:00.000Z',
        updatedAt: '2026-06-11T10:05:00.000Z',
        itemCount: 2,
        itemStatusCounts: { pending: 1, running: 1, completed: 0, failed: 0, skipped: 0 },
        ...overrides,
    };
}

describe('task-group-grouping engine', () => {
    it('reads the generic tag from live tasks and history items', () => {
        const live = { payload: { context: { taskGroup: { groupId: 'g1', groupType: 'for-each', role: 'item', workspaceId: 'ws' } } } };
        const history = { taskGroup: { groupId: 'g2', groupType: 'ralph', role: 'iteration', workspaceId: 'ws' } };
        expect(getTaskGroupRef(live)?.groupId).toBe('g1');
        expect(getTaskGroupRef(history)?.groupId).toBe('g2');
        expect(getTaskGroupRef({})).toBeUndefined();
        expect(getTaskGroupRef({ taskGroup: { groupId: ' ', groupType: 'x' } })).toBeUndefined();
    });

    it('filters tag resolution by group type', () => {
        const task = { taskGroup: { groupId: 'g1', groupType: 'for-each' } };
        expect(getTaskGroupIdForType(task, 'for-each')).toBe('g1');
        expect(getTaskGroupIdForType(task, 'map-reduce')).toBeUndefined();
    });

    it('timestamp helpers follow the activity and end chains', () => {
        const task = {
            lastActivityAt: 5_000,
            endTime: 4_000,
            completedAt: 3_000,
            startedAt: 2_000,
            startTime: 1_000,
            createdAt: 500,
        };
        expect(getTaskTimestamp(task)).toBe(5_000);
        expect(getTaskEndTimestamp(task)).toBe(4_000);
        expect(getTaskTimestamp({})).toBe(0);
    });

    it('returns items untouched when there are no seeds', () => {
        const items = [{ id: 'a' }, { id: 'b' }];
        const result = groupBySeededTaskGroups(items, [], {
            kind: 'x',
            getSeedId: () => 'never',
            getSeedTimestamp: () => 0,
            resolveTaskGroupId: () => undefined,
        });
        expect(result).toBe(items);
    });

    it('nests tasks carrying ONLY the generic tag into For Each run groups', () => {
        const runs = [forEachRunSummary()];
        const taggedChild = {
            id: 'task-tagged',
            createdAt: 1_000,
            payload: { context: { taskGroup: { groupId: 'run-1', groupType: 'for-each', role: 'item', workspaceId: 'ws-1' } } },
        };
        const legacyChild = {
            id: 'task-legacy',
            createdAt: 2_000,
            payload: { context: { forEach: { workspaceId: 'ws-1', runId: 'run-1', itemId: 'i', childMode: 'ask' } } },
        };
        const unrelated = { id: 'task-other', createdAt: 3_000 };

        const entries = groupByForEachRun([taggedChild, legacyChild, unrelated], runs);
        const group = entries.find((entry: any) => entry.kind === 'for-each-run');
        expect(group.children.map((child: any) => child.id)).toEqual(['task-tagged', 'task-legacy']);
        expect(entries).toContain(unrelated);
    });

    it('does not nest a tag of one type into another type group', () => {
        const runs = [forEachRunSummary()];
        const wrongType = {
            id: 'task-mr',
            payload: { context: { taskGroup: { groupId: 'run-1', groupType: 'map-reduce', role: 'item', workspaceId: 'ws-1' } } },
        };
        const entries = groupByForEachRun([wrongType], runs);
        const group = entries.find((entry: any) => entry.kind === 'for-each-run');
        expect(group.children).toHaveLength(0);
    });

    it('nests tagged map and reduce children into Map Reduce run groups', () => {
        const runs = [{
            runId: 'mr-1',
            status: 'reducing',
            originalRequest: 'map it',
            createdAt: '2026-06-11T10:00:00.000Z',
            updatedAt: '2026-06-11T10:05:00.000Z',
            itemCount: 1,
            itemStatusCounts: { pending: 0, running: 0, completed: 1, failed: 0, skipped: 0 },
            reduceStatus: 'running',
        }] as any[];
        const reduceChild = {
            id: 'task-reduce',
            payload: { context: { taskGroup: { groupId: 'mr-1', groupType: 'map-reduce', role: 'reduce', workspaceId: 'ws-1' } } },
        };
        const entries = groupByMapReduceRun([reduceChild], runs);
        const group = entries.find((entry: any) => entry.kind === 'map-reduce-run');
        expect(group.children.map((child: any) => child.id)).toEqual(['task-reduce']);
    });

    it('resolves Ralph session IDs from the generic tag as a fallback', () => {
        expect(getRalphSessionId({
            payload: { context: { taskGroup: { groupId: 'session-9', groupType: 'ralph', role: 'iteration', workspaceId: 'ws' } } },
        })).toBe('session-9');
        // Legacy context still wins when present.
        expect(getRalphSessionId({
            payload: { context: { ralph: { sessionId: 'session-ctx' }, taskGroup: { groupId: 'session-tag', groupType: 'ralph' } } },
        })).toBe('session-ctx');
    });
});

describe('task-group descriptors', () => {
    it('registers the four built-in types with stable pin types', () => {
        expect(Object.keys(TASK_GROUP_DESCRIPTORS).sort()).toEqual(['dream', 'for-each', 'map-reduce', 'ralph']);
        expect(getTaskGroupDescriptor('for-each')!.pinType).toBe('for-each-run');
        expect(getTaskGroupDescriptor('map-reduce')!.pinType).toBe('map-reduce-run');
        expect(getTaskGroupDescriptor('ralph')!.pinType).toBe('ralph-session');
    });

    it('dreams stay linkage-only (not groupable in the chat list)', () => {
        expect(getTaskGroupDescriptor('dream')!.groupable).toBe(false);
    });

    it('descriptor matching resolves group IDs from tags and legacy contexts', () => {
        const descriptor = getTaskGroupDescriptor('for-each')!;
        expect(descriptor.matchesTask({
            payload: { context: { taskGroup: { groupId: 'r1', groupType: 'for-each' } } },
        })).toBe('r1');
        expect(descriptor.matchesTask({
            payload: { context: { forEach: { runId: 'r2' } } },
        })).toBe('r2');
        expect(descriptor.matchesTask({})).toBeUndefined();
    });
});
