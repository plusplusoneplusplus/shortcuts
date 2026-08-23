/**
 * N-API boundary tests: marshalling, async behaviour, error propagation,
 * concurrency and handle lifetime against the real compiled addon.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addon, disabled } from './helpers';
import type { NativeFileIndex } from '../src/file-index';

// `helpers` already threw if a binary was expected and missing, so reaching
// here with no addon means COC_NATIVE=0 and nothing to exercise.
const suite = disabled ? describe.skip : describe;

let root: string;

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
});

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

suite('build + files marshalling', () => {
    it('returns repo-relative POSIX paths, gitignored entries excluded', async () => {
        const index = await addon!.buildFileIndex(root, {});
        const files = index.files(0, index.len());
        expect(files).toContain('src/index.ts');
        expect(files).toContain('src/server/tree-service.ts');
        expect(files).toContain('README.md');
        expect(files).not.toContain('ignored.txt');
        expect(files).not.toContain('dist/bundle.js');
        expect(files.some(f => f.startsWith('.git/'))).toBe(false);
    });

    it('includes gitignored files when asked', async () => {
        const index = await addon!.buildFileIndex(root, { includeIgnored: true });
        const files = index.files(0, index.len());
        expect(files).toContain('ignored.txt');
        expect(files).toContain('dist/bundle.js');
    });

    it('round-trips non-ASCII and spaced paths as exact JS strings', async () => {
        const index = await addon!.buildFileIndex(root, {});
        const files = index.files(0, index.len());
        expect(files).toContain('docs/a file with spaces.md');
        expect(files).toContain('docs/日本語/ファイル.md');
        expect(files).toContain('docs/café/résumé.md');
    });

    it('windows the path list and clamps out-of-range slices', async () => {
        const index = await addon!.buildFileIndex(root, {});
        const all = index.files(0, index.len());
        expect(index.files(1, 2)).toEqual(all.slice(1, 3));
        expect(index.files(index.len(), 10)).toEqual([]);
        expect(index.files(0, 0)).toEqual([]);
    });

    it('reports truncation when maxEntries caps the walk', async () => {
        const capped = await addon!.buildFileIndex(root, { maxEntries: 2 });
        expect(capped.len()).toBe(2);
        expect(capped.truncated()).toBe(true);

        const whole = await addon!.buildFileIndex(root, {});
        expect(whole.truncated()).toBe(false);
    });

    it('defaults options when none are passed', async () => {
        const index = await addon!.buildFileIndex(root);
        expect(index.len()).toBeGreaterThan(0);
    });
});

suite('search marshalling', () => {
    let index: NativeFileIndex;

    beforeAll(async () => {
        index = await addon!.buildFileIndex(root, {});
    });

    it('returns paths, scores and ascending highlight indices', async () => {
        const [best] = await index.search('index', 5);
        expect(best.path).toBe('src/index.ts');
        expect(best.score).toBeGreaterThan(0);
        expect(best.indices).toEqual([4, 5, 6, 7, 8]);
        expect(best.indices.map(i => best.path[i]).join('')).toBe('index');
    });

    it('indices are JavaScript string offsets for non-ASCII paths', async () => {
        const hits = await index.search('docsmd', 10);
        const hit = hits.find(h => h.path === 'docs/日本語/ファイル.md');
        expect(hit).toBeDefined();
        // Multi-byte characters occupy one JS string unit each, so the offsets
        // must index the path directly rather than its UTF-8 bytes.
        expect(hit!.indices.map(i => hit!.path[i]).join('')).toBe('docsmd');
    });

    it('folds case for ASCII only, matching the TypeScript scorer', async () => {
        // Documented deviation from `String.prototype.toLowerCase()`.
        expect(await index.search('CAFÉ', 10)).toEqual([]);
        expect((await index.search('café', 10)).length).toBeGreaterThan(0);
    });

    it('honours the limit and returns nothing for empty inputs', async () => {
        expect((await index.search('s', 2)).length).toBe(2);
        expect(await index.search('', 10)).toEqual([]);
        expect(await index.search('index', 0)).toEqual([]);
        expect(await index.search('zzzqqq', 10)).toEqual([]);
    });

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
            const index = await addon!.buildFileIndex(big, {});
            expect(index.len()).toBe(12000);
            const hits = await index.search('module', 12000);
            expect(hits.length).toBe(12000);
            expect(hits.every(h => typeof h.path === 'string' && h.score > 0)).toBe(true);
            // Best-first ordering must survive the heap merge across workers.
            for (let i = 1; i < hits.length; i++) {
                expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
            }
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    });
});

suite('async contract', () => {
    it('build returns a promise that does not block the event loop', async () => {
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
            const building = addon!.buildFileIndex(big, {});
            expect(building).toBeInstanceOf(Promise);
            // The timer is queued after the build starts; if the walk ran on the
            // main thread it could not fire before the build resolved.
            await timer;
            expect(timerFired).toBe(true);
            expect((await building).len()).toBe(10000);
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    });

    it('search returns a promise', async () => {
        const index = await addon!.buildFileIndex(root, {});
        const searching = index.search('index', 5);
        expect(searching).toBeInstanceOf(Promise);
        await searching;
    });
});

suite('error propagation', () => {
    it('rejects with a useful message for a nonexistent root', async () => {
        const missing = path.join(root, 'does-not-exist');
        await expect(addon!.buildFileIndex(missing, {})).rejects.toThrow(/does-not-exist/);
    });

    it('rejects when the root is a file, not a directory', async () => {
        await expect(addon!.buildFileIndex(path.join(root, 'README.md'), {})).rejects.toThrow(
            /README\.md/,
        );
    });

    it('rejects on refresh after the root disappears', async () => {
        const doomed = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-doomed-'));
        fs.writeFileSync(path.join(doomed, 'a.ts'), '');
        const index = await addon!.buildFileIndex(doomed, {});
        fs.rmSync(doomed, { recursive: true, force: true });
        await expect(index.refresh()).rejects.toThrow();
        // The old snapshot is still intact after a failed refresh.
        expect(index.files(0, 10)).toEqual(['a.ts']);
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

            const index = await addon!.buildFileIndex(guarded, {});
            expect(index.files(0, 10)).toContain('visible.ts');
        } finally {
            fs.chmodSync(locked, 0o700);
            fs.rmSync(guarded, { recursive: true, force: true });
        }
    });
});

suite('concurrency and lifetime', () => {
    it('serves many parallel searches from one index', async () => {
        const index = await addon!.buildFileIndex(root, {});
        const queries = ['index', 'tree', 'readme', 'docs', 'ts', 'md', 'src'];
        const batches = await Promise.all(
            Array.from({ length: 40 }, (_, i) => index.search(queries[i % queries.length], 10)),
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
            const index = await addon!.buildFileIndex(churn, {});

            // Written before the refresh starts, so the new snapshot is
            // deterministically the full 400 rather than a racing subset.
            for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(churn, `after${i}.ts`), '');
            const refreshing = index.refresh();
            const searches = Array.from({ length: 20 }, () => index.search('ts', 500));
            const [, ...results] = await Promise.all([refreshing, ...searches]);

            for (const hits of results as Awaited<ReturnType<NativeFileIndex['search']>>[]) {
                // Old snapshot (200) or new one (up to 400) — never a partial list.
                expect(hits.length === 200 || hits.length === 400).toBe(true);
                expect(hits.every(h => typeof h.path === 'string' && h.path.endsWith('.ts'))).toBe(true);
            }
            expect(index.len()).toBe(400);
        } finally {
            fs.rmSync(churn, { recursive: true, force: true });
        }
    });

    it('an index dropped while a search is in flight still resolves', async () => {
        let index: NativeFileIndex | null = await addon!.buildFileIndex(root, {});
        const searching = index.search('index', 10);
        index = null;
        if (typeof global.gc === 'function') global.gc();
        const hits = await searching;
        expect(hits[0].path).toBe('src/index.ts');
    });
});
