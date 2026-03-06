import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileToolCallCacheStore } from '../../src/memory/tool-call-cache-store';
import type { ToolCallQAEntry, ConsolidatedToolCallEntry } from '../../src/memory/tool-call-cache-types';

function makeEntry(overrides?: Partial<ToolCallQAEntry>): ToolCallQAEntry {
    return {
        id: 'test-id-' + Date.now(),
        toolName: 'grep',
        question: 'Find all uses of MemoryStore',
        answer: 'Found 5 files...',
        args: { pattern: 'MemoryStore', path: 'src/' },
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}

function makeConsolidated(overrides?: Partial<ConsolidatedToolCallEntry>): ConsolidatedToolCallEntry {
    return {
        id: 'consolidated-1',
        question: 'How is MemoryStore used?',
        answer: 'MemoryStore is used in 5 files...',
        topics: ['architecture'],
        toolSources: ['grep'],
        createdAt: new Date().toISOString(),
        hitCount: 0,
        ...overrides,
    };
}

describe('FileToolCallCacheStore', () => {
    let tmpDir: string;
    let store: FileToolCallCacheStore;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-call-cache-test-'));
        store = new FileToolCallCacheStore({ dataDir: tmpDir });
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // --- writeRaw / readRaw ---

    describe('writeRaw / readRaw', () => {
        it('roundtrips all fields including args deep equality', async () => {
            const entry = makeEntry({
                gitHash: 'abc123',
                parentToolCallId: 'parent-1',
            });
            const filename = await store.writeRaw(entry);
            const read = await store.readRaw(filename);

            expect(read).toBeDefined();
            expect(read!.id).toBe(entry.id);
            expect(read!.toolName).toBe(entry.toolName);
            expect(read!.question).toBe(entry.question);
            expect(read!.answer).toBe(entry.answer);
            expect(read!.args).toEqual(entry.args);
            expect(read!.gitHash).toBe('abc123');
            expect(read!.timestamp).toBe(entry.timestamp);
            expect(read!.parentToolCallId).toBe('parent-1');
        });

        it('returns a .json filename containing the tool name', async () => {
            const entry = makeEntry({ toolName: 'view' });
            const filename = await store.writeRaw(entry);
            expect(filename).toMatch(/\.json$/);
            expect(filename).toContain('view');
        });

        it('returns undefined for non-existent file', async () => {
            const result = await store.readRaw('no-such-file.json');
            expect(result).toBeUndefined();
        });
    });

    // --- listRaw ---

    describe('listRaw', () => {
        it('returns files sorted newest-first', async () => {
            const e1 = makeEntry({ timestamp: '2026-01-01T00:00:00.000Z', toolName: 'a' });
            const e2 = makeEntry({ timestamp: '2026-03-01T00:00:00.000Z', toolName: 'b' });
            const e3 = makeEntry({ timestamp: '2026-02-01T00:00:00.000Z', toolName: 'c' });

            await store.writeRaw(e1);
            await store.writeRaw(e2);
            await store.writeRaw(e3);

            const list = await store.listRaw();
            expect(list).toHaveLength(3);
            // Newest first: Mar > Feb > Jan
            expect(list[0]).toContain('b');
            expect(list[1]).toContain('c');
            expect(list[2]).toContain('a');
        });

        it('returns empty array for empty store', async () => {
            const list = await store.listRaw();
            expect(list).toEqual([]);
        });
    });

    // --- deleteRaw ---

    describe('deleteRaw', () => {
        it('removes file and returns true', async () => {
            const entry = makeEntry();
            const filename = await store.writeRaw(entry);

            const deleted = await store.deleteRaw(filename);
            expect(deleted).toBe(true);

            const list = await store.listRaw();
            expect(list).toEqual([]);
        });

        it('returns false for non-existent file', async () => {
            const deleted = await store.deleteRaw('nope.json');
            expect(deleted).toBe(false);
        });
    });

    // --- Concurrent write serialization ---

    describe('concurrent writes', () => {
        it('serializes multiple concurrent writes without corruption', async () => {
            const promises: Promise<string>[] = [];
            for (let i = 0; i < 10; i++) {
                const entry = makeEntry({
                    id: `concurrent-${i}`,
                    toolName: `tool-${i}`,
                    timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
                });
                promises.push(store.writeRaw(entry));
            }
            const filenames = await Promise.all(promises);

            expect(new Set(filenames).size).toBe(10);

            const list = await store.listRaw();
            expect(list).toHaveLength(10);

            for (const fn of filenames) {
                const read = await store.readRaw(fn);
                expect(read).toBeDefined();
            }
        });
    });

    // --- readConsolidated / writeConsolidated ---

    describe('readConsolidated / writeConsolidated', () => {
        it('returns empty array when no file exists', async () => {
            const result = await store.readConsolidated();
            expect(result).toEqual([]);
        });

        it('roundtrips an array of entries', async () => {
            const entries = [
                makeConsolidated({ id: 'c1', topics: ['arch'] }),
                makeConsolidated({ id: 'c2', topics: ['testing'], hitCount: 3 }),
            ];
            await store.writeConsolidated(entries);
            const read = await store.readConsolidated();
            expect(read).toEqual(entries);
        });

        it('overwrites existing consolidated data', async () => {
            await store.writeConsolidated([makeConsolidated({ id: 'old' })]);
            await store.writeConsolidated([makeConsolidated({ id: 'new' })]);
            const read = await store.readConsolidated();
            expect(read).toHaveLength(1);
            expect(read[0].id).toBe('new');
        });

        it('leaves no .tmp file after write', async () => {
            await store.writeConsolidated([makeConsolidated()]);
            const cacheDir = store.getCacheDir();
            const files = await fs.readdir(cacheDir);
            const tmpFiles = files.filter(f => f.endsWith('.tmp'));
            expect(tmpFiles).toEqual([]);
        });
    });

    // --- readIndex / updateIndex ---

    describe('readIndex / updateIndex', () => {
        it('returns defaults when no file exists', async () => {
            const index = await store.readIndex();
            expect(index).toEqual({
                lastAggregation: null,
                rawCount: 0,
                consolidatedCount: 0,
            });
        });

        it('creates index.json on first update', async () => {
            await store.updateIndex({ rawCount: 5 });
            const index = await store.readIndex();
            expect(index.rawCount).toBe(5);
            expect(index.lastAggregation).toBeNull();
            expect(index.consolidatedCount).toBe(0);
        });

        it('merges partial updates', async () => {
            await store.updateIndex({ rawCount: 3 });
            await store.updateIndex({ consolidatedCount: 2, lastAggregation: '2026-01-01T00:00:00Z' });

            const index = await store.readIndex();
            expect(index.rawCount).toBe(3);
            expect(index.consolidatedCount).toBe(2);
            expect(index.lastAggregation).toBe('2026-01-01T00:00:00Z');
        });
    });

    // --- getStats ---

    describe('getStats', () => {
        it('returns zeros for empty store', async () => {
            const stats = await store.getStats();
            expect(stats.rawCount).toBe(0);
            expect(stats.consolidatedExists).toBe(false);
            expect(stats.consolidatedCount).toBe(0);
            expect(stats.lastAggregation).toBeNull();
        });

        it('reflects actual filesystem state', async () => {
            await store.writeRaw(makeEntry({ timestamp: '2026-01-01T00:00:00.000Z', toolName: 'a' }));
            await store.writeRaw(makeEntry({ timestamp: '2026-01-02T00:00:00.000Z', toolName: 'b' }));
            await store.writeConsolidated([
                makeConsolidated({ id: 'c1' }),
                makeConsolidated({ id: 'c2' }),
                makeConsolidated({ id: 'c3' }),
            ]);
            await store.updateIndex({ lastAggregation: '2026-01-02T00:00:00Z' });

            const stats = await store.getStats();
            expect(stats.rawCount).toBe(2);
            expect(stats.consolidatedExists).toBe(true);
            expect(stats.consolidatedCount).toBe(3);
            expect(stats.lastAggregation).toBe('2026-01-02T00:00:00Z');
        });
    });

    // --- clear ---

    describe('clear', () => {
        it('removes all data', async () => {
            await store.writeRaw(makeEntry());
            await store.writeConsolidated([makeConsolidated()]);
            await store.updateIndex({ rawCount: 1 });

            await store.clear();

            expect(await store.listRaw()).toEqual([]);
            expect(await store.readConsolidated()).toEqual([]);
            expect(await store.readIndex()).toEqual({
                lastAggregation: null,
                rawCount: 0,
                consolidatedCount: 0,
            });
        });

        it('does not throw on non-existent directory', async () => {
            const freshStore = new FileToolCallCacheStore({ dataDir: path.join(tmpDir, 'nonexistent') });
            await expect(freshStore.clear()).resolves.toBeUndefined();
        });
    });

    // --- File naming sanitization ---

    describe('filename sanitization', () => {
        it('sanitizes special characters in tool name', async () => {
            const entry = makeEntry({ toolName: 'my/tool:v2' });
            const filename = await store.writeRaw(entry);

            expect(filename).not.toContain('/');
            expect(filename).not.toContain(':');
            expect(filename).toContain('my_tool_v2');
        });
    });

    // --- getCacheDir ---

    describe('getCacheDir', () => {
        it('returns correct path with defaults', () => {
            expect(store.getCacheDir()).toBe(path.join(tmpDir, 'explore-cache'));
        });

        it('respects custom cacheSubDir', () => {
            const custom = new FileToolCallCacheStore({
                dataDir: tmpDir,
                cacheSubDir: 'my-cache',
            });
            expect(custom.getCacheDir()).toBe(path.join(tmpDir, 'my-cache'));
        });
    });

    // --- Default dataDir ---

    describe('default dataDir', () => {
        it('defaults to COC_DATA_DIR/explore-cache when env var is set, else ~/.coc/memory/explore-cache', () => {
            const defaultStore = new FileToolCallCacheStore();
            const expectedBase = process.env.COC_DATA_DIR ?? path.join(os.homedir(), '.coc', 'memory');
            expect(defaultStore.getCacheDir()).toBe(path.join(expectedBase, 'explore-cache'));
        });
    });
});
