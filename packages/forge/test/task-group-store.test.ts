/**
 * SqliteTaskGroupStore Tests
 *
 * Uses an in-memory SQLite database. Cross-platform compatible.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

import { initializeDatabase } from '../src/sqlite-schema';
import { SqliteTaskGroupStore, TaskGroupRecord } from '../src/task-group-store';

function makeGroup(overrides?: Partial<TaskGroupRecord>): TaskGroupRecord {
    return {
        groupId: 'run-1',
        workspaceId: 'ws-1',
        type: 'for-each',
        title: 'Process 3 items',
        status: 'draft',
        createdAt: '2026-06-11T10:00:00.000Z',
        updatedAt: '2026-06-11T10:00:00.000Z',
        ...overrides,
    };
}

describe('SqliteTaskGroupStore', () => {
    let db: Database.Database;
    let store: SqliteTaskGroupStore;

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
        store = new SqliteTaskGroupStore(db);
    });

    afterEach(() => {
        db.close();
    });

    it('creates and reads back a group with no children', () => {
        store.upsertGroup(makeGroup());
        const group = store.getGroup('ws-1', 'run-1');
        expect(group).toBeDefined();
        expect(group!.type).toBe('for-each');
        expect(group!.title).toBe('Process 3 items');
        expect(group!.status).toBe('draft');
        expect(group!.childCount).toBe(0);
        expect(group!.children).toEqual([]);
    });

    it('upsert preserves createdAt and refreshes mutable fields', () => {
        store.upsertGroup(makeGroup());
        store.upsertGroup(makeGroup({
            status: 'running',
            updatedAt: '2026-06-11T11:00:00.000Z',
        }));
        const group = store.getGroup('ws-1', 'run-1')!;
        expect(group.status).toBe('running');
        expect(group.createdAt).toBe('2026-06-11T10:00:00.000Z');
        expect(group.updatedAt).toBe('2026-06-11T11:00:00.000Z');
    });

    it('upsert keeps existing title/origin/extra when omitted', () => {
        store.upsertGroup(makeGroup({
            originProcessId: 'proc-gen',
            extra: { itemCount: 3 },
        }));
        store.upsertGroup(makeGroup({
            title: undefined,
            originProcessId: undefined,
            extra: undefined,
            status: 'running',
            updatedAt: '2026-06-11T11:00:00.000Z',
        }));
        const group = store.getGroup('ws-1', 'run-1')!;
        expect(group.title).toBe('Process 3 items');
        expect(group.originProcessId).toBe('proc-gen');
        expect(group.extra).toEqual({ itemCount: 3 });
    });

    it('updateGroup merges extra and returns the updated summary', () => {
        store.upsertGroup(makeGroup({ extra: { itemCount: 3 } }));
        const updated = store.updateGroup('ws-1', 'run-1', {
            status: 'completed',
            completedAt: '2026-06-11T12:00:00.000Z',
            extra: { detailStatus: 'reduced' },
            updatedAt: '2026-06-11T12:00:00.000Z',
        });
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('completed');
        expect(updated!.completedAt).toBe('2026-06-11T12:00:00.000Z');
        expect(updated!.extra).toEqual({ itemCount: 3, detailStatus: 'reduced' });
    });

    it('updateGroup returns undefined for a missing group', () => {
        const updated = store.updateGroup('ws-1', 'missing', {
            status: 'failed',
            updatedAt: '2026-06-11T12:00:00.000Z',
        });
        expect(updated).toBeUndefined();
    });

    it('links children with roles and aggregates them in summaries', () => {
        store.upsertGroup(makeGroup());
        store.linkChild('ws-1', 'run-1', { role: 'generation', processId: 'proc-gen', linkedAt: '2026-06-11T10:01:00.000Z' });
        store.linkChild('ws-1', 'run-1', { role: 'item', taskId: 'task-a', itemKey: 'item-a', memberIndex: 1, linkedAt: '2026-06-11T10:02:00.000Z' });
        store.linkChild('ws-1', 'run-1', { role: 'item', taskId: 'task-b', itemKey: 'item-b', memberIndex: 2, linkedAt: '2026-06-11T10:03:00.000Z' });

        const group = store.getGroup('ws-1', 'run-1')!;
        expect(group.childCount).toBe(3);
        expect(group.children.map(child => child.role)).toEqual(['generation', 'item', 'item']);
        expect(group.children[1].itemKey).toBe('item-a');
        expect(group.children[1].taskId).toBe('task-a');
    });

    it('linkChild upserts by taskId, filling processId later', () => {
        store.upsertGroup(makeGroup());
        store.linkChild('ws-1', 'run-1', { role: 'item', taskId: 'task-a', itemKey: 'item-a' });
        store.linkChild('ws-1', 'run-1', { role: 'item', taskId: 'task-a', itemKey: 'item-a', processId: 'proc-a' });

        const children = store.getChildren('ws-1', 'run-1');
        expect(children).toHaveLength(1);
        expect(children[0].taskId).toBe('task-a');
        expect(children[0].processId).toBe('proc-a');
    });

    it('linkChild upserts by processId when no taskId is recorded', () => {
        store.upsertGroup(makeGroup({ type: 'dream', groupId: 'dream-1' }));
        store.linkChild('ws-1', 'dream-1', { role: 'analyzer', processId: 'proc-analyzer' });
        store.linkChild('ws-1', 'dream-1', { role: 'analyzer', processId: 'proc-analyzer', taskId: 'task-analyzer' });

        const children = store.getChildren('ws-1', 'dream-1');
        expect(children).toHaveLength(1);
        expect(children[0].taskId).toBe('task-analyzer');
    });

    it('keeps separate links for retries of the same itemKey with new tasks', () => {
        store.upsertGroup(makeGroup());
        store.linkChild('ws-1', 'run-1', { role: 'item', taskId: 'task-a1', itemKey: 'item-a' });
        store.linkChild('ws-1', 'run-1', { role: 'item', taskId: 'task-a2', itemKey: 'item-a' });

        const children = store.getChildren('ws-1', 'run-1');
        expect(children).toHaveLength(2);
        expect(children.map(child => child.taskId).sort()).toEqual(['task-a1', 'task-a2']);
    });

    it('listGroups is workspace-scoped, filters by type/status, excludes hidden by default', () => {
        store.upsertGroup(makeGroup({ groupId: 'run-1', type: 'for-each', status: 'running' }));
        store.upsertGroup(makeGroup({ groupId: 'run-2', type: 'map-reduce', status: 'completed' }));
        store.upsertGroup(makeGroup({ groupId: 'dream-1', type: 'dream', hidden: true }));
        store.upsertGroup(makeGroup({ groupId: 'other-ws', workspaceId: 'ws-2' }));

        const all = store.listGroups('ws-1');
        expect(all.map(group => group.groupId).sort()).toEqual(['run-1', 'run-2']);

        const forEach = store.listGroups('ws-1', { type: 'for-each' });
        expect(forEach.map(group => group.groupId)).toEqual(['run-1']);

        const completed = store.listGroups('ws-1', { status: 'completed' });
        expect(completed.map(group => group.groupId)).toEqual(['run-2']);

        const withHidden = store.listGroups('ws-1', { includeHidden: true });
        expect(withHidden.map(group => group.groupId).sort()).toEqual(['dream-1', 'run-1', 'run-2']);
    });

    it('listGroups attaches children to the right groups', () => {
        store.upsertGroup(makeGroup({ groupId: 'run-1' }));
        store.upsertGroup(makeGroup({ groupId: 'run-2' }));
        store.linkChild('ws-1', 'run-1', { role: 'item', taskId: 'task-a' });
        store.linkChild('ws-1', 'run-2', { role: 'item', taskId: 'task-b' });

        const groups = store.listGroups('ws-1');
        const byId = new Map(groups.map(group => [group.groupId, group]));
        expect(byId.get('run-1')!.children.map(child => child.taskId)).toEqual(['task-a']);
        expect(byId.get('run-2')!.children.map(child => child.taskId)).toEqual(['task-b']);
    });

    it('orders children by memberIndex then insertion order', () => {
        store.upsertGroup(makeGroup({ groupId: 'session-1', type: 'ralph' }));
        store.linkChild('ws-1', 'session-1', { role: 'iteration', taskId: 'task-2', memberIndex: 2 });
        store.linkChild('ws-1', 'session-1', { role: 'grilling', taskId: 'task-0' });
        store.linkChild('ws-1', 'session-1', { role: 'iteration', taskId: 'task-1', memberIndex: 1 });

        const children = store.getChildren('ws-1', 'session-1');
        // NULL member_index sorts first in SQLite ASC ordering.
        expect(children.map(child => child.taskId)).toEqual(['task-0', 'task-1', 'task-2']);
    });

    it('removeGroup deletes the group and its members', () => {
        store.upsertGroup(makeGroup());
        store.linkChild('ws-1', 'run-1', { role: 'item', taskId: 'task-a' });

        expect(store.removeGroup('ws-1', 'run-1')).toBe(true);
        expect(store.getGroup('ws-1', 'run-1')).toBeUndefined();
        expect(store.getChildren('ws-1', 'run-1')).toEqual([]);
        expect(store.removeGroup('ws-1', 'run-1')).toBe(false);
    });

    it('survives malformed extra JSON', () => {
        store.upsertGroup(makeGroup());
        db.prepare("UPDATE task_groups SET extra = 'not-json' WHERE group_id = 'run-1'").run();
        const group = store.getGroup('ws-1', 'run-1')!;
        expect(group.extra).toBeUndefined();
        expect(group.groupId).toBe('run-1');
    });
});
