import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileMemoryStore } from '../../src/memory/memory-store';
import type { RawObservationMetadata } from '../../src/memory/types';

describe('FileMemoryStore — consolidated, index, management', () => {
    let tmpDir: string;
    let store: FileMemoryStore;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-store-cons-'));
        store = new FileMemoryStore({ dataDir: tmpDir });
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // Helper to write raw observations for testing stats/clear
    async function writeRaw(level: 'system' | 'repo', repoHash: string | undefined, count: number): Promise<string[]> {
        const filenames: string[] = [];
        for (let i = 0; i < count; i++) {
            const meta: RawObservationMetadata = {
                pipeline: `test-${i}`,
                timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
            };
            filenames.push(await store.writeRaw(level, repoHash, meta, `content-${i}`));
        }
        return filenames;
    }

    // --- Consolidated Memory Tests ---

    describe('readConsolidated / writeConsolidated', () => {
        it('returns null when file does not exist', async () => {
            const result = await store.readConsolidated('system');
            expect(result).toBeNull();
        });

        it('roundtrips content correctly', async () => {
            const content = '# System Memory\n\n- Fact 1\n- Fact 2\n';
            await store.writeConsolidated('system', content);
            const result = await store.readConsolidated('system');
            expect(result).toBe(content);
        });

        it('overwrites existing content', async () => {
            await store.writeConsolidated('system', 'content A');
            await store.writeConsolidated('system', 'content B');
            const result = await store.readConsolidated('system');
            expect(result).toBe('content B');
        });

        it('leaves no .tmp file after write', async () => {
            await store.writeConsolidated('system', 'atomic test');
            const sysDir = store.getSystemDir();
            const entries = await fs.readdir(sysDir);
            expect(entries.filter(e => e.endsWith('.tmp'))).toEqual([]);
        });

        it('creates parent directories for repo-level path', async () => {
            const hash = store.computeRepoHash('/new/repo');
            await store.writeConsolidated('repo', 'repo content', hash);
            const result = await store.readConsolidated('repo', hash);
            expect(result).toBe('repo content');
        });

        it('serializes concurrent writes correctly', async () => {
            const contentA = 'A'.repeat(1000);
            const contentB = 'B'.repeat(1000);
            await Promise.all([
                store.writeConsolidated('system', contentA),
                store.writeConsolidated('system', contentB),
            ]);
            const result = await store.readConsolidated('system');
            // Result must be one of the two, not corrupted
            expect([contentA, contentB]).toContain(result);
        });
    });

    // --- Index Tests ---

    describe('readIndex / updateIndex', () => {
        it('returns defaults when file does not exist', async () => {
            const index = await store.readIndex('system', undefined);
            expect(index).toEqual({
                lastAggregation: null,
                rawCount: 0,
                factCount: 0,
                categories: [],
            });
        });

        it('creates index.json when it does not exist', async () => {
            await store.updateIndex('system', undefined, { factCount: 5 });
            const index = await store.readIndex('system', undefined);
            expect(index.factCount).toBe(5);
            expect(index.lastAggregation).toBeNull();
            expect(index.rawCount).toBe(0);
            expect(index.categories).toEqual([]);
        });

        it('merges into existing index', async () => {
            await store.updateIndex('system', undefined, {
                factCount: 10,
                lastAggregation: '2026-01-01T00:00:00.000Z',
                categories: ['code-style'],
            });
            await store.updateIndex('system', undefined, { factCount: 15 });
            const index = await store.readIndex('system', undefined);
            expect(index.factCount).toBe(15);
            expect(index.lastAggregation).toBe('2026-01-01T00:00:00.000Z');
            expect(index.categories).toEqual(['code-style']);
        });

        it('replaces categories array on update', async () => {
            await store.updateIndex('system', undefined, { categories: ['old-cat'] });
            await store.updateIndex('system', undefined, { categories: ['new-cat-a', 'new-cat-b'] });
            const index = await store.readIndex('system', undefined);
            expect(index.categories).toEqual(['new-cat-a', 'new-cat-b']);
        });
    });

    // --- Repo Info Tests ---

    describe('getRepoInfo / updateRepoInfo', () => {
        const hash = 'abcdef1234567890';

        it('returns null when file does not exist', async () => {
            const info = await store.getRepoInfo(hash);
            expect(info).toBeNull();
        });

        it('roundtrips repo info correctly', async () => {
            await store.updateRepoInfo(hash, {
                path: '/my/repo',
                name: 'my-repo',
                remoteUrl: 'https://github.com/owner/repo',
                lastAccessed: '2026-01-15T12:00:00.000Z',
            });
            const info = await store.getRepoInfo(hash);
            expect(info).not.toBeNull();
            expect(info!.path).toBe('/my/repo');
            expect(info!.name).toBe('my-repo');
            expect(info!.remoteUrl).toBe('https://github.com/owner/repo');
            expect(info!.lastAccessed).toBe('2026-01-15T12:00:00.000Z');
        });

        it('merges partial updates', async () => {
            await store.updateRepoInfo(hash, {
                path: '/my/repo',
                name: 'my-repo',
                lastAccessed: '2026-01-01T00:00:00.000Z',
            });
            await store.updateRepoInfo(hash, {
                lastAccessed: '2026-02-01T00:00:00.000Z',
            });
            const info = await store.getRepoInfo(hash);
            expect(info!.name).toBe('my-repo');
            expect(info!.path).toBe('/my/repo');
            expect(info!.lastAccessed).toBe('2026-02-01T00:00:00.000Z');
        });
    });

    // --- Clear Tests ---

    describe('clear', () => {
        it('rawOnly=true preserves consolidated.md', async () => {
            await store.writeConsolidated('system', 'keep me');
            await writeRaw('system', undefined, 2);

            await store.clear('system', undefined, true);

            const consolidated = await store.readConsolidated('system');
            expect(consolidated).toBe('keep me');
            const rawList = await store.listRaw('system', undefined);
            expect(rawList).toEqual([]);
        });

        it('rawOnly=true preserves index.json', async () => {
            await store.updateIndex('system', undefined, { factCount: 42 });
            await writeRaw('system', undefined, 2);

            await store.clear('system', undefined, true);

            const index = await store.readIndex('system', undefined);
            expect(index.factCount).toBe(42);
            const rawList = await store.listRaw('system', undefined);
            expect(rawList).toEqual([]);
        });

        it('rawOnly=false removes everything', async () => {
            await store.writeConsolidated('system', 'gone');
            await store.updateIndex('system', undefined, { factCount: 10 });
            await writeRaw('system', undefined, 2);

            await store.clear('system', undefined, false);

            const consolidated = await store.readConsolidated('system');
            expect(consolidated).toBeNull();
            const index = await store.readIndex('system', undefined);
            expect(index).toEqual({ lastAggregation: null, rawCount: 0, factCount: 0, categories: [] });
        });

        it('clears non-existent directory without error', async () => {
            await expect(store.clear('repo', 'nonexistent', false)).resolves.toBeUndefined();
        });
    });

    // --- Stats Tests ---

    describe('getStats', () => {
        it('returns zeros/false for empty store', async () => {
            const stats = await store.getStats('system');
            expect(stats).toEqual({
                rawCount: 0,
                consolidatedExists: false,
                lastAggregation: null,
                factCount: 0,
            });
        });

        it('returns correct rawCount', async () => {
            await writeRaw('system', undefined, 3);
            const stats = await store.getStats('system');
            expect(stats.rawCount).toBe(3);
        });

        it('reflects consolidated existence', async () => {
            await store.writeConsolidated('system', 'consolidated content');
            const stats = await store.getStats('system');
            expect(stats.consolidatedExists).toBe(true);
        });

        it('reads lastAggregation and factCount from index', async () => {
            await store.updateIndex('system', undefined, {
                lastAggregation: '2026-02-15T10:00:00.000Z',
                factCount: 25,
            });
            const stats = await store.getStats('system');
            expect(stats.lastAggregation).toBe('2026-02-15T10:00:00.000Z');
            expect(stats.factCount).toBe(25);
        });
    });

    // --- listRepos Tests ---

    describe('listRepos', () => {
        it('returns empty array when no repos exist', async () => {
            const repos = await store.listRepos();
            expect(repos).toEqual([]);
        });

        it('returns all repo directories', async () => {
            const hash1 = store.computeRepoHash('/repo/one');
            const hash2 = store.computeRepoHash('/repo/two');
            await writeRaw('repo', hash1, 1);
            await writeRaw('repo', hash2, 1);

            const repos = await store.listRepos();
            expect(repos).toHaveLength(2);
            expect(repos).toContain(hash1);
            expect(repos).toContain(hash2);
        });

        it('ignores non-directory entries', async () => {
            const hash = store.computeRepoHash('/repo/real');
            await writeRaw('repo', hash, 1);

            // Create a stray file in the repos/ directory
            const reposDir = path.join(tmpDir, 'repos');
            await fs.writeFile(path.join(reposDir, 'stray-file.txt'), 'stray');

            const repos = await store.listRepos();
            expect(repos).toEqual([hash]);
        });
    });
});
