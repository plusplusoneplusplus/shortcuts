/**
 * RepoTreeService against both scorers.
 *
 * Every behavioural test here runs twice — once with the native addon forced
 * off, once with the real one — and the two must produce the same responses.
 * That is the whole safety argument for shipping a native fast path: a machine
 * without a binary must not behave differently, only slower.
 *
 * The native lane skips (loudly) when no binary is built, so this suite stays
 * meaningful on a machine with no Rust toolchain.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadNativeFileIndex, nativeFileIndexStatus } from '@plusplusoneplusplus/coc-native';
import type { NativeFileIndexAddon } from '@plusplusoneplusplus/coc-native';
import { RepoTreeService } from '../../src/server/repos/tree-service';

const NATIVE = loadNativeFileIndex();
if (!NATIVE) {
    // eslint-disable-next-line no-console
    console.warn(
        `[coc] native file index not loaded (${nativeFileIndexStatus().reason}); ` +
            'running the fallback lane only.',
    );
}

const GIT = (() => {
    try {
        childProcess.execSync('git --version', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
})();

const MODES: Array<{ name: string; addon: NativeFileIndexAddon | null; skip: boolean }> = [
    { name: 'javascript fallback', addon: null, skip: !GIT },
    { name: 'native addon', addon: NATIVE, skip: !NATIVE || !GIT },
];

const REPO_ID = 'test-repo-id';

let tmpDir: string;
let dataDir: string;
let repoDir: string;

/**
 * A real git repository: both paths only apply gitignore rules inside one — the
 * JS path shells out to `git check-ignore`, and the walker crate requires a git
 * directory for the same reason. A hand-made `.git` folder is not enough.
 */
function seedRepo(): void {
    fs.mkdirSync(repoDir, { recursive: true });
    childProcess.execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(
        path.join(dataDir, 'workspaces.json'),
        JSON.stringify([{ id: REPO_ID, name: 'test-repo', rootPath: repoDir }], null, 2),
        'utf-8',
    );
}

