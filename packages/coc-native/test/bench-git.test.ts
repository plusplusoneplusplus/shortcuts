/**
 * The git benchmark, and the thing a benchmark can get quietly wrong.
 *
 * A comparison only means something when both sides answer the same question.
 * The legacy half of `bench-git.mjs` is a reimplementation — the TypeScript it
 * replays was deleted — so the load-bearing tests here are the differential
 * ones: for every case where a comparison is well defined, the legacy path and
 * the native path are run against a real repository and their answers checked
 * against each other. A baseline that does less work would read as a speed-up.
 *
 * The rest pin the statistics, the verdict rule and the flags, because those
 * decide whether a regression is reported or explained away.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { removeDir } from './helpers';

// @ts-expect-error — a .mjs benchmark script with no type declarations.
import {
    benchRepo,
    CASES,
    createSmallRepo,
    describeRepo,
    formatEventLoop,
    formatTable,
    legacyBranchPage,
    legacyNoIndexDiff,
    legacyParseCommitFiles,
    legacyParseCommitLine,
    legacyParsePorcelain,
    legacyParseRangeFiles,
    legacyRewriteNoIndexHeaders,
    parseArgs,
    speedup,
    summarize,
    verdict,
} from '../scripts/bench-git.mjs';
import { loadNativeGit } from '../src/git';

describe('parseArgs', () => {
    it('defaults to both repositories, 20 iterations and a 5% tolerance', () => {
        const options = parseArgs([]);
        expect(options).toMatchObject({
            repos: [], iterations: 20, warmup: 3, tolerance: 0.05,
            only: null, small: true, large: true, eventLoop: true, json: false, check: false,
        });
    });

    it('reads every flag', () => {
        const options = parseArgs([
            '--iterations', '7', '--warmup', '1', '--tolerance', '0.2',
            '--only', 'repo-root, remote-url', '--small-commits', '5',
            '--no-small', '--no-large', '--no-event-loop', '--json', '--check',
        ]);
        expect(options).toMatchObject({
            iterations: 7, warmup: 1, tolerance: 0.2, only: ['repo-root', 'remote-url'],
            smallCommits: 5, small: false, large: false, eventLoop: false, json: true, check: true,
        });
    });

    it('resolves --repo to an absolute path and accepts it more than once', () => {
        const options = parseArgs(['--repo', '.', '--repo', '/tmp']);
        expect(options.repos).toHaveLength(2);
        expect(options.repos.every((repo: string) => path.isAbsolute(repo))).toBe(true);
    });

    it('rejects an unknown flag, a valueless flag and a non-positive iteration count', () => {
        expect(() => parseArgs(['--nope'])).toThrow(/unknown option --nope/);
        expect(() => parseArgs(['--iterations'])).toThrow(/needs a value/);
        expect(() => parseArgs(['--iterations', '0'])).toThrow(/positive/);
    });

    it('rejects an unknown case id and names the ones that exist', () => {
        expect(() => parseArgs(['--only', 'not-a-case'])).toThrow(/unknown case not-a-case/);
        expect(() => parseArgs(['--only', 'not-a-case'])).toThrow(/repo-root/);
    });
});

describe('summarize', () => {
    it('takes the middle of an odd sample set and the mean of the two middles of an even one', () => {
        expect(summarize([3, 1, 2]).median).toBe(2);
        expect(summarize([4, 1, 2, 3]).median).toBe(2.5);
    });

    it('reports mean, range and count', () => {
        expect(summarize([1, 2, 6])).toMatchObject({ mean: 3, min: 1, max: 6, samples: 3 });
    });
});

describe('speedup', () => {
    it('is above 1 when native is faster and below when it is slower', () => {
        expect(speedup(10, 5)).toBe(2);
        expect(speedup(5, 10)).toBe(0.5);
        expect(speedup(1, 0)).toBe(Infinity);
    });
});

describe('verdict', () => {
    const result = (id: string, gated: boolean, legacyMs: number, nativeMs: number) => ({
        case: { id, gated }, legacy: { median: legacyMs }, native: { median: nativeMs },
    });

    it('passes a case that is faster and one that is slower only within the tolerance', () => {
        const outcome = verdict([result('fast', true, 10, 2), result('parity', true, 10, 10.4)], 0.05);
        expect(outcome.ok).toBe(true);
        expect(outcome.regressions).toHaveLength(0);
    });

    it('fails a gated case beyond the tolerance and names it', () => {
        const outcome = verdict([result('slow', true, 10, 12)], 0.05);
        expect(outcome.ok).toBe(false);
        expect(outcome.regressions.map((r: { case: { id: string } }) => r.case.id)).toEqual(['slow']);
    });

    it('never gates an ungated case, however slow it is', () => {
        const outcome = verdict([result('informational', false, 10, 1000)], 0.05);
        expect(outcome.ok).toBe(true);
        expect(outcome.gatedCount).toBe(0);
    });

    it('counts a case as improved only from 1.1x', () => {
        const outcome = verdict([result('thin', true, 10, 9.5), result('real', true, 10, 9)], 0.05);
        expect(outcome.improved.map((r: { case: { id: string } }) => r.case.id)).toEqual(['real']);
    });
});

describe('the case table', () => {
    it('has unique ids and a runnable pair per case', () => {
        const ids = CASES.map((c: { id: string }) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const testCase of CASES) {
            expect(typeof testCase.legacy, testCase.id).toBe('function');
            expect(typeof testCase.native, testCase.id).toBe('function');
            expect(testCase.children, testCase.id).toBeGreaterThan(0);
            expect(typeof testCase.title, testCase.id).toBe('string');
        }
    });

    it('makes every ungated case say why it is ungated', () => {
        // Without this, a regression can be silenced by flipping one boolean.
        for (const testCase of CASES.filter((c: { gated: boolean }) => !c.gated)) {
            expect(testCase.note, testCase.id).toBeTruthy();
        }
    });

    it('covers the four operations AC-09 names', () => {
        const ids = CASES.map((c: { id: string }) => c.id);
        expect(ids).toContain('working-tree-status');
        expect(ids).toContain('branch-list-100');
        expect(ids.some((id: string) => id.startsWith('commit-log-'))).toBe(true);
        expect(ids.some((id: string) => id.startsWith('range-'))).toBe(true);
    });
});

describe('formatting', () => {
    it('aligns the columns and marks an ungated case', () => {
        const table = formatTable('repo', [
            { case: { id: 'a', children: 1, gated: true }, legacy: { median: 1.5 }, native: { median: 0.5 }, speedup: 3 },
            { case: { id: 'bbbbb', children: 3, gated: false }, legacy: { median: 10 }, native: { median: 20 }, speedup: 0.5 },
        ]);
        expect(table).toContain('1.50 ms');
        expect(table).toContain('3.00x');
        expect(table).toContain('1 child');
        expect(table).toContain('3 children — ungated');
        const rows = table.split('\n').filter(line => line.startsWith('a ') || line.startsWith('bbbbb'));
        expect(rows[0].indexOf('1.50 ms')).toBe(rows[1].indexOf('10.00 ms'));
    });

    it('renders an error row instead of timings', () => {
        const table = formatTable('repo', [{ case: { id: 'a', children: 1, gated: true }, error: 'boom' }]);
        expect(table).toContain('boom');
    });

    it('says nothing when no case measured the event loop', () => {
        expect(formatEventLoop([{ case: { id: 'a' } }])).toBe('');
    });
});

describe('against a real repository', () => {
    let dir: string;
    let repo: { root: string; head: string };
    const git = loadNativeGit();

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-bench-git-test-'));
        repo = createSmallRepo(path.join(dir, 'repo'), { commits: 12, files: 8 });
    });

    afterAll(() => {
        removeDir(dir);
    });

    const run = (root: string, args: string[]) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();

    /** The legacy services rebuilt absolute paths with `path.join`; git and the
     *  addon both speak forward slashes. Compare in git's spelling. */
    const toPosix = (value: string) => value.split(path.sep).join('/');

    it('builds a fixture that can answer every case', () => {
        // Each of these is a precondition of some case: without them the case
        // measures a failure path and still reports a number.
        expect(run(repo.root, ['rev-parse', '--verify', 'origin/main'])).toMatch(/^[0-9a-f]{40}$/);
        expect(run(repo.root, ['rev-parse', '--abbrev-ref', 'main@{upstream}'])).toBe('origin/main');
        expect(run(repo.root, ['remote', 'get-url', 'origin'])).toContain('example.invalid');
        expect(run(repo.root, ['status', '--porcelain'])).toMatch(/\?\? untracked\.txt/);
        expect(run(repo.root, ['branch', '--list']).split('\n').length).toBeGreaterThan(10);
        expect(parseInt(run(repo.root, ['rev-list', '--count', 'origin/main..HEAD']), 10)).toBeGreaterThan(0);
    });

    it('describes the repository the header line reports', () => {
        const described = describeRepo(repo.root);
        expect(described.commits).toBe(12);
        expect(described.refs).toBeGreaterThan(12);
        expect(described.head).toBe(repo.head);
    });

    // ── the differential half ────────────────────────────────────────────────
    // Each case's two implementations, run for real and compared. The shapes
    // differ on purpose (the legacy services rebuilt absolute paths in Node and
    // the addon leaves that to the caller), so each comparison names the fields
    // that have to agree.

    const caseById = (id: string) => CASES.find((c: { id: string }) => c.id === id);

    it('working-tree-status: the same changes, in the same order', async () => {
        const testCase = caseById('working-tree-status');
        const legacy = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);
        expect(native.length).toBe(legacy.length);
        expect(native.map((e: { path: string }) => e.path))
            .toEqual(legacy.map((c: { filePath: string }) => toPosix(path.relative(repo.root, c.filePath))));
        expect(native.map((e: { status: string }) => e.status)).toEqual(legacy.map((c: { status: string }) => c.status));
        expect(native.map((e: { stage: string }) => e.stage)).toEqual(legacy.map((c: { stage: string }) => c.stage));
    });

    it('repository-status: the legacy porcelain names the branch the addon reports', async () => {
        const testCase = caseById('repository-status');
        const legacy: string = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);
        expect(legacy).toContain(`# branch.head ${native.branch}`);
        expect(native.dirty).toBe(true);
    });

    it('branch-status: the same branch, upstream and drift', async () => {
        const testCase = caseById('branch-status');
        const legacy = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);
        expect(native).toMatchObject({
            name: legacy.name, isDetached: legacy.isDetached,
            ahead: legacy.ahead, behind: legacy.behind, trackingBranch: legacy.trackingBranch,
        });
        expect(native.ahead).toBeGreaterThan(0);
    });

    it('branch-list-100: the same page and the same total', async () => {
        const testCase = caseById('branch-list-100');
        const legacy = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);
        expect(native.totalCount).toBe(legacy.totalCount);
        expect(native.branches.map((b: { name: string }) => b.name).sort())
            .toEqual(legacy.branches.map((b: { name: string }) => b.name).sort());
        expect(native.branches.filter((b: { isCurrent: boolean }) => b.isCurrent))
            .toHaveLength(legacy.branches.filter((b: { isCurrent: boolean }) => b.isCurrent).length);
    });

    it.each(['commit-log-1', 'commit-log-50', 'commit-log-200'])('%s: both sides read the same page', async id => {
        const testCase = caseById(id);
        const legacy = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);
        expect(native.commits.map((c: { hash: string }) => c.hash))
            .toEqual(legacy.commits.map((c: { hash: string }) => c.hash));
        expect(native.hasMore).toBe(legacy.hasMore);
        expect(native.commits[0].subject).toBe(legacy.commits[0].subject);
        expect(native.commits[0].authorName).toBe(legacy.commits[0].authorName);
        // Both agreeing on a wrong order would still pass the line above.
        const real = execFileSync('git', ['log', '-n', String(native.commits.length), '--format=%H'], { cwd: repo.root, encoding: 'utf-8' })
            .trim().split('\n');
        expect(native.commits.map((c: { hash: string }) => c.hash)).toEqual(real);
    });

    it('legacyBranchPage pages the same way with and without the shell pipeline', () => {
        // The cmd.exe branch never runs on this box, and it is where the paging
        // moves from `head` into JavaScript.
        const posix = legacyBranchPage(repo, 5, false);
        const windows = legacyBranchPage(repo, 5, true);
        expect(posix.branches).toHaveLength(5);
        // `lastCommitDate` is git's `%(committerdate:relative)`, re-evaluated on
        // each shell-out, so the two calls straddling a second boundary read
        // "0 seconds ago" and "1 second ago" off the same commit. Compare the
        // stable fields and assert the date is populated separately.
        type Branch = { name: string; isCurrent: boolean; isRemote: boolean; lastCommitSubject: string; lastCommitDate: string };
        const stable = ({ name, isCurrent, isRemote, lastCommitSubject }: Branch) =>
            ({ name, isCurrent, isRemote, lastCommitSubject });
        expect(windows.branches.map(stable)).toEqual(posix.branches.map(stable));
        for (const branch of [...posix.branches, ...windows.branches] as Branch[]) {
            expect(branch.lastCommitDate).not.toBe('');
        }
        expect(windows.totalCount).toBe(posix.totalCount);
        expect(windows.hasMore).toBe(true);
        expect(legacyBranchPage(repo, 500, true).hasMore).toBe(false);
    });

    it('commit-files: the same parent and the same files', async () => {
        const testCase = caseById('commit-files');
        const legacy = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);
        expect(native.parentHash).toBe(legacy.parentHash);
        const key = (f: { path: string; status: string; additions?: number; deletions?: number; originalPath?: string }) =>
            `${f.path}|${f.status}|${f.additions ?? '-'}|${f.deletions ?? '-'}|${f.originalPath ?? ''}`;
        expect(native.files.map(key).sort()).toEqual(legacy.files.map(key).sort());
        // The fixture renames a file in its last commit, so a side that dropped
        // the name-status child would show it as two `modified` rows.
        expect(native.files.some((f: { status: string }) => f.status === 'renamed')).toBe(true);
    });

    it('range-refs: the same base, merge base and commit count', async () => {
        const testCase = caseById('range-refs');
        const legacy = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);
        expect(native).toMatchObject({ baseRef: legacy.baseRef, mergeBase: legacy.mergeBase, commitCount: legacy.commitCount });
        expect(native.baseRef).toBe('origin/main');
    });

    it('range-full: the same files on top of the same refs', async () => {
        const testCase = caseById('range-full');
        const legacy = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);
        expect(native.baseRef).toBe(legacy.baseRef);
        expect(native.commitCount).toBe(legacy.commitCount);
        const key = (f: { path: string; status: string; additions: number; deletions: number; oldPath?: string }) =>
            `${f.path}|${f.status}|${f.additions}|${f.deletions}|${f.oldPath ?? ''}`;
        expect(native.files.map(key).sort()).toEqual(legacy.files.map(key).sort());
        expect(native.files.some((f: { status: string }) => f.status === 'renamed')).toBe(true);
        expect(native.stats.additions).toBeGreaterThan(0);
    });

    it('no-index-diff: the same rendering, minus the newline the boundary strips', async () => {
        const testCase = caseById('no-index-diff');
        const legacy = await testCase.legacy(repo);
        const native = await testCase.native(repo, git);

        // Everything that crosses the boundary loses exactly one trailing line
        // ending; the one production caller `.trimEnd()`s it away. Naming the
        // divergence here rather than trimming both sides keeps the comparison
        // able to see any other difference.
        expect(native).toBe(legacy.replace(/\r?\n$/, ''));
        expect(native.split('\n')[0]).toBe('diff --git a/src/sample.ts b/src/sample.ts');
        expect(native).toContain('--- a/src/sample.ts');
        expect(native).toContain('+++ b/src/sample.ts');
        expect(native.match(/^\+.*— edited$/gm)).toHaveLength(3);
        expect(native).not.toContain(os.tmpdir());
    });

    it('no-index-diff: identical contents measure nothing on either side', async () => {
        // Both sides have to do the work; a baseline that short-circuits on
        // equality would be measuring a different operation.
        const labels = { beforeLabel: 'a/x.ts', afterLabel: 'b/x.ts' };
        expect(await legacyNoIndexDiff('same\n', 'same\n', labels)).toBe('');
        expect(await git.gitDiffNoIndex({ before: 'same\n', after: 'same\n', ...labels })).toBe('');
    });

    it('no-index-diff: neither side leaves a temp directory behind', async () => {
        // The legacy half is measured over 25 iterations; a baseline that
        // skipped its `finally` would do less work than the code it stands for
        // and would fill the temp directory doing it.
        const tempDirs = () => fs.readdirSync(os.tmpdir()).filter(e => e.startsWith('codex-file-diff-'));
        const before = tempDirs();
        await caseById('no-index-diff').legacy(repo);
        await caseById('no-index-diff').native(repo, git);
        expect(tempDirs()).toEqual(before);
    });

    it('legacyRewriteNoIndexHeaders rewrites only the first of each header', async () => {
        // The removed line `-- signature` reaches the hunk body as
        // `--- signature`. Both implementations have to leave it alone.
        const labels = { beforeLabel: 'a/sig.txt', afterLabel: 'b/sig.txt' };
        const legacy = await legacyNoIndexDiff('keep\n-- signature\n', 'keep\n', labels);
        const native = await git.gitDiffNoIndex({ before: 'keep\n-- signature\n', after: 'keep\n', ...labels });
        expect(native).toBe(legacy.replace(/\r?\n$/, ''));
        expect(native.endsWith('--- signature')).toBe(true);
    });

    it('remote-url and repo-root: the same answers', async () => {
        expect(await caseById('remote-url').native(repo, git)).toBe(await caseById('remote-url').legacy(repo));
        // git prints the physical path and reports it with forward slashes;
        // gix reports the path discovery walked. Resolve both before comparing.
        // `realpathSync.native` rather than `realpathSync`: only the native one
        // expands a Windows 8.3 short name, and the two sides disagree about
        // whether TMPDIR is `RUNNER~1` or `runneradmin`.
        expect(path.resolve(fs.realpathSync.native(await caseById('repo-root').native(repo, git))))
            .toBe(path.resolve(fs.realpathSync.native(await caseById('repo-root').legacy(repo))));
    });

    // ── the runner ───────────────────────────────────────────────────────────

    it('benchRepo times every selected case and rules on it', async () => {
        const results = await benchRepo(repo, git, {
            cases: CASES.filter((c: { id: string }) => ['repo-root', 'remote-url'].includes(c.id)),
            iterations: 2, warmup: 1, eventLoop: false,
        });
        expect(results).toHaveLength(2);
        for (const result of results) {
            expect(result.error).toBeUndefined();
            expect(result.legacy.samples).toBe(2);
            expect(result.native.samples).toBe(2);
            expect(result.speedup).toBeGreaterThan(0);
        }
        expect(verdict(results, 0.05).gatedCount).toBe(2);
    });

    it('benchRepo records a case that throws instead of dying', async () => {
        const boom = { id: 'boom', title: 'boom', children: 1, gated: true, legacy: () => { throw new Error('nope'); }, native: () => 1 };
        const [result] = await benchRepo(repo, git, { cases: [boom], iterations: 1, warmup: 0, eventLoop: false });
        expect(result.error).toBe('nope');
        expect(result.legacy).toBeUndefined();
    });

    it('counts timer ticks for a case whose legacy path blocked', async () => {
        const [result] = await benchRepo(repo, git, {
            cases: CASES.filter((c: { id: string }) => c.id === 'repo-root'),
            iterations: 1, warmup: 0, eventLoop: true, loopRounds: 15,
        });
        // The whole point of the measurement: `execFileSync` lets no timer
        // through, and the addon's worker thread lets the loop keep running.
        expect(result.loop.legacy.ticks).toBe(0);
        expect(result.loop.native.ticks).toBeGreaterThan(0);
        expect(formatEventLoop([result])).toContain('repo-root');
        expect(formatEventLoop([result])).toContain('during 15 sequential calls');
    });
});

