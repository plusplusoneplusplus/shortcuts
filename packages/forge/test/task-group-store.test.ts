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

    it('removeGroup cascades to task_group_members in one transaction', () => {
        store.upsertGroup(makeGroup({ groupId: 'folder-1', type: 'chat-folder' }));
        store.linkChild('ws-1', 'folder-1', { role: 'member', processId: 'p-a' });
        store.linkChild('ws-1', 'folder-1', { role: 'member', processId: 'p-b' });
        // A sibling group's members must survive.
        store.upsertGroup(makeGroup({ groupId: 'folder-2', type: 'chat-folder' }));
        store.linkChild('ws-1', 'folder-2', { role: 'member', processId: 'p-c' });

        const countMembers = (groupId: string) => (db
            .prepare('SELECT COUNT(*) AS n FROM task_group_members WHERE workspace_id = ? AND group_id = ?')
            .get('ws-1', groupId) as { n: number }).n;

        expect(store.removeGroup('ws-1', 'folder-1')).toBe(true);
        expect(countMembers('folder-1')).toBe(0);
        expect(countMembers('folder-2')).toBe(1);

        // Rolling the enclosing transaction back must undo BOTH deletes, which
        // only holds if removeGroup does not commit between them.
        store.upsertGroup(makeGroup({ groupId: 'folder-3', type: 'chat-folder' }));
        store.linkChild('ws-1', 'folder-3', { role: 'member', processId: 'p-d' });
        const attempt = db.transaction(() => {
            store.removeGroup('ws-1', 'folder-3');
            throw new Error('boom');
        });
        expect(() => attempt()).toThrow('boom');
        expect(store.getGroup('ws-1', 'folder-3')).toBeDefined();
        expect(countMembers('folder-3')).toBe(1);
    });

    describe('chat-folder support', () => {
        it('round-trips parentGroupId, defaulting to undefined', () => {
            store.upsertGroup(makeGroup({ groupId: 'folder-1', type: 'chat-folder' }));
            expect(store.getGroup('ws-1', 'folder-1')!.parentGroupId).toBeUndefined();

            store.upsertGroup(makeGroup({ groupId: 'folder-2', type: 'chat-folder', parentGroupId: 'folder-1' }));
            expect(store.getGroup('ws-1', 'folder-2')!.parentGroupId).toBe('folder-1');

            const updated = store.updateGroup('ws-1', 'folder-2', {
                parentGroupId: undefined,
                title: 'Renamed',
                updatedAt: '2026-06-11T11:00:00.000Z',
            })!;
            // undefined means "leave alone" for a partial update.
            expect(updated.parentGroupId).toBe('folder-1');
            expect(updated.title).toBe('Renamed');
        });

        it('listGroups by type keeps chat folders and run groups apart', () => {
            store.upsertGroup(makeGroup({ groupId: 'run-1', type: 'for-each' }));
            store.upsertGroup(makeGroup({ groupId: 'run-2', type: 'map-reduce' }));
            store.upsertGroup(makeGroup({ groupId: 'session-1', type: 'ralph' }));
            store.upsertGroup(makeGroup({ groupId: 'dream-1', type: 'dream' }));
            store.upsertGroup(makeGroup({ groupId: 'folder-1', type: 'chat-folder', title: 'Auth rewrite' }));
            store.upsertGroup(makeGroup({ groupId: 'folder-2', type: 'chat-folder', title: 'Perf' }));

            const folders = store.listGroups('ws-1', { type: 'chat-folder' });
            expect(folders.map(group => group.groupId).sort()).toEqual(['folder-1', 'folder-2']);

            for (const type of ['for-each', 'map-reduce', 'ralph', 'dream']) {
                const groups = store.listGroups('ws-1', { type });
                expect(groups.map(group => group.groupId)).not.toContain('folder-1');
                expect(groups.map(group => group.groupId)).not.toContain('folder-2');
            }
        });

        it('unlinkChild removes only that process link in that folder', () => {
            store.upsertGroup(makeGroup({ groupId: 'folder-1', type: 'chat-folder' }));
            store.upsertGroup(makeGroup({ groupId: 'folder-2', type: 'chat-folder' }));
            store.linkChild('ws-1', 'folder-1', { role: 'member', processId: 'p-a' });
            store.linkChild('ws-1', 'folder-1', { role: 'member', processId: 'p-b' });
            store.linkChild('ws-1', 'folder-2', { role: 'member', processId: 'p-c' });

            expect(store.unlinkChild('ws-1', 'folder-1', 'p-a')).toBe(1);
            expect(store.getChildren('ws-1', 'folder-1').map(child => child.processId)).toEqual(['p-b']);
            expect(store.getChildren('ws-1', 'folder-2').map(child => child.processId)).toEqual(['p-c']);

            // Unlinking something that was never filed is a no-op, not an error.
            expect(store.unlinkChild('ws-1', 'folder-1', 'p-a')).toBe(0);
            expect(store.unlinkChild('ws-1', 'folder-1', 'p-c')).toBe(0);
            expect(store.unlinkChild('ws-2', 'folder-1', 'p-b')).toBe(0);
            expect(store.getChildren('ws-1', 'folder-1')).toHaveLength(1);
        });

        it('findMembership resolves a process to its folder, scoped by type', () => {
            store.upsertGroup(makeGroup({ groupId: 'folder-1', type: 'chat-folder' }));
            store.upsertGroup(makeGroup({ groupId: 'run-1', type: 'for-each' }));
            store.linkChild('ws-1', 'folder-1', { role: 'member', processId: 'p-a', linkedAt: '2026-06-11T10:00:00.000Z' });
            store.linkChild('ws-1', 'run-1', { role: 'item', processId: 'p-a', linkedAt: '2026-06-11T10:01:00.000Z' });

            expect(store.findMembership('ws-1', 'p-a', { type: 'chat-folder' })!.groupId).toBe('folder-1');
            expect(store.findMembership('ws-1', 'p-a', { type: 'for-each' })!.groupId).toBe('run-1');
            expect(store.findMembership('ws-1', 'p-missing', { type: 'chat-folder' })).toBeUndefined();
            expect(store.findMembership('ws-2', 'p-a', { type: 'chat-folder' })).toBeUndefined();

            // A dangling member row whose group is gone resolves to nothing
            // rather than reporting a phantom folder.
            store.removeGroup('ws-1', 'folder-1');
            db.prepare(`
                INSERT INTO task_group_members (workspace_id, group_id, role, process_id, linked_at)
                VALUES ('ws-1', 'folder-1', 'member', 'p-a', '2026-06-11T10:00:00.000Z')
            `).run();
            expect(store.findMembership('ws-1', 'p-a', { type: 'chat-folder' })).toBeUndefined();
        });

        it('listMembershipsByProcess maps every filed process in one query', () => {
            store.upsertGroup(makeGroup({ groupId: 'folder-1', type: 'chat-folder' }));
            store.upsertGroup(makeGroup({ groupId: 'folder-2', type: 'chat-folder' }));
            store.upsertGroup(makeGroup({ groupId: 'run-1', type: 'for-each' }));
            store.linkChild('ws-1', 'folder-1', { role: 'member', processId: 'p-a' });
            store.linkChild('ws-1', 'folder-2', { role: 'member', processId: 'p-b' });
            store.linkChild('ws-1', 'run-1', { role: 'item', processId: 'p-c' });
            // A task-only link carries no process and must not appear.
            store.linkChild('ws-1', 'folder-1', { role: 'member', taskId: 'task-a' });

            const filed = store.listMembershipsByProcess('ws-1', { type: 'chat-folder' });
            expect([...filed.entries()].sort()).toEqual([['p-a', 'folder-1'], ['p-b', 'folder-2']]);
            expect(filed.has('p-c')).toBe(false);

            expect(store.listMembershipsByProcess('ws-2', { type: 'chat-folder' }).size).toBe(0);
            expect(store.listMembershipsByProcess('ws-1').get('p-c')).toBe('run-1');
        });

        it('listMembershipsByProcess takes the most recent link when a process is in two folders', () => {
            store.upsertGroup(makeGroup({ groupId: 'folder-1', type: 'chat-folder' }));
            store.upsertGroup(makeGroup({ groupId: 'folder-2', type: 'chat-folder' }));
            store.linkChild('ws-1', 'folder-1', { role: 'member', processId: 'p-a', linkedAt: '2026-06-11T10:00:00.000Z' });
            store.linkChild('ws-1', 'folder-2', { role: 'member', processId: 'p-a', linkedAt: '2026-06-11T12:00:00.000Z' });

            expect(store.listMembershipsByProcess('ws-1', { type: 'chat-folder' }).get('p-a')).toBe('folder-2');
            expect(store.findMembership('ws-1', 'p-a', { type: 'chat-folder' })!.groupId).toBe('folder-2');
        });
    });

    it('survives malformed extra JSON', () => {
        store.upsertGroup(makeGroup());
        db.prepare("UPDATE task_groups SET extra = 'not-json' WHERE group_id = 'run-1'").run();
        const group = store.getGroup('ws-1', 'run-1')!;
        expect(group.extra).toBeUndefined();
        expect(group.groupId).toBe('run-1');
    });
});
