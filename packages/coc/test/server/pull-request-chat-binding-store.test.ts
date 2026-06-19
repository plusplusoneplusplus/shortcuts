import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { PullRequestChatBindingStore } from '../../src/server/processes/pull-request-chat-binding-store';

describe('PullRequestChatBindingStore', () => {
    let db: Database.Database;
    let store: PullRequestChatBindingStore;

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
        store = new PullRequestChatBindingStore(db);
    });

    it('load returns empty object when no bindings exist', () => {
        expect(store.load('ws1')).toEqual({});
    });

    it('bind + get round-trip', () => {
        store.bind('ws1', '142', 'task-1');
        const binding = store.get('ws1', '142');
        expect(binding).toBeDefined();
        expect(binding!.taskId).toBe('task-1');
        expect(new Date(binding!.createdAt).toISOString()).toBe(binding!.createdAt);
    });

    it('bind overwrites existing binding', () => {
        store.bind('ws1', '142', 'task-1');
        store.bind('ws1', '142', 'task-2');
        expect(store.get('ws1', '142')!.taskId).toBe('task-2');
    });

    it('unbind removes existing binding', () => {
        store.bind('ws1', '142', 'task-1');
        const removed = store.unbind('ws1', '142');
        expect(removed).toBe(true);
        expect(store.get('ws1', '142')).toBeUndefined();
    });

    it('unbind is no-op for missing key', () => {
        store.bind('ws1', '142', 'task-1');
        const removed = store.unbind('ws1', '999');
        expect(removed).toBe(false);
        expect(store.get('ws1', '142')!.taskId).toBe('task-1');
    });

    it('list returns all bindings for a workspace', () => {
        store.bind('ws1', '142', 'task-a');
        store.bind('ws1', '143', 'task-b');
        store.bind('ws1', '144', 'task-c');
        const all = store.list('ws1');
        expect(Object.keys(all)).toHaveLength(3);
        expect(all['142'].taskId).toBe('task-a');
        expect(all['143'].taskId).toBe('task-b');
        expect(all['144'].taskId).toBe('task-c');
    });

    it('listByTaskId round-trips an upserted binding', () => {
        store.bind('gh_owner_repo', '142', 'task-1');
        const byTask = store.listByTaskId('gh_owner_repo', 'task-1');
        expect(Object.keys(byTask)).toEqual(['142']);
        expect(byTask['142'].taskId).toBe('task-1');
        expect(new Date(byTask['142'].createdAt).toISOString()).toBe(byTask['142'].createdAt);
    });

    it('listByTaskId returns every PR a single task created, newest values after overwrite', () => {
        store.bind('gh_owner_repo', '142', 'task-1');
        store.bind('gh_owner_repo', '143', 'task-1');
        store.bind('gh_owner_repo', '144', 'task-2');
        // overwrite 142 keeps it bound to task-1
        store.bind('gh_owner_repo', '142', 'task-1');

        const forTask1 = store.listByTaskId('gh_owner_repo', 'task-1');
        expect(Object.keys(forTask1).sort()).toEqual(['142', '143']);

        const forTask2 = store.listByTaskId('gh_owner_repo', 'task-2');
        expect(Object.keys(forTask2)).toEqual(['144']);
    });

    it('listByTaskId returns empty object for an unknown task', () => {
        store.bind('gh_owner_repo', '142', 'task-1');
        expect(store.listByTaskId('gh_owner_repo', 'task-absent')).toEqual({});
    });

    it('listByTaskId is isolated across origin scopes', () => {
        store.bind('gh_owner_repo', '142', 'task-1');
        store.bind('gh_other_repo', '143', 'task-1');
        expect(Object.keys(store.listByTaskId('gh_owner_repo', 'task-1'))).toEqual(['142']);
        expect(Object.keys(store.listByTaskId('gh_other_repo', 'task-1'))).toEqual(['143']);
    });

    it('listByTaskId reflects a binding moved to a different task by overwrite', () => {
        store.bind('gh_owner_repo', '142', 'task-1');
        // re-bind the same PR to a different chat task
        store.bind('gh_owner_repo', '142', 'task-2');
        expect(store.listByTaskId('gh_owner_repo', 'task-1')).toEqual({});
        expect(Object.keys(store.listByTaskId('gh_owner_repo', 'task-2'))).toEqual(['142']);
    });

    it('listByTaskId migrates legacy workspace rows before filtering', () => {
        db.prepare(`
            INSERT INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at)
            VALUES (?, ?, ?, ?)
        `).run('ws-a', '142', 'task-legacy', '2026-01-01T00:00:00.000Z');

        const byTask = store.listByTaskId('gh_owner_repo', 'task-legacy', ['ws-a']);
        expect(Object.keys(byTask)).toEqual(['142']);
        expect(byTask['142'].taskId).toBe('task-legacy');
        expect(store.list('ws-a')).toEqual({});
    });

    it('multiple origin scopes are isolated', () => {
        store.bind('gh_owner_repo', '142', 'task-1');
        expect(store.get('gh_owner_repo', '142')!.taskId).toBe('task-1');
        expect(store.get('gh_other_repo', '142')).toBeUndefined();
    });

    it('createdAt is a valid ISO-8601 string', () => {
        store.bind('ws1', '142', 'task-1');
        const binding = store.get('ws1', '142')!;
        const parsed = new Date(binding.createdAt);
        expect(isNaN(parsed.getTime())).toBe(false);
        expect(parsed.toISOString()).toBe(binding.createdAt);
    });

    it('unbind on empty store does not throw', () => {
        const result = store.unbind('ws1', '142');
        expect(result).toBe(false);
    });

    it('handles non-numeric pr identifiers (provider-agnostic)', () => {
        store.bind('ws1', 'PR-ABC123', 'task-x');
        expect(store.get('ws1', 'PR-ABC123')!.taskId).toBe('task-x');
    });

    it('migrates legacy workspace rows into an origin scope using newest binding per PR', () => {
        db.prepare(`
            INSERT INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at)
            VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)
        `).run(
            'ws-a', '142', 'task-old', '2026-01-01T00:00:00.000Z',
            'ws-b', '142', 'task-new', '2026-01-02T00:00:00.000Z',
            'ws-a', '143', 'task-other', '2026-01-01T00:00:00.000Z',
        );

        const bindings = store.list('gh_owner_repo', ['ws-a', 'ws-b']);

        expect(bindings['142'].taskId).toBe('task-new');
        expect(bindings['142'].createdAt).toBe('2026-01-02T00:00:00.000Z');
        expect(bindings['143'].taskId).toBe('task-other');
        expect(store.list('ws-a')).toEqual({});
        expect(store.list('ws-b')).toEqual({});
    });

    it('preserves existing origin rows when migrating legacy workspace rows', () => {
        db.prepare(`
            INSERT INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at)
            VALUES (?, ?, ?, ?), (?, ?, ?, ?)
        `).run(
            'gh_owner_repo', '142', 'task-origin', '2026-01-03T00:00:00.000Z',
            'ws-a', '142', 'task-legacy', '2026-01-04T00:00:00.000Z',
        );

        expect(store.get('gh_owner_repo', '142', ['ws-a'])!.taskId).toBe('task-origin');
        expect(store.get('ws-a', '142')).toBeUndefined();
    });

    it('does not resurrect migrated legacy rows after an origin unbind', () => {
        db.prepare(`
            INSERT INTO pull_request_chat_bindings (workspace_id, pr_id, task_id, created_at)
            VALUES (?, ?, ?, ?)
        `).run('ws-a', '142', 'task-legacy', '2026-01-01T00:00:00.000Z');

        expect(store.unbind('gh_owner_repo', '142', ['ws-a'])).toBe(true);

        expect(store.get('gh_owner_repo', '142', ['ws-a'])).toBeUndefined();
        expect(store.get('ws-a', '142')).toBeUndefined();
    });
});