describe('the legacy parsers', () => {
    it('legacyParsePorcelain reads a rename, a staged edit and an untracked file', () => {
        const changes = legacyParsePorcelain('R  old.txt -> new.txt\nM  staged.txt\n M unstaged.txt\n?? new-file.txt\n!! ignored.txt\n', '/repo');
        expect(changes.map((c: { status: string; stage: string }) => `${c.stage}:${c.status}`))
            .toEqual(['staged:renamed', 'staged:modified', 'unstaged:modified', 'untracked:untracked']);
        expect(changes[0]).toMatchObject({ filePath: path.join('/repo', 'new.txt'), originalPath: path.join('/repo', 'old.txt') });
    });

    it('legacyParseCommitLine splits the nine fields the format asked for', () => {
        const commit = legacyParseCommitLine(
            'abc123|abc|a subject|A Name|a@b.c|2026-01-01T00:00:00Z|2 days ago|p1 p2|HEAD -> main, origin/main',
            '/repo', 'repo');
        expect(commit).toMatchObject({
            hash: 'abc123', shortHash: 'abc', subject: 'a subject', authorName: 'A Name',
            authorEmail: 'a@b.c', parentHashes: ['p1', 'p2'], refs: ['HEAD -> main', 'origin/main'],
        });
    });

    it('legacyParseCommitLine gives a root commit an empty parent list', () => {
        expect(legacyParseCommitLine('h|h|s|n|e|d|r||', '/repo', 'repo').parentHashes).toEqual([]);
    });

    it('legacyParseCommitFiles is name-status driven and leaves a binary file without counts', () => {
        const files = legacyParseCommitFiles(
            'M\tsrc/a.ts\nA\tbin/logo.png\nR100\tsrc/b.ts\tsrc/c.ts\n',
            '5\t2\tsrc/a.ts\n-\t-\tbin/logo.png\n1\t0\tsrc/{b.ts => c.ts}\n');
        expect(files).toEqual([
            { path: 'src/a.ts', status: 'modified', additions: 5, deletions: 2 },
            { path: 'bin/logo.png', status: 'added' },
            { path: 'src/c.ts', originalPath: 'src/b.ts', status: 'renamed', additions: 1, deletions: 0 },
        ]);
    });

    it('legacyParseRangeFiles merges numstat counts with name-status letters', () => {
        const files = legacyParseRangeFiles(
            '5\t2\tsrc/a.ts\n-\t-\tbin/logo.png\n1\t0\tsrc/c.ts\n',
            'M\tsrc/a.ts\nA\tbin/logo.png\nR100\tsrc/b.ts\tsrc/c.ts\n');
        expect(files).toEqual([
            { path: 'src/a.ts', status: 'modified', additions: 5, deletions: 2 },
            { path: 'bin/logo.png', status: 'added', additions: 0, deletions: 0 },
            { path: 'src/c.ts', status: 'renamed', additions: 1, deletions: 0, oldPath: 'src/b.ts' },
        ]);
    });
});
