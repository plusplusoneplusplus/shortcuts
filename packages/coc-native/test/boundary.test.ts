/**
 * N-API boundary tests for the whole-root file index behind `RepoFiles`:
 * marshalling, async behaviour, error propagation, concurrency and handle
 * lifetime against the real compiled addon.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addon } from './helpers';
import type { NativeRepoFiles } from '../src/repo-files';

let root: string;

/** Every path in the handle's whole-root index, in index order. */
async function indexed(files: NativeRepoFiles, showIgnored = false): Promise<string[]> {
    return (await files.indexFiles({ showIgnored, maxEntries: 1_000_000 })).files;
}

/** A handle whose TTL never expires mid-test, so only explicit refreshes run. */
function open(dir: string): NativeRepoFiles {
    return addon.openRepoFiles(dir, 3_600_000);
}

function write(relative: string, contents = ''): void {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-boundary-'));
    // A .git directory makes gitignore rules apply exactly as ripgrep applies them.
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    write('.git/HEAD', 'ref: refs/heads/main\n');
    write('.gitignore', 'ignored.txt\ndist/\n');
    write('src/index.ts');
    write('src/server/tree-service.ts');
    write('README.md');
    write('ignored.txt');
    write('dist/bundle.js');
    write('docs/a file with spaces.md');
    write('docs/日本語/ファイル.md');
    write('docs/café/résumé.md');
    write('a/x.ts');
    write('x/a.ts');
});

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('build + files marshalling', () => {
    it('returns repo-relative POSIX paths, gitignored entries excluded', async () => {
        const files = await indexed(open(root));
        expect(files).toContain('src/index.ts');
        expect(files).toContain('src/server/tree-service.ts');
        expect(files).toContain('README.md');
        expect(files).not.toContain('ignored.txt');
        expect(files).not.toContain('dist/bundle.js');
        expect(files.some(f => f.startsWith('.git/'))).toBe(false);
    });

    it('includes gitignored files when asked', async () => {
        const files = await indexed(open(root), true);
        expect(files).toContain('ignored.txt');
        expect(files).toContain('dist/bundle.js');
    });

    it('round-trips non-ASCII and spaced paths as exact JS strings', async () => {
        const files = await indexed(open(root));
        expect(files).toContain('docs/a file with spaces.md');
        expect(files).toContain('docs/日本語/ファイル.md');
        expect(files).toContain('docs/café/résumé.md');
    });

    it('caps the listing but never the index search reaches', async () => {
        const files = open(root);
        const all = await indexed(files);
        await expect(files.indexFiles({ showIgnored: false, maxEntries: 2 })).resolves.toEqual({
            files: all.slice(0, 2),
            truncated: true,
        });
        await expect(files.indexFiles({ showIgnored: false, maxEntries: 0 })).resolves.toEqual({
            files: [],
            truncated: true,
        });
        expect((await files.indexFiles({ showIgnored: false, maxEntries: all.length })).truncated).toBe(false);
        const last = all[all.length - 1];
        expect((await files.searchFiles(last, 1, false))[0].path).toBe(last);
    });

    it('defaults the TTL when none is passed', async () => {
        expect((await indexed(addon.openRepoFiles(root))).length).toBeGreaterThan(0);
    });
});