function write(relative: string, contents = 'x'): void {
    const target = path.join(repoDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-tree-native-'));
    dataDir = path.join(tmpDir, 'data');
    repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

for (const mode of MODES) {
    const suite = mode.skip ? describe.skip : describe;

    suite(`RepoTreeService — ${mode.name}`, () => {
        function newService(options?: { fileListCacheTtlMs?: number; fileListMaxEntries?: number }) {
            return new RepoTreeService(dataDir, {
                fileListCacheTtlMs: 60_000,
                nativeFileIndex: mode.addon,
                ...options,
            });
        }

        it('lists whole-repo files as repo-relative POSIX paths', async () => {
            seedRepo();
            write('src/index.ts');
            write('src/server/tree-service.ts');
            write('README.md');

            const { files } = await newService().listFilesRecursive(REPO_ID, '.');
            expect(files).toContain('src/index.ts');
            expect(files).toContain('src/server/tree-service.ts');
            expect(files).toContain('README.md');
            expect(files.every(f => !f.startsWith('/') && !f.includes('\\'))).toBe(true);
        });

        it('excludes gitignored files unless showIgnored is set', async () => {
            seedRepo();
            write('.gitignore', 'ignored.ts\ndist/\n');
            write('kept.ts');
            write('ignored.ts');
            write('dist/bundle.js');
            const svc = newService();

            const hidden = await svc.listFilesRecursive(REPO_ID, '.', { showIgnored: false });
            expect(hidden.files).toContain('kept.ts');
            expect(hidden.files).not.toContain('ignored.ts');
            expect(hidden.files).not.toContain('dist/bundle.js');

            const shown = await svc.listFilesRecursive(REPO_ID, '.', { showIgnored: true });
            expect(shown.files).toContain('ignored.ts');
            expect(shown.files).toContain('dist/bundle.js');
        });

        it('ranks search results best-first with match indices', async () => {
            seedRepo();
            write('src/index.ts');
            write('test/index.test.ts');
            write('README.md');

            const result = await newService().searchFiles(REPO_ID, 'index');
            expect(result.results.map(r => r.path)).toEqual(['src/index.ts', 'test/index.test.ts']);
            for (const match of result.results) {
                expect(match.score).toBeGreaterThan(0);
                expect(match.indices.map(i => match.path[i].toLowerCase()).join('')).toBe('index');
                expect(match.indices).toEqual([...match.indices].sort((a, b) => a - b));
            }
        });

        it('applies and clamps the search limit', async () => {
            seedRepo();
            for (let i = 0; i < 10; i++) write(`file${i}.ts`);
            const svc = newService();

            expect((await svc.searchFiles(REPO_ID, 'file', { limit: 3 })).results).toHaveLength(3);
            // 0 clamps up to 1, not down to nothing.
            expect((await svc.searchFiles(REPO_ID, 'file', { limit: 0 })).results).toHaveLength(1);
            expect((await svc.searchFiles(REPO_ID, 'file', { limit: 999 })).results).toHaveLength(10);
        });

        it('returns nothing for a query that matches nothing', async () => {
            seedRepo();
            write('src/index.ts');
            expect((await newService().searchFiles(REPO_ID, 'zzzqqqwww')).results).toEqual([]);
        });

        it('makes a file written through writeBlob immediately searchable', async () => {
            seedRepo();
            write('first.ts');
            const svc = newService();

            await svc.searchFiles(REPO_ID, 'first');
            await svc.writeBlob(REPO_ID, 'created.ts', 'x');

            const result = await svc.searchFiles(REPO_ID, 'created');
            expect(result.results.map(r => r.path)).toContain('created.ts');
        });

        it('keys indexes on showIgnored so the two variants do not share one', async () => {
            seedRepo();
            write('.gitignore', 'ignored.ts\n');
            write('ignored.ts');
            write('kept.ts');
            const svc = newService();

            const hidden = await svc.searchFiles(REPO_ID, 'ignored', { showIgnored: false });
            const shown = await svc.searchFiles(REPO_ID, 'ignored', { showIgnored: true });
            expect(hidden.results.map(r => r.path)).toEqual([]);
            expect(shown.results.map(r => r.path)).toContain('ignored.ts');

            // Re-reading each variant must not have polluted the other.
            const hiddenAgain = await svc.searchFiles(REPO_ID, 'ignored', { showIgnored: false });
            expect(hiddenAgain.results.map(r => r.path)).toEqual([]);
        });

        it('picks up files created outside writeBlob once the TTL lapses', async () => {
            seedRepo();
            write('first.ts');
            const svc = newService({ fileListCacheTtlMs: 0 });

            await svc.listFilesRecursive(REPO_ID, '.');
            write('second.ts');

            // A stale read triggers a background refresh; the next reads observe it.
            const deadline = Date.now() + 10_000;
            let files: string[] = [];
            while (Date.now() < deadline) {
                files = (await svc.listFilesRecursive(REPO_ID, '.')).files;
                if (files.includes('second.ts')) break;
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            expect(files).toContain('second.ts');
        });

        it('reports a missing repo as an error rather than an empty result', async () => {
            seedRepo();
            await expect(newService().searchFiles('no-such-repo', 'index')).rejects.toThrow(
                /Repo not found/,
            );
        });

        it('serves concurrent cold callers without duplicating work or diverging', async () => {
            seedRepo();
            for (let i = 0; i < 25; i++) write(`src/file${i}.ts`);
            const svc = newService();

            const results = await Promise.all(
                Array.from({ length: 8 }, () => svc.searchFiles(REPO_ID, 'file')),
            );
            for (const result of results) {
                expect(result.results.map(r => r.path)).toEqual(results[0].results.map(r => r.path));
            }
        });

        it('leaves per-directory listings uncached and unaffected', async () => {
            seedRepo();
            write('src/a.ts');
            const svc = newService();

            await svc.listFilesRecursive(REPO_ID, 'src');
            write('src/b.ts');
            expect((await svc.listFilesRecursive(REPO_ID, 'src')).files).toContain('src/b.ts');
        });
    });
}

const nativeOnly = NATIVE && GIT ? describe : describe.skip;

nativeOnly('RepoTreeService — native and fallback agree', () => {
    function bothServices() {
        return {
            fallback: new RepoTreeService(dataDir, { fileListCacheTtlMs: 60_000, nativeFileIndex: null }),
            native: new RepoTreeService(dataDir, { fileListCacheTtlMs: 60_000, nativeFileIndex: NATIVE }),
        };
    }

    it('returns identical search responses for the same repo and queries', async () => {
        seedRepo();
        const names = ['index', 'tree-service', 'repo_routes', 'README', 'Quick.Open', 'a b'];
        for (const dir of ['src', 'src/server', 'test', 'docs']) {
            for (const name of names) write(`${dir}/${name}.ts`);
        }
        const { fallback, native } = bothServices();

        for (const query of ['index', 'tree', 'INDEX', 'srcindex', 'q', 'zzz', 'ts', 'docsreadme']) {
            const a = await fallback.searchFiles(REPO_ID, query, { limit: 20 });
            const b = await native.searchFiles(REPO_ID, query, { limit: 20 });
            expect(b.results).toEqual(a.results);
        }
    });

    it('returns the same whole-repo file set', async () => {
        seedRepo();
        write('.gitignore', 'ignored.ts\n');
        write('src/index.ts');
        write('ignored.ts');
        write('docs/日本語.md');
        const { fallback, native } = bothServices();

        const a = await fallback.listFilesRecursive(REPO_ID, '.');
        const b = await native.listFilesRecursive(REPO_ID, '.');
        expect(new Set(b.files)).toEqual(new Set(a.files));
    });

    it('searches past the payload cap that bounds the /files response', async () => {
        seedRepo();
        for (let i = 0; i < 30; i++) write(`src/file${String(i).padStart(2, '0')}.ts`);
        const svc = new RepoTreeService(dataDir, {
            fileListMaxEntries: 5,
            nativeFileIndex: NATIVE,
        });

        // The listing is capped for the response...
        const listed = await svc.listFilesRecursive(REPO_ID, '.');
        expect(listed.files).toHaveLength(5);
        expect(listed.truncated).toBe(true);

        // ...but the index kept every path, so search still reaches the tail.
        const found = await svc.searchFiles(REPO_ID, 'file29');
        expect(found.results.map(r => r.path)).toContain('src/file29.ts');
        expect(found.truncated).toBe(false);
    });
});
