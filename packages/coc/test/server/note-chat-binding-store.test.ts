import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { NoteChatBindingStore } from '../../src/server/note-chat-binding-store';

describe('NoteChatBindingStore', () => {
    let db: Database.Database;
    let store: NoteChatBindingStore;

    beforeEach(() => {
        db = new Database(':memory:');
        initializeDatabase(db);
        store = new NoteChatBindingStore(db);
    });

    it('load returns empty object when no bindings exist', () => {
        expect(store.load('ws1')).toEqual({});
    });

    it('bind + get round-trip', () => {
        store.bind('ws1', 'folder/my-note.md', 'task-1');
        const binding = store.get('ws1', 'folder/my-note.md');
        expect(binding).toBeDefined();
        expect(binding!.taskId).toBe('task-1');
        expect(new Date(binding!.createdAt).toISOString()).toBe(binding!.createdAt);
    });

    it('bind overwrites existing binding', () => {
        store.bind('ws1', 'note.md', 'task-1');
        store.bind('ws1', 'note.md', 'task-2');
        const binding = store.get('ws1', 'note.md');
        expect(binding!.taskId).toBe('task-2');
    });

    it('unbind removes existing binding', () => {
        store.bind('ws1', 'note.md', 'task-1');
        const removed = store.unbind('ws1', 'note.md');
        expect(removed).toBe(true);
        expect(store.get('ws1', 'note.md')).toBeUndefined();
    });

    it('unbind is no-op for missing key', () => {
        store.bind('ws1', 'note.md', 'task-1');
        const removed = store.unbind('ws1', 'nonexistent.md');
        expect(removed).toBe(false);
        expect(store.get('ws1', 'note.md')!.taskId).toBe('task-1');
    });

    it('rebind moves binding from old to new path', () => {
        store.bind('ws1', 'old/note.md', 'task-1');
        const original = store.get('ws1', 'old/note.md')!;
        const result = store.rebind('ws1', 'old/note.md', 'new/note.md');
        expect(result).toBe(true);
        expect(store.get('ws1', 'old/note.md')).toBeUndefined();
        const moved = store.get('ws1', 'new/note.md')!;
        expect(moved.taskId).toBe(original.taskId);
        expect(moved.createdAt).toBe(original.createdAt);
    });

    it('rebind is no-op when old path missing', () => {
        store.bind('ws1', 'existing.md', 'task-1');
        const result = store.rebind('ws1', 'missing.md', 'new.md');
        expect(result).toBe(false);
        expect(store.get('ws1', 'existing.md')!.taskId).toBe('task-1');
        expect(store.get('ws1', 'new.md')).toBeUndefined();
    });

    it('rebind overwrites if newPath already bound', () => {
        store.bind('ws1', 'old.md', 'task-old');
        const originalBinding = store.get('ws1', 'old.md')!;
        store.bind('ws1', 'new.md', 'task-new');
        const result = store.rebind('ws1', 'old.md', 'new.md');
        expect(result).toBe(true);
        const binding = store.get('ws1', 'new.md')!;
        expect(binding.taskId).toBe('task-old');
        expect(binding.createdAt).toBe(originalBinding.createdAt);
        expect(store.get('ws1', 'old.md')).toBeUndefined();
    });

    it('list returns all bindings', () => {
        store.bind('ws1', 'a.md', 'task-1');
        store.bind('ws1', 'b.md', 'task-2');
        store.bind('ws1', 'folder/c.md', 'task-3');
        const all = store.list('ws1');
        expect(Object.keys(all)).toHaveLength(3);
        expect(all['a.md'].taskId).toBe('task-1');
        expect(all['b.md'].taskId).toBe('task-2');
        expect(all['folder/c.md'].taskId).toBe('task-3');
    });

    it('multiple workspaces are isolated', () => {
        store.bind('ws1', 'note.md', 'task-1');
        expect(store.get('ws1', 'note.md')!.taskId).toBe('task-1');
        expect(store.get('ws2', 'note.md')).toBeUndefined();
    });

    it('createdAt is a valid ISO-8601 string', () => {
        store.bind('ws1', 'note.md', 'task-1');
        const binding = store.get('ws1', 'note.md')!;
        const parsed = new Date(binding.createdAt);
        expect(isNaN(parsed.getTime())).toBe(false);
        expect(parsed.toISOString()).toBe(binding.createdAt);
    });

    it('unbind on empty store does not throw', () => {
        const result = store.unbind('ws1', 'nonexistent');
        expect(result).toBe(false);
    });

    it('handles paths with special characters', () => {
        const specialPath = 'folder/my note (draft).md';
        store.bind('ws1', specialPath, 'task-1');
        const binding = store.get('ws1', specialPath);
        expect(binding).toBeDefined();
        expect(binding!.taskId).toBe('task-1');
    });

    it('handles deeply nested paths', () => {
        const deepPath = 'a/b/c/d/e/note.md';
        store.bind('ws1', deepPath, 'task-deep');
        expect(store.get('ws1', deepPath)!.taskId).toBe('task-deep');
    });
});
