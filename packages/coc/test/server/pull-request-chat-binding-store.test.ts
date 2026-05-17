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

    it('multiple workspaces are isolated', () => {
        store.bind('ws1', '142', 'task-1');
        expect(store.get('ws1', '142')!.taskId).toBe('task-1');
        expect(store.get('ws2', '142')).toBeUndefined();
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
});
