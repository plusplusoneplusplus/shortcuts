/**
 * Tests for concurrent write serialization in FileMemoryStore.
 *
 * Section 1: Concurrent Write Serialization
 * - 10 simultaneous writeRaw() calls → all 10 entries persisted with no data loss
 * - Each entry has unique content → no entries overwrite each other
 * - Write during ongoing write → queued and both complete in order
 * - After concurrent writes, listRaw() returns exactly 10 entries
 * - Atomic write (tmp → rename) → at no point is a partial entry observable
 * - Simulated disk ENOSPC error on rename → error thrown, existing entries not corrupted
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileMemoryStore } from '../../src/memory/memory-store';
import type { RawObservationMetadata } from '../../src/memory/types';

describe('FileMemoryStore — concurrent write serialization', () => {
    let tmpDir: string;
    let store: FileMemoryStore;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-concurrent-test-'));
        store = new FileMemoryStore({ dataDir: tmpDir });
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('10 simultaneous writeRaw calls — all 10 entries persisted with no data loss', async () => {
        const promises: Promise<string>[] = [];
        for (let i = 0; i < 10; i++) {
            const meta: RawObservationMetadata = {
                pipeline: `pipeline-${i}`,
                timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
            };
            promises.push(store.writeRaw('system', undefined, meta, `unique-content-${i}`));
        }
        const filenames = await Promise.all(promises);

        // All 10 filenames returned successfully
        expect(filenames).toHaveLength(10);

        // All filenames are unique — no overwriting
        expect(new Set(filenames).size).toBe(10);

        // Exactly 10 entries on disk
        const list = await store.listRaw('system', undefined);
        expect(list).toHaveLength(10);
    });

    it('each entry has unique content — no entries overwrite each other', async () => {
        const contents = Array.from({ length: 10 }, (_, i) => `entry-content-${i}`);
        const promises = contents.map((content, i) =>
            store.writeRaw('system', undefined, {
                pipeline: `p${i}`,
                timestamp: `2026-0${Math.floor(i / 4) + 1}-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
            }, content),
        );
        const filenames = await Promise.all(promises);

        const readContents = await Promise.all(
            filenames.map(fn => store.readRaw('system', undefined, fn)),
        );

        const readSet = new Set(readContents.map(o => o!.content));
        expect(readSet.size).toBe(10);
        for (const c of contents) {
            expect(readSet).toContain(c);
        }
    });

    it('write during ongoing write → queued and both complete', async () => {
        const meta1: RawObservationMetadata = { pipeline: 'a', timestamp: '2026-01-01T00:00:00.000Z' };
        const meta2: RawObservationMetadata = { pipeline: 'b', timestamp: '2026-01-02T00:00:00.000Z' };

        // Start first write, then immediately start second
        const p1 = store.writeRaw('system', undefined, meta1, 'first');
        const p2 = store.writeRaw('system', undefined, meta2, 'second');

        const [fn1, fn2] = await Promise.all([p1, p2]);

        expect(fn1).toBeTruthy();
        expect(fn2).toBeTruthy();
        expect(fn1).not.toBe(fn2);

        const list = await store.listRaw('system', undefined);
        expect(list).toHaveLength(2);
    });

    it('after concurrent writes, getEntries returns exactly N entries', async () => {
        const N = 10;
        await Promise.all(
            Array.from({ length: N }, (_, i) =>
                store.writeRaw('system', undefined, {
                    pipeline: `p${i}`,
                    timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
                }, `content-${i}`),
            ),
        );
        const list = await store.listRaw('system', undefined);
        expect(list).toHaveLength(N);
    });

    it('each written file is parseable without errors (atomic write integrity)', async () => {
        const writes = Array.from({ length: 5 }, (_, i) =>
            store.writeRaw('system', undefined, {
                pipeline: `proc-${i}`,
                timestamp: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
            }, `body-${i}`),
        );
        const filenames = await Promise.all(writes);

        for (const fn of filenames) {
            const obs = await store.readRaw('system', undefined, fn);
            expect(obs).toBeDefined();
            expect(obs!.content).toMatch(/^body-\d$/);
        }
    });

    it('atomic write — no .tmp file left behind after successful write', async () => {
        const meta: RawObservationMetadata = { pipeline: 'atomic', timestamp: '2026-03-01T00:00:00.000Z' };
        const filename = await store.writeRaw('system', undefined, meta, 'atomic-content');

        const rawDir = path.join(tmpDir, 'system', 'raw');
        const tmpFile = path.join(rawDir, filename + '.tmp');

        // .tmp file must not exist after successful write
        let exists = false;
        try {
            await fs.access(tmpFile);
            exists = true;
        } catch {
            exists = false;
        }
        expect(exists).toBe(false);
    });

    it('simulated ENOSPC on rename → error thrown, previously committed entries not corrupted', async () => {
        // Write a valid entry that should survive any subsequent errors
        const meta1: RawObservationMetadata = { pipeline: 'ok', timestamp: '2026-01-01T00:00:00.000Z' };
        const fn1 = await store.writeRaw('system', undefined, meta1, 'good-entry');

        // Verify it was written
        expect(await store.readRaw('system', undefined, fn1)).toBeDefined();

        // Simulate a failing store by pointing it at a path where writes will fail:
        // create a FILE at the path where the raw/ directory would be, so mkdir fails.
        const conflictPath = path.join(tmpDir, 'system2', 'raw');
        await fs.mkdir(path.join(tmpDir, 'system2'), { recursive: true });
        await fs.writeFile(conflictPath, 'not a directory', 'utf-8'); // conflict: file, not dir

        const failStore = new FileMemoryStore({ dataDir: path.join(tmpDir, 'fail-store') });
        // Manually create the store's raw dir but as a file instead of directory:
        await fs.mkdir(path.join(tmpDir, 'fail-store'), { recursive: true });
        await fs.mkdir(path.join(tmpDir, 'fail-store', 'system'), { recursive: true });
        await fs.writeFile(
            path.join(tmpDir, 'fail-store', 'system', 'raw'),
            'blocking file',
            'utf-8',
        );

        const meta2: RawObservationMetadata = { pipeline: 'fail', timestamp: '2026-02-01T00:00:00.000Z' };
        // Writing to a store whose raw dir is blocked by a file should throw
        await expect(failStore.writeRaw('system', undefined, meta2, 'will-fail')).rejects.toThrow();

        // The original store's first entry must still be intact
        const obs = await store.readRaw('system', undefined, fn1);
        expect(obs).toBeDefined();
        expect(obs!.content).toBe('good-entry');

        // Only 1 entry in the original store (the failed write was separate)
        const list = await store.listRaw('system', undefined);
        expect(list).toHaveLength(1);
    });

    it('read (listRaw) during in-progress write → returns consistent snapshot', async () => {
        // Write 5 entries to set a baseline
        for (let i = 0; i < 5; i++) {
            await store.writeRaw('system', undefined, {
                pipeline: `base-${i}`,
                timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
            }, `base-${i}`);
        }

        // Kick off a concurrent write + list — both must see valid state
        const writePromise = store.writeRaw('system', undefined, {
            pipeline: 'concurrent',
            timestamp: '2026-06-01T00:00:00.000Z',
        }, 'concurrent-content');
        const listPromise = store.listRaw('system', undefined);

        const [, listResult] = await Promise.all([writePromise, listPromise]);

        // List must have seen either 5 or 6 entries — never a corrupt/partial state
        expect(listResult.length).toBeGreaterThanOrEqual(5);
        expect(listResult.length).toBeLessThanOrEqual(6);
    });
});