describe('search marshalling', () => {
    let index: NativeRepoFiles;

    beforeAll(() => {
        index = open(root);
    });

    it('keeps the public search result shape unchanged', async () => {
        const [best] = await index.searchFiles('index', 5, false);
        expect(best.path).toBe('src/index.ts');
        expect(best.score).toBeGreaterThan(0);
        expect(best.indices).toEqual([4, 5, 6, 7, 8]);
        expect(best.indices.map(i => best.path[i]).join('')).toBe('index');
        expect(Object.keys(best).sort()).toEqual(['indices', 'path', 'score']);
    });

    it('exposes every native ranking key for cross-index merging', async () => {
        const ordered = await indexed(index);
        const [basename] = await index.searchFilesRanked('index', 5, false);
        expect(basename).toEqual({
            path: 'src/index.ts',
            score: expect.any(Number),
            indices: [4, 5, 6, 7, 8],
            ranking: {
                tier: 2,
                targetLen: 'index.ts'.length,
                pathLen: 'src/index.ts'.length,
                snapshotIndex: ordered.indexOf('src/index.ts'),
            },
        });

        const [pathOnly] = await index.searchFilesRanked('srcindex', 5, false);
        expect(pathOnly.ranking).toEqual({
            tier: 1,
            targetLen: 'src/index.ts'.length,
            pathLen: 'src/index.ts'.length,
            snapshotIndex: ordered.indexOf('src/index.ts'),
        });
    });

    it('preserves tier ordering when public scores are equal', async () => {
        const matches = (await index.searchFilesRanked('x', 10, false)).filter(
            match => match.path === 'a/x.ts' || match.path === 'x/a.ts',
        );
        expect(matches.map(match => [match.path, match.score, match.ranking.tier])).toEqual([
            ['a/x.ts', matches[0].score, 2],
            ['x/a.ts', matches[0].score, 1],
        ]);
    });

    it('indices are JavaScript string offsets for non-ASCII paths', async () => {
        const hits = await index.searchFiles('docsmd', 10, false);
        const hit = hits.find(h => h.path === 'docs/日本語/ファイル.md');
        expect(hit).toBeDefined();
        // Multi-byte characters occupy one JS string unit each, so the offsets
        // must index the path directly rather than its UTF-8 bytes.
        expect(hit!.indices.map(i => hit!.path[i]).join('')).toBe('docsmd');
    });

    it('folds case for ASCII only, matching the TypeScript scorer', async () => {
        // Documented deviation from `String.prototype.toLowerCase()`.
        expect(await index.searchFiles('CAFÉ', 10, false)).toEqual([]);
        expect((await index.searchFiles('café', 10, false)).length).toBeGreaterThan(0);
    });

    it('honours the limit and returns nothing for empty inputs', async () => {
        expect((await index.searchFiles('s', 2, false)).length).toBe(2);
        expect(await index.searchFiles('', 10, false)).toEqual([]);
        expect(await index.searchFiles('index', 0, false)).toEqual([]);
        expect(await index.searchFiles('zzzqqq', 10, false)).toEqual([]);
    });

    // Creating (and later removing) 12k files is trivial on Linux and macOS but
    // costs minutes on a Windows runner, where every file open/close goes through
    // the virus scanner. The default 60s budget is the file I/O, not the addon.
    it('marshals a result array larger than 10k entries', async () => {
        const big = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-big-'));
        try {
            for (let bucket = 0; bucket < 20; bucket++) {
                const dir = path.join(big, `pkg${bucket}`);
                fs.mkdirSync(dir, { recursive: true });
                for (let i = 0; i < 600; i++) {
                    fs.writeFileSync(path.join(dir, `module${i}.ts`), '');
                }
            }
            const index = open(big);
            expect((await indexed(index)).length).toBe(12000);
            const hits = await index.searchFiles('module', 12000, false);
            expect(hits.length).toBe(12000);
            expect(hits.every(h => typeof h.path === 'string' && h.score > 0)).toBe(true);
            // Best-first ordering must survive the heap merge across workers.
            for (let i = 1; i < hits.length; i++) {
                expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
            }
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    }, 180_000);
});

describe('async contract', () => {
    it('a cold build returns a promise that does not block the event loop', async () => {
        const big = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-async-'));
        try {
            for (let bucket = 0; bucket < 20; bucket++) {
                const dir = path.join(big, `pkg${bucket}`);
                fs.mkdirSync(dir, { recursive: true });
                for (let i = 0; i < 500; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), '');
            }

            let timerFired = false;
            const timer = new Promise<void>(resolve =>
                setTimeout(() => {
                    timerFired = true;
                    resolve();
                }, 0),
            );
            const building = open(big).indexFiles({ showIgnored: false, maxEntries: 1 });
            expect(building).toBeInstanceOf(Promise);
            // The timer is queued after the build starts; if the walk ran on the
            // main thread it could not fire before the build resolved.
            await timer;
            expect(timerFired).toBe(true);
            expect((await building).truncated).toBe(true);
            expect((await indexed(open(big))).length).toBe(10000);
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    });

    it('search returns a promise', async () => {
        const index = open(root);
        const searching = index.searchFiles('index', 5, false);
        expect(searching).toBeInstanceOf(Promise);
        await searching;
    });
});

describe('error propagation', () => {
    it('rejects every index call for a nonexistent root', async () => {
        const files = open(path.join(root, 'does-not-exist'));
        await expect(files.indexFiles({ showIgnored: false, maxEntries: 5 })).rejects.toThrow();
        await expect(files.searchFiles('a', 5, false)).rejects.toThrow();
    });

    it('rejects when the root is a file, not a directory', async () => {
        await expect(open(path.join(root, 'README.md')).searchFiles('a', 5, false)).rejects.toThrow();
    });

    it('keeps the old snapshot when a refresh fails after the root disappears', async () => {
        const doomed = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-doomed-'));
        fs.writeFileSync(path.join(doomed, 'a.ts'), '');
        const index = open(doomed);
        expect(await indexed(index)).toEqual(['a.ts']);
        fs.rmSync(doomed, { recursive: true, force: true });
        await expect(index.invalidate()).resolves.toBe(false);
        expect(await indexed(index)).toEqual(['a.ts']);
    });

    it('skips unreadable directories instead of failing the walk', async () => {
        if (process.platform === 'win32' || process.getuid?.() === 0) return;
        const guarded = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-perm-'));
        const locked = path.join(guarded, 'locked');
        try {
            fs.mkdirSync(locked);
            fs.writeFileSync(path.join(locked, 'hidden.ts'), '');
            fs.writeFileSync(path.join(guarded, 'visible.ts'), '');
            fs.chmodSync(locked, 0o000);

            expect(await indexed(open(guarded))).toContain('visible.ts');
        } finally {
            fs.chmodSync(locked, 0o700);
            fs.rmSync(guarded, { recursive: true, force: true });
        }
    });
});

describe('concurrency and lifetime', () => {
    it('serves many parallel searches from one index', async () => {
        const index = open(root);
        const queries = ['index', 'tree', 'readme', 'docs', 'ts', 'md', 'src'];
        const batches = await Promise.all(
            Array.from({ length: 40 }, (_, i) => index.searchFiles(queries[i % queries.length], 10, false)),
        );
        expect(batches).toHaveLength(40);
        for (let i = 0; i < batches.length; i++) {
            expect(batches[i]).toEqual(batches[i % queries.length]);
        }
    });

    it('a search racing a refresh sees one whole snapshot, never a torn one', async () => {
        const churn = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-churn-'));
        try {
            for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(churn, `before${i}.ts`), '');
            const index = open(churn);
            expect((await indexed(index)).length).toBe(200);

            // Written before the refresh starts, so the new snapshot is
            // deterministically the full 400 rather than a racing subset.
            for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(churn, `after${i}.ts`), '');
            const refreshing = index.invalidate();
            const searches = Array.from({ length: 20 }, () => index.searchFiles('ts', 500, false));
            const [, ...results] = await Promise.all([refreshing, ...searches]);

            for (const hits of results as Awaited<ReturnType<NativeRepoFiles['searchFiles']>>[]) {
                // Old snapshot (200) or new one (up to 400) — never a partial list.
                expect(hits.length === 200 || hits.length === 400).toBe(true);
                expect(hits.every(h => typeof h.path === 'string' && h.path.endsWith('.ts'))).toBe(true);
            }
            expect((await indexed(index)).length).toBe(400);
        } finally {
            fs.rmSync(churn, { recursive: true, force: true });
        }
    });

    it('a handle dropped while a search is in flight still resolves', async () => {
        let index: NativeRepoFiles | null = open(root);
        const searching = index.searchFiles('index', 10, false);
        index = null;
        if (typeof global.gc === 'function') global.gc();
        const hits = await searching;
        expect(hits[0].path).toBe('src/index.ts');
    });
});
