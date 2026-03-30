import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CommitChatBindingStore } from '../../src/server/commit-chat-binding-store';

describe('CommitChatBindingStore', () => {
    let dataDir: string;
    let store: CommitChatBindingStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-chat-binding-test-'));
        store = new CommitChatBindingStore(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('load returns empty object when file does not exist', () => {
        expect(store.load('ws1')).toEqual({});
    });

    it('bind + get round-trip', () => {
        store.bind('ws1', 'abc123', 'task-1');
        const binding = store.get('ws1', 'abc123');
        expect(binding).toBeDefined();
        expect(binding!.taskId).toBe('task-1');
        expect(new Date(binding!.createdAt).toISOString()).toBe(binding!.createdAt);
    });

    it('bind overwrites existing binding', () => {
        store.bind('ws1', 'abc123', 'task-1');
        store.bind('ws1', 'abc123', 'task-2');
        const binding = store.get('ws1', 'abc123');
        expect(binding!.taskId).toBe('task-2');
    });

    it('unbind removes existing binding', () => {
        store.bind('ws1', 'abc123', 'task-1');
        const removed = store.unbind('ws1', 'abc123');
        expect(removed).toBe(true);
        expect(store.get('ws1', 'abc123')).toBeUndefined();
    });

    it('unbind is no-op for missing key', () => {
        store.bind('ws1', 'abc123', 'task-1');
        const removed = store.unbind('ws1', 'nonexistent');
        expect(removed).toBe(false);
        expect(store.get('ws1', 'abc123')!.taskId).toBe('task-1');
    });

    it('rebind moves binding from old to new hash', () => {
        store.bind('ws1', 'oldHash', 'task-1');
        const original = store.get('ws1', 'oldHash')!;
        const result = store.rebind('ws1', 'oldHash', 'newHash');
        expect(result).toBe(true);
        expect(store.get('ws1', 'oldHash')).toBeUndefined();
        const moved = store.get('ws1', 'newHash')!;
        expect(moved.taskId).toBe(original.taskId);
        expect(moved.createdAt).toBe(original.createdAt);
    });

    it('rebind is no-op when old hash missing', () => {
        store.bind('ws1', 'existingHash', 'task-1');
        const result = store.rebind('ws1', 'missingHash', 'newHash');
        expect(result).toBe(false);
        expect(store.get('ws1', 'existingHash')!.taskId).toBe('task-1');
        expect(store.get('ws1', 'newHash')).toBeUndefined();
    });

    it('rebind overwrites if newHash already bound', () => {
        store.bind('ws1', 'oldHash', 'task-old');
        const originalBinding = store.get('ws1', 'oldHash')!;
        store.bind('ws1', 'newHash', 'task-new');
        const result = store.rebind('ws1', 'oldHash', 'newHash');
        expect(result).toBe(true);
        const binding = store.get('ws1', 'newHash')!;
        expect(binding.taskId).toBe('task-old');
        expect(binding.createdAt).toBe(originalBinding.createdAt);
        expect(store.get('ws1', 'oldHash')).toBeUndefined();
    });

    it('list returns all bindings', () => {
        store.bind('ws1', 'hash1', 'task-1');
        store.bind('ws1', 'hash2', 'task-2');
        store.bind('ws1', 'hash3', 'task-3');
        const all = store.list('ws1');
        expect(Object.keys(all)).toHaveLength(3);
        expect(all['hash1'].taskId).toBe('task-1');
        expect(all['hash2'].taskId).toBe('task-2');
        expect(all['hash3'].taskId).toBe('task-3');
    });

    it('load returns empty object on corrupt JSON file', () => {
        const filePath = path.join(dataDir, 'repos', 'ws1', 'commit-chat-bindings.json');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '{{not valid json!!!', 'utf-8');
        expect(store.load('ws1')).toEqual({});
    });

    it('multiple workspaces are isolated', () => {
        store.bind('ws1', 'abc123', 'task-1');
        expect(store.get('ws1', 'abc123')!.taskId).toBe('task-1');
        expect(store.get('ws2', 'abc123')).toBeUndefined();
    });

    it('save creates parent directory if missing', () => {
        const nestedDir = path.join(dataDir, 'deep', 'nested');
        const nestedStore = new CommitChatBindingStore(nestedDir);
        nestedStore.bind('ws1', 'abc123', 'task-1');
        expect(nestedStore.get('ws1', 'abc123')!.taskId).toBe('task-1');
    });
});
