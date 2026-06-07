import { describe, expect, it } from 'vitest';
import type { ProcessGroupPin } from '@plusplusoneplusplus/coc-client';
import {
    getGroupPinKey,
    mergePinnedEntries,
    partitionPinnedGroups,
    type PinnedGroupEntry,
} from '../../../../src/server/spa/client/react/features/chat/group-pinning';
import type { ForEachRunGroup } from '../../../../src/server/spa/client/react/features/chat/for-each-run-grouping';
import type { MapReduceRunGroup } from '../../../../src/server/spa/client/react/features/chat/map-reduce-run-grouping';
import type { RalphSession } from '../../../../src/server/spa/client/react/features/chat/ralph-session-grouping';

function makeRalphSession(sessionId: string, overrides: Partial<RalphSession> = {}): RalphSession {
    return {
        kind: 'ralph-session',
        sessionId,
        title: 'Ralph Session',
        grillingProcess: undefined,
        iterations: [],
        latestTimestamp: Date.parse('2026-01-01T00:00:00.000Z'),
        hasUnseen: false,
        phase: 'complete',
        loopCount: 1,
        ...overrides,
    };
}

function makeForEachGroup(runId: string, overrides: Partial<ForEachRunGroup> = {}): ForEachRunGroup {
    return {
        kind: 'for-each-run',
        runId,
        run: {
            runId,
            workspaceId: 'ws-1',
            status: 'completed',
            originalRequest: 'Split work',
            childMode: 'ask',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            itemCount: 0,
            itemStatusCounts: {
                pending: 0,
                running: 0,
                completed: 0,
                failed: 0,
                skipped: 0,
            },
        },
        children: [],
        latestTimestamp: Date.parse('2026-01-01T00:00:00.000Z'),
        hasUnseen: false,
        ...overrides,
    };
}

function makeMapReduceGroup(runId: string, overrides: Partial<MapReduceRunGroup> = {}): MapReduceRunGroup {
    return {
        kind: 'map-reduce-run',
        runId,
        run: {
            runId,
            workspaceId: 'ws-1',
            status: 'completed',
            originalRequest: 'Split and aggregate work',
            childMode: 'ask',
            reduceInstructions: 'Aggregate outputs.',
            maxParallel: 3,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            itemCount: 0,
            itemStatusCounts: {
                pending: 0,
                running: 0,
                completed: 0,
                failed: 0,
                skipped: 0,
            },
            reduceStatus: 'completed',
        },
        children: [],
        latestTimestamp: Date.parse('2026-01-01T00:00:00.000Z'),
        hasUnseen: false,
        ...overrides,
    };
}

function pin(type: ProcessGroupPin['type'], groupId: string, pinnedAt: string): ProcessGroupPin {
    return { type, groupId, pinnedAt };
}

describe('group-pinning helpers', () => {
    it('keys group pins by type and group id', () => {
        expect(getGroupPinKey('ralph-session', 'same-id')).toBe('ralph-session:same-id');
        expect(getGroupPinKey('for-each-run', 'same-id')).toBe('for-each-run:same-id');
        expect(getGroupPinKey('map-reduce-run', 'same-id')).toBe('map-reduce-run:same-id');
    });

    it('partitions pinned Ralph groups without matching same-id For Each pins', () => {
        const pinned = makeRalphSession('session-1');
        const unpinned = makeRalphSession('session-2');

        const result = partitionPinnedGroups([pinned, unpinned], [
            pin('for-each-run', 'session-2', '2026-01-01T00:03:00.000Z'),
            pin('ralph-session', 'session-1', '2026-01-01T00:02:00.000Z'),
        ]);

        expect(result.pinnedGroups.map(group => group.sessionId)).toEqual(['session-1']);
        expect(result.pinnedGroups[0].groupPinnedAt).toBe('2026-01-01T00:02:00.000Z');
        expect(result.unpinnedGroups.map(group => group.sessionId)).toEqual(['session-2']);
    });

    it('partitions pinned For Each groups and leaves child process metadata unchanged', () => {
        const child = { id: 'child-1', pinnedAt: undefined, archived: false };
        const group = makeForEachGroup('run-1', { children: [child] });

        const result = partitionPinnedGroups([group], [
            pin('for-each-run', 'run-1', '2026-01-01T00:05:00.000Z'),
        ]);

        expect(result.pinnedGroups).toHaveLength(1);
        expect(result.unpinnedGroups).toEqual([]);
        expect(result.pinnedGroups[0].children[0]).toBe(child);
        expect(child).toEqual({ id: 'child-1', pinnedAt: undefined, archived: false });
    });

    it('partitions pinned Map Reduce groups and leaves child process metadata unchanged', () => {
        const child = { id: 'child-1', pinnedAt: undefined, archived: false };
        const group = makeMapReduceGroup('run-1', { children: [child] });

        const result = partitionPinnedGroups([group], [
            pin('map-reduce-run', 'run-1', '2026-01-01T00:05:00.000Z'),
        ]);

        expect(result.pinnedGroups).toHaveLength(1);
        expect(result.unpinnedGroups).toEqual([]);
        expect(result.pinnedGroups[0].children[0]).toBe(child);
        expect(child).toEqual({ id: 'child-1', pinnedAt: undefined, archived: false });
    });

    it('sorts pinned groups newest first and removes them from the unpinned bucket', () => {
        const older = makeForEachGroup('older-run');
        const newer = makeForEachGroup('newer-run');
        const normal = makeForEachGroup('normal-run');

        const result = partitionPinnedGroups([older, newer, normal], [
            pin('for-each-run', 'older-run', '2026-01-01T00:01:00.000Z'),
            pin('for-each-run', 'newer-run', '2026-01-01T00:03:00.000Z'),
        ]);

        expect(result.pinnedGroups.map(group => group.runId)).toEqual(['newer-run', 'older-run']);
        expect(result.unpinnedGroups.map(group => group.runId)).toEqual(['normal-run']);
    });

    it('interleaves pinned chats and pinned groups by pin time newest first', () => {
        const olderChat = { id: 'older-chat', pinnedAt: '2026-01-01T00:01:00.000Z' };
        const newerChat = { id: 'newer-chat', pinnedAt: '2026-01-01T00:03:00.000Z' };
        const group = {
            ...makeRalphSession('session-1'),
            groupPinnedAt: '2026-01-01T00:02:00.000Z',
        } satisfies PinnedGroupEntry<RalphSession>;

        const result = mergePinnedEntries([olderChat, newerChat], [group]);

        expect(result.map(entry => 'sessionId' in entry ? entry.sessionId : entry.id)).toEqual([
            'newer-chat',
            'session-1',
            'older-chat',
        ]);
    });
});
