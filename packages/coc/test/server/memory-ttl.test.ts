/**
 * Tests for TTL expiry in FileMemoryStore (coc-server).
 *
 * Section 2: TTL Expiry
 *
 * Verifies that entries older than ttlDays are excluded from list() results.
 * ttlDays: 0 means infinite TTL (entries never expire).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileMemoryStore } from '../../src/server/memory/memory-store';

function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function overwriteCreatedAt(storageDir: string, id: string, createdAt: string): void {
    const filePath = path.join(storageDir, `${id}.json`);
    const entry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    entry.createdAt = createdAt;
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');

    // Also update the index record
    const indexPath = path.join(storageDir, 'index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const record = index.find((r: any) => r.id === id);
    if (record) record.createdAt = createdAt;
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

describe('FileMemoryStore — TTL expiry', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ttl-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('entry created today → returned by list() with ttlDays: 30', () => {
        const store = new FileMemoryStore(tmpDir, { ttlDays: 30 });
        const entry = store.create({ content: 'fresh entry', tags: [], source: 'manual' });

        const result = store.list();

        expect(result.total).toBe(1);
        expect(result.entries[0].id).toBe(entry.id);
    });

    it('entry with createdAt = now minus (ttlDays + 1 days) → NOT returned by list()', () => {
        const ttlDays = 7;
        const store = new FileMemoryStore(tmpDir, { ttlDays });
        const entry = store.create({ content: 'old entry', tags: [], source: 'manual' });

        // Backdate the entry past the TTL
        overwriteCreatedAt(tmpDir, entry.id, daysAgo(ttlDays + 1));

        const result = store.list();

        expect(result.total).toBe(0);
    });

    it('entry with createdAt = exactly ttlDays ago → excluded (boundary: expired)', () => {
        // Entry is exactly at the cutoff — should be excluded.
        // Behavior: cutoff = now - ttlDays * 24h. Entry AT cutoff has time equal to boundary.
        // The filter uses strict ">", so exactly at boundary is excluded.
        const ttlDays = 14;
        const store = new FileMemoryStore(tmpDir, { ttlDays });
        const entry = store.create({ content: 'boundary entry', tags: [], source: 'manual' });

        // Set createdAt exactly ttlDays ago
        overwriteCreatedAt(tmpDir, entry.id, daysAgo(ttlDays));

        const result = store.list();

        // Exactly at the boundary (createdAt <= cutoff) → excluded
        expect(result.total).toBe(0);
    });

    it('ttlDays: 0 → entries never expire (zero means infinite TTL)', () => {
        const store = new FileMemoryStore(tmpDir, { ttlDays: 0 });
        const entry = store.create({ content: 'ancient entry', tags: [], source: 'manual' });

        // Backdate dramatically — 1000 days ago
        overwriteCreatedAt(tmpDir, entry.id, daysAgo(1000));

        const result = store.list();

        // TTL: 0 → no expiry → entry still returned
        expect(result.total).toBe(1);
    });

    it('no ttlDays option → default is no TTL (entries never expire)', () => {
        const store = new FileMemoryStore(tmpDir);
        const entry = store.create({ content: 'default ttl entry', tags: [], source: 'manual' });

        overwriteCreatedAt(tmpDir, entry.id, daysAgo(500));

        const result = store.list();
        expect(result.total).toBe(1);
    });

    it('mix of expired and non-expired entries → only non-expired returned', () => {
        const ttlDays = 10;
        const store = new FileMemoryStore(tmpDir, { ttlDays });

        const fresh = store.create({ content: 'fresh', tags: [], source: 'manual' });
        const expired1 = store.create({ content: 'expired1', tags: [], source: 'manual' });
        const expired2 = store.create({ content: 'expired2', tags: [], source: 'manual' });

        overwriteCreatedAt(tmpDir, expired1.id, daysAgo(ttlDays + 2));
        overwriteCreatedAt(tmpDir, expired2.id, daysAgo(ttlDays + 5));

        const result = store.list();

        expect(result.total).toBe(1);
        expect(result.entries[0].id).toBe(fresh.id);
    });

    it('expired entries excluded — get() still returns them (TTL only affects list)', () => {
        const ttlDays = 5;
        const store = new FileMemoryStore(tmpDir, { ttlDays });
        const entry = store.create({ content: 'old but accessible', tags: [], source: 'manual' });
        overwriteCreatedAt(tmpDir, entry.id, daysAgo(ttlDays + 3));

        // list() excludes it
        expect(store.list().total).toBe(0);

        // get() by ID still returns it (TTL filtering only applies to listing)
        const fetched = store.get(entry.id);
        expect(fetched).toBeDefined();
        expect(fetched!.content).toBe('old but accessible');
    });
});
