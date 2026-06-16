import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { WorkItemChatBindingStore } from '../../src/server/processes/work-item-chat-binding-store';

describe('WorkItemChatBindingStore', () => {
    let db: Database.Database;
    let store: WorkItemChatBindingStore;

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
        store = new WorkItemChatBindingStore(db);
    });

    it('list returns empty object when no bindings exist', () => {
        expect(store.list('ws1')).toEqual({});
    });

    it('bind + get round-trip', () => {
        store.bind('ws1', 'wi-1', 'task-1');
        const binding = store.get('ws1', 'wi-1');
        expect(binding).toBeDefined();
        expect(binding!.taskId).toBe('task-1');
        expect(new Date(binding!.createdAt).toISOString()).toBe(binding!.createdAt);
    });

    it('bind overwrites existing binding', () => {
        store.bind('ws1', 'wi-1', 'task-1');
        store.bind('ws1', 'wi-1', 'task-2');
        expect(store.get('ws1', 'wi-1')!.taskId).toBe('task-2');
    });

    it('unbind removes existing binding', () => {
        store.bind('ws1', 'wi-1', 'task-1');
        expect(store.unbind('ws1', 'wi-1')).toBe(true);
        expect(store.get('ws1', 'wi-1')).toBeUndefined();
    });

    it('unbind is no-op for missing key', () => {
        store.bind('ws1', 'wi-1', 'task-1');
        expect(store.unbind('ws1', 'wi-missing')).toBe(false);
        expect(store.get('ws1', 'wi-1')!.taskId).toBe('task-1');
    });

    it('lists all bindings for a workspace', () => {
        store.bind('ws1', 'wi-1', 'task-a');
        store.bind('ws1', 'wi-2', 'task-b');
        store.bind('ws1', 'wi-3', 'task-c');

        const all = store.list('ws1');
        expect(Object.keys(all)).toHaveLength(3);
        expect(all['wi-1'].taskId).toBe('task-a');
        expect(all['wi-2'].taskId).toBe('task-b');
        expect(all['wi-3'].taskId).toBe('task-c');
    });

    it('keys bindings by both workspace and workItemId', () => {
        store.bind('ws1', 'wi-1', 'task-ws1');
        store.bind('ws2', 'wi-1', 'task-ws2');

        expect(store.get('ws1', 'wi-1')!.taskId).toBe('task-ws1');
        expect(store.get('ws2', 'wi-1')!.taskId).toBe('task-ws2');
        expect(store.list('ws1')).toEqual({
            'wi-1': expect.objectContaining({ taskId: 'task-ws1' }),
        });
    });

    it('supports opaque custom work item identifiers', () => {
        store.bind('ws1', 'feature:repo-a:42', 'task-custom');
        expect(store.get('ws1', 'feature:repo-a:42')!.taskId).toBe('task-custom');
    });

    it('migrates legacy workspace rows into an origin scope using newest binding per work item', () => {
        db.prepare(`
            INSERT INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at)
            VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)
        `).run(
            'ws-a', 'wi-1', 'task-old', '2026-01-01T00:00:00.000Z',
            'ws-b', 'wi-1', 'task-new', '2026-01-02T00:00:00.000Z',
            'ws-a', 'wi-2', 'task-other', '2026-01-01T00:00:00.000Z',
        );

        const bindings = store.list('gh_owner_repo', ['ws-a', 'ws-b']);

        expect(bindings['wi-1'].taskId).toBe('task-new');
        expect(bindings['wi-1'].createdAt).toBe('2026-01-02T00:00:00.000Z');
        expect(bindings['wi-2'].taskId).toBe('task-other');
        expect(store.list('ws-a')).toEqual({});
        expect(store.list('ws-b')).toEqual({});
    });

    it('preserves existing origin rows when migrating legacy workspace rows', () => {
        db.prepare(`
            INSERT INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at)
            VALUES (?, ?, ?, ?), (?, ?, ?, ?)
        `).run(
            'gh_owner_repo', 'wi-1', 'task-origin', '2026-01-03T00:00:00.000Z',
            'ws-a', 'wi-1', 'task-legacy', '2026-01-04T00:00:00.000Z',
        );

        expect(store.get('gh_owner_repo', 'wi-1', ['ws-a'])!.taskId).toBe('task-origin');
        expect(store.get('ws-a', 'wi-1')).toBeUndefined();
    });

    it('does not resurrect migrated legacy rows after an origin unbind', () => {
        db.prepare(`
            INSERT INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at)
            VALUES (?, ?, ?, ?)
        `).run('ws-a', 'wi-1', 'task-legacy', '2026-01-01T00:00:00.000Z');

        expect(store.unbind('gh_owner_repo', 'wi-1', ['ws-a'])).toBe(true);

        expect(store.get('gh_owner_repo', 'wi-1', ['ws-a'])).toBeUndefined();
        expect(store.get('ws-a', 'wi-1')).toBeUndefined();
    });
});
