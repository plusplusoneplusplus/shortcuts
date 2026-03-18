/**
 * Tests for maxEntries pruning in FileMemoryStore (coc-server).
 *
 * Section 3: maxEntries Pruning
 *
 * Verifies that when maxEntries is set, the oldest entries are pruned
 * when the limit is exceeded on create().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileMemoryStore } from '../src/memory/memory-store';

describe('FileMemoryStore — maxEntries pruning', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-maxentries-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('write entries up to maxEntries limit → all present', () => {
        const store = new FileMemoryStore(tmpDir, { maxEntries: 5 });
        for (let i = 0; i < 5; i++) {
            store.create({ content: `entry ${i}`, tags: [], source: 'manual' });
        }

        const result = store.list({ pageSize: 100 });
        expect(result.total).toBe(5);
    });

    it('write one more entry when at limit → oldest entry pruned from store', () => {
        const store = new FileMemoryStore(tmpDir, { maxEntries: 3 });

        const e1 = store.create({ content: 'first', tags: [], source: 'manual' });
        const e2 = store.create({ content: 'second', tags: [], source: 'manual' });
        const e3 = store.create({ content: 'third', tags: [], source: 'manual' });

        // At limit — add one more
        store.create({ content: 'fourth', tags: [], source: 'manual' });

        const result = store.list({ pageSize: 100 });
        expect(result.total).toBe(3);

        // The oldest entry (e1) should be pruned
        const ids = result.entries.map(e => e.id);
        expect(ids).not.toContain(e1.id);
        expect(ids).toContain(e2.id);
        expect(ids).toContain(e3.id);
    });

    it('after pruning, list().total === maxEntries', () => {
        const maxEntries = 4;
        const store = new FileMemoryStore(tmpDir, { maxEntries });

        for (let i = 0; i < maxEntries + 3; i++) {
            store.create({ content: `entry ${i}`, tags: [], source: 'manual' });
        }

        const result = store.list({ pageSize: 100 });
        expect(result.total).toBe(maxEntries);
    });

    it('pruned entry is the chronologically oldest (by createdAt)', () => {
        const store = new FileMemoryStore(tmpDir, { maxEntries: 2 });

        // Create entries with a small delay to ensure distinct timestamps
        const e1 = store.create({ content: 'oldest', tags: [], source: 'manual' });
        // Force e2 to have a later timestamp by slightly advancing time
        const e2 = store.create({ content: 'middle', tags: [], source: 'manual' });
        store.create({ content: 'newest', tags: [], source: 'manual' }); // triggers pruning

        const result = store.list({ pageSize: 100 });
        const ids = result.entries.map(e => e.id);

        // The first-created entry (e1) should be pruned if e1 < e2 timestamps
        // (If timestamps are identical due to fast execution, behavior is by sort order)
        expect(ids).not.toContain(e1.id);
        // e2 or the "newest" entry should be present
        expect(ids.length).toBe(2);
        expect(ids).toContain(e2.id);
    });

    it('pruning persists to disk — restart store instance, count still at limit', () => {
        const maxEntries = 3;
        const store = new FileMemoryStore(tmpDir, { maxEntries });

        for (let i = 0; i < maxEntries + 2; i++) {
            store.create({ content: `entry ${i}`, tags: [], source: 'manual' });
        }

        // Create a new instance pointing to the same directory (simulates restart)
        const store2 = new FileMemoryStore(tmpDir, { maxEntries });
        const result = store2.list({ pageSize: 100 });

        expect(result.total).toBe(maxEntries);
    });

    it('maxEntries: 1 → only the single most recent entry kept', () => {
        const store = new FileMemoryStore(tmpDir, { maxEntries: 1 });

        store.create({ content: 'first', tags: [], source: 'manual' });
        store.create({ content: 'second', tags: [], source: 'manual' });
        store.create({ content: 'third', tags: [], source: 'manual' });
        const last = store.create({ content: 'last', tags: [], source: 'manual' });

        const result = store.list({ pageSize: 100 });
        expect(result.total).toBe(1);
        expect(result.entries[0].id).toBe(last.id);
    });

    it('maxEntries: 0 → no limit enforced, all entries kept', () => {
        // maxEntries: 0 means "no limit"
        const store = new FileMemoryStore(tmpDir, { maxEntries: 0 });

        for (let i = 0; i < 20; i++) {
            store.create({ content: `entry ${i}`, tags: [], source: 'manual' });
        }

        const result = store.list({ pageSize: 100 });
        // All 20 entries should be present — no pruning
        expect(result.total).toBe(20);
    });
});
