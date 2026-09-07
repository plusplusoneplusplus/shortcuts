import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { ChatBindingStore } from '../../src/server/shared/chat-binding-store';

/**
 * Exercises the shared base directly against one real table. Regression cover
 * for the key-column aliasing (`SELECT <keyColumn> AS key`) that replaced the
 * per-store literal column reads, plus the shared migrateLegacyScopes core.
 */
describe('ChatBindingStore', () => {
    let db: Database.Database;
    let store: ChatBindingStore;

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
        store = new ChatBindingStore(db, 'work_item_chat_bindings', 'work_item_id');
    });

    const seed = (scope: string, key: string, taskId: string, createdAt: string) => {
        db.prepare(
            'INSERT OR REPLACE INTO work_item_chat_bindings (workspace_id, work_item_id, task_id, created_at) VALUES (?, ?, ?, ?)',
        ).run(scope, key, taskId, createdAt);
    };

    it('list returns {} when the scope has no rows', () => {
        expect(store.list('scope-1')).toEqual({});
    });

    it('list keys rows by the parameterized key column', () => {
        store.bind('scope-1', 'wi-1', 'task-1');
        store.bind('scope-1', 'wi-2', 'task-2');
        const bindings = store.list('scope-1');
        expect(Object.keys(bindings).sort()).toEqual(['wi-1', 'wi-2']);
        expect(bindings['wi-1'].taskId).toBe('task-1');
        expect(bindings['wi-2'].taskId).toBe('task-2');
    });

    it('list is scoped — other scopes are not returned', () => {
        store.bind('scope-1', 'wi-1', 'task-1');
        store.bind('scope-2', 'wi-2', 'task-2');
        expect(Object.keys(store.list('scope-1'))).toEqual(['wi-1']);
    });

    it('bind + get round-trip records an ISO-8601 createdAt', () => {
        store.bind('scope-1', 'wi-1', 'task-1');
        const binding = store.get('scope-1', 'wi-1');
        expect(binding).toBeDefined();
        expect(binding!.taskId).toBe('task-1');
        expect(new Date(binding!.createdAt).toISOString()).toBe(binding!.createdAt);
    });

    it('bind overwrites an existing binding', () => {
        store.bind('scope-1', 'wi-1', 'task-1');
        store.bind('scope-1', 'wi-1', 'task-2');
        expect(store.get('scope-1', 'wi-1')!.taskId).toBe('task-2');
    });

    it('get returns undefined for a missing key', () => {
        expect(store.get('scope-1', 'nope')).toBeUndefined();
    });

    it('unbind returns true when a row was removed and false otherwise', () => {
        store.bind('scope-1', 'wi-1', 'task-1');
        expect(store.unbind('scope-1', 'wi-1')).toBe(true);
        expect(store.unbind('scope-1', 'wi-1')).toBe(false);
        expect(store.get('scope-1', 'wi-1')).toBeUndefined();
    });

    describe('migrateLegacyScopes', () => {
        it('is a no-op with no legacy scopes', () => {
            store.bind('scope-1', 'wi-1', 'task-1');
            store.migrateLegacyScopes('scope-1');
            store.migrateLegacyScopes('scope-1', []);
            expect(store.list('scope-1')['wi-1'].taskId).toBe('task-1');
        });

        it('ignores blank legacy IDs and the target scope itself', () => {
            store.bind('scope-1', 'wi-1', 'task-1');
            store.migrateLegacyScopes('scope-1', ['  ', 'scope-1']);
            expect(store.list('scope-1')['wi-1'].taskId).toBe('task-1');
        });

        it('moves legacy rows into the target scope preserving created_at', () => {
            seed('legacy-1', 'wi-1', 'task-legacy', '2024-01-01T00:00:00.000Z');
            store.migrateLegacyScopes('scope-1', ['legacy-1']);
            expect(store.get('scope-1', 'wi-1')).toEqual({
                taskId: 'task-legacy',
                createdAt: '2024-01-01T00:00:00.000Z',
            });
            expect(store.list('legacy-1')).toEqual({});
        });

        it('picks the newest binding per key across legacy scopes', () => {
            seed('legacy-1', 'wi-1', 'task-old', '2024-01-01T00:00:00.000Z');
            seed('legacy-2', 'wi-1', 'task-new', '2024-06-01T00:00:00.000Z');
            store.migrateLegacyScopes('scope-1', ['legacy-1', 'legacy-2']);
            expect(store.get('scope-1', 'wi-1')!.taskId).toBe('task-new');
            expect(store.list('legacy-1')).toEqual({});
            expect(store.list('legacy-2')).toEqual({});
        });

        it('preserves rows already present in the target scope', () => {
            seed('scope-1', 'wi-1', 'task-target', '2024-01-01T00:00:00.000Z');
            seed('legacy-1', 'wi-1', 'task-legacy', '2025-01-01T00:00:00.000Z');
            seed('legacy-1', 'wi-2', 'task-other', '2025-01-01T00:00:00.000Z');
            store.migrateLegacyScopes('scope-1', ['legacy-1']);
            expect(store.get('scope-1', 'wi-1')!.taskId).toBe('task-target');
            expect(store.get('scope-1', 'wi-2')!.taskId).toBe('task-other');
            expect(store.list('legacy-1')).toEqual({});
        });

        it('deduplicates repeated legacy scope IDs', () => {
            seed('legacy-1', 'wi-1', 'task-legacy', '2024-01-01T00:00:00.000Z');
            store.migrateLegacyScopes('scope-1', ['legacy-1', 'legacy-1']);
            expect(store.get('scope-1', 'wi-1')!.taskId).toBe('task-legacy');
        });
    });

    it('works against a differently named table and key column', () => {
        const noteStore = new ChatBindingStore(db, 'note_chat_bindings', 'note_path');
        noteStore.bind('ws1', 'Plans/a.md', 'task-a');
        expect(noteStore.list('ws1')).toHaveProperty(['Plans/a.md']);
        expect(noteStore.get('ws1', 'Plans/a.md')!.taskId).toBe('task-a');
    });
});
