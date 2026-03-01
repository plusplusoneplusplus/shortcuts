import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileMemoryStore, computeRepoHash } from '../../src/memory/memory-store';
import type { RawObservationMetadata } from '../../src/memory/types';

describe('FileMemoryStore', () => {
    let tmpDir: string;
    let store: FileMemoryStore;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-store-test-'));
        store = new FileMemoryStore({ dataDir: tmpDir });
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // --- computeRepoHash ---

    describe('computeRepoHash', () => {
        it('returns a stable 16-char hex string', () => {
            const hash1 = store.computeRepoHash('/some/path');
            const hash2 = store.computeRepoHash('/some/path');
            expect(hash1).toBe(hash2);
            expect(hash1).toMatch(/^[0-9a-f]{16}$/);
        });

        it('returns different hashes for different paths', () => {
            const hashA = store.computeRepoHash('/path/a');
            const hashB = store.computeRepoHash('/path/b');
            expect(hashA).not.toBe(hashB);
        });

        it('uses resolved path so relative equals absolute', () => {
            const rel = store.computeRepoHash('relative/path');
            const abs = store.computeRepoHash(path.resolve('relative/path'));
            expect(rel).toBe(abs);
        });

        it('is also available as a standalone function', () => {
            const fromClass = store.computeRepoHash('/standalone/test');
            const fromFn = computeRepoHash('/standalone/test');
            expect(fromClass).toBe(fromFn);
        });
    });

    // --- Path helpers ---

    describe('getSystemDir / getRepoDir', () => {
        it('returns correct system directory path', () => {
            expect(store.getSystemDir()).toBe(path.join(tmpDir, 'system'));
        });

        it('returns correct repo directory path', () => {
            expect(store.getRepoDir('abc123')).toBe(path.join(tmpDir, 'repos', 'abc123'));
        });
    });

    // --- ensureStorageLayout ---

    describe('ensureStorageLayout', () => {
        it('creates system/raw/ directory', async () => {
            await store.ensureStorageLayout('system');
            const stat = await fs.stat(path.join(tmpDir, 'system', 'raw'));
            expect(stat.isDirectory()).toBe(true);
        });

        it('creates repos/<hash>/raw/ directory', async () => {
            await store.ensureStorageLayout('repo', 'abc123');
            const stat = await fs.stat(path.join(tmpDir, 'repos', 'abc123', 'raw'));
            expect(stat.isDirectory()).toBe(true);
        });

        it('creates both system and repo directories', async () => {
            await store.ensureStorageLayout('both', 'abc123');
            const sys = await fs.stat(path.join(tmpDir, 'system', 'raw'));
            const repo = await fs.stat(path.join(tmpDir, 'repos', 'abc123', 'raw'));
            expect(sys.isDirectory()).toBe(true);
            expect(repo.isDirectory()).toBe(true);
        });

        it('is idempotent — calling twice does not throw', async () => {
            await store.ensureStorageLayout('both', 'abc123');
            await expect(store.ensureStorageLayout('both', 'abc123')).resolves.toBeUndefined();
        });
    });

    // --- writeRaw + readRaw roundtrip ---

    describe('writeRaw / readRaw', () => {
        const metadata: RawObservationMetadata = {
            pipeline: 'code-review',
            timestamp: '2026-02-28T15:00:00.000Z',
            repo: 'github/shortcuts',
            model: 'gpt-4',
        };
        const content = '- Found unused import\n- Missing error handling';

        it('roundtrips metadata and content for system level', async () => {
            const filename = await store.writeRaw('system', undefined, metadata, content);
            expect(filename).toMatch(/\.md$/);

            const obs = await store.readRaw('system', undefined, filename);
            expect(obs).toBeDefined();
            expect(obs!.metadata.pipeline).toBe('code-review');
            expect(obs!.metadata.timestamp).toBe('2026-02-28T15:00:00.000Z');
            expect(obs!.metadata.repo).toBe('github/shortcuts');
            expect(obs!.metadata.model).toBe('gpt-4');
            expect(obs!.content).toBe(content.trim());
            expect(obs!.filename).toBe(filename);
        });

        it('roundtrips for repo level', async () => {
            const hash = store.computeRepoHash('/my/repo');
            const filename = await store.writeRaw('repo', hash, metadata, content);
            const obs = await store.readRaw('repo', hash, filename);
            expect(obs).toBeDefined();
            expect(obs!.metadata.pipeline).toBe('code-review');
        });

        it('writes to both system and repo when level is both', async () => {
            const hash = store.computeRepoHash('/my/repo');
            const filename = await store.writeRaw('both', hash, metadata, content);

            // Both locations should have the file
            const sysPath = path.join(tmpDir, 'system', 'raw', filename);
            const repoPath = path.join(tmpDir, 'repos', hash, 'raw', filename);
            await expect(fs.stat(sysPath)).resolves.toBeDefined();
            await expect(fs.stat(repoPath)).resolves.toBeDefined();
        });

        it('returns undefined for non-existent filename', async () => {
            await store.ensureStorageLayout('system');
            const obs = await store.readRaw('system', undefined, 'no-such-file.md');
            expect(obs).toBeUndefined();
        });
    });

    // --- writeRaw file format ---

    describe('writeRaw file format', () => {
        it('produces YAML frontmatter with all metadata fields', async () => {
            const metadata: RawObservationMetadata = {
                pipeline: 'code-review',
                timestamp: '2026-02-28T15:00:00.000Z',
                repo: 'github/shortcuts',
                model: 'gpt-4',
            };
            const filename = await store.writeRaw('system', undefined, metadata, 'some content');
            const filePath = path.join(tmpDir, 'system', 'raw', filename);
            const raw = await fs.readFile(filePath, 'utf-8');

            expect(raw).toContain('---\n');
            expect(raw).toContain('pipeline: code-review');
            expect(raw).toContain('timestamp: 2026-02-28T15:00:00.000Z');
            expect(raw).toContain('repo: github/shortcuts');
            expect(raw).toContain('model: gpt-4');
            expect(raw).toContain('some content');
        });

        it('omits optional fields when not provided', async () => {
            const metadata: RawObservationMetadata = {
                pipeline: 'test',
                timestamp: '2026-01-01T00:00:00.000Z',
            };
            const filename = await store.writeRaw('system', undefined, metadata, 'body');
            const filePath = path.join(tmpDir, 'system', 'raw', filename);
            const raw = await fs.readFile(filePath, 'utf-8');

            expect(raw).not.toContain('repo:');
            expect(raw).not.toContain('model:');
        });
    });

    // --- listRaw ---

    describe('listRaw', () => {
        it('returns sorted filenames newest first', async () => {
            const base: RawObservationMetadata = { pipeline: 'test', timestamp: '' };

            await store.writeRaw('system', undefined, { ...base, timestamp: '2026-01-01T00:00:00.000Z' }, 'first');
            await store.writeRaw('system', undefined, { ...base, timestamp: '2026-03-01T00:00:00.000Z' }, 'third');
            await store.writeRaw('system', undefined, { ...base, timestamp: '2026-02-01T00:00:00.000Z' }, 'second');

            const list = await store.listRaw('system', undefined);
            expect(list).toHaveLength(3);
            // Newest first
            expect(list[0]).toContain('2026-03-01');
            expect(list[1]).toContain('2026-02-01');
            expect(list[2]).toContain('2026-01-01');
        });

        it('returns empty array for missing directory', async () => {
            const list = await store.listRaw('system', undefined);
            expect(list).toEqual([]);
        });

        it('filters by level — system observations not returned at repo level', async () => {
            const hash = 'abcdef1234567890';
            const meta: RawObservationMetadata = { pipeline: 'p1', timestamp: '2026-01-01T00:00:00.000Z' };

            await store.writeRaw('system', undefined, meta, 'sys only');

            const repoList = await store.listRaw('repo', hash);
            expect(repoList).toEqual([]);

            const sysList = await store.listRaw('system', undefined);
            expect(sysList).toHaveLength(1);
        });
    });

    // --- deleteRaw ---

    describe('deleteRaw', () => {
        it('removes file and returns true', async () => {
            const meta: RawObservationMetadata = { pipeline: 'p', timestamp: '2026-01-01T00:00:00.000Z' };
            const filename = await store.writeRaw('system', undefined, meta, 'to delete');

            const deleted = await store.deleteRaw('system', undefined, filename);
            expect(deleted).toBe(true);

            const list = await store.listRaw('system', undefined);
            expect(list).toEqual([]);
        });

        it('returns false for non-existent file', async () => {
            const deleted = await store.deleteRaw('system', undefined, 'nope.md');
            expect(deleted).toBe(false);
        });

        it('deletes from both levels', async () => {
            const hash = store.computeRepoHash('/repo');
            const meta: RawObservationMetadata = { pipeline: 'p', timestamp: '2026-06-01T00:00:00.000Z' };
            const filename = await store.writeRaw('both', hash, meta, 'both');

            const deleted = await store.deleteRaw('both', hash, filename);
            expect(deleted).toBe(true);

            expect(await store.listRaw('system', undefined)).toEqual([]);
            expect(await store.listRaw('repo', hash)).toEqual([]);
        });

        it('leaves other files intact after deleting one', async () => {
            const meta1: RawObservationMetadata = { pipeline: 'a', timestamp: '2026-01-01T00:00:00.000Z' };
            const meta2: RawObservationMetadata = { pipeline: 'b', timestamp: '2026-02-01T00:00:00.000Z' };

            const fn1 = await store.writeRaw('system', undefined, meta1, 'keep');
            const fn2 = await store.writeRaw('system', undefined, meta2, 'delete');

            await store.deleteRaw('system', undefined, fn2);

            const list = await store.listRaw('system', undefined);
            expect(list).toEqual([fn1]);
        });
    });

    // --- Filename sanitization ---

    describe('filename sanitization', () => {
        it('sanitizes special characters in pipeline ID', async () => {
            const meta: RawObservationMetadata = {
                pipeline: 'my/pipeline:v2',
                timestamp: '2026-01-01T00:00:00.000Z',
            };
            const filename = await store.writeRaw('system', undefined, meta, 'body');

            expect(filename).not.toContain('/');
            expect(filename).not.toContain(':');
            expect(filename).toContain('my_pipeline_v2');
        });
    });

    // --- Concurrent writes ---

    describe('concurrent writes', () => {
        it('serializes multiple concurrent writes without corruption', async () => {
            const promises: Promise<string>[] = [];
            for (let i = 0; i < 10; i++) {
                const meta: RawObservationMetadata = {
                    pipeline: `pipeline-${i}`,
                    timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
                };
                promises.push(store.writeRaw('system', undefined, meta, `content-${i}`));
            }
            const filenames = await Promise.all(promises);

            expect(new Set(filenames).size).toBe(10);

            const list = await store.listRaw('system', undefined);
            expect(list).toHaveLength(10);

            // Verify each file is readable without parse errors
            for (const fn of filenames) {
                const obs = await store.readRaw('system', undefined, fn);
                expect(obs).toBeDefined();
            }
        });
    });

    // --- Default dataDir ---

    describe('default dataDir', () => {
        it('defaults to ~/.coc/memory', () => {
            const defaultStore = new FileMemoryStore();
            expect(defaultStore.getSystemDir()).toBe(
                path.join(os.homedir(), '.coc', 'memory', 'system'),
            );
        });
    });
});
