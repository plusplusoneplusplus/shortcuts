import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { NoteChatBindingStore } from '../../src/server/notes/note-chat-binding-store';

describe('NoteChatBindingStore', () => {
    let db: Database.Database;
    let store: NoteChatBindingStore;

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
        store = new NoteChatBindingStore(db);
    });

    it('list returns empty object when no bindings exist', () => {
        expect(store.list('ws1')).toEqual({});
    });

    it('bind + get round-trip', () => {
        store.bind('ws1', 'Features/Memory.md', 'task-1');
        const binding = store.get('ws1', 'Features/Memory.md');
        expect(binding).toBeDefined();
        expect(binding!.taskId).toBe('task-1');
        expect(new Date(binding!.createdAt).toISOString()).toBe(binding!.createdAt);
    });

    it('bind overwrites existing binding', () => {
        store.bind('ws1', 'a.md', 'task-1');
        store.bind('ws1', 'a.md', 'task-2');
        expect(store.get('ws1', 'a.md')!.taskId).toBe('task-2');
    });

    it('list returns all bindings for a workspace', () => {
        store.bind('ws1', 'a.md', 'task-a');
        store.bind('ws1', 'b/c.md', 'task-c');
        store.bind('ws2', 'a.md', 'task-other');
        const result = store.list('ws1');
        expect(Object.keys(result).sort()).toEqual(['a.md', 'b/c.md']);
        expect(result['a.md'].taskId).toBe('task-a');
        expect(result['b/c.md'].taskId).toBe('task-c');
    });

    it('unbind removes existing binding', () => {
        store.bind('ws1', 'a.md', 'task-1');
        expect(store.unbind('ws1', 'a.md')).toBe(true);
        expect(store.get('ws1', 'a.md')).toBeUndefined();
    });

    it('unbind returns false when no binding exists', () => {
        expect(store.unbind('ws1', 'missing.md')).toBe(false);
    });

    it('unbindByTask removes all rows pointing at a task', () => {
        store.bind('ws1', 'a.md', 'task-1');
        store.bind('ws1', 'b.md', 'task-1');
        store.bind('ws1', 'c.md', 'task-2');
        const removed = store.unbindByTask('ws1', 'task-1');
        expect(removed).toBe(2);
        expect(Object.keys(store.list('ws1')).sort()).toEqual(['c.md']);
    });

    describe('renamePath', () => {
        it('moves a single binding', () => {
            store.bind('ws1', 'old.md', 'task-1');
            const moved = store.renamePath('ws1', 'old.md', 'new.md');
            expect(moved).toBe(1);
            expect(store.get('ws1', 'old.md')).toBeUndefined();
            expect(store.get('ws1', 'new.md')!.taskId).toBe('task-1');
        });

        it('no-op when source missing', () => {
            const moved = store.renamePath('ws1', 'missing.md', 'new.md');
            expect(moved).toBe(0);
        });

        it('no-op when source equals destination', () => {
            store.bind('ws1', 'a.md', 't1');
            expect(store.renamePath('ws1', 'a.md', 'a.md')).toBe(0);
            expect(store.get('ws1', 'a.md')!.taskId).toBe('t1');
        });

        it('overwrites a colliding destination', () => {
            store.bind('ws1', 'src.md', 'src-task');
            store.bind('ws1', 'dst.md', 'dst-task');
            const moved = store.renamePath('ws1', 'src.md', 'dst.md');
            expect(moved).toBe(1);
            expect(store.get('ws1', 'src.md')).toBeUndefined();
            expect(store.get('ws1', 'dst.md')!.taskId).toBe('src-task');
        });
    });

    describe('renamePrefix', () => {
        it('moves all children under the folder', () => {
            store.bind('ws1', 'old/a.md', 'task-a');
            store.bind('ws1', 'old/sub/b.md', 'task-b');
            store.bind('ws1', 'other/c.md', 'task-c');
            const moved = store.renamePrefix('ws1', 'old', 'new');
            expect(moved).toBe(2);
            expect(store.get('ws1', 'new/a.md')!.taskId).toBe('task-a');
            expect(store.get('ws1', 'new/sub/b.md')!.taskId).toBe('task-b');
            expect(store.get('ws1', 'other/c.md')!.taskId).toBe('task-c');
        });

        it('accepts trailing slashes on either side', () => {
            store.bind('ws1', 'old/a.md', 'task-a');
            store.renamePrefix('ws1', 'old/', 'new/');
            expect(store.get('ws1', 'new/a.md')!.taskId).toBe('task-a');
        });

        it('does not match unrelated prefixes', () => {
            store.bind('ws1', 'oldfolder/x.md', 'task-keep');
            store.bind('ws1', 'old/a.md', 'task-move');
            const moved = store.renamePrefix('ws1', 'old', 'new');
            expect(moved).toBe(1);
            expect(store.get('ws1', 'oldfolder/x.md')!.taskId).toBe('task-keep');
            expect(store.get('ws1', 'new/a.md')!.taskId).toBe('task-move');
        });

        it('escapes LIKE wildcards in folder name', () => {
            store.bind('ws1', 'a_b/x.md', 'task-real');
            store.bind('ws1', 'aXb/x.md', 'task-unrelated');
            const moved = store.renamePrefix('ws1', 'a_b', 'renamed');
            expect(moved).toBe(1);
            expect(store.get('ws1', 'renamed/x.md')!.taskId).toBe('task-real');
            expect(store.get('ws1', 'aXb/x.md')!.taskId).toBe('task-unrelated');
        });

        it('escapes LIKE percent wildcards in folder name', () => {
            store.bind('ws1', '100%done/x.md', 'task-real');
            store.bind('ws1', '100XXdone/x.md', 'task-unrelated');
            const moved = store.renamePrefix('ws1', '100%done', 'renamed');
            expect(moved).toBe(1);
            expect(store.get('ws1', 'renamed/x.md')!.taskId).toBe('task-real');
            expect(store.get('ws1', '100XXdone/x.md')!.taskId).toBe('task-unrelated');
        });
    });

    describe('deletePrefix', () => {
        it('removes all children under the folder', () => {
            store.bind('ws1', 'gone/a.md', 'task-a');
            store.bind('ws1', 'gone/sub/b.md', 'task-b');
            store.bind('ws1', 'keep/c.md', 'task-c');
            const removed = store.deletePrefix('ws1', 'gone');
            expect(removed).toBe(2);
            expect(Object.keys(store.list('ws1')).sort()).toEqual(['keep/c.md']);
        });

        it('accepts trailing slash', () => {
            store.bind('ws1', 'gone/a.md', 'task-a');
            store.deletePrefix('ws1', 'gone/');
            expect(store.get('ws1', 'gone/a.md')).toBeUndefined();
        });

        it('escapes LIKE wildcards', () => {
            store.bind('ws1', 'a_b/x.md', 'task-real');
            store.bind('ws1', 'aXb/x.md', 'task-keep');
            store.deletePrefix('ws1', 'a_b');
            expect(store.get('ws1', 'a_b/x.md')).toBeUndefined();
            expect(store.get('ws1', 'aXb/x.md')!.taskId).toBe('task-keep');
        });
    });

    it('bindings are isolated per workspace', () => {
        store.bind('ws1', 'shared.md', 'task-1');
        store.bind('ws2', 'shared.md', 'task-2');
        expect(store.get('ws1', 'shared.md')!.taskId).toBe('task-1');
        expect(store.get('ws2', 'shared.md')!.taskId).toBe('task-2');
        store.unbind('ws1', 'shared.md');
        expect(store.get('ws2', 'shared.md')!.taskId).toBe('task-2');
    });
});
