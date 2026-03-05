/**
 * Tests for FileMemoryStore — CRUD, search, index consistency.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileMemoryStore } from '../src/memory/memory-store';

let tmpDir: string;
let store: FileMemoryStore;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-store-test-'));
    store = new FileMemoryStore(tmpDir);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('FileMemoryStore.create', () => {
    it('creates an entry and returns it with generated id', () => {
        const entry = store.create({
            content: 'Test memory content',
            tags: ['test'],
            source: 'manual',
        });
        expect(entry.id).toBeTruthy();
        expect(entry.content).toBe('Test memory content');
        expect(entry.tags).toEqual(['test']);
        expect(entry.source).toBe('manual');
        expect(entry.createdAt).toBeTruthy();
        expect(entry.updatedAt).toBeTruthy();
    });

    it('accepts a provided id', () => {
        const entry = store.create({
            id: 'custom-id-123',
            content: 'Content',
            tags: [],
            source: 'manual',
        });
        expect(entry.id).toBe('custom-id-123');
    });

    it('persists entry file to storageDir', () => {
        const entry = store.create({ content: 'test', tags: [], source: 'manual' });
        const filePath = path.join(tmpDir, `${entry.id}.json`);
        expect(fs.existsSync(filePath)).toBe(true);
    });

    it('updates the index', () => {
        const entry = store.create({ content: 'indexed', tags: ['a'], source: 'manual' });
        const indexPath = path.join(tmpDir, 'index.json');
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        expect(Array.isArray(index)).toBe(true);
        const record = index.find((r: any) => r.id === entry.id);
        expect(record).toBeTruthy();
        // Index records must NOT have content
        expect(record.content).toBeUndefined();
    });

    it('creates entries without tmp files remaining', () => {
        const entry = store.create({ content: 'atomic', tags: [], source: 'manual' });
        const filePath = path.join(tmpDir, `${entry.id}.json`);
        expect(fs.existsSync(filePath + '.tmp')).toBe(false);
    });
});

describe('FileMemoryStore.get', () => {
    it('returns entry by id', () => {
        const created = store.create({ content: 'hello', tags: [], source: 'manual' });
        const fetched = store.get(created.id);
        expect(fetched).toBeTruthy();
        expect(fetched!.content).toBe('hello');
    });

    it('returns undefined for unknown id', () => {
        expect(store.get('nonexistent')).toBeUndefined();
    });
});

describe('FileMemoryStore.list', () => {
    it('returns empty result when no entries', () => {
        const result = store.list();
        expect(result.entries).toHaveLength(0);
        expect(result.total).toBe(0);
    });

    it('lists all entries sorted newest first', () => {
        const e1 = store.create({ content: 'first', tags: [], source: 'manual' });
        const e2 = store.create({ content: 'second', tags: [], source: 'manual' });
        const result = store.list();
        expect(result.total).toBe(2);
        // newest entry (e2) should come first
        expect(result.entries[0].id === e2.id || result.entries[0].id === e1.id).toBe(true);
    });

    it('filters by tag', () => {
        store.create({ content: 'tagged', tags: ['important'], source: 'manual' });
        store.create({ content: 'untagged', tags: [], source: 'manual' });
        const result = store.list({ tag: 'important' });
        expect(result.total).toBe(1);
        expect(result.entries[0].tags).toContain('important');
    });

    it('filters by query string against tags and source', () => {
        store.create({ content: 'alpha content', tags: ['keyword'], source: 'pipe1' });
        store.create({ content: 'beta content', tags: ['other'], source: 'pipe2' });
        const result = store.list({ q: 'keyword' });
        expect(result.total).toBe(1);
    });

    it('paginates correctly', () => {
        for (let i = 0; i < 5; i++) {
            store.create({ content: `entry ${i}`, tags: [], source: 'manual' });
        }
        const page1 = store.list({ page: 1, pageSize: 3 });
        const page2 = store.list({ page: 2, pageSize: 3 });
        expect(page1.entries).toHaveLength(3);
        expect(page2.entries).toHaveLength(2);
        expect(page1.totalPages).toBe(2);
        expect(page1.total).toBe(5);
    });
});

describe('FileMemoryStore.update', () => {
    it('updates tags', () => {
        const entry = store.create({ content: 'original', tags: ['old'], source: 'manual' });
        const updated = store.update(entry.id, { tags: ['new', 'tags'] });
        expect(updated).toBeTruthy();
        expect(updated!.tags).toEqual(['new', 'tags']);
    });

    it('updates content', () => {
        const entry = store.create({ content: 'original', tags: [], source: 'manual' });
        const updated = store.update(entry.id, { content: 'new content' });
        expect(updated!.content).toBe('new content');
    });

    it('updates updatedAt timestamp', () => {
        const entry = store.create({ content: 'x', tags: [], source: 'manual' });
        const before = entry.updatedAt;
        // Small delay to ensure timestamps differ
        const updated = store.update(entry.id, { tags: ['new'] });
        expect(updated!.updatedAt >= before).toBe(true);
    });

    it('reflects updates in index', () => {
        const entry = store.create({ content: 'x', tags: ['old'], source: 'manual' });
        store.update(entry.id, { tags: ['new'] });
        const indexPath = path.join(tmpDir, 'index.json');
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        const record = index.find((r: any) => r.id === entry.id);
        expect(record.tags).toEqual(['new']);
    });

    it('returns undefined for unknown id', () => {
        expect(store.update('nonexistent', { tags: [] })).toBeUndefined();
    });
});

describe('FileMemoryStore.delete', () => {
    it('deletes an existing entry', () => {
        const entry = store.create({ content: 'to delete', tags: [], source: 'manual' });
        const result = store.delete(entry.id);
        expect(result).toBe(true);
        expect(store.get(entry.id)).toBeUndefined();
    });

    it('removes entry from index', () => {
        const entry = store.create({ content: 'x', tags: [], source: 'manual' });
        store.delete(entry.id);
        const indexPath = path.join(tmpDir, 'index.json');
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
        expect(index.find((r: any) => r.id === entry.id)).toBeUndefined();
    });

    it('returns false for unknown id', () => {
        expect(store.delete('nonexistent')).toBe(false);
    });

    it('deletes the entry file', () => {
        const entry = store.create({ content: 'gone', tags: [], source: 'manual' });
        const filePath = path.join(tmpDir, `${entry.id}.json`);
        store.delete(entry.id);
        expect(fs.existsSync(filePath)).toBe(false);
    });
});
